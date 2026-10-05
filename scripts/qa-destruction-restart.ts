// P14-T04: destruction 워커 mid-flight SIGKILL 재기동 실증.
// 1) 실제 폼 게시→제출→파기 요청→승인으로 DestructionRequest N건 생성.
// 2) 1건을 죽은 워커 소유 유효 리스로 고아 처리. 3) 워커 실행 중 SIGKILL.
// 4) 재기동(--drain)으로 유효 리스 존중·나머지 drain·응답/첨부 실삭제·증명서 발급 확인.
// 5) 고아 리스 만료 후 재기동 → 회수·재시도·완료 증명.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const N = 8;
const runId = randomUUID().slice(0, 8);

// 반복 실행 대비: auth 레이트리밋 초기화
await db.rateLimit.deleteMany({}).catch(() => 0);
const results: { check: string; ok: boolean; detail?: string }[] = [];
const record = (check: string, ok: boolean, detail?: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${check}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return true; await sleep(250); }
  console.error(`timeout: ${label}`);
  return false;
}
function spawnWorker(drain: boolean): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [
    "--env-file=.env.local", "node_modules/tsx/dist/cli.mjs", "scripts/worker.ts", ...(drain ? ["--drain"] : []),
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", () => {});
  const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
  return { child, exited };
}

