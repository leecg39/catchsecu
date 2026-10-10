import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt, opaqueToken, tokenHash } from "@/server/crypto";
import { POST as createDocument } from "@/app/api/v1/documents/route";
import { PATCH as updateDocument, POST as documentAction } from "@/app/api/v1/documents/[...segments]/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import { POST as createRecipient } from "@/app/api/v1/recipients/route";
import { GET as publicCatalog } from "@/app/api/v1/public/services/[serviceId]/documents/route";
import type { DocumentInput, DocumentRecord } from "@/contracts/documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
function req(path: string, cookie = "", method = "GET", input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": randomUUID() },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function fixture() {
  const email = "recipient-snapshot-" + randomUUID() + "@catchsecu.test", password = "Recipient-snapshot!123";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "합성 게시본 검증", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "합성 회사", publicName: "공개 회사", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "합성 서비스", externalName: "공개 서비스" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  return { cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), serviceId: company.services[0].id, tenantId: company.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function recipient(f: Fixture) {
  const response = await createRecipient(req("/recipients", f.cookie, "POST", { serviceId: f.serviceId, name: "수탁자 " + randomUUID(),
    kind: "processor", countryCode: "US", purpose: "합성 처리", items: ["이름"], retentionMode: "days", retentionDays: 30, retentionReason: "",
    contact: "qa@example.test", transferMethod: "암호화 전송", transferTiming: "접수 시", refusalNotice: "거부 가능" }));
  expect(response.status).toBe(201); return (await response.json()).id as string;
}
async function publish(f: Fixture, indirect: string[], direct: string[] = [], options: {
  type?: "consent" | "overseas_transfer"; required?: boolean; kind?: "general" | "unique_identifier";
} = {}) {
  const purposeResponse = await createPurpose(req("/processing-purposes", f.cookie, "POST", { serviceId: f.serviceId, name: "목적 " + randomUUID(),
    purpose: "합성 처리", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: options.kind ?? "general", required: options.required ?? true }],
    retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: indirect }));
  expect(purposeResponse.status).toBe(201); const purposeId = (await purposeResponse.json()).id;
  const input: DocumentInput = { serviceId: f.serviceId, type: options.type ?? "consent", title: "합성 게시본", body: "게시 본문", refusalNotice: "거부 가능",
    rightsContact: "QA 창구", effectiveDate: "2026-10-10", purposeIds: [purposeId], recipientIds: direct };
  const created = await createDocument(req("/documents", f.cookie, "POST", input)); expect(created.status).toBe(201);
  const row = await created.json() as DocumentRecord;
  const response = await documentAction(req(`/documents/${row.id}/publish`, f.cookie, "POST", { version: row.version, expiresAt: null }));
  expect(response.status).toBe(201);
  const published = await response.json() as { document: DocumentRecord; url: string };
  const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.id } });
  return { input, published, version };
}
async function list(f: Fixture, suffix = "") {
  const response = await publicCatalog(req(`/public/services/${f.serviceId}/documents?view=recipients${suffix}`));
  expect(response.status).toBe(200); return (await response.json()).items as { url: string; contentHash: string }[];
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("수집 목적을 통해 연결된 수탁자도 게시본의 공개 제공·수탁 안내에 나타난다", async () => {
  const f = await fixture(), id = await recipient(f), p = await publish(f, [id]);
  expect((await list(f)).map(row => row.url)).toContain(p.published.url);
  expect((await list(f, "&recipient=" + id)).map(row => row.url)).toContain(p.published.url);
});

test("미게시 초안에서 수탁자를 제거해도 게시 당시 수탁자 필터와 본문은 변하지 않는다", async () => {
  const f = await fixture(), id = await recipient(f), p = await publish(f, [], [id]);
  expect((await updateDocument(req(`/documents/${p.published.document.id}`, f.cookie, "PATCH", {
    ...p.input, body: "미게시 본문", recipientIds: [], version: p.published.document.version,
  }))).status).toBe(200);
  expect((await list(f, "&recipient=" + id + "&country=US")).map(row => row.url)).toContain(p.published.url);
  const stored = await db.documentVersion.findUniqueOrThrow({ where: { id: p.version.id } });
  expect(stored.snapshot).toEqual(p.version.snapshot); expect(stored.contentHash).toBe(p.version.contentHash);
});

test("게시 수탁자 출처는 중복 없이 고정되고 게시 뒤 추가·수정·삭제와 다른회사 연결을 DB에서 막는다", async () => {
  const f = await fixture(), id = await recipient(f), extra = await recipient(f), p = await publish(f, [id], [id]);
  const rows = await db.$queryRaw<{ recipientId: string }[]>`SELECT "recipientId" FROM "DocumentVersionRecipient" WHERE "documentVersionId"=${p.version.id}`;
  expect(rows).toEqual([{ recipientId: id }]);
  await expect(db.$executeRaw`DELETE FROM "DocumentVersionRecipient" WHERE "documentVersionId"=${p.version.id}`).rejects.toThrow(/cannot be changed or deleted/);
  await expect(db.$executeRaw`UPDATE "DocumentVersionRecipient" SET "recipientId"=${extra} WHERE "documentVersionId"=${p.version.id}`).rejects.toThrow(/cannot be changed or deleted/);
  await expect(db.$executeRaw`INSERT INTO "DocumentVersionRecipient" ("tenantId","serviceId","documentId","documentVersionId","recipientId") VALUES (${f.tenantId},${f.serviceId},${p.version.documentId},${p.version.id},${extra})`).rejects.toThrow(/sealed/);
  const foreign = await fixture(), foreignRecipient = await recipient(foreign);
  const draftVersion = await db.documentVersion.create({ data: { tenantId: f.tenantId, serviceId: f.serviceId, documentId: p.version.documentId,
    number: 2, draftRevision: p.version.draftRevision, snapshot: p.version.snapshot!, contentHash: p.version.contentHash, renderedText: p.version.renderedText } });
  await expect(db.$executeRaw`INSERT INTO "DocumentVersionRecipient" ("tenantId","serviceId","documentId","documentVersionId","recipientId") VALUES (${f.tenantId},${f.serviceId},${p.version.documentId},${draftVersion.id},${foreignRecipient})`).rejects.toThrow(/foreign key constraint/);
});

test("출처가 없던 과거 게시본은 본문 기준 목록에 남고 특정 수탁자 ID를 추정하지 않는다", async () => {
  const f = await fixture(), id = await recipient(f), p = await publish(f, [id]);
  await db.$executeRawUnsafe('TRUNCATE TABLE "DocumentVersionRecipient"');
  expect((await list(f)).map(row => row.url)).toContain(p.published.url);
  expect(await list(f, "&recipient=" + id)).toEqual([]);
  expect((await db.documentVersion.findUniqueOrThrow({ where: { id: p.version.id } })).snapshot).toEqual(p.version.snapshot);
});

test("먼저 게시한 비대상 링크가 100개를 넘어도 각 필터에 맞는 게시본을 누락하지 않는다", async () => {
  const f = await fixture(), older = await publish(f, [], [], { required: false });
  await db.documentPublication.createMany({ data: Array.from({ length: 100 }, () => {
    const token = opaqueToken();
    return { tenantId: f.tenantId, serviceId: f.serviceId, documentId: older.version.documentId,
      documentVersionId: older.version.id, tokenHash: tokenHash(token), tokenCipher: encrypt(token), createdAt: new Date("2026-01-01") };
  }) });
  const id = await recipient(f), consent = await publish(f, [id], [], { kind: "unique_identifier" });
  const overseas = await publish(f, [id], [], { type: "overseas_transfer" });
  const cases = [
    ["view=recipients", consent.published.url],
    ["view=overseas", overseas.published.url],
    ["view=resident", consent.published.url],
    ["view=collection&agreement=required", consent.published.url],
    ["view=collection&country=US", consent.published.url],
    ["view=collection&recipient=" + id, consent.published.url],
    ["view=resident&domestic=domestic&agreement=required&country=US&recipient=" + id, consent.published.url],
  ];
  for (const [query, expected] of cases) {
    const response = await publicCatalog(req(`/public/services/${f.serviceId}/documents?${query}`));
    expect(response.status).toBe(200);
    expect((await response.json()).items.map((row: { url: string }) => row.url), query).toContain(expected);
  }
});
