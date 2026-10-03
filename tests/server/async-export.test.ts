import { randomUUID, createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as submit } from "@/app/api/v1/public/forms/[...segments]/route";
import { GET as download } from "@/app/api/v1/forms/[id]/submissions/export/route";
import { PUT as uploadBytes, POST as uploadAction } from "@/app/api/v1/uploads/[...segments]/route";
import { POST as createExportApi, GET as listExportApi } from "@/app/api/v1/exports/route";
import { GET as exportApi, POST as cancelApi, DELETE as deleteApi } from "@/app/api/v1/exports/[...segments]/route";
import { claimExport, processExportClaim, runOneExport, cleanupExpiredExports } from "@/server/exports";
import { PATCH as correctApi, POST as submissionAction } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { runOneDestruction } from "@/server/destruction-worker";
import { Client } from "pg";
import { POST as selectContext } from "@/app/api/v1/context/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
function req(path: string, method = "GET", cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "idempotency-key": randomUUID(), ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function account(name: string) {
  const email = "export-" + randomUUID() + "@catchsecu.test", password = "Response-export!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(login.status).toBe(200);
  return { user, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const owner = await account("응답 내보내기");
  const company = await db.company.create({ data: { name: "내보내기 시험", publicName: "내보내기", policy: { create: {} },
    memberships: { create: { userId: owner.user.id, role: "owner" } }, services: { create: { name: "응답 서비스", externalName: "응답" } } }, include: { services: true } });
  const serviceId = company.services[0].id, parent = randomUUID();
  const content = { body: "", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10000,
    questions: [
      { id: parent, type: "객관식 답변", label: "방식", required: true, options: ["온라인", "현장"] },
      { id: randomUUID(), type: "단문형 답변", label: "자유 답변", required: false },
      { id: randomUUID(), type: "단문형 답변", label: "숨긴 답변", required: false, condition: { questionId: parent, operator: "equals", value: "현장" } },
      { id: randomUUID(), type: "행렬형 단일 선택", label: "만족도", required: true, options: ["좋음", "보통"], rows: [{ id: randomUUID(), label: "과정" }, { id: randomUUID(), label: "강사" }] },
      { id: randomUUID(), type: "행렬형 복수 선택", label: "관심", required: false, options: ["기초,심화", '실습"과정'], rows: [{ id: randomUUID(), label: "다음 과정" }] },
      { id: randomUUID(), type: "파일 업로드", label: "참고 파일", required: false },
    ] };
  const created = await createForm(req("/forms", "POST", owner.cookie, { serviceId, title: "응답 내보내기 폼", content }));
  expect(created.status).toBe(201); const form = await created.json();
  const published = await formAction(req("/forms/" + form.id + "/publish", "POST", owner.cookie, { version: 1 }));
  expect(published.status).toBe(201);
  return { ...owner, company, serviceId, content, id: form.id as string, token: (await published.json()).token as string };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function response(f: Fixture, text = "한글 답변", file?: { id: string; uploadToken: string }) {
  const q = f.content.questions;
  const result = await submit(req("/public/forms/" + f.token + "/submissions", "POST", "", { consent: true, answers: {
    [q[0].id]: "온라인", [q[1].id]: text, [q[3].id]: { [q[3].rows![0].id]: "보통", [q[3].rows![1].id]: "좋음" },
    [q[4].id]: { [q[4].rows![0].id]: ["기초,심화", '실습"과정'] },
    ...(file ? { [q[5].id]: file.id } : {}),
  }, ...(file ? { attachments: { [q[5].id]: { fileId: file.id, token: file.uploadToken } } } : {}) }));
  expect(result.status).toBe(201); return (await result.json()).id as string;
}

beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });
async function create(f: Fixture, key = randomUUID(), filters = {}) {
  const request = req("/exports", "POST", f.cookie, { formId: f.id, filters }); request.headers.set("idempotency-key", key);
  const result = await createExportApi(request); expect(result.status).toBe(201); return await result.json();
}
async function finish(id: string, max = 1100) {
  for (let step = 0; step < max; step++) {
    const row = await db.exportJob.findUniqueOrThrow({ where: { id } });
    if (!["queued", "processing"].includes(row.status)) { expect(row.status, row.lastError ?? undefined).toBe("ready"); return row; }
    expect(await runOneExport("test-worker", new Date(), id)).toBe(true);
  }
  throw new Error("Export steps exceeded fixture bound");
}
async function read(f: Fixture, id: string) {
  const result = await exportApi(req("/exports/" + id + "/download", "GET", f.cookie)); expect(result.status).toBe(200);
  return Buffer.from(await result.arrayBuffer());
}
async function erased(id: string) {
  const row = await db.exportJob.findUniqueOrThrow({ where: { id } });
  expect(row.filtersCipher).toBeNull(); expect(row.layoutCipher).toBeNull(); expect(row.requestHash).toBeNull(); expect(row.resultHash).toBeNull();
  expect(await db.exportChunk.count({ where: { jobId: id } })).toBe(0);
  expect(await db.exportSource.count({ where: { jobId: id, sourceHash: { not: null } } })).toBe(0);
}
async function bulk(f: Fixture, count: number) {
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.id, status: "published" } });
  const publication = await db.publication.findFirstOrThrow({ where: { formId: f.id, formVersionId: version.id } });
  await db.$executeRaw`INSERT INTO "Submission" (id,"tenantId","formVersionId","publicationId","retentionUntil","originalRetentionUntil","submittedAt","updatedAt")
    SELECT gen_random_uuid()::text,${f.company.id},${version.id},${publication.id},now()+interval '30 days',now()+interval '30 days',now()+s*interval '1 millisecond',now() FROM generate_series(1,${count}::int) s`;
}

