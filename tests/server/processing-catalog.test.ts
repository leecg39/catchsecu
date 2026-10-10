import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, test, expect } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { requireContext } from "@/server/context";
import { listCatalog, catalogQuery } from "@/server/processing-catalog";
import type { Role } from "@/generated/prisma/client";
import type { PurposeInput, RecipientInput, PurposeRecord, RecipientRecord, CatalogHistory } from "@/contracts/processing-catalog";
import { POST as createPurpose, GET as listPurposes } from "@/app/api/v1/processing-purposes/route";
import { GET as getPurpose, PATCH as patchPurpose, DELETE as archivePurpose, POST as actPurpose } from "@/app/api/v1/processing-purposes/[...segments]/route";
import { POST as createRecipient, GET as listRecipients } from "@/app/api/v1/recipients/route";
import { GET as getRecipient, PATCH as patchRecipient, DELETE as archiveRecipient, POST as actRecipient } from "@/app/api/v1/recipients/[...segments]/route";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), foreignService = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? (await response.clone().json()).error?.code : "").toBe(status);
  return response.json() as Promise<T>;
}
const purpose = (patch: Partial<PurposeInput> = {}): PurposeInput => ({ serviceId: service, name: "수집 목적 " + randomUUID(),
  purpose: "시험용 상담 신청 처리", lawfulBasis: "consent", basisReference: "시험 양식의 동의문",
  items: [{ name: "이름", kind: "general", required: true }, { name: "이메일", kind: "general", required: false }],
  retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [], ...patch });
const recipient = (patch: Partial<RecipientInput> = {}): RecipientInput => ({ serviceId: service, name: "제공자 " + randomUUID(),
  kind: "processor", countryCode: "KR", purpose: "시험용 메시지 전달", items: ["이메일"], retentionMode: "days", retentionDays: 7,
  retentionReason: "", contact: "test@catalog.local.test", transferMethod: "", transferTiming: "", refusalNotice: "", ...patch });
