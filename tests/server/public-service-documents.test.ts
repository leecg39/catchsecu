import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as createDocument, } from "@/app/api/v1/documents/route";
import { POST as documentAction } from "@/app/api/v1/documents/[...segments]/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import { POST as createRecipient } from "@/app/api/v1/recipients/route";
import { GET as publicCatalog } from "@/app/api/v1/public/services/[serviceId]/documents/route";
import { GET as publicRead } from "@/app/api/v1/public/documents/[token]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Public-documents!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function fixture() {
  const email = "public-docs-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "공개 문서", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "비공개 회사명", publicName: "공개 회사", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "내부 서비스", externalName: "공개 서비스" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  return { cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), serviceId: company.services[0].id, companyId: company.id };
}
async function purpose(f: Awaited<ReturnType<typeof fixture>>, required = true, kind: "general" | "unique_identifier" = "general") {
  const response = await createPurpose(req("/processing-purposes", f.cookie, "POST", { serviceId: f.serviceId, name: "목적 " + randomUUID(), purpose: "안내", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind, required }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, randomUUID()));
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
async function recipient(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await createRecipient(req("/recipients", f.cookie, "POST", { serviceId: f.serviceId, name: "국외 수탁 " + randomUUID(), kind: "processor", countryCode: "US", purpose: "국외 처리", items: ["이름"], retentionMode: "days", retentionDays: 30, retentionReason: "", contact: "desk@example.com", transferMethod: "암호화 전송", transferTiming: "수집 즉시", refusalNotice: "거부할 수 있습니다." }, randomUUID()));
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, type: "consent" | "overseas_transfer", purposeId: string, recipientIds: string[] = []) {
  const created = await createDocument(req("/documents", f.cookie, "POST", { serviceId: f.serviceId, type, title: type + " " + randomUUID(), body: "공개 본문", refusalNotice: "거부할 수 있습니다.", rightsContact: "창구", effectiveDate: "2026-10-01", purposeIds: [purposeId], recipientIds }, randomUUID()));
  expect(created.status).toBe(201);
  const row = await created.json();
  const published = await documentAction(req("/documents/" + row.id + "/publish", f.cookie, "POST", { version: row.version, expiresAt: null }, randomUUID()));
  expect(published.status).toBe(201);
  return { ...(await published.json()), id: row.id as string };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("게시 문서만 공개하고 허용되지 않은 agree·category·회수 링크는 제외한다", async () => {
  const f = await fixture();
  const consentPurpose = await purpose(f);
  const residentPurpose = await purpose(f, true, "unique_identifier");
  const consent = await publish(f, "consent", consentPurpose);
  const resident = await publish(f, "consent", residentPurpose);
  const overseas = await publish(f, "overseas_transfer", consentPurpose, [await recipient(f)]);
  const draft = await createDocument(req("/documents", f.cookie, "POST", { serviceId: f.serviceId, type: "consent", title: "초안", body: "비공개", refusalNotice: "거부", rightsContact: "창구", effectiveDate: "2026-10-01", purposeIds: [consentPurpose], recipientIds: [] }, randomUUID()));
  expect(draft.status).toBe(201);
  const catalog = await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=collection"));
  expect(catalog.status).toBe(200);
  const body = await catalog.json();
  expect(body.companyName).toBe("공개 회사");
  expect(body.items.map((item: { type: string }) => item.type).sort()).toEqual(["consent", "consent"]);
  expect(JSON.stringify(body)).not.toContain("tokenCipher");
  expect(JSON.stringify(body)).not.toContain(f.companyId);
  expect((await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=collection&agreement=optional"))).status).toBe(422);
  expect((await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=collection&category=secret"))).status).toBe(422);
  expect((await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=collection&unknown=1"))).status).toBe(422);
  const residentList = await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=resident&domestic=domestic&agreement=required"));
  const residentBody = await residentList.json();
  expect(residentBody.items).toHaveLength(1);
  expect(residentBody.items[0].url).toBe(resident.url);
  const overseasList = await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=overseas"));
  expect((await overseasList.json()).items.map((item: { url: string }) => item.url)).toEqual([overseas.url]);
  const token = consent.url.split("/").pop();
  expect((await publicRead(req("/public/documents/" + token))).status).toBe(200);
  const current = await db.document.findUniqueOrThrow({ where: { id: consent.id } });
  expect((await documentAction(req("/documents/" + consent.id + "/revoke", f.cookie, "POST", { version: current.version, publicationId: consent.publicationId }, randomUUID()))).status).toBe(200);
  const after = await publicCatalog(req("/public/services/" + f.serviceId + "/documents?view=collection"));
  expect((await after.json()).items.map((item: { url: string }) => item.url)).not.toContain(consent.url);
  expect((await publicRead(req("/public/documents/" + token))).status).toBe(410);
});