test("같은 생성 키의 동시 요청·현재 DTO·실제 CSV가 즉시 다운로드와 일치한다", async () => {
  const f = await fixture(); await response(f, '=1+1,\n"한글"'); const key = randomUUID();
  const [a, b] = await Promise.all([create(f, key), create(f, key)]); expect(a.id).toBe(b.id); expect(JSON.stringify(a)).not.toContain("Cipher");
  expect(await db.auditEvent.count({ where: { action: "export.requested" } })).toBe(1);
  expect((await exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie))).status).toBe(409);
  const wrong = req("/exports", "POST", f.cookie, { formId: f.id, filters: { search: "other" } }); wrong.headers.set("idempotency-key", key);
  expect((await createExportApi(wrong)).status).toBe(409);
  const ready = await finish(a.id); expect(ready.processedRows).toBe(1);
  const bytes = await read(f, a.id), direct = await download(req("/forms/" + f.id + "/submissions/export", "GET", f.cookie)); expect(direct.status).toBe(200);
  expect(bytes.equals(Buffer.from(await direct.arrayBuffer()))).toBe(true); expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
  expect(await db.auditEvent.count({ where: { action: "export.downloaded" } })).toBe(1);
  const listed = await listExportApi(req("/exports?formId=" + f.id + "&page=999", "GET", f.cookie)); expect(listed.status).toBe(200); expect((await listed.json()).page).toBe(1);
  expect((await exportApi(req("/exports/" + a.id, "GET", f.cookie))).status).toBe(200);
});

test("정정 API는 처리한 CSV 원문을 같은 transaction에서 회수하고 새 작업은 새 값만 제공한다", async () => {
  const f = await fixture(), id = await response(f, "정정 전 원문"), a = await create(f); await finish(a.id);
  const result = await correctApi(req("/submissions/" + id, "PATCH", f.cookie, { version: 1, reason: "합성 정정", answers: { [f.content.questions[1].id]: "정정 후 원문" } }));
  expect(result.status).toBe(200); expect((await db.exportJob.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("invalidated"); await erased(a.id);
  expect((await exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie))).status).toBe(410);
  const b = await create(f); await finish(b.id); const bytes = await read(f, b.id); expect(bytes.toString()).toContain("정정 후 원문"); expect(bytes.toString()).not.toContain("정정 전 원문");
});