async function addPurpose(input = purpose(), who = "owner", key = randomUUID()) {
  return ok<PurposeRecord>(await createPurpose(req("/processing-purposes", "POST", who, input, { "idempotency-key": key })), 201);
}
async function addRecipient(input = recipient(), who = "owner", key = randomUUID()) {
  return ok<RecipientRecord>(await createRecipient(req("/recipients", "POST", who, input, { "idempotency-key": key })), 201);
}
const delPurpose = (row: PurposeRecord, who = "owner") => archivePurpose(req("/processing-purposes/" + row.id, "DELETE", who, undefined, { "if-match": String(row.version) }));
const delRecipient = (row: RecipientRecord, who = "owner") => archiveRecipient(req("/recipients/" + row.id, "DELETE", who, undefined, { "if-match": String(row.version) }));
async function signup(name: string, role: Role, company = tenant) {
  await db.rateLimit.deleteMany();
  const email = name + "@catalog.local.test", password = "Catalog-testing-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  if (company === tenant) await db.serviceGrant.create({ data: { tenantId: tenant, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password }));
  expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [foreignService, foreign]])
    await db.service.create({ data: { id, tenantId, name: "수집 근거 시험 " + id, externalName: "수집 근거 시험" } });
  await signup("owner", "owner"); await signup("editor", "editor"); await signup("viewer", "viewer"); await signup("privacy", "privacy"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("processing catalog through actual PostgreSQL and API handlers", () => {
  test("creates, reads, updates both resources and keeps the original recipient snapshot", async () => {
    const partyInput = recipient(), party = await addRecipient(partyInput), input = purpose({ recipientIds: [party.id] }), record = await addPurpose(input);
    expect(record.recipients[0]).toMatchObject({ id: party.id, name: partyInput.name, version: 1 });
    expect(await ok(await getPurpose(req("/processing-purposes/" + record.id)))).toMatchObject({ id: record.id, items: input.items });
    const partyNext = await ok<RecipientRecord>(await patchRecipient(req("/recipients/" + party.id, "PATCH", "owner", { ...partyInput, purpose: "변경된 제공 목적", version: 1 })));
    expect(partyNext.version).toBe(2);
    expect(await ok<RecipientRecord>(await getRecipient(req("/recipients/" + party.id)))).toMatchObject({ id: party.id, version: 2 });
    expect((await ok<CatalogHistory>(await getRecipient(req("/recipients/" + party.id + "/history")))).total).toBe(2);
    const purposeNext = await ok<PurposeRecord>(await patchPurpose(req("/processing-purposes/" + record.id, "PATCH", "editor", { ...input, retentionDays: 60, version: 1 })));
    expect(purposeNext).toMatchObject({ version: 2, retentionDays: 60 });
    const history = await ok<CatalogHistory>(await getPurpose(req("/processing-purposes/" + record.id + "/history")));
    expect(history.total).toBe(2); expect(history.items[0].snapshot).toMatchObject({ retentionDays: 60, recipients: [{ purpose: "변경된 제공 목적", version: 2 }] });
    expect(history.items[1].snapshot).toMatchObject({ retentionDays: 30, recipients: [{ purpose: partyInput.purpose, version: 1 }] });
    expect(await db.purposeRevision.count({ where: { purposeId: record.id } })).toBe(2);
    expect(await db.auditEvent.count({ where: { resourceId: record.id } })).toBe(2);
    const stored = await db.processingPurpose.findUniqueOrThrow({ where: { id: record.id } }); expect(stored.retentionDays).toBe(60);
  });
  test("archives and restores with link dependency, preserved history and no hard deletion", async () => {
    const party = await addRecipient(), input = purpose({ recipientIds: [party.id] }), record = await addPurpose(input);
    expect((await delRecipient(party)).status).toBe(409);
    expect((await delPurpose(record)).status).toBe(204); expect((await delRecipient(party)).status).toBe(204);
    expect((await patchPurpose(req("/processing-purposes/" + record.id, "PATCH", "owner", { ...input, version: 2 }))).status).toBe(409);
    expect((await actPurpose(req("/processing-purposes/" + record.id + "/restore", "POST", "owner", { version: 2 }))).status).toBe(422);
    const restoredParty = await ok<RecipientRecord>(await actRecipient(req("/recipients/" + party.id + "/restore", "POST", "owner", { version: 2 })));
    const restoredPurpose = await ok<PurposeRecord>(await actPurpose(req("/processing-purposes/" + record.id + "/restore", "POST", "owner", { version: 2 })));
    expect(restoredParty).toMatchObject({ version: 3, status: "active" }); expect(restoredPurpose).toMatchObject({ version: 3, status: "active" });
    expect(await db.purposeRevision.count({ where: { purposeId: record.id } })).toBe(3);
    expect((await actPurpose(req("/processing-purposes/" + record.id + "/restore", "POST", "owner", { version: 3 }))).status).toBe(409);
  });
  test("validates all three retention modes, non-consent basis and normalized item uniqueness", async () => {
    const valid = purpose();
    const bad: unknown[] = [{ ...valid, retentionDays: null }, { ...valid, retentionDays: 0 }, { ...valid, retentionDays: 36501 },
      { ...valid, retentionMode: "until_purpose", retentionDays: null }, { ...valid, retentionMode: "statutory", retentionReason: "5년" },
      { ...valid, lawfulBasis: "contract", basisReference: " " }, { ...valid, items: [] }, { ...valid, items: [{ name: "이름", kind: "general" }] },
      { ...valid, items: [{ name: "Ａ", kind: "general", required: true }, { name: "a", kind: "general", required: true }] },
      { ...valid, recipientIds: [randomUUID(), randomUUID()], tenantId: foreign }, { ...valid, name: " " }];
    for (const body of bad) expect((await createPurpose(req("/processing-purposes", "POST", "owner", body, { "idempotency-key": randomUUID() }))).status).toBe(422);
    for (const mode of ["until_purpose", "statutory"] as const) expect(await addPurpose(purpose({ lawfulBasis: "contract", basisReference: "시험 계약 3조",
      retentionMode: mode, retentionDays: null, retentionReason: "계약 종료 시점에 검토" }))).toMatchObject({ retentionMode: mode, retentionDays: null });
  });
  test("validates overseas transfers and country codes and permits a complete country record", async () => {
    const valid = recipient({ countryCode: "US" });
    for (const body of [valid, { ...valid, countryCode: "ZZ" }, { ...valid, items: ["A", "Ａ"] }, { ...valid, items: [] }])
      expect((await createRecipient(req("/recipients", "POST", "owner", body, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const row = await addRecipient({ ...valid, transferMethod: "암호화 파일 전달", transferTiming: "계약 체결 시", refusalNotice: "고객 창구에서 철회 신청" });
    expect(row.countryCode).toBe("US");
    expect(await addRecipient(recipient({ kind: "source", countryCode: "US", contact: "" }))).toMatchObject({ kind: "source" });
  });
  test("tenant and current service grants isolate reads, links, mutations and replay", async () => {
    const key = randomUUID(), input = recipient(), party = await addRecipient(input, "editor", key), p = await addPurpose();
    expect((await getRecipient(req("/recipients/" + party.id, "GET", "foreign"))).status).toBe(404);
    expect((await ok<{total:number}>(await listPurposes(req("/processing-purposes", "GET", "foreign")))).total).toBe(0);
    expect((await createPurpose(req("/processing-purposes", "POST", "editor", purpose({ serviceId: second }), { "idempotency-key": randomUUID() }))).status).toBe(403);
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.editor, serviceId: service } } });
    const cachedCtx = await requireContext(req("/processing-purposes", "GET", "editor").headers, "document.read");
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: [] } });
    try {
      expect((await getPurpose(req("/processing-purposes/" + p.id, "GET", "editor"))).status).toBe(403);
      expect((await getRecipient(req("/recipients/" + party.id + "/history", "GET", "editor"))).status).toBe(403);
      expect((await listCatalog(cachedCtx, "purposes", catalogQuery.parse({}))).total).toBe(0);
      expect((await createRecipient(req("/recipients", "POST", "editor", input, { "idempotency-key": key }))).status).toBe(403);
    } finally { await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } }); }
  });
  test("role and login restrictions apply to list, detail and write endpoints", async () => {
    const row = await addPurpose();
    expect((await listPurposes(req("/processing-purposes", "GET", "anonymous"))).status).toBe(401);
    expect((await listRecipients(req("/recipients", "GET", "privacy"))).status).toBe(403);
    expect((await getPurpose(req("/processing-purposes/" + row.id, "GET", "viewer"))).status).toBe(200);
    expect((await delPurpose(row, "viewer")).status).toBe(403);
    expect((await createRecipient(req("/recipients", "POST", "viewer", recipient(), { "idempotency-key": randomUUID() }))).status).toBe(403);
    expect((await createPurpose(req("/processing-purposes", "POST", "owner", purpose(), { origin: "https://another.example", "idempotency-key": randomUUID() }))).status).toBe(403);
    const ctx = await requireContext(req("/processing-purposes", "GET", "editor").headers, "document.read");
    await db.membership.update({ where: { id: members.editor }, data: { role: "privacy" } });
    try { await expect(listCatalog(ctx, "purposes", catalogQuery.parse({}))).rejects.toMatchObject({ status: 403 }); }
    finally { await db.membership.update({ where: { id: members.editor }, data: { role: "editor" } }); }
  });
  test("cross-service and cross-tenant links and immutable service moves are rejected", async () => {
    const party = await addRecipient(recipient({ serviceId: second })), other = await addRecipient(recipient({ serviceId: foreignService }), "foreign"), row = await addPurpose();
    for (const recipientId of [party.id, other.id]) expect((await createPurpose(req("/processing-purposes", "POST", "owner", purpose({ recipientIds: [recipientId] }), { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await patchPurpose(req("/processing-purposes/" + row.id, "PATCH", "owner", { ...purpose({ serviceId: second }), version: 1 }))).status).toBe(422);
    await expect(db.purposeRecipient.create({ data: { tenantId: tenant, serviceId: service, purposeId: row.id, recipientId: party.id } })).rejects.toThrow();
    await expect(db.purposeRecipient.create({ data: { tenantId: tenant, serviceId: service, purposeId: row.id, recipientId: other.id } })).rejects.toThrow();
  });
  test("one concurrent update wins, stale archive fails and names are normalized", async () => {
    const input = purpose(), row = await addPurpose(input);
    const result = await Promise.all(["첫 번째", "두 번째"].map(name => patchPurpose(req("/processing-purposes/" + row.id, "PATCH", "owner", { ...input, name, version: 1 }))));
    expect(result.map(item => item.status).sort()).toEqual([200, 409]); expect((await delPurpose(row)).status).toBe(409);
    const suffix = randomUUID(), normalized = purpose({ name: "ＡＢＣ  " + suffix }); await addPurpose(normalized);
    expect((await createPurpose(req("/processing-purposes", "POST", "owner", { ...normalized, name: "abc " + suffix }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect(await db.purposeRevision.count({ where: { purposeId: row.id } })).toBe(2);
  });
  test("archive permits name reuse but prevents a conflicting restore", async () => {
    const input = recipient(), row = await addRecipient(input); expect((await delRecipient(row)).status).toBe(204);
    await addRecipient(input);
    expect((await actRecipient(req("/recipients/" + row.id + "/restore", "POST", "owner", { version: 2 }))).status).toBe(409);
    expect((await db.recipient.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2);
    expect(await db.recipientRevision.count({ where: { recipientId: row.id } })).toBe(2);
    expect(await addRecipient({ ...input, kind: "source" })).toMatchObject({ kind: "source" });
  });
  test("idempotent concurrent creation commits one record and changed payloads conflict", async () => {
    const input = purpose(), key = randomUUID();
    const rows = await Promise.all([addPurpose(input, "owner", key), addPurpose(input, "owner", key)]);
    expect(rows[0].id).toBe(rows[1].id); expect(await db.processingPurpose.count({ where: { tenantId: tenant, name: input.name } })).toBe(1);
    expect((await createPurpose(req("/processing-purposes", "POST", "owner", { ...input, name: "다른 값" }, { "idempotency-key": key }))).status).toBe(409);
    expect((await createPurpose(req("/processing-purposes", "POST", "owner", purpose()))).status).toBe(400);
  });
  test("filters and paginates in stable order with archived records excluded by default", async () => {
    const prefix = "페이지 " + randomUUID(), rows = [];
    for (const index of [1, 2, 3]) rows.push(await addPurpose(purpose({ name: prefix + " " + index })));
    const query = "/processing-purposes?search=" + encodeURIComponent(prefix) + "&pageSize=2&sort=name&direction=asc";
    const first = await ok<{items:PurposeRecord[];total:number}>(await listPurposes(req(query))), next = await ok<{items:PurposeRecord[];total:number}>(await listPurposes(req(query + "&page=2")));
    expect(first.total).toBe(3); expect(first.items.map(row => row.id)).toEqual(rows.slice(0, 2).map(row => row.id)); expect(next.items[0].id).toBe(rows[2].id);
    expect((await delPurpose(rows[0])).status).toBe(204);
    expect((await ok<{total:number}>(await listPurposes(req(query)))).total).toBe(2);
    expect((await ok<{total:number}>(await listPurposes(req(query + "&status=archived")))).total).toBe(1);
    expect((await ok<{total:number}>(await listPurposes(req(query + "&status=all")))).total).toBe(3);
    expect((await listPurposes(req(query + "&page=0"))).status).toBe(422);
  });
  test("history remains paginated and a read cannot change it", async () => {
    const input = purpose(), row = await addPurpose(input);
    for (let version = 1; version <= 11; version++) await ok(await patchPurpose(req("/processing-purposes/" + row.id, "PATCH", "owner", { ...input, purpose: "개정 " + version, version })));
    const first = await ok<CatalogHistory>(await getPurpose(req("/processing-purposes/" + row.id + "/history?pageSize=10"))), second = await ok<CatalogHistory>(await getPurpose(req("/processing-purposes/" + row.id + "/history?pageSize=10&page=2")));
    expect(first.total).toBe(12); expect(first.items.map(item => item.version)).toEqual([12,11,10,9,8,7,6,5,4,3]); expect(second.items.map(item => item.version)).toEqual([2,1]);
    await expect(db.purposeRevision.update({ where: { id: second.items[1].id }, data: { snapshot: {} } })).rejects.toThrow();
    await expect(db.purposeRevision.delete({ where: { id: second.items[1].id } })).rejects.toThrow();
  });
  test("database rejects mutation without matching revision, malformed items and deleted history", async () => {
    const party = await addRecipient(), row = await addPurpose(purpose({ recipientIds: [party.id] }));
    await expect(db.processingPurpose.update({ where: { id: row.id }, data: { purpose: "이력 없는 변경", version: 2 } })).rejects.toThrow();
    await expect(db.recipient.update({ where: { id: party.id }, data: { purpose: "이력 없는 변경", version: 2 } })).rejects.toThrow();
    for (const items of [[{ name: "이름", kind: "general" }], [{ kind: "general", required: true }], [null]])
      await expect(db.processingPurpose.update({ where: { id: row.id }, data: { items, version: 2 } })).rejects.toThrow();
    const rev = await db.recipientRevision.findFirstOrThrow({ where: { recipientId: party.id } });
    await expect(db.recipientRevision.delete({ where: { id: rev.id } })).rejects.toThrow();
    await expect(db.processingPurpose.delete({ where: { id: row.id } })).rejects.toThrow();
    expect((await db.processingPurpose.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(1);
  });
  test("database cannot silently detach a recipient without creating a purpose revision", async () => {
    const party = await addRecipient(), row = await addPurpose(purpose({ recipientIds: [party.id] }));
    await expect(db.purposeRecipient.deleteMany({ where: { purposeId: row.id } })).rejects.toThrow();
    expect(await db.purposeRecipient.count({ where: { purposeId: row.id } })).toBe(1);
  });
  test("an archived service permits historical reads and blocks catalog changes", async () => {
    const input = purpose({ serviceId: second }), row = await addPurpose(input);
    await db.service.update({ where: { id: second }, data: { status: "archived", version: { increment: 1 } } });
    try {
      expect((await getPurpose(req("/processing-purposes/" + row.id))).status).toBe(200);
      expect((await patchPurpose(req("/processing-purposes/" + row.id, "PATCH", "owner", { ...input, version: 1 }))).status).toBe(409);
      expect((await createPurpose(req("/processing-purposes", "POST", "owner", purpose({ serviceId: second }), { "idempotency-key": randomUUID() }))).status).toBe(409);
    } finally { await db.service.update({ where: { id: second }, data: { status: "active", version: { increment: 1 } } }); }
  });
});