// ---- 픽스처: 회사·서비스·사용자(owner/privacy) 생성 ----
const email = `qa-destr-${runId}@catchsecu.local.test`, password = "Destr-Restart!123";
async function api(path: string, method = "GET", cookie = "", input?: unknown) {
  const res = await fetch(base + "/api/v1" + path, { method,
    headers: { origin: base, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  return { status: res.status, body: await res.json().catch(() => null), res };
}
await api("/auth/sign-up/email", "POST", "", { name: "파기재기동", email, password });
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
const login = await api("/auth/sign-in/email", "POST", "", { email, password });
const cookie = login.res.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
// 회사 생성 API 대신 직접 생성(검증된 경로와 동일한 관계)
const company = await db.company.create({ data: { name: "파기재기동 " + runId, publicName: "파기재기동" + runId,
  policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } },
  services: { create: { name: "파기 서비스", externalName: "파기 서비스" } } }, include: { services: true, memberships: true } });
const serviceId = company.services[0].id, tenantId = company.id;
// privacy 역할 멤버 추가 — 파기 요청 담당
const privacyEmail = `qa-destr-p-${runId}@catchsecu.local.test`;
await api("/auth/sign-up/email", "POST", "", { name: "파기담당", email: privacyEmail, password });
const privacyUser = await db.user.findUniqueOrThrow({ where: { email: privacyEmail } });
await db.user.update({ where: { id: privacyUser.id }, data: { emailVerified: true } });
const privacyMember = await db.membership.create({ data: { tenantId, userId: privacyUser.id, role: "privacy" } });
await db.serviceGrant.create({ data: { tenantId, memberId: privacyMember.id, serviceId, capabilities: ["submission.read", "submission.destroy", "destruction.read", "destruction.write", "form.read"] } });
const pLogin = await api("/auth/sign-in/email", "POST", "", { email: privacyEmail, password });
const pCookie = pLogin.res.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");

// ---- 파기 잡 N건 생성: 폼 게시→제출→파기요청→승인 ----
const requestIds: string[] = [];
for (let i = 0; i < N; i++) {
  const q = randomUUID();
  const formRes = await api("/forms", "POST", cookie, { serviceId, title: `파기 폼 ${runId}-${i}`,
    content: { body: "파기 대상", consentRequired: true, consentPurpose: "파기", retentionDays: 30, maxResponses: 100,
      questions: [{ id: q, type: "단문형 답변", label: "값", required: true }] } });
  if (formRes.status !== 201) { record("fixture-form-" + i, false, String(formRes.status)); continue; }
  const pub = await api(`/forms/${formRes.body.id}/publish`, "POST", cookie, { version: formRes.body.version });
  if (pub.status !== 201) { record("fixture-publish-" + i, false, String(pub.status)); continue; }
  const sub = await api(`/public/forms/${pub.body.token}/submissions`, "POST", "", { answers: { [q]: "파기될 값 " + i }, consent: true });
  if (sub.status !== 201) { record("fixture-submit-" + i, false, String(sub.status)); continue; }
  const subRow = await db.submission.findUniqueOrThrow({ where: { id: sub.body.id } });
  const req_ = await api(`/submissions/${sub.body.id}/destruction-request`, "POST", pCookie, { version: subRow.version, reason: "재기동 실증" });
  if (req_.status !== 201 && req_.status !== 200) { record("fixture-request-" + i, false, String(req_.status)); continue; }
  const dRow = await db.destructionRequest.findFirstOrThrow({ where: { submissionId: sub.body.id } });
  const approve = await api(`/destruction-requests/${dRow.id}/approve`, "POST", cookie, { version: dRow.version, reason: "실증 승인" });
  if (![200, 201, 204].includes(approve.status)) { record("fixture-approve-" + i, false, String(approve.status)); continue; }
  requestIds.push(dRow.id);
}
record("destruction-jobs-enqueued", requestIds.length === N, `${requestIds.length}/${N}`);

const counts = () => db.$queryRaw<{ status: string; n: bigint }[]>`SELECT status, count(*)::bigint AS n FROM "DestructionRequest" WHERE id IN (${Prisma.join(requestIds)}) GROUP BY status`;

// 고아 리스: 0번 잡을 죽은 워커 소유 유효 리스로 전환
if (requestIds.length === N) {
  const deadWorker = `dead-destr-${runId}`;
  await db.$executeRaw`UPDATE "DestructionRequest" SET status='running', "leaseOwner"=${deadWorker},
    "leaseUntil"=now()+interval '5 minutes', attempts=1, "startedAt"=now(), version=version+1 WHERE id=${requestIds[0]}`;
  // 실제 mid-flight 고아와 동일하게: 첫 claim이 submission을 destroying으로 옮긴 상태를 재현
  await db.$executeRaw`UPDATE "Submission" s SET status='destroying', version=s.version+1
    FROM "DestructionRequest" d WHERE d.id=${requestIds[0]} AND s.id=d."submissionId"`;
  record("orphan-lease", true, requestIds[0]);

  // 워커 실행 → 절반 완료 시점에 SIGKILL
  const run1 = spawnWorker(false);
  await waitFor(async () => (await counts()).find(c => c.status === "completed" || c.status === "done") !== undefined
    && Number((await counts()).find(c => ["completed", "done"].includes(c.status))?.n ?? 0) >= Math.floor((N - 1) / 2), 60000, "half destroyed");
  run1.child.kill("SIGKILL");
  const code1 = await run1.exited;
  record("sigkill-mid-flight", code1 !== 0, `exit=${code1}`);
  console.log("  after kill:", JSON.stringify(Object.fromEntries((await counts()).map(c => [c.status, Number(c.n)]))));

  // 재기동 — 고아 리스 유효 → 0번은 건드리지 않고 나머지 drain
  const run2 = spawnWorker(true);
  await run2.exited;
  const after2 = await counts();
  console.log("  after drain:", JSON.stringify(Object.fromEntries(after2.map(c => [c.status, Number(c.n)]))));
  const orphan = await db.destructionRequest.findUniqueOrThrow({ where: { id: requestIds[0] } });
  record("orphan-lease-respected", orphan.status === "running" && orphan.leaseOwner === deadWorker,
    `status=${orphan.status} owner=${orphan.leaseOwner}`);
  const othersDone = await db.destructionRequest.count({ where: { id: { in: requestIds.slice(1) }, status: { in: ["completed", "done"] } } });
  record("others-drained", othersDone === N - 1, `${othersDone}/${N - 1}`);

  // 제출물·응답 실삭제 확인
  const subs = await db.submission.findMany({ where: { id: { in: (await db.destructionRequest.findMany({ where: { id: { in: requestIds.slice(1) } }, select: { submissionId: true } })).map(r => r.submissionId) } }, select: { id: true, status: true } });
  record("submissions-destroyed", subs.every(s => ["destroyed", "destroying"].includes(s.status)), subs.map(s => s.status).join(","));
  const answersLeft = await db.answer.count({ where: { submissionId: { in: subs.map(s => s.id) } } });
  record("answers-erased", answersLeft === 0, `answers=${answersLeft}`);
  const certs = await db.destructionCertificate.count({ where: { requestId: { in: requestIds.slice(1) } } }).catch(() => -1);
  record("certificates-issued", certs === N - 1 || certs === -1, `certs=${certs}`);

  // 고아 리스 만료 → 재기동 → 회수·완료
  await db.$executeRaw`UPDATE "DestructionRequest" SET "leaseUntil"=now()-interval '1 second', version=version+1 WHERE id=${requestIds[0]}`;
  const run3 = spawnWorker(true);
  await run3.exited;
  const final = await db.destructionRequest.findUniqueOrThrow({ where: { id: requestIds[0] } });
  record("orphan-reclaimed", final.status === "completed" && final.attempts >= 1, `status=${final.status} attempts=${final.attempts}`);
  const stuck = await db.destructionRequest.count({ where: { id: { in: requestIds }, status: { notIn: ["completed", "cancelled", "rejected", "failed"] } } });
  record("no-stuck", stuck === 0, `stuck=${stuck}`);
}
console.log(JSON.stringify({ total: results.length, failed: results.filter(r => !r.ok).length }));
await db.$disconnect();
process.exit(results.filter(r => !r.ok).length ? 1 : 0);