test("파일 권한을 포함한 실제 첨부 내보내기와 grant 회수는 이름과 암호화 결과를 제거한다", async () => {
  const f = await fixture(), bytes = Buffer.from("실제 첨부 합성 자료");
  const up = await submit(req("/public/forms/" + f.token + "/uploads", "POST", "", { questionId: f.content.questions[5].id, name: "=검사.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })); expect(up.status).toBe(201); const file = await up.json();
  const headers = { origin, "x-upload-token": file.uploadToken };
  expect((await uploadBytes(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { ...headers, "content-type": "text/plain" }, body: bytes }))).status).toBe(200);
  expect((await uploadAction(new Request(origin + "/api/v1/uploads/" + file.id + "/complete", { method: "POST", headers }))).status).toBe(200); await response(f, "첨부", file);
  const actor = await account("범위 담당자"), member = await db.membership.create({ data: { tenantId: f.company.id, userId: actor.user.id, role: "privacy" } });
  const grant = await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId: f.serviceId, capabilities: ["submission.read"] } });
  const privacy = { ...f, cookie: actor.cookie }, a = await create(privacy); await finish(a.id);
  expect((await read(privacy, a.id)).toString()).not.toContain("검사.txt");
  await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["submission.read", "file.read"] } }); await erased(a.id);
  const b = await create(privacy); await finish(b.id); const csv = (await read(privacy, b.id)).toString(); expect(csv).toContain("'=검사.txt"); expect(csv).not.toContain(file.id);
  await db.serviceGrant.delete({ where: { id: grant.id } }); await erased(b.id);
  expect((await exportApi(req("/exports/" + b.id + "/download", "GET", actor.cookie))).status).toBe(403);
  expect((await exportApi(req("/exports/" + b.id, "GET", f.cookie))).status).toBe(404);
});

test("취소·삭제의 version 경합과 이전 worker claim은 결과를 되살리지 않는다", async () => {
  const f = await fixture(); await response(f); const key = randomUUID(), a = await create(f, key), old = await claimExport("old", new Date(), a.id); expect(old).not.toBeNull();
  expect((await cancelApi(req("/exports/" + a.id + "/cancel", "POST", f.cookie, { version: a.version }))).status).toBe(409);
  expect((await cancelApi(req("/exports/" + a.id + "/cancel", "POST", f.cookie, { version: old!.version }))).status).toBe(200);
  await processExportClaim(old!, "old"); await erased(a.id); expect(await runOneExport("next", new Date(), a.id)).toBe(false);
  const cancelled = await db.exportJob.findUniqueOrThrow({ where: { id: a.id } });
  expect((await deleteApi(req("/exports/" + a.id, "DELETE", f.cookie, { version: cancelled.version }))).status).toBe(204);
  const retry = req("/exports", "POST", f.cookie, { formId: f.id, filters: {} }); retry.headers.set("idempotency-key", key); expect((await createExportApi(retry)).status).toBe(410);
  expect((await listExportApi(req("/exports?formId=" + f.id, "GET", f.cookie))).status).toBe(200);
});

test("동시 claim 한 건과 만료 lease 회수 이후 옛 worker는 현재 worker를 덮어쓰지 않는다", async () => {
  const f = await fixture(); await response(f); const a = await create(f), claims = await Promise.all([claimExport("a", new Date(), a.id), claimExport("b", new Date(), a.id)]);
  expect(claims.filter(Boolean)).toHaveLength(1); const old = claims.find(Boolean)!;
  await db.exportJob.update({ where: { id: a.id }, data: { leaseUntil: new Date(Date.now() - 1) } }); const next = await claimExport("recovery", new Date(), a.id); expect(next).not.toBeNull();
  await processExportClaim(old, old.leaseOwner!); expect(await db.exportChunk.count({ where: { jobId: a.id } })).toBe(0);
  await processExportClaim(next!, "recovery"); await finish(a.id); expect(await db.exportChunk.count({ where: { jobId: a.id } })).toBe(2);
});

