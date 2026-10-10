import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { policyFixture } from "../fixtures/policy-details";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { canonicalDocument } from "@/server/documents";
import { POST as create } from "@/app/api/v1/documents/route";
import { GET as read, PATCH as update, DELETE as archive, POST as act } from "@/app/api/v1/documents/[...segments]/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import { DELETE as archivePurpose } from "@/app/api/v1/processing-purposes/[...segments]/route";
import { GET as options } from "@/app/api/v1/documents/options/route";
import { GET as publicRead } from "@/app/api/v1/public/documents/[token]/route";
import { GET as publicPdf } from "@/app/api/v1/public/documents/[token]/pdf/route";
import type { DocumentInput, DocumentRecord, DocumentPreview, DocumentOptions } from "@/contracts/documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const cookies: Record<string, string> = {}; let tenantId: string, serviceId: string, otherServiceId: string, purposeId: string;
function req(path: string, method = "GET", input?: unknown, actor = "owner", key = randomUUID()) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "", "idempotency-key": key, ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return response.json(); }
const input = (patch: Partial<DocumentInput> = {}): DocumentInput => ({ serviceId, type: "privacy_policy", title: "합성 구조화 처리방침", body: "합성 본문", refusalNotice: "", rightsContact: "합성 문의 창구", effectiveDate: "2026-10-10", purposeIds: [purposeId], recipientIds: [], policyDetails: policyFixture(), ...patch });
const bodyOf = (row: DocumentRecord): DocumentInput => ({ serviceId: row.serviceId, type: row.type, title: row.title, body: row.body, refusalNotice: row.refusalNotice, rightsContact: row.rightsContact, effectiveDate: row.effectiveDate, purposeIds: row.purposeIds, recipientIds: row.recipientIds, ...(row.policyDetails ? { policyDetails: row.policyDetails } : {}) });
async function add(value = input()) { return ok<DocumentRecord>(await create(req("/documents", "POST", value)), 201); }
async function edit(row: DocumentRecord, patch: Partial<DocumentInput> = {}) { return ok<DocumentRecord>(await update(req("/documents/" + row.id, "PATCH", { ...bodyOf(row), ...patch, version: row.version }))); }
async function publish(row: DocumentRecord) { return ok<{ document: DocumentRecord; number: number; url: string }>(await act(req(`/documents/${row.id}/publish`, "POST", { version: row.version, expiresAt: null })), 201); }
beforeAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_policy_audit_failure ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_policy_audit_failure()');
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  const company = await db.company.create({ data: { name: "合成", publicName: "합성 공개회사", policy: { create: {} }, services: { create: [{ name: "처리방침 서비스", externalName: "공개 서비스" }, { name: "별도 서비스", externalName: "별도 서비스" }] } }, include: { services: true } });
  tenantId = company.id; serviceId = company.services[0].id; otherServiceId = company.services[1].id;
  const foreign = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사", policy: { create: {} } } });
  for (const actor of ["owner", "viewer", "other"]) {
    const email = `policy-${actor}-${randomUUID()}@catchsecu.test`, password = "Structured-policy!123";
    await db.rateLimit.deleteMany(); expect((await auth.handler(req("/auth/sign-up/email", "POST", { name: actor, email, password }, "anonymous"))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    await db.membership.create({ data: { tenantId: actor === "other" ? foreign.id : tenantId, userId: user.id, role: actor === "viewer" ? "viewer" : "owner" } });
    const response = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }, "anonymous")); expect(response.status).toBe(200);
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const purpose = await ok<{ id: string }>(await createPurpose(req("/processing-purposes", "POST", { serviceId, name: "합성 목적", purpose: "신청 처리", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] })), 201); purposeId = purpose.id;
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_policy_audit_failure ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_policy_audit_failure()'); await db.$disconnect();
});

