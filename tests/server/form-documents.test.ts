import { beforeAll, beforeEach, afterAll, describe, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Prisma, type Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext } from "@/server/context";
import { roleCapabilities } from "@/server/permissions";
import { decrypt } from "@/server/crypto";
import { canonicalDocument } from "@/server/documents";
import { sha256 } from "@/server/pdf-renderer";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { runOneDestruction } from "@/server/destruction-worker";
import { emptyDisplay, type DocumentInput, type DocumentRecord, type DisplayRecord } from "@/contracts/documents";
import type { FormRecord, FormContent, Paged } from "@/contracts/forms";
import type { ConsentEvidence, FormConsentBundle, FormDocumentOption, DocumentSelection } from "@/contracts/form-documents";
import { POST as docCreate } from "@/app/api/v1/documents/route";
import { PATCH as docEdit, POST as docAction } from "@/app/api/v1/documents/[...segments]/route";
import { POST as purposeCreate } from "@/app/api/v1/processing-purposes/route";
import { GET as displayGet, PATCH as displayEdit } from "@/app/api/v1/services/[id]/consent-display/[kind]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { PATCH as formEdit, POST as formAction, GET as formGet } from "@/app/api/v1/forms/[...segments]/route";
import { GET as options } from "@/app/api/v1/forms/document-options/route";
import { GET as publicGet, POST as publicSubmit } from "@/app/api/v1/public/forms/[...segments]/route";
import { GET as receiptPdf } from "@/app/api/v1/submissions/[id]/receipts/[receiptId]/pdf/route";
import { GET as subGet, POST as subAction } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { POST as decision } from "@/app/api/v1/approvals/[...segments]/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";
import { POST as templateAction } from "@/app/api/v1/templates/[...segments]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "", ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function ok<T = Record<string, unknown>>(response: Response, status = 200): Promise<T> { expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json(); }
const displayPath = () => "/services/" + service + "/consent-display/collection";
async function display(startText: string, publicationId?: string) {
  const current = await ok<DisplayRecord>(await displayGet(req(displayPath())));
  return ok<DisplayRecord>(await displayEdit(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: current.version, startText,
    ...(publicationId ? { policyMode: "document", publicationId } : {}) })));
}
async function document(patch: Partial<DocumentInput> = {}) {
  const serviceId = patch.serviceId ?? service;
  const purpose = await ok<{id:string}>(await purposeCreate(req("/processing-purposes", "POST", "owner", { serviceId, name: "증거 목적 " + randomUUID(), purpose: "합성 상담", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, { "idempotency-key": randomUUID() })), 201);
  const input: DocumentInput = { serviceId, title: "동의 문서 " + randomUUID(), type: "consent", body: "당시의 한글 동의 본문", refusalNotice: "동의를 거부할 수 있습니다.", rightsContact: "QA 문의", effectiveDate: "2026-10-03", recipientIds: [], ...patch, purposeIds: [purpose.id] };
  const row = await ok<DocumentRecord>(await docCreate(req("/documents", "POST", "owner", input, { "idempotency-key": randomUUID() })), 201);
  const published = await ok<{ document: DocumentRecord; publicationId: string }>(await docAction(req(`/documents/${row.id}/publish`, "POST", "owner", { version: row.version, expiresAt: null })), 201);
  const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.id } });
  return { ...published, version, input };
}
const selection = (row: Awaited<ReturnType<typeof document>>, required = true): DocumentSelection => ({ documentVersionId: row.version.id, required, kind: "collection" });
function content(documentConsents: DocumentSelection[] = [], patch: Partial<FormContent> = {}): FormContent {
  return { body: "제출 시점의 개인정보 안내", questions: [{ id: randomUUID(), label: "합성 이름", type: "단문형 답변", required: true }],
    font: "16px", bold: false, verify: false, consentPurpose: "상담 신청", consentRequired: true, retentionDays: 30, maxResponses: 100, showSubmitNotice: true, documentConsents, ...patch };
}
async function form(documents: DocumentSelection[] = [], patch: Partial<FormContent> = {}) {
  return ok<FormRecord>(await formCreate(req("/forms", "POST", "owner", { serviceId: service, title: "동의 폼 " + randomUUID(), content: content(documents, patch) }, { "idempotency-key": randomUUID() })), 201);
}
const readForm = (id: string) => formGet(req("/forms/" + id)).then(response => ok<FormRecord>(response));
const publish = (row: FormRecord) => formAction(req(`/forms/${row.id}/publish`, "POST", "owner", { version: row.version }, { "idempotency-key": randomUUID() }));
async function live(row: FormRecord) {
  const publication = await ok<{ token: string }>(await publish(row), 201);
  const body = await ok<{ title: string; content: FormContent; consentBundle: FormConsentBundle }>(await publicGet(req("/public/forms/" + publication.token)));
  return { ...publication, body, form: row };
}
function submit(row: Awaited<ReturnType<typeof live>>, patch: Record<string, unknown> = {}, key = randomUUID()) {
  return publicSubmit(req(`/public/forms/${row.token}/submissions`, "POST", "anonymous", { answers: { [row.form.content.questions[0].id]: "합성 응답자" }, consent: true,
    documentConsents: row.body.consentBundle.documents.filter(item => item.required).map(item => item.key), ...patch }, { "idempotency-key": key }));
}
const download = (id: string, receiptId: string, who = "owner") => receiptPdf(req(`/submissions/${id}/receipts/${receiptId}/pdf`, "GET", who));
async function signup(name: string, role: Role, tenantId = tenant) {
  await db.rateLimit.deleteMany(); const email = name + "@form-documents.local.test", password = "Receipt-test-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  if (tenantId === tenant) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "당시 회사", policy: { create: {} } } });
  for (const id of [service, second]) await db.service.create({ data: { id, tenantId: tenant, name: id, externalName: "당시 서비스" } });
  await signup("owner", "owner"); await signup("editor", "editor"); await signup("viewer", "viewer"); await signup("privacy", "privacy"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireApproval: false } }); });
