import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET as list } from "@/app/api/v1/audit-events/route";
import { GET as exportCsv } from "@/app/api/v1/audit-events/export/route";
import { parse } from "csv-parse/sync";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Audit fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Test-only-password!123";
const companyA = randomUUID(), companyB = randomUUID(), serviceA1 = randomUUID(), serviceA2 = randomUUID(), serviceB = randomUUID();
let adminId = "", privacyId = "", viewerId = "", adminCookie = "", privacyCookie = "", viewerCookie = "";
let eventService = "", eventMarketing = "", eventMember = "", eventInfo = "", eventMine = "";
function request(path: string, method = "GET", cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}) },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function addUser(email: string, role: "admin" | "privacy" | "viewer", tenantId = companyA) {
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: email.split("@")[0], email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const signed = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  expect(signed.status).toBe(200);
  return { id: user.id, memberId: member.id, cookie: cookies(signed) };
}
async function event(tenantId: string, action: string, serviceId: string | null, actorId: string, at: number,
  resourceId = randomUUID()) {
  return db.auditEvent.create({ data: { tenantId, serviceId, actorId, action, resource: action.split(".")[0],
    resourceId, requestId: randomUUID(), createdAt: new Date(Date.now() - at * 60000),
    detail: { email: "secret@example.test", token: "never-return-this-token", changedFields: ["status"] } } });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: companyA, name: "감사 회사 A", publicName: "A" },
    { id: companyB, name: "감사 회사 B", publicName: "B" }] });
  await db.service.createMany({ data: [{ id: serviceA1, tenantId: companyA, name: "=2+2", externalName: "A1" },
    { id: serviceA2, tenantId: companyA, name: "서비스 A2", externalName: "A2" },
    { id: serviceB, tenantId: companyB, name: "서비스 B", externalName: "B" }] });
  const admin = await addUser("audit-admin@test.local", "admin"); adminId = admin.id; adminCookie = admin.cookie;
  const privacy = await addUser("audit-privacy@test.local", "privacy"); privacyId = privacy.id; privacyCookie = privacy.cookie;
  const viewer = await addUser("audit-viewer@test.local", "viewer"); viewerId = viewer.id; viewerCookie = viewer.cookie;
  const other = await addUser("audit-other@test.local", "admin", companyB);
  await db.serviceGrant.createMany({ data: [
    { tenantId: companyA, memberId: privacy.memberId, serviceId: serviceA1, capabilities: ["service.read", "audit.read"] },
    { tenantId: companyA, memberId: viewer.memberId, serviceId: serviceA1, capabilities: ["service.read"] },
  ] });
  eventService = (await event(companyA, "service.updated", serviceA1, adminId, 5, "private-link-token-do-not-return")).id;
  eventMarketing = (await event(companyA, "marketing.granted", serviceA1, privacyId, 4)).id;
  eventMember = (await event(companyA, "member.updated", null, adminId, 3)).id;
  eventInfo = (await event(companyA, "submission.viewed", serviceA2, adminId, 2)).id;
  eventMine = (await event(companyA, "service.viewed", serviceA1, viewerId, 1)).id;
  await event(companyB, "service.updated", serviceB, other.id, 0);
  await db.rateLimit.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