test("서비스 항목 선택은 모든 활성 목적에서 가져오고 다른 서비스·회사·권한을 차단한다", async () => {
  const ids: string[] = [];
  for (const [name, target, status, items] of [
    ["추가 목적", serviceId, "active", [{ name: "이름", kind: "general", required: true }, { name: "별명", kind: "general", required: false }]],
    ["보관 목적", serviceId, "archived", [{ name: "보관 비공개 항목", kind: "general", required: true }]],
    ["별도 서비스 목적", otherServiceId, "active", [{ name: "별도 비공개 항목", kind: "general", required: true }]],
  ] as const) {
    const row = await ok<{ id: string }>(await createPurpose(req("/processing-purposes", "POST", { serviceId: target, name, purpose: "합성 선택 항목", lawfulBasis: "consent", basisReference: "", items: [...items], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] })), 201);
    ids.push(row.id);
    if (status === "archived") {
      const request = req("/processing-purposes/" + row.id, "DELETE"); request.headers.set("if-match", "1");
      expect((await archivePurpose(request)).status).toBe(204);
    }
  }
  const result = await ok<DocumentOptions>(await options(req("/documents/options?serviceId=" + serviceId)));
  expect(result.policyItems).toEqual({ requiredItems: ["이름"], optionalItems: ["별명"] });
  expect(result.purposes.map(row => row.id)).toEqual(expect.arrayContaining([purposeId, ids[0]]));
  expect(result.purposes.some(row => row.id === ids[1] || row.id === ids[2])).toBe(false);
  for (const [actor, status] of [["anonymous", 401], ["viewer", 403], ["other", 403]] as const)
    expect((await options(req("/documents/options?serviceId=" + serviceId, "GET", undefined, actor))).status).toBe(status);
});
test("재수탁자 항목·근거의 DB 저장, 미완성 게시 거부, 수정·공개·PDF·과거 버전 고정을 확인한다", async () => {
  const details = policyFixture(), child = details.hosting.trustees[0].subprocessors[0];
  Object.assign(child, { requiredItems: [], optionalItems: [], legalBasis: "" });
  const draft = await add(input({ policyDetails: details }));
  expect((await act(req("/documents/" + draft.id + "/publish", "POST", { version: draft.version, expiresAt: null }))).status).toBe(422);
  Object.assign(child, { requiredItems: ["재수탁 필수 계정"], optionalItems: ["재수탁 선택 별명"], legalBasis: "재수탁 처리 근거 안내" });
  const edited = await edit(draft, { policyDetails: details });
  expect((await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: draft.id } })).payload).toEqual(details);
  const published = await publish(edited), path = "/public/documents/" + published.url.split("/").pop();
  const result = await ok<DocumentPreview>(await publicRead(req(path)));
  expect(result.snapshot.policyDetails).toEqual(details);
  const pdf = await publicPdf(req(path + "/pdf")); expect(pdf.status).toBe(200);
  const bytes = new Uint8Array(await pdf.arrayBuffer()), task = getDocument({ data: bytes.slice(), useSystemFonts: false }), parsed = await task.promise;
  try {
    let text = ""; for (let n = 1; n <= parsed.numPages; n++) text += (await (await parsed.getPage(n)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" ");
    for (const phrase of ["재수탁 필수 계정", "재수탁 선택 별명", "재수탁 처리 근거 안내"]) {
      expect(result.renderedText).toContain(phrase); expect(text).toContain(phrase);
    }
  } finally { await task.destroy(); }
  details.hosting.trustees[0].subprocessors = [];
  await edit(published.document, { policyDetails: details });
  expect(await ok<DocumentPreview>(await publicRead(req(path)))).toEqual(result);
  expect(Buffer.from(await (await publicPdf(req(path + "/pdf"))).arrayBuffer())).toEqual(Buffer.from(bytes));
});