afterAll(async () => { await db.$disconnect(); });

describe("versioned form documents and consent receipt PDFs", () => {
  test("publishes frozen display and policy text without leaking internal scope identifiers", async () => {
    const policy = await document({ type: "privacy_policy" }), doc = await document(); await display("고정된 수집 안내", policy.publicationId);
    const row = await form([selection(doc)]), published = await live(row);
    expect(published.body.consentBundle.display).toMatchObject({ name: "당시 서비스(당시 회사)", startText: "고정된 수집 안내", policy: { kind: "document", contentHash: policy.version.contentHash } });
    expect(published.body.content).not.toHaveProperty("documentConsents");
    const wire = JSON.stringify(published.body);
    for (const value of [tenant, service, doc.document.id, doc.version.id, policy.publicationId]) expect(wire).not.toContain(value);
    expect(published.body.consentBundle.documents[0]).toMatchObject({ title: doc.input.title, renderedText: doc.version.renderedText, contentHash: doc.version.contentHash, required: true });
    await display("別 설정");
  });
  test("validates published same-service selections, kind, duplicate documents and retention limit", async () => {
    const doc = await document(), other = await document({ serviceId: second }), policy = await document({ type: "privacy_policy" });
    for (const documentVersionId of [other.version.id, policy.version.id, randomUUID()]) {
      expect((await formCreate(req("/forms", "POST", "owner", { serviceId: service, title: "잘못된 선택", content: content([{ ...selection(doc), documentVersionId }]) }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    }
    expect((await formCreate(req("/forms", "POST", "owner", { serviceId: service, title: "초과", content: content([selection(doc)], { retentionDays: 31 }) }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const next = await ok<DocumentRecord>(await docEdit(req(`/documents/${doc.document.id}`, "PATCH", "owner", { ...doc.input, version: doc.document.version, body: "두 번째 본문" })));
    await ok(await docAction(req(`/documents/${next.id}/publish`, "POST", "owner", { version: next.version, expiresAt: null })), 201);
    const v2 = await db.documentVersion.findFirstOrThrow({ where: { documentId: next.id, number: 2 } });
    expect((await formCreate(req("/forms", "POST", "owner", { serviceId: service, title: "같은 문서 두 버전", content: content([selection(doc), { ...selection(doc), documentVersionId: v2.id }]) }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  });
  test("rejects missing, unknown and duplicate acknowledgments before creating any response", async () => {
    const row = await live(await form([selection(await document())]));
    for (const documentConsents of [[], [randomUUID()], [row.body.consentBundle.documents[0].key, row.body.consentBundle.documents[0].key]])
      expect((await submit(row, { documentConsents })).status).toBe(422);
    expect(await db.submission.count({ where: { formVersion: { formId: row.form.id } } })).toBe(0);
  });
  test("stores one encrypted immutable receipt for retry and parses its actual Korean PDF bytes", async () => {
    const doc = await document(), row = await live(await form([selection(doc)])), key = randomUUID();
    const responses = await Promise.all([submit(row, {}, key), submit(row, {}, key)]);
    const [first, again] = await Promise.all(responses.map(response => ok<{id:string}>(response, 201))); expect(first.id).toBe(again.id);
    const receipts = await db.consentReceipt.findMany({ where: { submissionId: first.id } }); expect(receipts).toHaveLength(1);
    const stored = receipts[0], evidence = decrypt<ConsentEvidence>(stored.evidenceCipher!);
    expect(evidence).toMatchObject({ receiptId: stored.id, submissionId: first.id, generalConsent: true, bundle: { documents: [{ title: doc.input.title, contentHash: doc.version.contentHash }] } });
    expect(stored.evidenceCipher).not.toContain(doc.input.title); expect(stored.pdfCipher).not.toContain("%PDF");
    expect(sha256(canonicalDocument(evidence))).toBe(stored.documentHash);
    const response = await download(first.id, stored.id); expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer()); expect(sha256(bytes)).toBe(stored.pdfHash);
    expect(response.headers.get("x-document-sha256")).toBe(stored.documentHash); expect(response.headers.get("cache-control")).toContain("no-store");
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), pdf = await task.promise;
    try {
      const text: string[] = []; for (let i = 1; i <= pdf.numPages; i++) text.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(""));
      const normalized = text.map(page => page.replace(/v1\s*\|\s*\d+\s*\/\s*\d+/g, "")).join("").replace(/\s/g, "");
      for (const expected of ["개인정보 동의 영수증", doc.input.title, doc.version.renderedText, stored.documentHash, first.id]) expect(normalized).toContain(expected.replace(/\s/g, ""));
      expect(normalized).not.toContain("합성응답자"); expect(await pdf.getJSActions()).toBeNull();
    } finally { await task.destroy(); }
    await expect(db.consentReceipt.update({ where: { id: stored.id }, data: { pdfHash: "f".repeat(64) } })).rejects.toThrow();
    await expect(db.consentReceipt.delete({ where: { id: stored.id } })).rejects.toThrow();
    expect(Buffer.from(await (await download(first.id, stored.id)).arrayBuffer())).toEqual(Buffer.from(bytes));
  });
  test("optional refusals never become granted documents and an all-refused response has no receipt", async () => {
    const row = await live(await form([selection(await document(), false)], { consentRequired: false }));
    const none = await ok<{id:string}>(await submit(row, { consent: false, documentConsents: [] }), 201);
    expect(await db.consentReceipt.count({ where: { submissionId: none.id } })).toBe(0);
    const general = await ok<{id:string}>(await submit(row, { documentConsents: [] }), 201);
    const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: general.id } });
    expect(decrypt<ConsentEvidence>(receipt.evidenceCipher!).bundle.documents).toEqual([]);
    const only = await ok<{id:string}>(await submit(row, { consent: false, documentConsents: [row.body.consentBundle.documents[0].key] }), 201);
    const accepted = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: only.id } });
    expect(decrypt<ConsentEvidence>(accepted.evidenceCipher!)).toMatchObject({ generalConsent: false, bundle: { documents: [{ key: row.body.consentBundle.documents[0].key }] } });
  });
  test("source edits, display changes and public-link revocation preserve published forms and receipt bytes", async () => {
    const doc = await document(); await display("원래 표시 문구"); const row = await live(await form([selection(doc)]));
    const sub = await ok<{id:string}>(await submit(row), 201), receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: sub.id } });
    const bytes = Buffer.from(await (await download(sub.id, receipt.id)).arrayBuffer());
    await display("바뀐 표시 문구");
    const changed = await ok<DocumentRecord>(await docEdit(req(`/documents/${doc.document.id}`, "PATCH", "owner", { ...doc.input, body: "현재는 다른 본문", version: doc.document.version })));
    await ok(await docAction(req(`/documents/${changed.id}/unpublish`, "POST", "owner", { version: changed.version })));
    const frozen = await ok<{consentBundle:FormConsentBundle}>(await publicGet(req("/public/forms/" + row.token)));
    expect(frozen.consentBundle).toEqual(row.body.consentBundle); expect((await submit(row)).status).toBe(201);
    expect(Buffer.from(await (await download(sub.id, receipt.id)).arrayBuffer())).toEqual(bytes);
    await ok(await subAction(req(`/submissions/${sub.id}/withdraw`, "POST", "owner", { version: 1, reason: "합성 철회" })));
    expect(Buffer.from(await (await download(sub.id, receipt.id)).arrayBuffer())).toEqual(bytes);
    expect(await db.consentEvent.count({ where: { receiptId: receipt.id, type: "withdrawn" } })).toBe(1);
  });
  test("approval freezes document display and saving refreshed settings requires approval again", async () => {
    const doc = await document(); await display("승인 당시 안내"); const row = await form([selection(doc)]);
    await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireApproval: true, approvalRoles: ["owner"] } });
    const approval = await ok<{id:string;version:number;snapshot:{consentBundle:FormConsentBundle}}>(await formAction(req(`/forms/${row.id}/approvals`, "POST", "owner", { version: row.version, message: "문서 검토", reference: "QA" }, { "idempotency-key": randomUUID() })), 201);
    expect(approval.snapshot.consentBundle.display?.startText).toBe("승인 당시 안내");
    await ok(await decision(req(`/approvals/${approval.id}/decision`, "POST", "owner", { version: approval.version, decision: "approved", reason: "문서 확인" })));
    await display("새 안내");
    const current = await readForm(row.id);
    const updated = await ok<FormRecord>(await formEdit(req(`/forms/${row.id}`, "PATCH", "owner", { version: current.version, content: current.content })));
    expect(updated.consentBundle?.display?.startText).toBe("새 안내");
    expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "superseded" });
    expect((await publish(updated)).status).toBe(409);
    const snapshot = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }); expect(JSON.stringify(snapshot.snapshot)).toContain("승인 당시 안내");
  });
  test("database rejects published binding edits and cross-service draft references", async () => {
    const doc = await document(), row = await form([selection(doc)]), version = await db.formVersion.findFirstOrThrow({ where: { formId: row.id } });
    const binding = await db.formDocumentBinding.findFirstOrThrow({ where: { formVersionId: version.id } });
    await expect(db.formDocumentBinding.create({ data: { ...binding, id: randomUUID(), serviceId: second, order: 1, displaySnapshot: binding.displaySnapshot as Prisma.InputJsonValue } })).rejects.toThrow();
    await live(row);
    await expect(db.formDocumentBinding.delete({ where: { id: binding.id } })).rejects.toThrow();
    await expect(db.formDocumentBinding.update({ where: { id: binding.id }, data: { required: false } })).rejects.toThrow();
    await expect(db.formVersion.update({ where: { id: version.id }, data: { consentDisplay: {} } })).rejects.toThrow();
  });
  test("current grants, tenant and retention control PDF access even with a previously loaded context", async () => {
    const row = await live(await form()), sub = await ok<{id:string}>(await submit(row), 201), receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await download(sub.id, receipt.id, "anonymous")).status).toBe(401); expect((await download(sub.id, receipt.id, "foreign")).status).toBe(404);
    expect((await download(sub.id, receipt.id, "viewer")).status).toBe(403);
    expect((await download(sub.id, receipt.id, "privacy")).status).toBe(200);
    const ctx = await requireContext(req("/context", "GET", "privacy").headers, "submission.read");
    await db.serviceGrant.updateMany({ where: { memberId: members.privacy }, data: { capabilities: [] } });
    try { await expect(privateConsentReceiptPdf(ctx, sub.id, receipt.id, randomUUID())).rejects.toMatchObject({ status: 403 }); }
    finally { await db.serviceGrant.updateMany({ where: { memberId: members.privacy }, data: { capabilities: [...roleCapabilities("privacy")] } }); }
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    expect((await download(sub.id, receipt.id)).status).toBe(410);
    await db.submission.update({ where: { id: sub.id }, data: { legalHold: true } }); expect((await download(sub.id, receipt.id)).status).toBe(200);
    await db.submission.update({ where: { id: sub.id }, data: { legalHold: false } });
  });
  test("approved destruction removes encrypted evidence, PDF and events then blocks downloads", async () => {
    const row = await live(await form([selection(await document())])), sub = await ok<{id:string}>(await submit(row), 201);
    const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: sub.id } }); expect(receipt.pdfCipher).toBeTruthy();
    const request = await ok<{destructionId:string}>(await subAction(req(`/submissions/${sub.id}/destruction-request`, "POST", "owner", { version: 1, reason: "검증 완료" })));
    const destruction = await db.destructionRequest.findUniqueOrThrow({ where: { id: request.destructionId } });
    await ok(await destructionAction(req(`/destruction-requests/${destruction.id}/approve`, "POST", "owner", { version: destruction.version, reason: "완전 파기" })));
    expect(await runOneDestruction("receipt-qa")).toBe(true);
    expect(await db.consentReceipt.count({ where: { submissionId: sub.id } })).toBe(0); expect(await db.consentEvent.count({ where: { receiptId: receipt.id } })).toBe(0);
    expect((await download(sub.id, receipt.id)).status).toBe(410);
    expect(await ok(await subGet(req("/submissions/" + sub.id)))).toMatchObject({ status: "destroyed", contentAvailable: false, receipts: [] });
  });
  test("legacy form receipts remain version zero without invented PDF evidence", async () => {
    const row = await form(), version = await db.formVersion.findFirstOrThrow({ where: { formId: row.id } });
    await db.formVersion.update({ where: { id: version.id }, data: { consentDisplay: Prisma.DbNull, receiptEvidenceVersion: 0 } });
    const published = await live(await readForm(row.id)), sub = await ok<{id:string}>(await submit(published), 201);
    const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(receipt).toMatchObject({ evidenceVersion: 0, evidenceCipher: null, pdfCipher: null, pdfHash: null });
    expect((await download(sub.id, receipt.id)).status).toBe(404);
  });
  test("preflight rejects unsupported PDF text before publishing and rolls back the form revision", async () => {
    const doc = await document({ body: "미지원 글자 😀" }), row = await form([selection(doc)]);
    const response = await publish(row); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: "PDF_UNSUPPORTED_CHARACTER" } });
    expect((await readForm(row.id)).version).toBe(row.version); expect(await db.publication.count({ where: { formId: row.id } })).toBe(0);
  });
  test("paginated options and templates enforce the same document boundaries", async () => {
    const doc = await document({ title: "찾을 문서" }), other = await document({ serviceId: second });
    const result = await ok<Paged<FormDocumentOption>>(await options(req(`/forms/document-options?serviceId=${service}&pageSize=1&search=찾을`)));
    expect(result.total).toBe(1); expect(result.items[0].documentVersionId).toBe(doc.version.id);
    expect((await options(req(`/forms/document-options?serviceId=${second}`, "GET", "editor"))).status).toBe(403);
    expect((await templateCreate(req("/templates", "POST", "owner", { serviceId: service, title: "타서비스 참조", category: "QA", content: content([selection(other)]) }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const template = await ok<{id:string;version:number}>(await templateCreate(req("/templates", "POST", "owner", { serviceId: service, title: "문서 템플릿", category: "QA", content: content([selection(doc)]) }, { "idempotency-key": randomUUID() })), 201);
    expect((await templateAction(req(`/templates/${template.id}/use`, "POST", "owner", { version: template.version, serviceId: second }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  });
  test("publication serializes with link revocation and never publishes an already-revoked selection", async () => {
    const doc = await document(), row = await form([selection(doc)]);
    await ok(await docAction(req(`/documents/${doc.document.id}/revoke`, "POST", "owner", { version: doc.document.version, publicationId: doc.publicationId })));
    expect((await publish(row)).status).toBe(422); expect(await db.publication.count({ where: { formId: row.id } })).toBe(0);
    const raceDoc = await document(), raceForm = await form([selection(raceDoc)]);
    const [published, revoked] = await Promise.all([publish(raceForm), docAction(req(`/documents/${raceDoc.document.id}/revoke`, "POST", "owner", { version: raceDoc.document.version, publicationId: raceDoc.publicationId }))]);
    expect(revoked.status).toBe(200); expect([201,422]).toContain(published.status);
    if (published.status === 201) {
      const publication = await published.json();
      expect(await ok(await publicGet(req("/public/forms/" + publication.token)))).toMatchObject({ consentBundle: { documents: [{ contentHash: raceDoc.version.contentHash }] } });
    } else expect(await db.publication.count({ where: { formId: raceForm.id } })).toBe(0);
  });
  test("two simultaneous draft saves create one consistent document selection", async () => {
    const doc = await document(), row = await form();
    const responses = await Promise.all([true, false].map(required => formEdit(req(`/forms/${row.id}`, "PATCH", "owner", { version: row.version, content: { ...row.content, documentConsents: [{ ...selection(doc), required }] } }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await db.formDocumentBinding.count({ where: { formVersion: { formId: row.id } } })).toBe(1);
  });
});
