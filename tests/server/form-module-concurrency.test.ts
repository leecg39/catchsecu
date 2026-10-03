import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { formContentSchema } from "@/contracts/domains";
import { questionTypes } from "@/contracts/questions";
import { requireFileScanner } from "@/server/file-scanner";
import { fingerprint, versionInclude } from "@/server/forms";
import { runOneDestruction } from "@/server/destruction-worker";
import { certificateDigest } from "@/server/destruction";
import { POST as purposeCreate } from "@/app/api/v1/processing-purposes/route";
import { POST as documentCreate } from "@/app/api/v1/documents/route";
import { POST as documentAction } from "@/app/api/v1/documents/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { GET as formRead, PATCH as formSave, POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as decision } from "@/app/api/v1/approvals/[...segments]/route";
import { POST as fixedCreate } from "@/app/api/v1/fixed-urls/route";
import { GET as publicRead, POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as uploadPost, PUT as uploadPut } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as fileRead } from "@/app/api/v1/files/[...segments]/route";
import { GET as receiptPdf } from "@/app/api/v1/submissions/[id]/receipts/[receiptId]/pdf/route";
import { POST as submissionAction } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import type { FormRecord } from "@/contracts/forms";
import type { FormConsentBundle } from "@/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const cookies = ["", ""], hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const barriers: { test: string | undefined; waiting: number; statuses: number[] }[] = [];
function req(path: string, method = "GET", input?: unknown, actor = 0, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "", ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> { expect(response.status, response.status >= 400 ? (await response.clone().json()).error?.code : "").toBe(status); return response.json(); }
const read = (id: string) => formRead(req("/forms/" + id)).then(response => ok<FormRecord>(response));
beforeAll(async () => { await requireFileScanner(); });
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE'); });
afterAll(async () => {
  await db.$disconnect();
  const target = process.env.FORM_MODULE_BARRIER_REPORT;
  if (target) {
    const path = resolve(target), allowed = resolve("docs/qa/P04-T05/concurrency") + "/";
    if (!path.startsWith(allowed) || !path.endsWith(".json")) throw new Error("Invalid barrier report path.");
    await writeFile(path, JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n");
  }
});

async function fixture() {
  const company = await db.company.create({ data: { name: "폼 경합 검증", publicName: "폼 경합", policy: { create: { requireApproval: true, approvalRoles: ["owner"] } }, services: { create: { name: "경합 서비스", externalName: "경합" } } }, include: { services: true } });
  const serviceId = company.services[0].id;
  for (const [actor, role] of (["editor", "owner"] as const).entries()) {
    const email = "form-race-" + randomUUID() + "@catchsecu.test", password = "Form-module-race!123";
    expect((await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: role }, 2))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const member = await db.membership.create({ data: { tenantId: company.id, userId: user.id, role } });
    if (role === "editor") await db.serviceGrant.create({ data: { tenantId: company.id, memberId: member.id, serviceId, capabilities: ["form.read", "form.write", "form.publish", "document.read", "document.write"] } });
    const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }, 2)); expect(login.status).toBe(200);
    cookies[actor] = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  }
  const purpose = await ok<{ id: string }>(await purposeCreate(req("/processing-purposes", "POST", { serviceId, name: "경합 수집 목적", purpose: "합성 상담", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] })), 201);
  const document = await ok<{ id: string; version: number }>(await documentCreate(req("/documents", "POST", { serviceId, type: "consent", title: "경합 동의서", body: "합성 상담 동의", refusalNotice: "거부할 수 있습니다.", rightsContact: "QA", effectiveDate: "2026-10-03", purposeIds: [purpose.id], recipientIds: [] })), 201);
  await ok(await documentAction(req("/documents/" + document.id + "/publish", "POST", { version: document.version, expiresAt: null })), 201);
  const documentVersion = await db.documentVersion.findFirstOrThrow({ where: { documentId: document.id } });
  const questions = questionTypes.map(type => ({ id: randomUUID(), type, label: type, required: true,
    ...(["객관식 답변", "체크박스", "드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"].includes(type) ? { options: ["첫째", "둘째"] } : {}),
    ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "행 A" }, { id: randomUUID(), label: "행 B" }] } : {}),
    ...(["체크박스", "행렬형 복수 선택"].includes(type) ? { selectionLimits: { min: 1, max: 1 } } : {}) }));
  const content = formContentSchema.parse({ body: "승인 전 원본", questions, consentRequired: true, consentPurpose: "합성 상담", retentionDays: 30, maxResponses: 10,
    documentConsents: [{ documentVersionId: documentVersion.id, required: true, kind: "collection" }] });
  content.questions[4].condition = { questionId: questions[2].id, operator: "equals", value: "첫째" };
  const form = await ok<FormRecord>(await formCreate(req("/forms", "POST", { serviceId, title: "아홉 질문 경합 폼", content })), 201);
  return { company, serviceId, form, content };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function requestApproval(f: Fixture) {
  const current = await read(f.form.id);
  return ok<{ id: string; version: number }>(await formAction(req("/forms/" + f.form.id + "/approvals", "POST", { version: current.version, message: "현재 아홉 질문 검토", reference: "QA" })), 201);
}
async function approve(f: Fixture) {
  const row = await requestApproval(f); await ok(await decision(req("/approvals/" + row.id + "/decision", "POST", { version: row.version, decision: "approved", reason: "합성 검토" }, 1))); return row;
}
async function publish(f: Fixture) { const current = await read(f.form.id); return ok<{ id: string; token: string }>(await formAction(req("/forms/" + f.form.id + "/publish", "POST", { version: current.version })), 201); }
async function competingFormRequests(id: string, operations: (() => Promise<Response>)[]) {
  const client = new Client({ connectionString: env.DATABASE_URL, application_name: "form-module-barrier" }); await client.connect();
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM "Form" WHERE id=$1 FOR UPDATE', [id]);
    const pending = Promise.all(operations.map(operation => operation()));
    const until = Date.now() + 2000; let waiting = 0;
    while (Date.now() < until) {
      await client.query("SELECT pg_stat_clear_snapshot()");
      const rows = await client.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Form"%' AND pid<>pg_backend_pid()`);
      waiting = Number(rows.rows[0].count); if (waiting >= operations.length) break;
      await new Promise(done => setTimeout(done, 25));
    }
    await client.query("COMMIT"); const responses = await pending; expect(waiting).toBeGreaterThanOrEqual(operations.length);
    barriers.push({ test: expect.getState().currentTestName, waiting, statuses: responses.map(response => response.status) }); return responses;
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
}
async function responseInput(f: Fixture, token: string) {
  const body = await ok<{ consentBundle: FormConsentBundle }>(await publicRead(req("/public/forms/" + token, "GET", undefined, 2))), q = (await read(f.form.id)).content.questions;
  const bytes = Buffer.from("경합의 실제 첨부 " + randomUUID()), questionId = q[6].id;
  const upload = await ok<{ id: string; uploadToken: string }>(await publicPost(req("/public/forms/" + token + "/uploads", "POST", { questionId, name: "경합.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, 2)), 201);
  expect((await uploadPut(new Request(origin + "/api/v1/uploads/" + upload.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": upload.uploadToken }, body: new Uint8Array(bytes) }))).status).toBe(200);
  await ok(await uploadPost(req("/uploads/" + upload.id + "/complete", "POST", undefined, 2, { "x-upload-token": upload.uploadToken })));
  const input = { answers: { [q[0].id]: "합성 이름", [q[1].id]: "장문", [q[2].id]: "첫째", [q[3].id]: ["첫째"], [q[4].id]: "둘째", [q[5].id]: "2026-10-03", [q[6].id]: upload.id,
    [q[7].id]: Object.fromEntries(q[7].rows!.map(row => [row.id, "첫째"])), [q[8].id]: Object.fromEntries(q[8].rows!.map(row => [row.id, ["둘째"]])) }, consent: true,
    documentConsents: body.consentBundle.documents.map(doc => doc.key), attachments: { [questionId]: { fileId: upload.id, token: upload.uploadToken } } };
  return { input, bytes, fileId: upload.id, questionId };
}
async function submit(f: Fixture, token: string) {
  const prepared = await responseInput(f, token), key = randomUUID();
  const submission = await ok<{ id: string }>(await publicPost(req("/public/forms/" + token + "/submissions", "POST", prepared.input, 2, { "idempotency-key": key })), 201);
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submission.id } });
  const pdf = await receiptPdf(req(`/submissions/${submission.id}/receipts/${receipt.id}/pdf`, "GET", undefined, 1)); expect(pdf.status).toBe(200);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer()); expect(pdfBytes.subarray(0, 4).toString()).toBe("%PDF"); expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(receipt.pdfHash);
  const stored = await db.submission.findUniqueOrThrow({ where: { id: submission.id }, include: { answers: { orderBy: { id: "asc" } } } }); expect(stored.answers).toHaveLength(9);
  return { ...prepared, key, id: submission.id, receipt, pdfBytes, formVersionId: stored.formVersionId, versionHash: fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude })), answerHash: hash(stored.answers.map(a => a.valueCipher)) };
}
async function unchanged(before: Awaited<ReturnType<typeof submit>>) {
  const receipt = await db.consentReceipt.findUniqueOrThrow({ where: { id: before.receipt.id } }); expect(receipt).toEqual(before.receipt);
  const pdf = await receiptPdf(req(`/submissions/${before.id}/receipts/${receipt.id}/pdf`, "GET", undefined, 1)); expect(pdf.status).toBe(200); expect(Buffer.from(await pdf.arrayBuffer())).toEqual(before.pdfBytes);
  const stored = await db.submission.findUniqueOrThrow({ where: { id: before.id }, include: { answers: { orderBy: { id: "asc" } } } }); expect(stored.formVersionId).toBe(before.formVersionId); expect(hash(stored.answers.map(a => a.valueCipher))).toBe(before.answerHash);
  expect(fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: before.formVersionId }, include: versionInclude }))).toBe(before.versionHash);
}

