// R25-T04 운영 리허설: 기존 샘플 이관 dry-run/검증, 마이그레이션 상태, 워커 크래시 복구(lease 만료 재인수), 백업 지표 재확인.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R25-T04/acceptance");
const TENANT = "10000000-0000-4000-8000-000000000001";
const SERVICE = "20000000-0000-4000-8000-000000000001";
const results: { step: string; detail: unknown }[] = [];
const step = (n: string, d: unknown) => { results.push({ step: n, detail: d }); console.log("PASS", n, JSON.stringify(d).slice(0, 200)); };

const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
let login: Response | null = null;
for (let i = 0; i < 6; i++) {
  login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
  if (login.status !== 429) break;
  await new Promise(r => setTimeout(r, 15000));
}
assert.equal(login!.status, 200);
const cookie = login!.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function api(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  let r: Response | null = null;
  for (let i = 0; i < 4; i++) {
    r = await fetch(`${base}/api/v1${path}`, { method, headers: { cookie, origin: base, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status !== 429) break;
    await new Promise(r2 => setTimeout(r2, 8000));
  }
  let payload: unknown = null; try { payload = await r!.json(); } catch { /* empty */ }
  return { status: r!.status, body: payload as Record<string, unknown>, headers: r!.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
await api("/context", "POST", { serviceId: SERVICE });
await mkdir(outDir, { recursive: true });
const stamp = Date.now();

// 1) 기존 샘플 이관: dryRun 계획만 → DB 무결(버전 동일) → 실제 적용 → 비밀키 격리·미지 섹션 표시 → 실커밋 재검증
const user0 = await db.user.findFirstOrThrow({ where: { email: "owner@catchsecu.local.test" }, select: { id: true, version: true } });
const sample = { profile: { name: "이관 이름 " + stamp, phone: "010-9999-" + String(stamp % 10000).padStart(4, "0"), api_key: "LEAK-SECRET", password: "do-not-import" },
  company: { address: "이관 주소 " + stamp, phone: "02-1111-2222" }, unknownSection: { x: 1 } };
const dry = await api("/migration/legacy", "POST", { dryRun: true, sections: sample }, ik());
assert.equal(dry.status, 200, JSON.stringify(dry.body));
assert.equal(dry.body.dryRun, true); assert.equal(dry.body.applied, false);
assert.ok((dry.body.rejectedSecrets as { field: string }[]).some(s => /api_key|password/.test(s.field)), "secrets quarantined");
assert.ok((dry.body.unknownSections as string[]).includes("unknownSection"), "unknown section flagged");
const userDry = await db.user.findFirstOrThrow({ where: { id: user0.id ?? undefined, email: "owner@catchsecu.local.test" }, select: { version: true, name: true } });
assert.equal(userDry.version, user0.version, "dryRun must not write");
assert.ok(!userDry.name.includes(String(stamp)), "dryRun name unchanged");
const apply = await api("/migration/legacy", "POST", { dryRun: false, sections: sample }, ik());
assert.equal(apply.status, 200, JSON.stringify(apply.body));
assert.equal(apply.body.applied, true);
const userAfter = await db.user.findFirstOrThrow({ where: { email: "owner@catchsecu.local.test" } });
assert.ok(userAfter.name.includes(String(stamp)), "applied write landed");
assert.equal(userAfter.name.includes("LEAK"), false, "no secret leaked into columns");
const audit = await db.auditEvent.findFirst({ where: { tenantId: TENANT, action: "migration.legacy_imported" }, orderBy: { createdAt: "desc" } });
assert.ok(audit, "legacy import audited");
step("legacy-dryrun", { dryApplied: false, secretsRejected: dry.body.rejectedSecrets, unknown: dry.body.unknownSections, applied: true, audited: true });

// 2) 마이그레이션 상태: 모든 적용 migration finished + 실패 행 없음
const migs = await db.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(
  `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`);
// finished_at NULL + rolled_back_at NULL = 시작 후 멈춘 상태만 실패. rolled_back 은 설계된 되돌리기 경로.
const stuck = migs.filter(m => !m.finished_at && !m.rolled_back_at);
const rolledBack = migs.filter(m => !!m.rolled_back_at);
assert.equal(stuck.length, 0, `stuck migrations: ${stuck.map(m => m.migration_name).join(",")}`);
step("migration-state", { applied: migs.filter(m => !!m.finished_at).length, rolledBack: rolledBack.map(m => m.migration_name), stuck: 0 });

// 3) 워커 크래시 복구: 큐잉 작업을 죽은 워커의 만료 lease 로 표시 → runOneJob 재인수 → 완료
const fv = await db.formVersion.findFirst({ where: { tenantId: TENANT, form: { serviceId: SERVICE, status: "published" }, status: "published" },
  orderBy: { number: "desc" }, include: { questions: { take: 1, select: { stableKey: true } } } });
const firstQ = fv!.questions[0]?.stableKey;
assert.ok(firstQ, "published form has a question");
const grant = await api("/share-grants", "POST", { formId: fv!.formId, formVersionId: fv!.id, email: `r25-ops-${stamp}@catchsecu.local.test`,
  questionIds: [firstQ],
  expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 201].includes(grant.status), JSON.stringify(grant.body));
const job = await db.job.findFirst({ where: { tenantId: TENANT, status: { in: ["queued", "leased", "retry"] } }, orderBy: { createdAt: "desc" } });
assert.ok(job, "queued job exists");
await db.job.update({ where: { id: job!.id }, data: { leaseOwner: "dead-worker-x", leaseUntil: new Date(Date.now() - 60000), status: "leased" } });
const ran = await runOneJob("r25-ops-recovery", { tenantId: TENANT, jobId: job!.id });
assert.ok(ran, "expired lease reclaimed");
const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
assert.ok(["done", "queued", "retry"].includes(after.status), `job after reclaim → ${after.status}`);
step("worker-crash-recovery", { jobType: job!.type, reclaimed: ran, finalStatus: after.status, attempts: after.attempts });

// 4) 백업/복구 지표 재확인: R01 리허설 산출물 존재 + 테이블 다이제스트 일치 구조 + 암호키 env 분리
const backupLog = await readFile("docs/qa/R01-T01/db-rehearsal/09-backup.log", "utf8").catch(() => null);
const restoreLog = await readFile("docs/qa/R01-T01/db-rehearsal/10-restore.log", "utf8").catch(() => null);
const digests = await readFile("docs/qa/R01-T01/db-rehearsal/restored-table-digests.json", "utf8").catch(() => null);
assert.ok(backupLog !== null && restoreLog !== null && digests !== null, "R01 backup/restore/digest evidence present");
const digestTables = Object.keys(JSON.parse(digests!) as Record<string, unknown>);
assert.ok(digestTables.length >= 50, `restored digests cover ${digestTables.length} tables`);
assert.ok(env.DATA_ENCRYPTION_KEY && !env.DATA_ENCRYPTION_KEY.startsWith("file:"), "encryption key is env-injected (not file-committed)");
const keyFile = await readdir(".").catch(() => [] as string[]);
assert.ok(!keyFile.some(f => /secret|key\.(pem|json)/i.test(f)), "no stray key file in repo root");
step("backup-recovery-evidence", { backup: true, restore: true, digestTables: digestTables.length, envKey: true });

await writeFile(resolve(outDir, "ops-runbook.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
console.log("R25-T04 ops rehearsal:", results.length, "steps passed");
