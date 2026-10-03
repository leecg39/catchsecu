import { beforeAll, beforeEach, afterAll, describe, test, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { type Role } from "@/generated/prisma/client";
import { roleCapabilities } from "@/server/permissions";
import { requireContext } from "@/server/context";
import { canonicalDocument, documentQuery, listDocuments } from "@/server/documents";
import { encrypt, opaqueToken, tokenHash } from "@/server/crypto";
import { emptyDisplay, type DocumentInput, type DocumentRecord, type DocumentVersionRecord, type DocumentPreview, type ClauseRecord, type DisplayRecord } from "@/contracts/documents";
import type { Paged } from "@/contracts/forms";
import { POST as create, GET as list } from "@/app/api/v1/documents/route";
import { GET as read, PATCH as update, DELETE as archive, POST as act } from "@/app/api/v1/documents/[...segments]/route";
import { GET as options } from "@/app/api/v1/documents/options/route";
import { GET as publicRead } from "@/app/api/v1/public/documents/[token]/route";
import { POST as createClause, GET as listClauses } from "@/app/api/v1/clause-templates/route";
import { GET as readClause, PATCH as updateClause, DELETE as deleteClause, POST as actClause } from "@/app/api/v1/clause-templates/[...segments]/route";
import { GET as getDisplay, PATCH as saveDisplay } from "@/app/api/v1/services/[id]/consent-display/[kind]/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import { PATCH as updatePurpose, DELETE as archivePurpose } from "@/app/api/v1/processing-purposes/[...segments]/route";
import { POST as createRecipient } from "@/app/api/v1/recipients/route";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), foreignService = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "", ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> { expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json() as Promise<T>; }
const input = (patch: Partial<DocumentInput> = {}): DocumentInput => ({ serviceId: service, type: "consent", title: "동의서 " + randomUUID(), body: "상담을 위한 개인정보 처리 안내", refusalNotice: "동의를 거부할 수 있으며 상담 접수가 제한됩니다.", rightsContact: "시험 문의 창구", effectiveDate: "2026-10-01", purposeIds: [], recipientIds: [], ...patch });
const purposeBody = (serviceId = service) => ({ serviceId, name: "시험 목적 " + randomUUID(), purpose: "시험용 상담 처리", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] as string[] });
async function purpose(serviceId = service, who = "owner", patch = {}) { const value = { ...purposeBody(serviceId), ...patch }; const row = await ok<{id:string;version:number}>(await createPurpose(req("/processing-purposes", "POST", who, value, { "idempotency-key": randomUUID() })), 201); return { ...value, id: row.id, version: row.version }; }
async function party(serviceId = service, who = "owner", patch = {}) { return ok<{id:string}>(await createRecipient(req("/recipients", "POST", who, { serviceId, name: "수탁자 " + randomUUID(), kind: "processor", countryCode: "KR", purpose: "상담 자료 처리", items: ["이름"], retentionMode: "days", retentionDays: 7, retentionReason: "", contact: "qa@example.test", transferMethod: "", transferTiming: "", refusalNotice: "", ...patch }, { "idempotency-key": randomUUID() })), 201); }
async function add(value = input(), who = "owner", key = randomUUID()) { return ok<DocumentRecord>(await create(req("/documents", "POST", who, value, { "idempotency-key": key })), 201); }
async function ready(patch: Partial<DocumentInput> = {}) { return add(input({ purposeIds: [(await purpose()).id], ...patch })); }
function documentBody(row: DocumentRecord): DocumentInput { return { serviceId: row.serviceId, type: row.type, title: row.title, body: row.body, refusalNotice: row.refusalNotice, rightsContact: row.rightsContact, effectiveDate: row.effectiveDate, purposeIds: row.purposeIds, recipientIds: row.recipientIds }; }
async function edit(row: DocumentRecord, patch: Partial<DocumentInput> = {}) { return ok<DocumentRecord>(await update(req("/documents/" + row.id, "PATCH", "owner", { ...documentBody(row), ...patch, version: row.version }))); }
type Published = { document: DocumentRecord; number: number; publicationId: string; url: string };
async function publish(row: DocumentRecord, expiresAt: string | null = null, who = "owner") { return ok<Published>(await act(req("/documents/" + row.id + "/publish", "POST", who, { version: row.version, expiresAt })), 201); }
const publicUrl = (path: string) => "/public/documents/" + path.split("/").pop();
const displayPath = (kind = "collection", serviceId = service) => `/services/${serviceId}/consent-display/${kind}`;
async function signup(name: string, role: Role, tenantId = tenant) {
  await db.rateLimit.deleteMany(); const email = name + "@documents.local.test", password = "Documents-testing-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  if (tenantId === tenant) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: "비공개 회사 " + id, publicName: "공개 회사명", policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [foreignService, foreign]]) await db.service.create({ data: { id, tenantId, name: "관리용 서비스 " + id, externalName: "공개 서비스명" } });
  await signup("owner", "owner"); await signup("editor", "editor"); await signup("viewer", "viewer"); await signup("privacy", "privacy"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("documents with real PostgreSQL, public links and service displays", () => {
  test("draft CRUD persists purpose links and checks version conflicts", async () => {
    const p = await purpose(), row = await add(input({ purposeIds: [p.id] }));
    expect(await ok<DocumentRecord>(await read(req("/documents/" + row.id)))).toMatchObject({ id: row.id, purposeIds: [p.id], version: 1, latestNumber: 0 });
    const changed = await edit(row, { body: "수정 본문", title: "수정 제목" }); expect(changed).toMatchObject({ body: "수정 본문", version: 2, draftRevision: 2 });
    expect((await update(req("/documents/" + row.id, "PATCH", "owner", { ...documentBody(row), version: 1 }))).status).toBe(409);
    expect(await db.auditEvent.count({ where: { resourceId: row.id } })).toBe(2);
    expect((await ok<Paged<DocumentRecord>>(await list(req("/documents?search=수정 제목")))).items.map(item => item.id)).toContain(row.id);
  });
  test("publishes immutable snapshots, hashes and only public fields", async () => {
    const p = await purpose(), row = await add(input({ purposeIds: [p.id] })), published = await publish(row);
    const body = await ok<{snapshot:Record<string,unknown>;contentHash:string;renderedText:string}>(await publicRead(req(publicUrl(published.url), "GET", "anonymous")));
    expect(body.contentHash).toBe(createHash("sha256").update(canonicalDocument(body.snapshot)).digest("hex"));
    expect(body.snapshot).toMatchObject({ companyName: "공개 회사명", serviceName: "공개 서비스명", purposes: [{ retentionDays: 30 }] });
    for (const secret of [tenant, service, members.owner, "비공개 회사", "관리용 서비스", "tokenCipher", "tokenHash", "createdBy", "tenantId"]) expect(JSON.stringify(body)).not.toContain(secret);
    const { id: _id, version: _version, ...pInput } = p; void _id; void _version;
    await ok(await updatePurpose(req("/processing-purposes/" + p.id, "PATCH", "owner", { ...pInput, retentionDays: 60, version: p.version })));
    expect(await ok(await publicRead(req(publicUrl(published.url))))).toEqual(body);
    expect(await ok(await read(req("/documents/" + row.id)))).toMatchObject({ hasUnpublishedChanges: true });
    const latest = await publish(published.document); expect(latest.number).toBe(2);
    expect(await ok(await publicRead(req(publicUrl(latest.url))))).toMatchObject({ snapshot: { purposes: [{ retentionDays: 60 }] } });
    const stored = await db.documentPublication.findUniqueOrThrow({ where: { id: published.publicationId } }); expect(stored.tokenHash).not.toBe(published.url.split("/").pop()); expect(stored.tokenCipher.startsWith("v1.")).toBe(true);
  });
  test("versions can be compared and earlier public links stay fixed", async () => {
    const first = await publish(await ready()); const next = await edit(first.document, { body: "두 번째 개정 본문" }); const second = await publish(next);
    const history = await ok<Paged<DocumentVersionRecord>>(await read(req("/documents/" + next.id + "/versions?pageSize=1"))); expect(history.total).toBe(2); expect(history.items[0]).toMatchObject({ number: 2, snapshot: { body: "두 번째 개정 본문" } });
    const old = await ok<Paged<DocumentVersionRecord>>(await read(req("/documents/" + next.id + "/versions?page=2&pageSize=1"))); expect(old.items[0].number).toBe(1);
    expect((await publicRead(req(publicUrl(first.url)))).status).toBe(200); expect((await publicRead(req(publicUrl(second.url)))).status).toBe(200);
    expect((await act(req("/documents/" + next.id + "/publish", "POST", "owner", { version: second.document.version, expiresAt: null }))).status).toBe(409);
  });
  test("single link revocation, unpublish and archive do not erase versions", async () => {
    const first = await publish(await ready()), second = await publish(await edit(first.document, { body: "새 버전" }));
    const revoked = await ok<DocumentRecord>(await act(req(`/documents/${first.document.id}/revoke`, "POST", "owner", { version: second.document.version, publicationId: first.publicationId })));
    expect((await publicRead(req(publicUrl(first.url)))).status).toBe(410); expect((await publicRead(req(publicUrl(second.url)))).status).toBe(200);
    const hidden = await ok<DocumentRecord>(await act(req(`/documents/${revoked.id}/unpublish`, "POST", "owner", { version: revoked.version }))); expect(hidden.status).toBe("private");
    expect((await publicRead(req(publicUrl(second.url)))).status).toBe(410);
    expect((await archive(req(`/documents/${hidden.id}`, "DELETE", "owner", undefined, { "if-match": String(hidden.version) }))).status).toBe(204);
    const restored = await ok<DocumentRecord>(await act(req(`/documents/${hidden.id}/restore`, "POST", "owner", { version: hidden.version + 1 }))); expect(restored.status).toBe("draft");
    expect((await publicRead(req(publicUrl(second.url)))).status).toBe(410); expect((await publish(restored)).number).toBe(3);
    expect(await db.documentVersion.count({ where: { documentId: hidden.id } })).toBe(3);
  });
  test("invalid, expired and closed company/service links do not expose content", async () => {
    const row = await publish(await ready()); expect((await publicRead(req("/public/documents/not-a-token"))).status).toBe(404);
    expect((await publicRead(req("/public/documents/" + opaqueToken()))).status).toBe(404);
    const token = opaqueToken(), version = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.document.id } });
    await db.documentPublication.create({ data: { tenantId: tenant, serviceId: service, documentId: row.document.id, documentVersionId: version.id, tokenHash: tokenHash(token), tokenCipher: encrypt(token), createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
    expect((await publicRead(req("/public/documents/" + token))).status).toBe(410);
    await db.service.update({ where: { id: service }, data: { status: "archived", version: { increment: 1 } } });
    try { expect((await publicRead(req(publicUrl(row.url)))).status).toBe(410); } finally { await db.service.update({ where: { id: service }, data: { status: "active", version: { increment: 1 } } }); }
    await db.company.update({ where: { id: tenant }, data: { status: "closed", version: { increment: 1 } } });
    try { expect((await publicRead(req(publicUrl(row.url)))).status).toBe(410); } finally { await db.company.update({ where: { id: tenant }, data: { status: "active", version: { increment: 1 } } }); }
  });
  test("publish checks purposes, refusal, contacts, overseas recipients and archived references", async () => {
    const row = await add(); expect((await act(req(`/documents/${row.id}/publish`, "POST", "owner", { version: 1, expiresAt: null }))).status).toBe(422);
    const p = await purpose(), over = await party(service, "owner", { countryCode: "US", transferMethod: "암호화 API", transferTiming: "신청 시", refusalNotice: "거부 시 처리 불가" });
    for (const patch of [{ refusalNotice: "" }, { type: "privacy_policy" as const, rightsContact: "" }, { type: "overseas_transfer" as const }]) {
      const doc = await add(input({ purposeIds: [p.id], ...patch })); expect((await act(req(`/documents/${doc.id}/publish`, "POST", "owner", { version: 1, expiresAt: null }))).status).toBe(422);
    }
    const overseas = await publish(await add(input({ type: "overseas_transfer", purposeIds: [p.id], recipientIds: [over.id] })));
    expect(await ok(await publicRead(req(publicUrl(overseas.url))))).toMatchObject({ snapshot: { recipients: [{ countryCode: "US", transferMethod: "암호화 API" }] } });
    const draft = await add(input({ purposeIds: [p.id] })); expect((await archivePurpose(req(`/processing-purposes/${p.id}`, "DELETE", "owner", undefined, { "if-match": "1" }))).status).toBe(204);
    expect((await act(req(`/documents/${draft.id}/publish`, "POST", "owner", { version: 1, expiresAt: null }))).status).toBe(422);
    expect((await publicRead(req(publicUrl(overseas.url)))).status).toBe(200);
  });
  test("linked purpose recipients are included automatically; non-consent grounds need a policy", async () => {
    const r = await party(), p = await purpose(service, "owner", { recipientIds: [r.id], lawfulBasis: "contract", basisReference: "시험 계약 2조" });
    const consent = await add(input({ purposeIds: [p.id] })); expect((await act(req(`/documents/${consent.id}/publish`, "POST", "owner", { version: 1, expiresAt: null }))).status).toBe(422);
    const policy = await publish(await add(input({ type: "privacy_policy", purposeIds: [p.id], recipientIds: [r.id] })));
    const published = await ok<{snapshot:{recipients:unknown[]}}>(await publicRead(req(publicUrl(policy.url)))); expect(published.snapshot.recipients).toHaveLength(1);
  });
  test("HTML, script and event handler text remain inert plain text", async () => {
    const body = '<script>window.__documentXss=1</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">링크</a>';
    const row = await ready({ body, title: "<b>문서 제목</b>" }), preview = await ok<DocumentPreview>(await read(req(`/documents/${row.id}/preview`)));
    expect(preview.renderedText).toContain(body); const pub = await publish(row);
    const response = await publicRead(req(publicUrl(pub.url))); expect(response.headers.get("content-type")).toContain("application/json"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ snapshot: { body } });
  });
  test("tenant, service, role and current grant checks cover drafts and histories", async () => {
    const row = await ready(), pub = await publish(row);
    expect((await read(req(`/documents/${row.id}`, "GET", "foreign"))).status).toBe(404);
    expect((await list(req("/documents", "GET", "anonymous"))).status).toBe(401);
    expect((await list(req("/documents", "GET", "privacy"))).status).toBe(403);
    expect((await create(req("/documents", "POST", "viewer", input(), { "idempotency-key": randomUUID() }))).status).toBe(403);
    const viewer = await ok<Paged<DocumentVersionRecord>>(await read(req(`/documents/${row.id}/versions`, "GET", "viewer"))); expect(viewer.items[0].publications[0].url).toBeUndefined();
    expect((await options(req(`/documents/options?serviceId=${second}`, "GET", "editor"))).status).toBe(403);
    const ctx = await requireContext(req("/documents", "GET", "editor").headers, "document.read"), grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.editor, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: [] } });
    try { expect((await read(req(`/documents/${row.id}/versions`, "GET", "editor"))).status).toBe(403); expect((await listDocuments(ctx, documentQuery.parse({}))).total).toBe(0); }
    finally { await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } }); }
    expect((await publicRead(req(publicUrl(pub.url), "GET", "anonymous"))).status).toBe(200);
  });
  test("cross-service references, duplicate links and service/type changes are rejected", async () => {
    const other = await purpose(second), alien = await purpose(foreignService, "foreign"), source = await party(service, "owner", { kind: "source" }), local = await purpose(), row = await ready();
    for (const value of [input({ purposeIds: [other.id] }), input({ purposeIds: [alien.id] }), input({ recipientIds: [source.id] }), input({ purposeIds: [local.id, local.id] })])
      expect((await create(req("/documents", "POST", "owner", value, { "idempotency-key": randomUUID() }))).status).toBe(422);
    for (const patch of [{ serviceId: second }, { type: "privacy_policy" }]) expect((await update(req(`/documents/${row.id}`, "PATCH", "owner", { ...documentBody(row), ...patch, version: row.version }))).status).toBe(422);
    await expect(db.documentPurpose.create({ data: { tenantId: tenant, serviceId: service, documentId: row.id, purposeId: other.id } })).rejects.toThrow();
  });
  test("simultaneous document changes and duplicate creates are serialized", async () => {
    const key = randomUUID(), payload = input();
    const created = await Promise.all([0, 1].map(() => create(req("/documents", "POST", "owner", payload, { "idempotency-key": key }))));
    const rows = await Promise.all(created.map(response => ok<DocumentRecord>(response, 201))); expect(rows[0].id).toBe(rows[1].id);
    const results = await Promise.all(["수정 A", "수정 B"].map(body => update(req(`/documents/${rows[0].id}`, "PATCH", "owner", { ...payload, body, version: 1 })))); expect(results.map(value => value.status).sort()).toEqual([200, 409]);
    expect((await create(req("/documents", "POST", "owner", { ...payload, title: "다른 요청" }, { "idempotency-key": key }))).status).toBe(409);
  });
  test("input errors, origin and publish expiry are validated before writes", async () => {
    for (const patch of [{ effectiveDate: "2026-02-30" }, { title: " " }, { type: "P" }, { body: "x".repeat(20001) }, { tenantId: foreign }])
      expect((await create(req("/documents", "POST", "owner", { ...input(), ...patch }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await create(req("/documents", "POST", "owner", input(), { origin: "https://unrelated.example", "idempotency-key": randomUUID() }))).status).toBe(403);
    const row = await ready(); expect((await act(req(`/documents/${row.id}/publish`, "POST", "owner", { version: 1, expiresAt: new Date(Date.now() - 1).toISOString() }))).status).toBe(422);
    expect(await db.documentVersion.count({ where: { documentId: row.id } })).toBe(0);
  });
  test("database prevents editing versions, changing tokens and restoring revoked links", async () => {
    const p = await publish(await ready()), v = await db.documentVersion.findFirstOrThrow({ where: { documentId: p.document.id } });
    await expect(db.documentVersion.update({ where: { id: v.id }, data: { renderedText: "변조" } })).rejects.toThrow();
    await expect(db.documentVersion.delete({ where: { id: v.id } })).rejects.toThrow();
    await expect(db.documentPublication.update({ where: { id: p.publicationId }, data: { tokenHash: "a".repeat(64) } })).rejects.toThrow();
    await ok(await act(req(`/documents/${p.document.id}/unpublish`, "POST", "owner", { version: p.document.version })));
    await expect(db.documentPublication.update({ where: { id: p.publicationId }, data: { status: "active", revokedAt: null } })).rejects.toThrow();
    await expect(db.document.delete({ where: { id: p.document.id } })).rejects.toThrow();
  });
  test("clause CRUD, copy application and later edits keep the document body independent", async () => {
    const value = { serviceId: service, type: "consent", title: "상담 문구", body: "최초 문구" }, row = await ok<ClauseRecord>(await createClause(req("/clause-templates", "POST", "editor", value, { "idempotency-key": randomUUID() })), 201);
    expect(await ok(await readClause(req(`/clause-templates/${row.id}`)))).toMatchObject(value);
    const document = await ready(), applied = await ok<DocumentRecord>(await act(req(`/documents/${document.id}/apply-clause`, "POST", "owner", { version: document.version, templateId: row.id, templateVersion: row.version }))); expect(applied.body).toBe("최초 문구");
    const updated = await ok<ClauseRecord>(await updateClause(req(`/clause-templates/${row.id}`, "PATCH", "editor", { ...value, body: "개정 문구", version: 1 })));
    expect(await ok(await read(req(`/documents/${document.id}`)))).toMatchObject({ body: "최초 문구" });
    expect((await act(req(`/documents/${document.id}/apply-clause`, "POST", "owner", { version: applied.version, templateId: row.id, templateVersion: 1 }))).status).toBe(409);
    expect((await deleteClause(req(`/clause-templates/${row.id}`, "DELETE", "editor", undefined, { "if-match": String(updated.version) }))).status).toBe(204);
    expect((await act(req(`/documents/${document.id}/apply-clause`, "POST", "owner", { version: applied.version, templateId: row.id, templateVersion: 3 }))).status).toBe(422);
    expect(await ok(await actClause(req(`/clause-templates/${row.id}/restore`, "POST", "editor", { version: 3 })))).toMatchObject({ status: "active", version: 4 });
    expect((await ok<Paged<ClauseRecord>>(await listClauses(req("/clause-templates?search=상담 문구")))).items.map(item => item.id)).toContain(row.id);
  });
  test("service displays persist two independent kinds and fixed policy versions", async () => {
    const p = await publish(await ready({ type: "privacy_policy" })); const before = await ok<DisplayRecord>(await getDisplay(req(displayPath())));
    const saved = await ok<DisplayRecord>(await saveDisplay(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: before.version, startText: "수집 안내", policyMode: "document", publicationId: p.publicationId })));
    expect(saved.policyUrl).toBe(p.url); const thirdBefore = await ok<DisplayRecord>(await getDisplay(req(displayPath("third_party"))));
    const third = await ok<DisplayRecord>(await saveDisplay(req(displayPath("third_party"), "PATCH", "owner", { ...emptyDisplay(), version: thirdBefore.version, nameMode: "company", startText: "제공 안내", policyMode: "external", externalUrl: "https://example.test/privacy" })));
    expect(third.policyUrl).toBe("https://example.test/privacy"); expect(await ok(await getDisplay(req(displayPath())))).toMatchObject({ startText: "수집 안내", publicationId: p.publicationId });
    const next = await publish(await edit(p.document, { body: "개정 정책" })); expect(next.number).toBe(2);
    expect(await ok(await getDisplay(req(displayPath())))).toMatchObject({ policyUrl: p.url });
    expect((await act(req(`/documents/${p.document.id}/unpublish`, "POST", "owner", { version: next.document.version }))).status).toBe(409);
    expect((await act(req(`/documents/${p.document.id}/revoke`, "POST", "owner", { version: next.document.version, publicationId: p.publicationId }))).status).toBe(409);
    expect((await archive(req(`/documents/${p.document.id}`, "DELETE", "owner", undefined, { "if-match": String(next.document.version) }))).status).toBe(409);
    await ok(await saveDisplay(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: saved.version })));
    expect((await act(req(`/documents/${p.document.id}/unpublish`, "POST", "owner", { version: next.document.version }))).status).toBe(200);
  });
  test("display policies reject unsafe URLs, foreign services and non-policy versions", async () => {
    const current = await ok<DisplayRecord>(await getDisplay(req(displayPath()))), base = { ...emptyDisplay(), version: current.version };
    for (const externalUrl of ["javascript:alert(1)", "http://example.test", "https://user:pass@example.test", "https://exa\nmple.test", "//example.test"])
      expect((await saveDisplay(req(displayPath(), "PATCH", "owner", { ...base, policyMode: "external", externalUrl }))).status).toBe(422);
    const consent = await publish(await ready()), foreignPurpose = await purpose(second), other = await publish(await add(input({ serviceId: second, type: "privacy_policy", purposeIds: [foreignPurpose.id] })));
    for (const publicationId of [consent.publicationId, other.publicationId, randomUUID()]) expect((await saveDisplay(req(displayPath(), "PATCH", "owner", { ...base, policyMode: "document", publicationId }))).status).toBe(422);
    expect((await saveDisplay(req(displayPath(), "PATCH", "editor", base))).status).toBe(403);
    expect((await getDisplay(req(displayPath("collection", foreignService)))).status).toBe(403);
    expect((await getDisplay(req(displayPath("invalid")))).status).toBe(422);
  });
  test("service display compare-and-swap rejects a second concurrent writer", async () => {
    const row = await ok<DisplayRecord>(await getDisplay(req(displayPath())));
    const results = await Promise.all(["첫 안내", "다음 안내"].map(startText => saveDisplay(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: row.version, startText }))));
    expect(results.map(value => value.status).sort()).toEqual([200, 409]);
    expect((await ok<DisplayRecord>(await getDisplay(req(displayPath())))).version).toBe(row.version + 1);
  });
  test("replayed creates and cached context still enforce role revocation", async () => {
    const key = randomUUID(), payload = input(), row = await add(payload, "editor", key), ctx = await requireContext(req("/documents", "GET", "editor").headers, "document.read");
    await db.membership.update({ where: { id: members.editor }, data: { role: "privacy" } });
    try {
      expect((await create(req("/documents", "POST", "editor", payload, { "idempotency-key": key }))).status).toBe(403);
      expect((await read(req(`/documents/${row.id}`, "GET", "editor"))).status).toBe(403);
      await expect(listDocuments(ctx, documentQuery.parse({}))).rejects.toMatchObject({ status: 403 });
    } finally { await db.membership.update({ where: { id: members.editor }, data: { role: "editor" } }); }
  });
  test("two publishers produce one version and one active link", async () => {
    const row = await ready();
    const responses = await Promise.all([0, 1].map(() => act(req(`/documents/${row.id}/publish`, "POST", "owner", { version: row.version, expiresAt: null }))));
    expect(responses.map(item => item.status).sort()).toEqual([201, 409]);
    expect(await db.documentVersion.count({ where: { documentId: row.id } })).toBe(1);
    expect(await db.documentPublication.count({ where: { documentId: row.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "document.published" } })).toBe(1);
  });
  test("linking a policy cannot race revocation into an active broken reference", async () => {
    const pub = await publish(await ready({ type: "privacy_policy" }));
    const current = await ok<DisplayRecord>(await getDisplay(req(displayPath())));
    const [connected, revoked] = await Promise.all([
      saveDisplay(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: current.version, policyMode: "document", publicationId: pub.publicationId })),
      act(req(`/documents/${pub.document.id}/revoke`, "POST", "owner", { version: pub.document.version, publicationId: pub.publicationId })),
    ]);
    if (connected.status === 200) {
      expect(revoked.status).toBe(409); expect((await publicRead(req(publicUrl(pub.url)))).status).toBe(200);
      const stored = await connected.json();
      await ok(await saveDisplay(req(displayPath(), "PATCH", "owner", { ...emptyDisplay(), version: stored.version })));
    } else {
      expect(connected.status).toBe(422); expect(revoked.status).toBe(200);
      expect(await db.serviceConsentDisplay.count({ where: { publicationId: pub.publicationId } })).toBe(0);
      expect((await publicRead(req(publicUrl(pub.url)))).status).toBe(410);
    }
  });
  test("clause application enforces type, service and current permissions", async () => {
    const doc = await ready();
    for (const patch of [{ type: "privacy_policy", serviceId: service }, { type: "consent", serviceId: second }]) {
      const clause = await ok<ClauseRecord>(await createClause(req("/clause-templates", "POST", "owner", { ...patch, title: "범위 검증 문구", body: "선택하면 안 되는 문구" }, { "idempotency-key": randomUUID() })), 201);
      expect((await act(req(`/documents/${doc.id}/apply-clause`, "POST", "owner", { version: doc.version, templateId: clause.id, templateVersion: clause.version }))).status).toBe(422);
      expect((await readClause(req(`/clause-templates/${clause.id}`, "GET", "foreign"))).status).toBe(404);
      expect((await updateClause(req(`/clause-templates/${clause.id}`, "PATCH", "viewer", { ...patch, title: "바꾸기", body: "변조", version: clause.version }))).status).toBe(403);
    }
    expect(await ok(await read(req(`/documents/${doc.id}`)))).toMatchObject({ version: 1, body: doc.body });
  });
});