describe("회사 격리 감사 이벤트 조회", () => {
  test("인증·역할·서비스 범위와 안전 DTO", async () => {
    expect((await list(request("/audit-events"))).status).toBe(401);
    expect((await list(request("/audit-events", "GET", viewerCookie))).status).toBe(403);
    const limited = await list(request("/audit-events?kind=all", "GET", privacyCookie));
    expect(limited.status).toBe(200);
    const limitedBody = await limited.json();
    expect(limitedBody.items.map((item: { id: string }) => item.id)).toEqual([eventMine, eventMarketing, eventService]);
    expect(limitedBody.items.every((item: { actorName: string | null; resourceId: string | null }) =>
      item.actorName === null && item.resourceId === null)).toBe(true);
    expect(JSON.stringify(limitedBody)).not.toContain("never-return-this-token");
    expect(JSON.stringify(limitedBody)).not.toContain("secret@example.test");
    const expectedTotal = await db.auditEvent.count({ where: { tenantId: companyA } });
    const full = await list(request("/audit-events", "GET", adminCookie));
    expect(full.status).toBe(200);
    const fullBody = await full.json();
    expect(fullBody.total).toBe(expectedTotal);
    expect(fullBody.items.some((item: { id: string; actorName: string | null }) =>
      item.id === eventInfo && item.actorName === "audit-admin")).toBe(true);
    expect(fullBody.items.find((item: { id: string }) => item.id === eventService).resourceId).toBeNull();
    expect(JSON.stringify(fullBody)).not.toContain("never-return-this-token");
    expect(JSON.stringify(fullBody)).not.toContain("private-link-token-do-not-return");
    expect((await list(request("/audit-events?serviceId=" + serviceB, "GET", adminCookie))).status).toBe(404);
    expect((await list(request("/audit-events?serviceId=" + serviceA2, "GET", privacyCookie))).status).toBe(404);
  });
  test("종류·기간·검색·페이지 필터가 DB에 적용된다", async () => {
    const service = await (await list(request("/audit-events?kind=service", "GET", adminCookie))).json();
    expect(service.items.map((item: { id: string }) => item.id)).toEqual([eventMine, eventService]);
    const marketing = await (await list(request("/audit-events?kind=marketing", "GET", adminCookie))).json();
    expect(marketing.items.map((item: { id: string }) => item.id)).toEqual([eventMarketing]);
    const member = await (await list(request("/audit-events?kind=member", "GET", adminCookie))).json();
    expect(member.items.map((item: { id: string }) => item.id)).toEqual([eventMember]);
    const info = await (await list(request("/audit-events?kind=info", "GET", privacyCookie))).json();
    expect(info.total).toBe(0);
    const searched = await (await list(request("/audit-events?search=service.updated&searchField=action", "GET", adminCookie))).json();
    expect(searched.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    const page1 = await (await list(request("/audit-events?kind=service&pageSize=1&page=1", "GET", adminCookie))).json();
    const page2 = await (await list(request("/audit-events?kind=service&pageSize=1&page=2", "GET", adminCookie))).json();
    expect(page1.items.map((item: { id: string }) => item.id)).toEqual([eventMine]);
    expect(page2.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    const cutoff = new Date(Date.now() - 2.5 * 60000).toISOString();
    const recent = await (await list(request("/audit-events?kind=service&from=" + encodeURIComponent(cutoff), "GET", adminCookie))).json();
    expect(recent.items.map((item: { id: string }) => item.id)).toEqual([eventMine]);
    const boundary = (await db.auditEvent.findUniqueOrThrow({ where: { id: eventMine }, select: { createdAt: true } })).createdAt.toISOString();
    const before = await (await list(request("/audit-events?kind=service&to=" + encodeURIComponent(boundary), "GET", adminCookie))).json();
    expect(before.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    expect((await list(request("/audit-events?from=2026-13-01", "GET", adminCookie))).status).toBe(422);
    expect((await list(request("/audit-events?from=" + encodeURIComponent(new Date().toISOString()) +
      "&to=2020-01-01T00%3A00%3A00.000Z", "GET", adminCookie))).status).toBe(422);
  });
  test("본인 활동은 조회하되 다른 처리자 조회·검색은 차단한다", async () => {
    const mine = await list(request("/audit-events?scope=mine", "GET", viewerCookie));
    expect(mine.status).toBe(200);
    const data = await mine.json();
    expect(data.items.map((item: { action: string }) => item.action)).toContain("session.created");
    expect(data.items.map((item: { id: string }) => item.id)).toContain(eventMine);
    expect(data.total).toBe(2);
    expect(data.items[0].actorName).toBe("audit-viewer");
    expect(data.items[0].resourceId).toBeNull();
    expect((await list(request("/audit-events?scope=mine&actorId=" + adminId, "GET", viewerCookie))).status).toBe(403);
    expect((await list(request("/audit-events?search=admin&searchField=actor", "GET", privacyCookie))).status).toBe(403);
    expect((await list(request("/audit-events?actorId=" + adminId, "GET", privacyCookie))).status).toBe(403);
  });
  test("CSV는 같은 필터 전체 행을 안전하게 내보내고 원장 삭제를 막는다", async () => {
    const path = "/audit-events/export?kind=service&page=1&pageSize=1";
    expect((await exportCsv(request(path))).status).toBe(401);
    expect((await exportCsv(request(path, "GET", viewerCookie))).status).toBe(403);
    const response = await exportCsv(request(path, "GET", adminCookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("audit-events.csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const exportEvent = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers.get("x-request-id")! } });
    expect(exportEvent).toMatchObject({ tenantId: companyA, actorId: adminId, action: "audit.exported",
      resource: "auditEvent", serviceId: null,
      detail: { scope: "company", kind: "service", rowCount: 2, hasSearch: false } });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const csv = bytes.toString("utf8");
    expect(csv).not.toContain("never-return-this-token");
    expect(csv).not.toContain("private-link-token-do-not-return");
    const rows = parse(csv, { bom: true }) as string[][];
    expect(rows.length).toBe(3);
    expect(rows.slice(1).map(row => row[0])).toEqual([eventMine, eventService]);
    expect(rows[2][2]).toBe("'=2+2");
    const limited = await exportCsv(request("/audit-events/export?kind=service", "GET", privacyCookie));
    expect(limited.status).toBe(200);
    const limitedRows = parse(await limited.text(), { bom: true }) as string[][];
    expect(limitedRows.every((row, index) => index === 0 || row[3] === "비공개")).toBe(true);
    expect((await exportCsv(request("/audit-events/export?serviceId=" + serviceB, "GET", adminCookie))).status).toBe(404);
    const mine = await exportCsv(request("/audit-events/export?scope=mine&kind=service", "GET", viewerCookie));
    expect(mine.status).toBe(200);
    expect((parse(await mine.text(), { bom: true }) as string[][]).slice(1).map(row => row[0])).toEqual([eventMine]);
    const searched = await exportCsv(request("/audit-events/export?search=secret%40example.test", "GET", adminCookie));
    expect(searched.status).toBe(200);
    const searchedEvent = await db.auditEvent.findFirstOrThrow({ where: { requestId: searched.headers.get("x-request-id")! } });
    expect(searchedEvent.detail).toMatchObject({ hasSearch: true, rowCount: 0 });
    expect(JSON.stringify(searchedEvent.detail)).not.toContain("secret@example.test");
    await expect(db.auditEvent.delete({ where: { id: eventService } })).rejects.toThrow();
  });
  test("5,000건 초과 내보내기는 일부만 내려주지 않는다", async () => {
    await db.auditEvent.createMany({ data: Array.from({ length: 5001 }, (_, index) => ({
      tenantId: companyA, actorId: adminId, serviceId: serviceA1, action: "audit.export_overflow",
      resource: "audit", resourceId: randomUUID(), requestId: randomUUID(), detail: { index },
    })) });
    const response = await exportCsv(request("/audit-events/export?search=audit.export_overflow", "GET", adminCookie));
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await db.auditEvent.count({ where: { requestId: response.headers.get("x-request-id")! } })).toBe(0);
  });
  test.each([
    { kind: "authority", actions: ["mfa_policy.updated", "mfa_exception.created", "ip_access.updated", "ip_rule.created", "policy.updated"] },
    { kind: "info", actions: ["consent_receipt.pdf_downloaded"] },
  ])("$kind includes its security/receipt producers with matching masked list and CSV", async ({ kind, actions }) => {
    const ids = [];
    for (const action of actions) ids.push((await event(companyA, action, serviceA1, adminId, 0)).id);
    const query = "?kind=" + kind + "&serviceId=" + serviceA1 + "&pageSize=100";
    const r = await list(request("/audit-events" + query, "GET", privacyCookie)); expect(r.status).toBe(200);
    const data = await r.json(); expect(data.items.map((row: { id: string }) => row.id).sort()).toEqual(ids.sort());
    expect(data.items.every((row: { resourceId: string | null; actorName: string | null }) => row.resourceId === null && row.actorName === null)).toBe(true);
    const exported = await exportCsv(request("/audit-events/export" + query, "GET", privacyCookie)); expect(exported.status).toBe(200);
    const csv = parse(await exported.text(), { bom: true }) as string[][];
    expect(csv.slice(1).map(row => row[0]).sort()).toEqual(ids.sort());
    expect(JSON.stringify(csv)).not.toContain("never-return-this-token");
  });
});