test("아홉 질문의 같은 version 저장 두 건이 실제 잠금 대기 후 한 번만 반영된다", async () => {
  const f = await fixture(), responses = await competingFormRequests(f.form.id, ["첫 요청", "둘째 요청"].map(body => () => formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: 1, content: { ...f.content, body } }, 0, { "idempotency-key": randomUUID() }))));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]); const row = await read(f.form.id); expect(row.version).toBe(2); expect(row.content.questions).toHaveLength(9); expect(row.content.questions[4].condition?.questionId).toBe(row.content.questions[2].id);
  expect(await db.auditEvent.count({ where: { resourceId: f.form.id, action: "form.draft_updated" } })).toBe(1);
  await approve(f); const live = await publish(f); await submit(f, live.token);
});
test("승인 요청과 초안 수정의 잠금 경합은 하나의 현재 내용만 승인 대상으로 만든다", async () => {
  const f = await fixture(), [approval, edit] = await competingFormRequests(f.form.id, [
    () => formAction(req("/forms/" + f.form.id + "/approvals", "POST", { version: 1, message: "원본 검토", reference: "QA" })),
    () => formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: 1, content: { ...f.content, body: "수정한 검토본" } }, 0, { "idempotency-key": randomUUID() })),
  ]); expect([[201, 409], [409, 200]]).toContainEqual([approval.status, edit.status]);
  const current = await read(f.form.id); expect(current.version).toBe(2);
  if (approval.status === 201) {
    expect(edit.status).toBe(409); const row = await approval.json(); const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } }); expect(stored.contentHash).toBe(fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude })));
    await ok(await decision(req("/approvals/" + row.id + "/decision", "POST", { version: row.version, decision: "approved", reason: "검토" }, 1)));
  } else { expect(approval.status).toBe(409); expect(edit.status).toBe(200); expect(await db.approvalRequest.count()).toBe(0); await approve(f); }
  const live = await publish(f); await submit(f, live.token);
});
test("승인 결정과 새 수정의 잠금 경합에서 수정된 내용은 이전 승인을 사용할 수 없다", async () => {
  const f = await fixture(), row = await requestApproval(f), current = await read(f.form.id);
  const [approved, edit] = await competingFormRequests(f.form.id, [
    () => decision(req("/approvals/" + row.id + "/decision", "POST", { version: row.version, decision: "approved", reason: "검토" }, 1)),
    () => formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: current.version, content: { ...f.content, body: "승인 경합 후 내용" } }, 0, { "idempotency-key": randomUUID() })),
  ]); expect(edit.status).toBe(200); expect([200, 409]).toContain(approved.status);
  const saved = await read(f.form.id), approval = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } }); expect(saved.version).toBe(3); expect(approval.status).toBe("superseded");
  expect(approval.contentHash).not.toBe(fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: approval.formVersionId }, include: versionInclude })));
  const denied = await formAction(req("/forms/" + f.form.id + "/publish", "POST", { version: saved.version })); expect(denied.status).toBe(409); expect((await denied.json()).error.code).toBe("APPROVAL_REQUIRED");
  expect(await db.publication.count()).toBe(0); await approve(f); const live = await publish(f); await submit(f, live.token);
});
test("서로 다른 승인 결정 두 건은 실제 잠금 대기 후 결정·감사를 한 번만 남긴다", async () => {
  const f = await fixture(), row = await requestApproval(f), responses = await competingFormRequests(f.form.id, (["approved", "rejected"] as const).map(verdict => () => decision(req("/approvals/" + row.id + "/decision", "POST", { version: row.version, decision: verdict, reason: "경합 검토" }, 1))));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]); const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } }); expect(stored.version).toBe(2);
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: { in: ["approval.approved", "approval.rejected"] } } })).toBe(1);
  if (stored.status === "rejected") await approve(f); const live = await publish(f); await submit(f, live.token);
});
test("새 게시와 수정의 잠금 경합 후 최초 아홉 응답·첨부·영수증 PDF는 그대로 유지된다", async () => {
  const f = await fixture(); await approve(f); const first = await publish(f), before = await submit(f, first.token);
  const fixed = await ok<{ id: string }>(await fixedCreate(req("/fixed-urls", "POST", { name: "경합 고정 주소", formId: f.form.id })), 201);
  let current = await read(f.form.id); await ok(await formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: current.version, content: { ...f.content, body: "새 승인본" } }, 0, { "idempotency-key": randomUUID() }))); await approve(f); current = await read(f.form.id);
  const [published, edit] = await competingFormRequests(f.form.id, [
    () => formAction(req("/forms/" + f.form.id + "/publish", "POST", { version: current.version })),
    () => formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: current.version, content: { ...f.content, body: "동시 새 수정" } }, 0, { "idempotency-key": randomUUID() })),
  ]); expect([published.status, edit.status].sort()).toEqual(published.status === 201 ? [201, 409] : [200, 409]);
  if (published.status === 201) { const live = await published.json(); expect((await db.fixedUrl.findUniqueOrThrow({ where: { id: fixed.id } })).publicationId).toBe(live.id); expect((await publicRead(req("/public/forms/" + first.token))).status).toBe(410); }
  else { expect(edit.status).toBe(200); expect((await publicRead(req("/public/forms/" + first.token))).status).toBe(200); await approve(f); await publish(f); }
  await unchanged(before);
  const file = await fileRead(req(`/files/${before.fileId}/download?submissionId=${before.id}&questionId=${before.questionId}`, "GET", undefined, 1)); expect(file.status).toBe(200); expect(Buffer.from(await file.arrayBuffer())).toEqual(before.bytes);
});
test("이전 응답 파기와 새 게시본 제출·영수증 읽기는 새 아홉 응답을 보존하고 파기 뒤 원문을 차단한다", async () => {
  const f = await fixture(); await approve(f); const first = await publish(f), before = await submit(f, first.token);
  let current = await read(f.form.id); await ok(await formSave(req("/forms/" + f.form.id + "/draft", "PATCH", { version: current.version, content: { ...f.content, body: "파기와 독립인 새 게시" } }, 0, { "idempotency-key": randomUUID() }))); await approve(f); const second = await publish(f), input = await responseInput(f, second.token);
  const stored = await db.submission.findUniqueOrThrow({ where: { id: before.id } });
  await ok(await submissionAction(req("/submissions/" + before.id + "/destruction-request", "POST", { version: stored.version, reason: "합성 파기" }, 1)));
  const request = await db.destructionRequest.findFirstOrThrow({ where: { submissionId: before.id } }); await ok(await destructionAction(req("/destruction-requests/" + request.id + "/approve", "POST", { version: request.version, reason: "합성 승인" }, 1)));
  const [destroyed, submitted, oldPdf] = await Promise.all([
    runOneDestruction("form-module-race"),
    publicPost(req("/public/forms/" + second.token + "/submissions", "POST", input.input, 2)),
    receiptPdf(req(`/submissions/${before.id}/receipts/${before.receipt.id}/pdf`, "GET", undefined, 1)),
  ]); expect(destroyed).toBe(true); const added = await ok<{ id: string }>(submitted, 201); expect([200, 410]).toContain(oldPdf.status); if (oldPdf.status === 200) expect(Buffer.from(await oldPdf.arrayBuffer())).toEqual(before.pdfBytes);
  expect((await db.submission.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("destroyed"); expect(await db.answer.count({ where: { submissionId: before.id } })).toBe(0); expect(await db.consentReceipt.count({ where: { submissionId: before.id } })).toBe(0);
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: before.fileId } })).status).toBe("deleted");
  expect((await receiptPdf(req(`/submissions/${before.id}/receipts/${before.receipt.id}/pdf`, "GET", undefined, 1))).status).toBe(410);
  expect((await fileRead(req(`/files/${before.fileId}/download?submissionId=${before.id}&questionId=${before.questionId}`, "GET", undefined, 1))).status).toBe(410);
  const cache = await db.idempotencyRecord.findFirstOrThrow({ where: { resourceType: "submission", resourceId: before.id } }); expect(cache.invalidatedAt).not.toBeNull(); expect(cache.responseCipher).toBeNull(); expect(cache.requestHash).toBeNull();
  expect(await db.answer.count({ where: { submissionId: added.id } })).toBe(9); expect(await db.consentReceipt.count({ where: { submissionId: added.id } })).toBe(1); expect((await db.fileObject.findUniqueOrThrow({ where: { id: input.fileId } })).status).toBe("attached");
  expect(await db.formVersion.count({ where: { formId: f.form.id } })).toBe(2); expect(fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: before.formVersionId }, include: versionInclude }))).toBe(before.versionHash);
  const certificate = await db.destructionCertificate.findUniqueOrThrow({ where: { requestId: request.id } }); expect(certificate.digest).toBe(certificateDigest(certificate)); expect(certificate.counts).toMatchObject({ answers: 9, receipts: 1, files: 1 });
  current = await read(f.form.id); expect(current.status).toBe("published"); expect((await publicRead(req("/public/forms/" + second.token))).status).toBe(200);
});
