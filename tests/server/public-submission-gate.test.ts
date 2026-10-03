import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { decrypt } from "@/server/crypto";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { GET as publicRead, POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { PUT as uploadBytes, POST as uploadAction } from "@/app/api/v1/uploads/[...segments]/route";
import type { FormContent } from "@/contracts/forms";
import { PublicSubmissionSession } from "@/lib/public-submission";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const barriers: { test: string | undefined; waiting: number; status: number }[] = [];
function req(path: string, method = "GET", input?: unknown, cookie = "", key: string = randomUUID(), headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key, ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function fixture(maxResponses = 10, file = false, verify = false) {
  const email = "public-gate-" + randomUUID() + "@catchsecu.test", password = "Public-gate!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", { name: "공개 접수 검증", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "공개 접수 합성 회사", publicName: "공개 검증", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "공개 접수", externalName: "공개 접수" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
  const mode = randomUUID(), detail = randomUUID(), matrix = randomUUID();
  const content: FormContent = { body: "합성 공개 폼", consentRequired: true, consentPurpose: "접수 시험", retentionDays: 30, maxResponses, verify,
    questions: [{ id: mode, type: "객관식 답변", label: "방식", required: true, options: ["온라인", "현장"] },
      { id: detail, type: "단문형 답변", label: "현장 정보", required: true, condition: { questionId: mode, operator: "equals", value: "현장" } },
      { id: matrix, type: "행렬형 복수 선택", label: "선택", required: true, options: ["첫째", "둘째"], rows: [{ id: randomUUID(), label: "행 A" }], selectionLimits: { min: 1, max: 1 } },
      ...(file ? [{ id: randomUUID(), type: "파일 업로드" as const, label: "증빙", required: true }] : [])] };
  const created = await createForm(req("/forms", "POST", { serviceId: company.services[0].id, title: "공개 접수 검증", content }, cookie)); expect(created.status).toBe(201);
  const form = await created.json(), published = await formAction(req("/forms/" + form.id + "/publish", "POST", { version: form.version }, cookie)); expect(published.status).toBe(201);
  const publication = await published.json(), payload = { consent: true, answers: { [mode]: "온라인", [matrix]: { [content.questions[2].rows![0].id]: ["첫째"] } } };
  return { company, serviceId: company.services[0].id, cookie, content, form, publication, payload };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function send(f: Fixture, key: string = randomUUID(), payload: unknown = f.payload) { return publicPost(req("/public/forms/" + f.publication.token + "/submissions", "POST", payload, "", key)); }
async function waitForLock(client: Client, text: string) {
  const until = Date.now() + 2500; let waiting = 0;
  while (Date.now() < until) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid() AND query LIKE $1", ["%" + text + "%"]);
    waiting = Number(rows.rows[0].count); if (waiting) break;
    await new Promise(done => setTimeout(done, 25));
  }
  return waiting;
}
async function blockedReplay(f: Fixture, change: () => Promise<unknown>) {
  const key = randomUUID(), first = await send(f, key); expect(first.status).toBe(201); const receipt = await first.json();
  const client = new Client({ connectionString: env.DATABASE_URL, application_name: "public-submission-barrier" }); await client.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["submission:" + f.publication.id + ":" + key]);
    const pending = send(f, key); const waiting = await waitForLock(client, "pg_advisory_xact_lock");
    await change(); await client.query("COMMIT"); const response = await pending;
    barriers.push({ test: expect.getState().currentTestName, waiting, status: response.status }); expect(waiting).toBeGreaterThan(0);
    expect(response.status).toBe(410); expect(await db.submission.count()).toBe(1);
    expect(await db.consentReceipt.count({ where: { submissionId: receipt.id } })).toBe(1);
    expect((await db.publication.findUniqueOrThrow({ where: { id: f.publication.id } })).responseCount).toBe(1);
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => {
  await mkdir("docs/qa/P06-T01", { recursive: true });
  await writeFile("docs/qa/P06-T01/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n");
  await db.$disconnect();
});

test("동시 제출은 한도를 넘지 않고 마지막 성공의 같은 키 재시도는 같은 영수증만 반환한다", async () => {
  const f = await fixture(2), key = randomUUID(), responses = await Promise.all([send(f, key), send(f, key)]);
  expect(responses[0].status).toBe(201); expect(responses[1].status).toBe(201);
  const remaining = await Promise.all([send(f), send(f), send(f)]);
  expect(remaining.filter(r => r.status === 201).length).toBe(1); expect(remaining.filter(r => r.status === 409).length).toBe(2);
  const first = await responses[0].json(); expect(await responses[1].json()).toEqual(first);
  expect((await send(f, key, { ...f.payload, answers: { ...f.payload.answers, [f.content.questions[2].id]: { [f.content.questions[2].rows![0].id]: ["둘째"] } } })).status).toBe(409);
  expect(await (await send(f, key)).json()).toEqual(first);
  expect(await db.submission.count()).toBe(2); expect(await db.answer.count()).toBe(6); expect(await db.consentReceipt.count()).toBe(2);
  expect(await db.consentEvent.count({ where: { type: "granted" } })).toBe(2); expect(await db.auditEvent.count({ where: { action: "submission.created" } })).toBe(2);
  const publicData = await (await publicRead(req("/public/forms/" + f.publication.token))).json(); expect(publicData.closed).toBe(true);
});
test("접수 성공 재전송이 대기하는 동안 실제 폼 중지 API가 끝나면 캐시 성공을 반환하지 않는다", async () => {
  const f = await fixture(1);
  await blockedReplay(f, async () => { const response = await formAction(req("/forms/" + f.form.id + "/pause", "POST", { version: 2 }, f.cookie)); expect(response.status).toBe(200); });
});
test.each(["service", "company", "expiry", "publication"])("대기 중 %s 종료를 재검사하고 성공 응답·자료를 추가하지 않는다", async mode => {
  const f = await fixture();
  await blockedReplay(f, async () => {
    if (mode === "service") await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
    else if (mode === "company") await db.company.update({ where: { id: f.company.id }, data: { status: "suspended" } });
    else await db.publication.update({ where: { id: f.publication.id }, data: mode === "expiry" ? { expiresAt: new Date(Date.now() - 1000) } : { status: "revoked" } });
  });
});
test("공개 조회는 회사 중지 transaction을 기다린 뒤 새 상태를 확인한다", async () => {
  const f = await fixture(), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query("BEGIN"); await client.query('UPDATE "Company" SET status=$1 WHERE id=$2', ["suspended", f.company.id]);
    const pending = publicRead(req("/public/forms/" + f.publication.token)); const waiting = await waitForLock(client, 'FROM "Company"');
    await client.query("COMMIT"); const response = await pending;
    barriers.push({ test: expect.getState().currentTestName, waiting, status: response.status }); expect(waiting).toBeGreaterThan(0); expect(response.status).toBe(410);
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
});
test("필드·다른 질문/행·숨긴 답변·동의 변조는 접수/영수증/감사/카운터를 남기지 않는다", async () => {
  const f = await fixture(), q = f.content.questions;
  const inputs = [{ ...f.payload, consent: false }, { ...f.payload, tenantId: f.company.id },
    { ...f.payload, answers: { ...f.payload.answers, [randomUUID()]: "다른 게시본 질문" } },
    { ...f.payload, answers: { ...f.payload.answers, [q[1].id]: "숨긴 현장 정보" } },
    { ...f.payload, answers: { ...f.payload.answers, [q[0].id]: "현장" } },
    { ...f.payload, answers: { ...f.payload.answers, [q[2].id]: { [randomUUID()]: ["첫째"] } } },
    { ...f.payload, answers: { ...f.payload.answers, [q[2].id]: { [q[2].rows![0].id]: ["첫째", "둘째"] } } },
    { ...f.payload, documentConsents: [randomUUID()] }];
  for (const input of inputs) expect((await send(f, randomUUID(), input)).status).toBe(422);
  expect(await db.submission.count()).toBe(0); expect(await db.answer.count()).toBe(0); expect(await db.consentReceipt.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "submission.created" } })).toBe(0);
  expect((await db.publication.findUniqueOrThrow({ where: { id: f.publication.id } })).responseCount).toBe(0);
});
test("실제 검사 파일의 잘못된 proof는 증가한 한도까지 rollback하고 같은 키의 올바른 재요청만 접수한다", async () => {
  const f = await fixture(1, true), questionId = f.content.questions[3].id, bytes = Buffer.from("공개 합성 파일 " + randomUUID());
  const upload = await publicPost(req("/public/forms/" + f.publication.token + "/uploads", "POST", { questionId, name: "공개.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
  expect(upload.status).toBe(201); const file = await upload.json(), headers = { origin, "x-upload-token": file.uploadToken };
  expect((await uploadBytes(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { ...headers, "content-type": "text/plain" }, body: new Uint8Array(bytes) }))).status).toBe(200);
  expect((await uploadAction(new Request(origin + "/api/v1/uploads/" + file.id + "/complete", { method: "POST", headers }))).status).toBe(200);
  const key = randomUUID(), input = { ...f.payload, answers: { ...f.payload.answers, [questionId]: file.id }, attachments: { [questionId]: { fileId: file.id, token: file.uploadToken } } };
  expect((await send(f, key, { ...input, attachments: { [questionId]: { fileId: file.id, token: "A".repeat(43) } } })).status).toBe(422);
  expect(await db.submission.count()).toBe(0); expect(await db.consentReceipt.count()).toBe(0); expect(await db.idempotencyRecord.count({ where: { scope: "submission:" + f.publication.id } })).toBe(0);
  expect((await db.publication.findUniqueOrThrow({ where: { id: f.publication.id } })).responseCount).toBe(0);
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("ready");
  let lost = false, calls = 0;
  const session = new PublicSubmissionSession({ makeKey: () => key, send: async (payload, requestKey) => {
    calls++; const result = await send(f, requestKey, JSON.parse(payload)); expect(result.status).toBe(201); const body = await result.json();
    if (!lost) { lost = true; throw new TypeError("success response lost after real commit"); } return body;
  } });
  await expect(session.submit(JSON.stringify(input))).rejects.toThrow("real commit"); expect(session.hasPending).toBe(true);
  expect(await db.submission.count()).toBe(1); expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).uploadTokenHash).toBeNull();
  await expect(session.submit(JSON.stringify({ ...input, consent: false }))).rejects.toThrow("이전 제출 결과"); expect(calls).toBe(1);
  const receipt = await session.retry(); expect(calls).toBe(2); expect(session.hasPending).toBe(false); expect(await db.submission.count()).toBe(1);
  const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } }); expect(stored.status).toBe("attached"); expect(stored.uploadTokenHash).toBeNull();
  const answer = await db.answer.findFirstOrThrow({ where: { submissionId: receipt.id, question: { stableKey: questionId } } }); expect(decrypt(answer.valueCipher)).toBe(file.id);
});
test("공개 DTO는 작성자·회사·내부 버전·게시/동의 선택 ID를 제외하고 잘못된 경로를 거부한다", async () => {
  const f = await fixture(), response = await publicRead(req("/public/forms/" + f.publication.token)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json(), text = JSON.stringify(data);
  for (const value of [f.company.id, f.serviceId, f.publication.id, f.form.id, "tokenCipher", "tokenHash", "documentVersionId", "ownerId"]) expect(text).not.toContain(value);
  for (const token of [f.form.id, "A".repeat(42), "A".repeat(44), "A".repeat(43)]) expect((await publicRead(req("/public/forms/" + token))).status).toBe(404);
  expect((await publicRead(req("/public/forms/" + f.publication.token + "/extra"))).status).toBe(404);
});
