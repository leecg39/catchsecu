import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { privateFiles } from "@/server/file-storage";
import { cleanupBusinessFiles } from "@/server/company-management";
import { POST as createCompany } from "@/app/api/v1/companies/route";
import { GET as getCompany, PATCH as patchCompany, DELETE as closeCompany } from "@/app/api/v1/companies/[id]/route";
import { POST as cancelClosure } from "@/app/api/v1/companies/[id]/closure/route";
import { GET as downloadFile, POST as uploadFile, DELETE as deleteFile } from "@/app/api/v1/companies/[id]/business-file/route";
import { GET as services, POST as createService } from "@/app/api/v1/services/route";
import { PATCH as patchService, DELETE as archiveService } from "@/app/api/v1/services/[id]/route";
import { GET as getContext, POST as selectContext } from "@/app/api/v1/context/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only the isolated test DB is allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Company-test-password!123";
const a = randomUUID(), b = randomUUID(), pdf = Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n");
let owner = "", admin = "", viewer = "", foreign = "", newcomer = "";
function request(path: string, method = "GET", cookie = owner, value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(value !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
async function register(email: string, tenantId?: string, role: "owner" | "admin" | "viewer" = "owner") {
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { email, password, name: role }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  if (tenantId) await db.membership.create({ data: { tenantId, userId: user.id, role } });
  return signIn(email);
}
async function signIn(email: string) {
  const response = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function version() { return (await db.company.findUniqueOrThrow({ where: { id: a } })).version; }
async function upload(bytes = pdf, name = "사업자등록증.pdf", mime = "application/pdf", ver?: number) {
  return uploadFile(new Request(origin + "/api/v1/companies/" + a + "/business-file?" + new URLSearchParams({ name, size: String(bytes.length) }), { method: "POST", headers: { origin, cookie: owner, "content-type": mime, "if-match": String(ver ?? await version()) }, body: new Uint8Array(bytes) }));
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const [id, name] of [[a, "회사 A"], [b, "회사 B"]]) await db.company.create({ data: { id, name, publicName: name, policy: { create: {} } } });
  owner = await register("company-owner@test.local", a);
  admin = await register("company-admin@test.local", a, "admin");
  viewer = await register("company-viewer@test.local", a, "viewer");
  foreign = await register("company-foreign@test.local", b);
  newcomer = await register("company-new@test.local");
});
beforeEach(async () => { await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany(); });
afterAll(async () => { vi.restoreAllMocks(); await db.$disconnect(); });

test("company creation atomically supplies owner, service, policy, trial and session selection", async () => {
  const response = await createCompany(request("/companies", "POST", newcomer, { name: "신규 회사", publicName: "신규 공개명", billingContactName: "청구 담당자", billingContactPhone: "02-1234-5678", billingEmail: "bill@test.local" }));
  expect(response.status).toBe(201);
  const company = await response.json();
  expect(company).toMatchObject({ billingContactName: "청구 담당자", billingContactPhone: "02-1234-5678", status: "active", version: 1 });
  const persisted = await db.company.findUniqueOrThrow({ where: { id: company.id }, include: { memberships: true, services: true, policy: true, subscriptions: true } });
  expect(persisted.memberships[0].role).toBe("owner"); expect(persisted.services).toHaveLength(1);
  expect(persisted.policy).toBeTruthy(); expect(persisted.subscriptions[0].activationSource).toBe("trial");
  expect(await (await getContext(request("/context", "GET", newcomer))).json()).toMatchObject({ company: { id: company.id } });
});
test("company edits persist across a fresh login, reject stale versions and exclude private DB fields", async () => {
  const v = await version();
  const response = await patchCompany(request("/companies/" + a, "PATCH", owner, { version: v, address: "서울", businessNo: "123-45-67890", billingContactName: "담당자", billingContactPhone: "010-1234-5678" }));
  expect(response.status).toBe(200);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: v, name: "낡은 수정" }))).status).toBe(409);
  const fresh = await signIn("company-owner@test.local");
  const result = await (await getCompany(request("/companies/" + a, "GET", fresh))).json();
  expect(result).toMatchObject({ address: "서울", billingContactName: "담당자", billingContactPhone: "010-1234-5678" });
  expect(result).not.toHaveProperty("closureReasonCipher"); expect(result).not.toHaveProperty("closureRequestedById");
});
test("company mutation permissions, foreign IDs, Origin and strict inputs are enforced", async () => {
  expect((await patchCompany(request("/companies/" + a, "PATCH", viewer, { version: await version(), name: "권한 없음" }))).status).toBe(403);
  expect((await getCompany(request("/companies/" + a, "GET", foreign))).status).toBe(404);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: await version(), name: "외부 출처" }, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: await version(), status: "closed" }))).status).toBe(422);
  expect((await createCompany(request("/companies", "POST", "", { name: "미인증", publicName: "미인증" }))).status).toBe(401);
});
test("optional company fields accept empty strings and malformed website is a clean 422, never 500", async () => {
  const created = await createCompany(request("/companies", "POST", newcomer, {
    name: "빈 필드 회사", publicName: "빈 필드 회사",
    address: "", phone: "", website: "", businessNo: "", billingEmail: "", billingContactName: "", billingContactPhone: "" }));
  expect(created.status).toBe(201);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: await version(), website: "notaurl" }))).status).toBe(422);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: await version(), website: "javascript:alert(1)" }))).status).toBe(422);
  expect((await patchCompany(request("/companies/" + a, "PATCH", owner, { version: await version(), website: "https://example.com" }))).status).toBe(200);
});
test("concurrent company edits commit one version and one audit event", async () => {
  const v = await version(), before = await db.auditEvent.count({ where: { tenantId: a, action: "company.updated" } });
  const responses = await Promise.all(["편집 A", "편집 B"].map(address => patchCompany(request("/companies/" + a, "PATCH", owner, { version: v, address }))));
  expect(responses.map(row => row.status).sort()).toEqual([200, 409]);
  expect(await version()).toBe(v + 1);
  expect(await db.auditEvent.count({ where: { tenantId: a, action: "company.updated" } })).toBe(before + 1);
});
test("closure needs the owner and exact company name; a request and cancellation retain the data", async () => {
  const input = { version: await version(), confirmation: "회사 A", reason: "폐쇄 시험 사유" };
  expect((await closeCompany(request("/companies/" + a, "DELETE", admin, input))).status).toBe(403);
  expect((await closeCompany(request("/companies/" + a, "DELETE", owner, { ...input, confirmation: "틀린 이름" }))).status).toBe(422);
  expect((await closeCompany(request("/companies/" + a, "DELETE", owner, input))).status).toBe(204);
  const row = await db.company.findUniqueOrThrow({ where: { id: a } });
  expect(row.status).toBe("active"); expect(row.closureRequestedAt).toBeTruthy(); expect(row.closureReasonCipher).not.toContain(input.reason);
  const result = await (await getCompany(request("/companies/" + a))).json(); expect(result.closureReason).toBe(input.reason);
  expect(await (await getCompany(request("/companies/" + a, "GET", viewer))).json()).not.toHaveProperty("closureReason");
  expect((await closeCompany(request("/companies/" + a, "DELETE", owner, { ...input, version: row.version }))).status).toBe(409);
  expect((await cancelClosure(request("/companies/" + a + "/closure", "POST", owner, { action: "cancel", version: row.version }))).status).toBe(204);
  expect(await db.company.findUnique({ where: { id: a } })).toMatchObject({ closureRequestedAt: null, closureReasonCipher: null, status: "active" });
  const events = await db.auditEvent.findMany({ where: { tenantId: a, action: { startsWith: "company.closure_" } } });
  expect(events).toHaveLength(2); expect(JSON.stringify(events)).not.toContain(input.reason);
});
test("the database rejects closure requester membership from another company", async () => {
  const other = await db.membership.findFirstOrThrow({ where: { tenantId: b } });
  await expect(db.company.update({ where: { id: a }, data: { closureRequestedAt: new Date(), closureReasonCipher: "cipher", closureRequestedById: other.userId } })).rejects.toMatchObject({ code: "P2003" });
});
test("scanned business file roundtrip is private, encrypted and byte exact", async () => {
  const response = await upload(); expect(response.status).toBe(201);
  const result = await response.json();
  const file = await db.companyBusinessFile.findUniqueOrThrow({ where: { id: result.businessFile.id } });
  expect(file.status).toBe("active"); expect(file.scanEngine).toBeTruthy(); expect(file.nameCipher).not.toContain("사업자등록증");
  const download = await downloadFile(request("/companies/" + a + "/business-file?fileId=" + file.id));
  expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(pdf);
  expect(download.headers.get("content-disposition")).toContain("attachment"); expect(download.headers.get("cache-control")).toContain("no-store");
  expect(await (await getCompany(request("/companies/" + a))).json()).toMatchObject({ businessFile: { id: file.id } });
});
test("business file download denies other company, viewer, unauthenticated and arbitrary IDs", async () => {
  const file = await db.companyBusinessFile.findFirstOrThrow({ where: { tenantId: a, status: "active" } });
  expect((await downloadFile(request("/companies/" + a + "/business-file", "GET", foreign))).status).toBe(404);
  expect((await downloadFile(request("/companies/" + b + "/business-file?fileId=" + file.id, "GET", foreign))).status).toBe(404);
  expect((await downloadFile(request("/companies/" + a + "/business-file", "GET", viewer))).status).toBe(403);
  expect((await downloadFile(request("/companies/" + a + "/business-file", "GET", ""))).status).toBe(401);
  expect(await (await getCompany(request("/companies/" + a, "GET", viewer))).json()).not.toHaveProperty("businessFile");
});
test("replacement revokes and erases the previous private file", async () => {
  const old = await db.companyBusinessFile.findFirstOrThrow({ where: { tenantId: a, status: "active" } });
  const response = await upload(pdf, "교체등록증.pdf"); expect(response.status).toBe(201);
  expect(await db.companyBusinessFile.findUnique({ where: { id: old.id } })).toMatchObject({ status: "deleted", nameCipher: null, storageKey: null, size: 0 });
  await expect(privateFiles.read(old.storageKey!)).rejects.toBeDefined();
  expect((await downloadFile(request("/companies/" + a + "/business-file?fileId=" + old.id))).status).toBe(404);
});
test("forged extension, traversal, unsupported MIME and infected bytes fail without replacing the current file", async () => {
  const old = await db.companyBusinessFile.findFirstOrThrow({ where: { tenantId: a, status: "active" } });
  expect((await upload(Buffer.from("not a PDF"))).status).toBe(422);
  expect((await upload(pdf, "../등록증.pdf")).status).toBe(422);
  expect((await upload(pdf, "등록증.png")).status).toBe(422);
  expect((await upload(pdf, "등록증.txt", "text/plain")).status).toBe(415);
  // A valid embedded-file PDF makes ClamAV extract and scan the standard EICAR test attachment.
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const objects = ["<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.com) 4 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    "<< /Type /Filespec /F (eicar.com) /EF << /F 5 0 R >> >>", "<< /Type /EmbeddedFile /Length " + eicar.length + " >>\nstream\n" + eicar + "\nendstream"];
  let document = "%PDF-1.4\n"; const offsets: number[] = [];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(document)); document += (i + 1) + " 0 obj\n" + object + "\nendobj\n"; }
  const xref = Buffer.byteLength(document);
  document += "xref\n0 6\n0000000000 65535 f \n" + offsets.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  const infected = Buffer.from(document);
  expect((await upload(infected)).status).toBe(422);
  expect(await db.companyBusinessFile.findFirst({ where: { tenantId: a, status: "active" } })).toMatchObject({ id: old.id });
});
test("competing uploads commit one checked file and reject a stale company version", async () => {
  const v = await version();
  const responses = await Promise.all(["등록증A.pdf", "등록증B.pdf"].map(name => upload(pdf, name, "application/pdf", v)));
  expect(responses.map(row => row.status).sort()).toEqual([201, 409]);
  expect(await db.companyBusinessFile.count({ where: { tenantId: a, status: "active" } })).toBe(1);
});
test("deletion blocks download before a failed storage erase and the cleanup retry finishes it", async () => {
  const file = await db.companyBusinessFile.findFirstOrThrow({ where: { tenantId: a, status: "active" } });
  const spy = vi.spyOn(privateFiles, "remove").mockRejectedValueOnce(new Error("Temporary storage failure"));
  try { expect((await deleteFile(request("/companies/" + a + "/business-file", "DELETE", owner, undefined, { "if-match": String(await version()) }))).status).toBe(503); } finally { spy.mockRestore(); }
  expect((await downloadFile(request("/companies/" + a + "/business-file?fileId=" + file.id))).status).toBe(404);
  expect(await cleanupBusinessFiles()).toEqual({ deleted: 1, retry: 0 });
  expect(await db.companyBusinessFile.findUnique({ where: { id: file.id } })).toMatchObject({ status: "deleted", nameCipher: null, size: 0 });
  const fresh = await upload(pdf, "삭제검증.pdf");
  expect(fresh.status).toBe(201);
  expect((await deleteFile(request("/companies/" + a + "/business-file", "DELETE", owner, undefined,
    { "if-match": String(await version()) }))).status).toBe(204);
});
test("service creation, search, editing, selection, archive and restore survive a new session", async () => {
  const created = await createService(request("/services", "POST", owner, { name: "서비스 CRUD", externalName: "공개", type: "app" }));
  expect(created.status).toBe(201); const row = await created.json();
  expect((await patchService(request("/services/" + row.id, "PATCH", owner, { version: 1, name: "서비스 편집" }))).status).toBe(200);
  const cookie = await signIn("company-owner@test.local");
  expect(await (await services(request("/services?search=서비스 편집", "GET", cookie))).json()).toMatchObject({ total: 1 });
  expect((await selectContext(request("/context", "POST", cookie, { serviceId: row.id }))).status).toBe(200);
  expect((await archiveService(request("/services/" + row.id, "DELETE", owner, undefined, { "if-match": "2" }))).status).toBe(204);
  expect((await selectContext(request("/context", "POST", cookie, { serviceId: row.id }))).status).toBe(409);
  expect(await (await services(request("/services?status=archived", "GET", cookie))).json()).toMatchObject({ total: 1 });
  expect((await patchService(request("/services/" + row.id, "PATCH", owner, { version: 3, status: "active" }))).status).toBe(200);
  expect(await db.service.findUnique({ where: { id: row.id } })).toMatchObject({ status: "active", version: 4 });
});
test("a referenced service rejects both DELETE and PATCH archive with 409", async () => {
  const row = await db.service.create({ data: { tenantId: a, name: "사용 중 서비스", externalName: "사용 중" } });
  const purpose = await createPurpose(request("/processing-purposes", "POST", owner, { serviceId: row.id, name: "수집 목적", purpose: "계약", lawfulBasis: "consent", basisReference: "동의문", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 365, retentionReason: "", recipientIds: [] }, { "idempotency-key": randomUUID() }));
  expect(purpose.status, purpose.status >= 400 ? (await purpose.clone().json()).error?.code : "").toBe(201);
  expect((await archiveService(request("/services/" + row.id, "DELETE", owner, undefined, { "if-match": "1" }))).status).toBe(409);
  expect((await patchService(request("/services/" + row.id, "PATCH", owner, { version: 1, status: "archived" }))).status).toBe(409);
  expect(await db.service.findUnique({ where: { id: row.id } })).toMatchObject({ status: "active", version: 1 });
});