test("구조화 초안을 생성·조회·수정·제거하고 과거 클라이언트 PATCH는 그대로 보존한다", async () => {
  const row = await add(); expect(row.policyDetails).toEqual(policyFixture());
  expect((await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: row.id } })).payload).toEqual(policyFixture());
  expect(await ok<DocumentRecord>(await read(req("/documents/" + row.id)))).toEqual(row);
  const { policyDetails: _details, ...legacy } = bodyOf(row); void _details;
  const next = await ok<DocumentRecord>(await update(req("/documents/" + row.id, "PATCH", { ...legacy, body: "이전 클라이언트 수정", version: row.version })));
  expect(next.policyDetails).toEqual(row.policyDetails);
  const changed = policyFixture(); changed.children.purpose = "수정된 아동 목적"; const edited = await edit(next, { policyDetails: changed });
  expect(edited.version).toBe(3); expect(edited.policyDetails).toEqual(changed);
  expect((await update(req("/documents/" + row.id, "PATCH", { ...input(), version: row.version }))).status).toBe(409);
  const removed = await edit(edited, { policyDetails: null }); expect(removed).not.toHaveProperty("policyDetails"); expect(await db.documentPolicyDraft.count({ where: { documentId: row.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: row.id } })).toBe(4);
});
test("게시 필수 항목 누락은 초안 저장만 허용하고 보완 뒤 게시한다", async () => {
  const details = policyFixture(); details.cctv.managers = [];
  const row = await add(input({ policyDetails: details })); const preview = await ok<DocumentPreview>(await read(req(`/documents/${row.id}/preview`)));
  expect(preview.publishErrors).toContain("CCTV 관리책임자 정보를 입력해주세요.");
  expect((await act(req(`/documents/${row.id}/publish`, "POST", { version: row.version, expiresAt: null }))).status).toBe(422);
  expect(await db.documentVersion.count({ where: { documentId: row.id } })).toBe(0);
  expect((await publish(await edit(row, { policyDetails: policyFixture() }))).number).toBe(1);
});
test("게시 JSON·본문·PDF가 고정되며 이후 수정·제거·보관은 과거 버전의 바이트를 변경하지 않는다", async () => {
  const row = await add(), first = await publish(row), path = "/public/documents/" + first.url.split("/").pop();
  const publicBefore = await ok<DocumentPreview>(await publicRead(req(path, "GET", undefined, "anonymous")));
  expect(publicBefore.snapshot.policyDetails).toEqual(policyFixture());
  expect(publicBefore.contentHash).toBe(createHash("sha256").update(canonicalDocument(publicBefore.snapshot)).digest("hex"));
  const pdf = await publicPdf(req(path + "/pdf", "GET", undefined, "anonymous")); expect(pdf.status).toBe(200); const bytes = new Uint8Array(await pdf.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false }), parsed = await task.promise;
  try {
    let text = ""; for (let i = 1; i <= parsed.numPages; i++) text += (await (await parsed.getPage(i)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" ");
    for (const phrase of ["가상 책임자", "기기 내부 사진 분류", "합성 재수탁자", "정보와 결정의 연관성", "합성 접속 기록"]) expect(text).toContain(phrase);
    expect(await parsed.getJSActions()).toBeNull();
  } finally { await task.destroy(); }
  const storedBefore = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.id, number: 1 } });
  const updated = await edit(first.document, { policyDetails: null, body: "다음 초안" }); expect(await ok(await publicRead(req(path)))).toEqual(publicBefore);
  expect(Buffer.from(await (await publicPdf(req(path + "/pdf"))).arrayBuffer())).toEqual(Buffer.from(bytes));
  const second = await publish(updated); expect(second.number).toBe(2);
  expect((await db.documentVersion.findFirstOrThrow({ where: { documentId: row.id, number: 2 } })).snapshot).not.toHaveProperty("policyDetails");
  const request = req("/documents/" + row.id, "DELETE"); request.headers.set("if-match", String(second.document.version)); expect((await archive(request)).status).toBe(204);
  expect((await publicRead(req(path))).status).toBe(410); expect(await db.documentVersion.findUnique({ where: { id: storedBefore.id } })).toEqual(storedBefore);
});
test("권한·다른회사·다른서비스·문서유형을 API와 DB에서 거부한다", async () => {
  const row = await add();
  for (const [actor, status] of [["anonymous", 401], ["viewer", 403], ["other", 404]] as const) expect((await update(req("/documents/" + row.id, "PATCH", { ...input(), version: row.version }, actor))).status).toBe(status);
  expect((await create(req("/documents", "POST", input({ type: "consent" })))).status).toBe(422);
  const plain = await add(input({ policyDetails: null, type: "consent" }));
  await expect(db.documentPolicyDraft.create({ data: { documentId: plain.id, tenantId, serviceId, payload: policyFixture() } })).rejects.toThrow(/privacy policy/);
  await expect(db.documentPolicyDraft.update({ where: { documentId: row.id }, data: { serviceId: otherServiceId } })).rejects.toThrow(/same service/);
  await expect(db.documentPolicyDraft.update({ where: { documentId: row.id }, data: { schemaVersion: 2 } })).rejects.toThrow(/check constraint/);
  expect((await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: row.id } })).payload).toEqual(policyFixture());
});
test("감사 저장 실패 시 문서 개정·구조화 항목·연결 변경을 함께 롤백한다", async () => {
  const row = await add(), before = await db.document.findUniqueOrThrow({ where: { id: row.id } });
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_policy_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.draft_updated' THEN RAISE EXCEPTION 'synthetic audit rollback'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_policy_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_policy_audit_failure()');
  try {
    expect((await update(req("/documents/" + row.id, "PATCH", { ...input({ policyDetails: null, purposeIds: [], body: "롤백 대상" }), version: row.version }))).status).toBe(500);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER qa_policy_audit_failure ON "AuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION qa_policy_audit_failure()'); }
  expect(await db.document.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
  expect((await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: row.id } })).payload).toEqual(policyFixture());
  expect(await db.documentPurpose.count({ where: { documentId: row.id } })).toBe(1); expect(await db.auditEvent.count({ where: { resourceId: row.id } })).toBe(1);
});
