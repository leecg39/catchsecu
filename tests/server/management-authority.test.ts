import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { GET as getCompany, PATCH as patchCompany, DELETE as closeCompany } from "@/app/api/v1/companies/[id]/route";
import { POST as cancelClosure } from "@/app/api/v1/companies/[id]/closure/route";
import { GET as services, POST as createService } from "@/app/api/v1/services/route";
import { GET as getService, PATCH as patchService, DELETE as archiveService } from "@/app/api/v1/services/[id]/route";
import { GET as downloadFile, POST as uploadFile, DELETE as deleteFile } from "@/app/api/v1/companies/[id]/business-file/route";
import { POST as registerCompany } from "@/app/api/v1/companies/route";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advance && /^(company|service)\./.test(args[3])) vi.setSystemTime(Date.now() + 120_000);
  } };
});

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "management-authority@example.test", password = "Management-authority!123";
let userId: string, backupOwnerId: string, tenantId: string, memberId: string, sessionId: string, serviceId: string, cookie = "";
const barriers: unknown[] = [];
function request(path: string, method = "GET", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", "POST", { name: "합성 회사 관리자", email, password }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  backupOwnerId = (await db.user.create({ data: { name: "소유권 보호용 합성 소유자", email: "management-backup@example.test", emailVerified: true } })).id;
});
beforeEach(async () => {
  clock.advance = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "경계 시험 회사", publicName: "합성 공개 회사",
    policy: { create: { passwordMonths: 0 } }, memberships: { create: [{ userId, role: "owner" }, { userId: backupOwnerId, role: "owner" }] },
    services: { create: { name: "경계 서비스", externalName: "합성 공개 서비스" } } }, include: { memberships: true, services: true } });
  tenantId = company.id; memberId = company.memberships.find(member => member.userId === userId)!.id;
  serviceId = company.services[0].id;
  const response = await auth.handler(request("/auth/sign-in/email", "POST", { email, password })); expect(response.status).toBe(200);
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  sessionId = (await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } })).id;
  await db.session.update({ where: { id: sessionId }, data: { activeCompanyId: tenantId } });
});
afterAll(async () => {
  clock.advance = false; vi.useRealTimers();
  await mkdir("docs/qa/R03-T02/authority", { recursive: true });
  await writeFile("docs/qa/R03-T02/authority/lock-observations.json", JSON.stringify(barriers, null, 2) + "\n");
  await db.$disconnect();
});
async function blockedBy(holder: number) {
  for (let n = 0; n < 200; n++) {
    const rows = await db.$queryRaw<{ pid: number; query: string }[]>`SELECT pid, query FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND ${holder}=ANY(pg_blocking_pids(pid))`;
    if (rows.length) return rows.map(row => ({ pid: row.pid, query: row.query }));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Request did not reach the PostgreSQL barrier");
}
const pdf = Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n");
async function upload(version: number) {
  return uploadFile(new Request(origin + "/api/v1/companies/" + tenantId + "/business-file?" + new URLSearchParams({ name: "합성등록증.pdf", size: String(pdf.length) }),
    { method: "POST", headers: { origin, cookie, "content-type": "application/pdf", "if-match": String(version) }, body: new Uint8Array(pdf) }));
}
async function setupOperation(operation: string) {
  if (operation === "restore") await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
  if (operation === "cancel") expect((await closeCompany(request("/companies/" + tenantId, "DELETE", { version: 1, confirmation: "경계 시험 회사", reason: "합성 요청" }))).status).toBe(204);
  if (["file-read", "file-delete"].includes(operation)) expect((await upload(1)).status).toBe(201);
}
async function invoke(operation: string, version: number) {
  const company = "/companies/" + tenantId, service = "/services/" + serviceId;
  if (operation === "company") return patchCompany(request(company, "PATCH", { version, address: "커밋되면 안 되는 합성 주소" }));
  if (operation === "create") return createService(request("/services", "POST", { name: "생성 경계 서비스", externalName: "합성 공개명" }));
  if (operation === "edit" || operation === "restore") return patchService(request(service, "PATCH", { version: 1, ...(operation === "restore" ? { status: "active" } : { name: "저장되면 안 되는 이름" }) }));
  if (operation === "close") return closeCompany(request(company, "DELETE", { version, confirmation: "경계 시험 회사", reason: "합성 요청" }));
  if (operation === "cancel") return cancelClosure(request(company + "/closure", "POST", { version, action: "cancel" }));
  if (operation === "file-upload") return upload(version);
  if (operation === "file-read") return downloadFile(request(company + "/business-file"));
  const req = request(operation === "file-delete" ? company + "/business-file" : service, "DELETE"); req.headers.set("if-match", String(version));
  return operation === "file-delete" ? deleteFile(req) : archiveService(req);
}
const writes = ["company", "create", "edit", "restore", "archive", "close", "cancel", "file-upload", "file-read", "file-delete"];
for (const operation of writes) test.each(["member", "session", "mfa"] as const)(`${operation}: DB 잠금 대기 중 %s 변경을 재검사하고 쓰기와 감사를 남기지 않는다`, async kind => {
  await setupOperation(operation);
  const holder = new Client({ connectionString: env.DATABASE_URL, options: "-c timezone=UTC" }); await holder.connect();
  let running: Promise<Response> | undefined;
  const before = await db.company.findUniqueOrThrow({ where: { id: tenantId } });
  const servicesBefore = await db.service.findMany({ where: { tenantId } }), filesBefore = await db.companyBusinessFile.findMany({ where: { tenantId } });
  const auditBefore = await db.auditEvent.count({ where: { tenantId } });
  try {
    await holder.query("BEGIN");
    await holder.query('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', [tenantId]);
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    running = invoke(operation, before.version);
    const blocked = await blockedBy(pid);
    if (kind === "member") await holder.query('UPDATE "Membership" SET role=\'viewer\' WHERE id=$1', [memberId]);
    if (kind === "session") await holder.query('UPDATE "Session" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [sessionId]);
    if (kind === "mfa") await holder.query('UPDATE "SecurityPolicy" SET "requireMfa"=true WHERE "tenantId"=$1', [tenantId]);
    await holder.query("COMMIT");
    const response = await running;
    const after = await db.company.findUniqueOrThrow({ where: { id: tenantId } });
    const audits = await db.auditEvent.count({ where: { tenantId } });
    barriers.push({ operation, kind, holderPid: pid, blocked, status: response.status, beforeVersion: before.version, afterVersion: after.version, auditDelta: audits - auditBefore });
    expect(response.status).toBe(kind === "session" ? 401 : 403);
    expect(after).toEqual(before); expect(audits).toBe(auditBefore);
    expect(await db.service.findMany({ where: { tenantId } })).toEqual(servicesBefore);
    expect(await db.companyBusinessFile.findMany({ where: { tenantId } })).toEqual(filesBefore);
  } finally { await holder.query("ROLLBACK"); await holder.end(); await running; }
});

for (const operation of writes) test(`${operation}: 감사 기록 뒤 자연 만료 시 응답과 DB 변경을 롤백한다`, async () => {
  await setupOperation(operation);
  const company = await db.company.findUniqueOrThrow({ where: { id: tenantId } });
  const servicesBefore = await db.service.findMany({ where: { tenantId } }), filesBefore = await db.companyBusinessFile.findMany({ where: { tenantId } });
  const audits = await db.auditEvent.count({ where: { tenantId } });
  await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
  try {
    expect((await invoke(operation, company.version)).status).toBe(401);
    expect(await db.company.findUniqueOrThrow({ where: { id: tenantId } })).toEqual(company);
    expect(await db.service.findMany({ where: { tenantId } })).toEqual(servicesBefore);
    expect(await db.companyBusinessFile.findMany({ where: { tenantId } })).toEqual(filesBefore);
    expect(await db.auditEvent.count({ where: { tenantId } })).toBe(audits);
  } finally { clock.advance = false; vi.useRealTimers(); }
});

for (const operation of ["company-read", "service-read", "list"]) test.each(["session", "mfa"] as const)(`${operation}: 조회도 DB 잠금 뒤 %s 변경을 재검사한다`, async kind => {
  const holder = new Client({ connectionString: env.DATABASE_URL, options: "-c timezone=UTC" }); await holder.connect();
  let running: Promise<Response> | undefined;
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', [tenantId]);
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    running = operation === "company-read" ? getCompany(request("/companies/" + tenantId)) : operation === "service-read" ? getService(request("/services/" + serviceId)) : services(request("/services"));
    const blocked = await blockedBy(pid);
    if (kind === "session") await holder.query('DELETE FROM "Session" WHERE id=$1', [sessionId]);
    else await holder.query('UPDATE "SecurityPolicy" SET "requireMfa"=true WHERE "tenantId"=$1', [tenantId]);
    await holder.query("COMMIT"); const response = await running;
    barriers.push({ operation, kind, holderPid: pid, blocked, status: response.status });
    expect(response.status).toBe(kind === "session" ? 401 : 403);
  } finally { await holder.query("ROLLBACK"); await holder.end(); await running; }
});
test("서비스 목록의 빈 마지막 페이지는 마지막 유효 페이지로 보정한다", async () => {
  const response = await services(request("/services?page=999&pageSize=1")); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 1, page: 1, pageSize: 1, items: [{ id: serviceId }] });
});
test("같은 회사 서비스명 동시 생성은 한 건과 한 감사만 남긴다", async () => {
  const value = { name: "동일한 서비스명", externalName: "합성 외부명" };
  const responses = await Promise.all([createService(request("/services", "POST", value)), createService(request("/services", "POST", value))]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await db.service.count({ where: { tenantId, name: value.name } })).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId, action: "service.created" } })).toBe(1);
});
test("서비스 동시 수정은 낡은 버전을 거부하고 교착 없이 한 건만 저장한다", async () => {
  const responses = await Promise.all(["수정 A", "수정 B"].map(name => patchService(request("/services/" + serviceId, "PATCH", { name, version: 1 }))));
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await db.service.findUniqueOrThrow({ where: { id: serviceId } })).version).toBe(2);
  expect(await db.auditEvent.count({ where: { tenantId, action: "service.updated" } })).toBe(1);
});
test.each(["expire", "delete"] as const)("회사 등록: 세션 잠금 중 %s 이후 회사·서비스·구독·감사를 만들지 않는다", async kind => {
  const holder = new Client({ connectionString: env.DATABASE_URL, options: "-c timezone=UTC" }); await holder.connect();
  let running: Promise<Response> | undefined;
  const before = { companies: await db.company.count(), services: await db.service.count(), subscriptions: await db.billingSubscription.count(), audits: await db.auditEvent.count({ where: { action: "company.created" } }) };
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Session" WHERE id=$1 FOR UPDATE', [sessionId]);
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    running = registerCompany(request("/companies", "POST", { name: "등록 경계 회사", publicName: "합성 공개 회사" }));
    const blocked = await blockedBy(pid);
    if (kind === "expire") await holder.query('UPDATE "Session" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [sessionId]);
    else await holder.query('DELETE FROM "Session" WHERE id=$1', [sessionId]);
    await holder.query("COMMIT"); const response = await running;
    barriers.push({ operation: "registration", kind, holderPid: pid, blocked, status: response.status });
    expect(response.status).toBe(401);
    expect({ companies: await db.company.count(), services: await db.service.count(), subscriptions: await db.billingSubscription.count(), audits: await db.auditEvent.count({ where: { action: "company.created" } }) }).toEqual(before);
  } finally { await holder.query("ROLLBACK"); await holder.end(); await running; }
});