test("5,001건은 100건씩 처리하고 즉시 CSV 한도를 넘어서도 실제 DB 행을 제공한다", async () => {
  const f = await fixture(); await bulk(f, 5001);
  expect((await download(req("/forms/" + f.id + "/submissions/export", "GET", f.cookie))).status).toBe(413);
  const a = await create(f), row = await finish(a.id, 60); expect(row.totalRows).toBe(5001); expect(row.processedRows).toBe(5001);
  const bytes = await read(f, a.id), rows = parse(bytes.toString(), { bom: true }) as string[][]; expect(rows).toHaveLength(5002);
  expect(new Set(rows.slice(1).map(r => r[0])).size).toBe(5001); expect(await db.exportChunk.count({ where: { jobId: a.id } })).toBe(52);
}, 120000);

test("100,001건은 부분 원문·성공 감사 없이 상한 오류로 종료한다", async () => {
  const f = await fixture(); await bulk(f, 100001); const a = await create(f); expect(await runOneExport("limit", new Date(), a.id)).toBe(true);
  const row = await db.exportJob.findUniqueOrThrow({ where: { id: a.id } }); expect(row.status).toBe("failed"); expect(row.lastError).toBe("SUBMISSION_EXPORT_ROWS"); await erased(a.id);
  expect(await db.auditEvent.count({ where: { action: { in: ["export.completed", "export.downloaded"] } } })).toBe(0);
}, 120000);

test("자료 보유 기한을 결과 만료에 반영하고 실제 경과 뒤 암호화 조각을 제거한다", async () => {
  const f = await fixture(), id = await response(f), deadline = new Date(Date.now() + 2000);
  await db.submission.update({ where: { id }, data: { retentionUntil: deadline } }); const a = await create(f); const row = await finish(a.id);
  expect(row.expiresAt.getTime()).toBe(deadline.getTime()); await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline.getTime() - Date.now() + 20)));
  expect((await exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie))).status).toBe(410); await erased(a.id);
  const b = await create(f); await finish(b.id); await db.exportJob.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1) } }); expect(await cleanupExpiredExports()).toBe(1); await erased(b.id);
});

test("미인증·타 회사·현재 역할 회수와 잘못된 필터는 결과를 노출하지 않는다", async () => {
  const f = await fixture(); await response(f); const a = await create(f); await finish(a.id);
  expect((await exportApi(req("/exports/" + a.id + "/download"))).status).toBe(401);
  const other = await fixture(); expect((await exportApi(req("/exports/" + a.id, "GET", other.cookie))).status).toBe(404);
  expect((await createExportApi(req("/exports", "POST", f.cookie, { formId: f.id, filters: { tenantId: other.company.id } }))).status).toBe(422);
  await db.membership.create({ data: { tenantId: f.company.id, userId: other.user.id, role: "owner" } });
  await db.membership.updateMany({ where: { tenantId: f.company.id, userId: f.user.id }, data: { role: "viewer" } }); await erased(a.id);
  expect((await exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie))).status).toBe(403);
});

test("다운로드는 실제 응답 잠금 대기 후 보유 기한 변경을 재검사해 원문을 제공하지 않는다", async () => {
  const f = await fixture(), id = await response(f, "파기 전 원문"), a = await create(f); await finish(a.id);
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM "Submission" WHERE id=$1 FOR UPDATE', [id]);
    const reading = exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie)); let count = 0;
    for (let i = 0; i < 200 && !count; i++) { await client.query("SELECT pg_stat_clear_snapshot()"); const waiting = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Submission%' AND pid<>pg_backend_pid()"); count = waiting.rows[0].n; if (!count) await new Promise(r => setTimeout(r, 10)); }
    expect(count).toBeGreaterThan(0);
    await client.query('UPDATE "Submission" SET "retentionUntil"=now()-interval \'1 second\',"retentionVersion"="retentionVersion"+1 WHERE id=$1', [id]); await client.query("COMMIT");
    expect((await reading).status).toBe(410); await erased(a.id);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});

