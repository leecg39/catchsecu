import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { beforeAll, beforeEach, afterAll, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { GET as list, POST as create } from "@/app/api/v1/access-requests/route";
import { PATCH as decide, DELETE as cancel } from "@/app/api/v1/access-requests/[id]/route";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advance && args[3].startsWith("access_request.")) vi.setSystemTime(Date.now() + 120_000);
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw Error("Isolated test DB required");
const password = "Access-authority!123";
const identities = { requester: { email: "access-authority-requester@example.test", userId: "", memberId: "", sessionId: "", cookie: "" },
  reviewer: { email: "access-authority-reviewer@example.test", userId: "", memberId: "", sessionId: "", cookie: "" } };
let tenantId = "", serviceId = "", requestId = "";
const observations: unknown[] = [];
type Operation = "mine" | "review" | "create" | "approve" | "reject" | "cancel";
function request(path: string, method: string, cookie: string, value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function actor(operation: Operation) { return ["review", "approve", "reject"].includes(operation) ? identities.reviewer : identities.requester; }
async function invoke(operation: Operation) {
  const cookie = actor(operation).cookie;
  if (operation === "mine" || operation === "review") return list(request("/access-requests?scope=" + operation, "GET", cookie));
  if (operation === "create") return create(request("/access-requests", "POST", cookie, { serviceId, reason: "합성 권한 요청" }));
  if (operation === "cancel") {
    const req = request("/access-requests/" + requestId, "DELETE", cookie); req.headers.set("if-match", "1"); return cancel(req);
  }
  return decide(request("/access-requests/" + requestId, "PATCH", cookie, { version: 1, decision: operation, note: "합성 검토 답변" }));
}
async function state() {
  return { requests: await db.accessRequest.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    grants: await db.serviceGrant.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    requesterVersion: (await db.membership.findUniqueOrThrow({ where: { id: identities.requester.memberId } })).version,
    audit: await db.auditEvent.count({ where: { tenantId, resource: "access_request" } }) };
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const identity of Object.values(identities)) {
    expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: identity.email.split("@")[0], email: identity.email, password }))).status).toBe(200);
    identity.userId = (await db.user.update({ where: { email: identity.email }, data: { emailVerified: true } })).id;
  }
});
beforeEach(async () => {
  clock.advance = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  await db.user.updateMany({ where: { id: { in: Object.values(identities).map(i => i.userId) } }, data: { status: "active" } });
  const company = await db.company.create({ data: { name: "접근 요청 경계", publicName: "합성 공개 회사",
    policy: { create: { passwordMonths: 0 } }, services: { create: { name: "요청할 서비스", externalName: "합성 서비스" } } }, include: { services: true } });
  tenantId = company.id; serviceId = company.services[0].id;
  for (const [kind, identity] of Object.entries(identities)) {
    identity.memberId = (await db.membership.create({ data: { tenantId, userId: identity.userId, role: kind === "reviewer" ? "admin" : "viewer" } })).id;
    const response = await auth.handler(request("/auth/sign-in/email", "POST", "", { email: identity.email, password }));
    expect(response.status).toBe(200);
    identity.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    identity.sessionId = (await db.session.findFirstOrThrow({ where: { userId: identity.userId }, orderBy: { createdAt: "desc" } })).id;
    await db.session.update({ where: { id: identity.sessionId }, data: { activeCompanyId: tenantId } });
  }
  requestId = (await db.accessRequest.create({ data: { tenantId, serviceId, requesterId: identities.requester.memberId, reason: "기존 합성 요청" } })).id;
});
afterAll(async () => {
  clock.advance = false; vi.useRealTimers();
  await mkdir("docs/qa/R03-T02/access-authority", { recursive: true });
  await writeFile("docs/qa/R03-T02/access-authority/lock-observations.json", JSON.stringify(observations, null, 2) + "\n");
  await db.$disconnect();
});
async function barrier(holder: number) {
  for (let n = 0; n < 200; n++) {
    const rows = await db.$queryRaw<{ pid: number; query: string }[]>`SELECT pid, query FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND ${holder}=ANY(pg_blocking_pids(pid))`;
    if (rows.length) return rows;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("Request did not reach actual PostgreSQL lock barrier");
}
const operations: Operation[] = ["mine", "review", "create", "approve", "reject", "cancel"];
for (const operation of operations) test.each(["session", "mfa", "member"] as const)(`${operation}: 잠금 대기 중 %s 변경은 자료와 감사를 반환하거나 저장하지 않는다`, async kind => {
  if (operation === "create") await db.accessRequest.delete({ where: { id: requestId } });
  const before = await state(), current = actor(operation);
  const holder = new Client({ connectionString: env.DATABASE_URL, options: "-c timezone=UTC" }); await holder.connect();
  let pending: Promise<Response> | undefined;
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', [tenantId]);
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    pending = invoke(operation); const blocked = await barrier(pid);
    if (kind === "session") await holder.query('UPDATE "Session" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [current.sessionId]);
    if (kind === "mfa") await holder.query('UPDATE "SecurityPolicy" SET "requireMfa"=true WHERE "tenantId"=$1', [tenantId]);
    if (kind === "member") await holder.query('UPDATE "Membership" SET status=\'suspended\' WHERE id=$1', [current.memberId]);
    await holder.query("COMMIT"); const response = await pending;
    observations.push({ operation, kind, holderPid: pid, blocked, status: response.status });
    expect(response.status).toBe(kind === "session" ? 401 : 403);
    expect(await state()).toEqual(before);
  } finally { await holder.query("ROLLBACK"); await holder.end(); await pending; }
});
for (const operation of ["create", "approve", "reject", "cancel"] as Operation[]) test(`${operation}: 감사 기록 뒤 만료되면 요청·부여 권한·멤버 개정·감사가 함께 롤백된다`, async () => {
  if (operation === "create") await db.accessRequest.delete({ where: { id: requestId } });
  const before = await state();
  await db.session.update({ where: { id: actor(operation).sessionId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
  try { expect((await invoke(operation)).status).toBe(401); expect(await state()).toEqual(before); }
  finally { clock.advance = false; vi.useRealTimers(); }
});
test("폐기된 마지막 페이지를 보정하고 최신 부여 권한은 요청 선택지에서 제외한다", async () => {
  const response = await list(request("/access-requests?scope=review&page=999&pageSize=1", "GET", identities.reviewer.cookie));
  expect(await response.json()).toMatchObject({ total: 1, page: 1, items: [{ id: requestId }] });
  expect((await invoke("approve")).status).toBe(200);
  expect(await (await invoke("mine")).json()).toMatchObject({ availableServices: [], pendingCount: 0 });
});
test("정지된 요청자 계정에는 승인과 서비스 권한을 부여하지 않는다", async () => {
  const before = await state();
  await db.user.update({ where: { id: identities.requester.userId }, data: { status: "suspended" } });
  expect((await invoke("approve")).status).toBe(409);
  expect(await state()).toEqual(before);
});
test("동시 승인과 취소는 하나만 저장하고 승인이 성공한 경우에만 권한이 생긴다", async () => {
  const [approval, cancellation] = await Promise.all([invoke("approve"), invoke("cancel")]);
  expect([approval.status, cancellation.status].sort()).toEqual(approval.status === 200 ? [200, 409] : [204, 409]);
  const result = await state();
  expect(result.requests[0]).toMatchObject({ status: approval.status === 200 ? "approved" : "cancelled", version: 2 });
  expect(result.grants).toHaveLength(approval.status === 200 ? 1 : 0);
  expect(result.requesterVersion).toBe(approval.status === 200 ? 2 : 1); expect(result.audit).toBe(1);
});
test.each(["archived-service", "suspended-requester", "billing-requester"] as const)("%s: 승인 제한은 권한을 만들지 않고 거절은 이력을 보존한다", async kind => {
  if (kind === "archived-service") await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
  if (kind === "suspended-requester") await db.membership.update({ where: { id: identities.requester.memberId }, data: { status: "suspended" } });
  if (kind === "billing-requester") await db.membership.update({ where: { id: identities.requester.memberId }, data: { role: "billing" } });
  const before = await state(), denied = await invoke("approve");
  expect(denied.status).toBe(kind === "billing-requester" ? 403 : 409); expect(await state()).toEqual(before);
  expect((await invoke("reject")).status).toBe(200);
  const after = await state(); expect(after.requests[0]).toMatchObject({ status: "rejected", version: 2 });
  expect(after.grants).toEqual([]); expect(after.audit).toBe(1);
});
