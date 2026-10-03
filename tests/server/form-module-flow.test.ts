import { createHash, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { formContentSchema } from "@/contracts/domains";
import { questionTypes } from "@/contracts/questions";
import { requireFileScanner } from "@/server/file-scanner";
import { fingerprint, versionInclude } from "@/server/forms";
import { POST as purposeCreate } from "@/app/api/v1/processing-purposes/route";
import { POST as documentCreate } from "@/app/api/v1/documents/route";
import { POST as documentAction } from "@/app/api/v1/documents/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { GET as formRead, PATCH as formSave, POST as formAction, DELETE as formArchive } from "@/app/api/v1/forms/[...segments]/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";
import { POST as templateUse, DELETE as templateDelete } from "@/app/api/v1/templates/[...segments]/route";
import { POST as decision } from "@/app/api/v1/approvals/[...segments]/route";
import { POST as fixedCreate } from "@/app/api/v1/fixed-urls/route";
import { GET as publicRead, POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as uploadPost, PUT as uploadPut } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as fileRead } from "@/app/api/v1/files/[...segments]/route";
import { POST as shareCreate } from "@/app/api/v1/share-grants/route";
import type { FormRecord } from "@/contracts/forms";
import type { FormConsentBundle } from "@/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const cookies = ["", ""], hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function req(path: string, method = "GET", input?: unknown, actor = 0, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "", ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> { expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json(); }
const read = (id: string) => formRead(req("/forms/" + id)).then(response => ok<FormRecord>(response));
beforeAll(async () => { await requireFileScanner(); });
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("아홉 질문의 생성·템플릿·동의·반려/승인·게시·파일 응답·공유·새 버전·중단을 하나의 DB 흐름으로 검증한다", async () => {
  const company = await db.company.create({ data: { name: "폼 전체 검증", publicName: "폼 전체 검증", policy: { create: { requireApproval: true, approvalRoles: ["owner"] } }, services: { create: { name: "검증 서비스", externalName: "검증" } } }, include: { services: true } });
  const serviceId = company.services[0].id;
  for (const [actor, role] of (["editor", "owner"] as const).entries()) {
    const email = "form-flow-" + randomUUID() + "@catchsecu.test", password = "Form-module-flow!123";
    expect((await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: role }, 2))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const member = await db.membership.create({ data: { tenantId: company.id, userId: user.id, role } });
    await db.serviceGrant.create({ data: { tenantId: company.id, memberId: member.id, serviceId, capabilities: [...roleCapabilities(role)] } });
    const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }, 2)); expect(login.status).toBe(200);
    cookies[actor] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const purpose = await ok<{ id: string }>(await purposeCreate(req("/processing-purposes", "POST", { serviceId, name: "전체 흐름 목적", purpose: "합성 상담", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] })), 201);
  const document = await ok<{ id: string; version: number }>(await documentCreate(req("/documents", "POST", { serviceId, type: "consent", title: "전체 흐름 동의서", body: "합성 상담 개인정보 동의", refusalNotice: "거부할 수 있습니다.", rightsContact: "QA 담당자", effectiveDate: "2026-10-03", purposeIds: [purpose.id], recipientIds: [] })), 201);
  await ok(await documentAction(req("/documents/" + document.id + "/publish", "POST", { version: document.version, expiresAt: null })), 201);
  const documentVersion = await db.documentVersion.findFirstOrThrow({ where: { documentId: document.id } });
  const questions = questionTypes.map(type => ({ id: randomUUID(), type, label: type, required: true,
    ...(["객관식 답변", "체크박스", "드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"].includes(type) ? { options: ["첫째", "둘째"] } : {}),
    ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "행 A" }, { id: randomUUID(), label: "행 B" }] } : {}),
    ...(["체크박스", "행렬형 복수 선택"].includes(type) ? { selectionLimits: { min: 1, max: 1 } } : {}),
  }));
  const content = formContentSchema.parse({ body: "최초 본문", questions, consentRequired: true, consentPurpose: "합성 상담", retentionDays: 30, maxResponses: 5,
    documentConsents: [{ documentVersionId: documentVersion.id, required: true, kind: "collection" }] });
  content.questions[4].condition = { questionId: questions[2].id, operator: "equals", value: "첫째" };
  const source = await ok<FormRecord>(await formCreate(req("/forms", "POST", { serviceId, title: "전체 흐름 원본", content })), 201);
  const saved = await ok<FormRecord>(await formSave(req("/forms/" + source.id + "/draft", "PATCH", { version: source.version, content: { ...content, body: "템플릿 등록 본문" } }, 0, { "idempotency-key": randomUUID() })));
  expect(saved.id).toBe(source.id);
  const template = await ok<{ id: string; version: number }>(await templateCreate(req("/templates", "POST", { serviceId, title: "전체 흐름 양식", category: "QA", content: saved.content })), 201);
  const useKey = randomUUID(), usedRequest = { serviceId, version: template.version }, used = await ok<FormRecord>(await templateUse(req("/templates/" + template.id + "/use", "POST", usedRequest, 0, { "idempotency-key": useKey })), 201);
  expect((await ok<FormRecord>(await templateUse(req("/templates/" + template.id + "/use", "POST", usedRequest, 0, { "idempotency-key": useKey })), 201)).id).toBe(used.id);
  expect(used.id).not.toBe(source.id); expect(used.content.questions.map(q => q.type)).toEqual([...questionTypes]);
  expect(used.content.questions[4].condition?.questionId).toBe(used.content.questions[2].id);
  expect(used.content.questions[7].rows![0].id).not.toBe(content.questions[7].rows![0].id);
  expect((await templateDelete(req("/templates/" + template.id, "DELETE", undefined, 0, { "if-match": String(template.version) }))).status).toBe(204);
  expect((await read(used.id)).content).toEqual(used.content);
  async function approve(verdict: "approved" | "rejected") {
    const current = await read(used.id), approval = await ok<{ id: string; version: number }>(await formAction(req("/forms/" + used.id + "/approvals", "POST", { version: current.version, message: "아홉 질문과 동의서 검토", reference: "QA" })), 201);
    await ok(await decision(req("/approvals/" + approval.id + "/decision", "POST", { version: approval.version, decision: verdict, reason: "합성 검토" }, 1)));
  }
  await approve("rejected"); expect((await read(used.id)).status).toBe("draft"); await approve("approved");
  async function publish() { const current = await read(used.id); return ok<{ id: string; token: string }>(await formAction(req("/forms/" + used.id + "/publish", "POST", { version: current.version })), 201); }
  const publication = await publish(), publicBody = await ok<{ consentBundle: FormConsentBundle }>(await publicRead(req("/public/forms/" + publication.token, "GET", undefined, 2)));
  const fixed = await ok<{ id: string }>(await fixedCreate(req("/fixed-urls", "POST", { name: "전체 흐름 고정 주소", formId: used.id })), 201);
  const bytes = Buffer.from("폼 모듈 아홉 질문 첨부 검증 " + randomUUID()), fileQuestion = used.content.questions[6].id;
  const upload = await ok<{ id: string; uploadToken: string }>(await publicPost(req("/public/forms/" + publication.token + "/uploads", "POST", { questionId: fileQuestion, name: "전체 검증.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, 2)), 201);
  const uploadRequest = new Request(origin + "/api/v1/uploads/" + upload.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": upload.uploadToken }, body: new Uint8Array(bytes) });
  expect((await uploadPut(uploadRequest)).status).toBe(200);
  await ok(await uploadPost(req("/uploads/" + upload.id + "/complete", "POST", undefined, 2, { "x-upload-token": upload.uploadToken })));
  const q = used.content.questions, answers = { [q[0].id]: "합성 이름", [q[1].id]: "장문 답변", [q[2].id]: "첫째", [q[3].id]: ["첫째"], [q[4].id]: "둘째", [q[5].id]: "2026-10-03", [q[6].id]: upload.id,
    [q[7].id]: Object.fromEntries(q[7].rows!.map(row => [row.id, "첫째"])), [q[8].id]: Object.fromEntries(q[8].rows!.map(row => [row.id, ["둘째"]])) };
  const submissionInput = { answers, consent: true, documentConsents: publicBody.consentBundle.documents.map(doc => doc.key), attachments: { [fileQuestion]: { fileId: upload.id, token: upload.uploadToken } } };
  for (const invalid of [
    { ...submissionInput, answers: { ...answers, [q[2].id]: "둘째" } },
    { ...submissionInput, answers: { ...answers, [q[3].id]: ["첫째", "둘째"] } },
    { ...submissionInput, documentConsents: [] },
  ]) expect((await publicPost(req("/public/forms/" + publication.token + "/submissions", "POST", invalid, 2))).status).toBe(422);
  expect(await db.submission.count({ where: { tenantId: company.id } })).toBe(0);
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } })).uploadTokenHash).not.toBeNull();
  const submitKey = randomUUID(), submitted = await ok<{ id: string }>(await publicPost(req("/public/forms/" + publication.token + "/submissions", "POST", submissionInput, 2, { "idempotency-key": submitKey })), 201);
  expect((await ok<{ id: string }>(await publicPost(req("/public/forms/" + publication.token + "/submissions", "POST", submissionInput, 2, { "idempotency-key": submitKey })), 201)).id).toBe(submitted.id);
  const stored = await db.submission.findUniqueOrThrow({ where: { id: submitted.id }, include: { answers: { orderBy: { id: "asc" } }, receipts: true } });
  const immutable = await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude }), originalHash = fingerprint(immutable), answersHash = hash(stored.answers.map(a => a.valueCipher));
  expect(stored.answers).toHaveLength(9); expect(stored.receipts.length).toBeGreaterThan(0);
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } })).scanStatus).toBe("clean");
  const downloadPath = "/files/" + upload.id + "/download?submissionId=" + submitted.id + "&questionId=" + fileQuestion;
  const download = await fileRead(req(downloadPath, "GET", undefined, 1)); expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
  const share = await ok<{ id: string }>(await shareCreate(req("/share-grants", "POST", { formId: used.id, formVersionId: stored.formVersionId, email: "form-flow-share@catchsecu.local.test", questionIds: [q[0].id], expiresAt: new Date(Date.now() + 86400000).toISOString() }, 1)), 201);
  const current = await read(used.id), changed = await ok<FormRecord>(await formSave(req("/forms/" + used.id + "/draft", "PATCH", { version: current.version, content: { ...used.content, body: "새 게시 본문" } }, 0, { "idempotency-key": randomUUID() })));
  expect(changed.id).toBe(used.id); expect(changed.draftNumber).toBe(2); await approve("approved"); const newPublication = await publish();
  expect((await db.fixedUrl.findUniqueOrThrow({ where: { id: fixed.id } })).publicationId).toBe(newPublication.id);
  expect((await publicRead(req("/public/forms/" + publication.token, "GET", undefined, 2))).status).toBe(410);
  let row = await read(used.id); await ok(await formAction(req("/forms/" + used.id + "/pause", "POST", { version: row.version })));
  expect((await publicRead(req("/public/forms/" + newPublication.token, "GET", undefined, 2))).status).toBe(410);
  row = await read(used.id); await ok(await formAction(req("/forms/" + used.id + "/resume", "POST", { version: row.version })));
  expect((await publicRead(req("/public/forms/" + newPublication.token, "GET", undefined, 2))).status).toBe(200);
  row = await read(used.id); expect((await formArchive(req("/forms/" + used.id, "DELETE", undefined, 0, { "if-match": String(row.version) }))).status).toBe(204);
  expect((await publicRead(req("/public/forms/" + newPublication.token, "GET", undefined, 2))).status).toBe(410);
  const after = await db.submission.findUniqueOrThrow({ where: { id: submitted.id }, include: { answers: { orderBy: { id: "asc" } } } });
  expect(after.formVersionId).toBe(stored.formVersionId); expect(hash(after.answers.map(a => a.valueCipher))).toBe(answersHash);
  expect(fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude }))).toBe(originalHash);
  expect((await db.shareGrant.findUniqueOrThrow({ where: { id: share.id } })).formVersionId).toBe(stored.formVersionId);
  const laterDownload = await fileRead(req(downloadPath, "GET", undefined, 1)); expect(laterDownload.status).toBe(200); expect(Buffer.from(await laterDownload.arrayBuffer())).toEqual(bytes);
  expect(await db.approvalRequest.count({ where: { formId: used.id } })).toBe(3); expect(await db.submission.count({ where: { tenantId: company.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId: company.id, action: "submission.created" } })).toBe(1);
});