test("실제 파기 요청·승인·worker는 기존 CSV 조각과 답변 원문을 제거한다", async () => {
  const f = await fixture(), id = await response(f, "파기 대상 원문"), a = await create(f); await finish(a.id);
  expect((await submissionAction(req("/submissions/" + id + "/destruction-request", "POST", f.cookie, { version: 1, reason: "합성 파기 요청" }))).status).toBe(200);
  await erased(a.id); const request = await db.destructionRequest.findFirstOrThrow({ where: { submissionId: id } });
  expect((await destructionAction(req("/destruction-requests/" + request.id + "/approve", "POST", f.cookie, { version: request.version, reason: "합성 승인" }))).status).toBe(200);
  expect(await runOneDestruction("export-destruction-test")).toBe(true); expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("destroyed");
  expect(await db.answer.count({ where: { submissionId: id } })).toBe(0); await erased(a.id);
  expect((await exportApi(req("/exports/" + a.id + "/download", "GET", f.cookie))).status).toBe(410);
});

test("빈 검색 결과·진행 중 요청 한도와 Origin·요청 키 유효성을 검사한다", async () => {
  const f = await fixture(); await response(f); const empty = await create(f, randomUUID(), { search: "missing" }); const ready = await finish(empty.id);
  expect(ready.totalRows).toBe(0); expect((parse((await read(f, empty.id)).toString(), { bom: true }) as string[][])).toHaveLength(1);
  const noKey = req("/exports", "POST", f.cookie, { formId: f.id }); noKey.headers.delete("idempotency-key"); expect((await createExportApi(noKey)).status).toBe(400);
  const evil = req("/exports", "POST", f.cookie, { formId: f.id }); evil.headers.set("origin", "https://other.invalid"); expect((await createExportApi(evil)).status).toBe(403);
  for (let i = 0; i < 5; i++) await create(f);
  expect((await createExportApi(req("/exports", "POST", f.cookie, { formId: f.id }))).status).toBe(409);
});

test("20MB 상한은 실제 큰 암호화 응답을 처리하며 부분 결과와 원문을 제거한다", async () => {
  const f = await fixture(), id = await response(f); const question = await db.question.findFirstOrThrow({ where: { stableKey: f.content.questions[1].id } });
  await db.answer.updateMany({ where: { submissionId: id, questionId: question.id }, data: { valueCipher: encrypt("x".repeat(21 * 1024 * 1024)) } });
  const a = await create(f); expect(await runOneExport("byte-limit", new Date(), a.id)).toBe(true); expect(await runOneExport("byte-limit", new Date(), a.id)).toBe(true);
  const row = await db.exportJob.findUniqueOrThrow({ where: { id: a.id } }); expect(row.status).toBe("failed"); expect(row.lastError).toBe("SUBMISSION_EXPORT_BYTES"); await erased(a.id);
  expect(await db.auditEvent.count({ where: { action: { in: ["export.completed", "export.downloaded"] } } })).toBe(0);
}, 120000);

test("전문가 열람자의 여분 grant는 응답 내보내기 권한으로 승격되지 않는다", async () => {
  const f = await fixture(); await response(f); const actor = await account("내보내기 전문가"), deadline = new Date(Date.now() + 1800000);
  const assignment = await db.expertAssignment.create({ data: { tenantId: f.company.id, expertUserId: actor.user.id, assignedById: f.user.id, expiresAt: deadline } });
  await db.expertAssignmentService.create({ data: { tenantId: f.company.id, assignmentId: assignment.id, serviceId: f.serviceId } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: actor.user.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId: f.serviceId, capabilities: ["service.read", "submission.read", "file.read"] } });
  expect((await selectContext(req("/context", "POST", actor.cookie, { companyId: f.company.id }))).status).toBe(200);
  expect((await createExportApi(req("/exports", "POST", actor.cookie, { formId: f.id }))).status).toBe(403);
  expect((await listExportApi(req("/exports?formId=" + f.id, "GET", actor.cookie))).status).toBe(403);
  await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await createExportApi(req("/exports", "POST", actor.cookie, { formId: f.id }))).status).toBe(403);
});
