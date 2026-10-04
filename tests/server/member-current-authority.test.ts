import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { changeInvitation, createInvitation, createInvitationRequest, getMember, listInvitations, listMembers, removeMember, transferOwnership, updateMember } from "@/server/members";

const clock = vi.hoisted(() => ({ advanceAfterAudit: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advanceAfterAudit) vi.setSystemTime(Date.now() + 120_000);
  } };
});

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Member authority tests require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Member-authority-test!123";
let ownerId: string, recipientId: string, ctx: Context, tenantId: string, memberId: string, serviceId: string, invitationId: string;
const query = { page: 1, pageSize: 20, search: "", status: "all" };
const email = "member-authority-owner@example.test";
function request(path: string, cookie = "", data?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: data ? "POST" : "GET", headers: {
    origin, cookie, ...(data ? { "content-type": "application/json" } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const address of [email, "member-authority-recipient@example.test"]) {
    expect((await auth.handler(request("/auth/sign-up/email", "", { email: address, name: address, password }))).status).toBe(200);
    const user = await db.user.update({ where: { email: address }, data: { emailVerified: true } });
    if (address === email) ownerId = user.id; else recipientId = user.id;
  }
});
beforeEach(async () => {
  vi.useRealTimers(); clock.advanceAfterAudit = false;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "현재 구성원 권한", publicName: "현재 구성원 권한",
    memberships: { create: [{ userId: ownerId, role: "owner" }, { userId: recipientId, role: "viewer" }] },
    services: { create: { name: "서비스", externalName: "서비스" } },
  }, include: { services: true, memberships: true } });
  tenantId = company.id; serviceId = company.services[0].id;
  memberId = company.memberships.find(member => member.userId === recipientId)!.id;
  const signed = await auth.handler(request("/auth/sign-in/email", "", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId: ownerId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: tenantId } });
  ctx = await requireContext(request("/context", cookie).headers, "member.manage");
  const invitation = await db.$transaction(tx => createInvitation(ctx, {
    email: randomUUID() + "@example.test", role: "viewer", serviceIds: [serviceId],
  }, randomUUID(), tx));
  invitationId = invitation.id;
});
afterAll(async () => { clock.advanceAfterAudit = false; vi.useRealTimers(); await db.$disconnect(); });

const operations = {
  update: () => updateMember(ctx, memberId, { version: 1, role: "editor" }, randomUUID()),
  remove: () => removeMember(ctx, memberId, 1, randomUUID()),
  transfer: () => transferOwnership(ctx, memberId, 1, randomUUID()),
  invite: () => db.$transaction(tx => createInvitation(ctx, { email: randomUUID() + "@example.test", role: "viewer", serviceIds: [serviceId] }, randomUUID(), tx)),
  resend: () => changeInvitation(ctx, invitationId, 1, "resend", randomUUID()),
  revoke: () => changeInvitation(ctx, invitationId, 1, "revoke", randomUUID()),
  list: () => listMembers(ctx, query),
  detail: () => getMember(ctx, memberId),
  invitations: () => listInvitations(ctx, query),
};
test.each(Object.keys(operations) as (keyof typeof operations)[])("%s rejects a session revoked after request authentication", async operation => {
  const auditCount = await db.auditEvent.count({ where: { tenantId } });
  await db.session.delete({ where: { id: ctx.session.id } });
  await expect(operations[operation]()).rejects.toMatchObject({ status: 401 });
  expect(await db.membership.findUnique({ where: { id: memberId } })).toMatchObject({ role: "viewer", status: "active", version: 1 });
  expect(await db.invitation.findUnique({ where: { id: invitationId } })).toMatchObject({ status: "pending", version: 1 });
  expect(await db.auditEvent.count({ where: { tenantId } })).toBe(auditCount);
});
test.each(["update", "remove", "transfer", "invite", "resend", "revoke"] as const)("%s rolls back mutation, mail and audit when the session expires before commit", async operation => {
  const auditCount = await db.auditEvent.count({ where: { tenantId } });
  const jobCount = await db.job.count({ where: { tenantId } });
  const inviteCount = await db.invitation.count({ where: { tenantId } });
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  clock.advanceAfterAudit = true;
  try { await expect(operations[operation]()).rejects.toMatchObject({ status: 401 }); }
  finally { clock.advanceAfterAudit = false; vi.useRealTimers(); }
  expect(await db.membership.findUnique({ where: { id: memberId } })).toMatchObject({ role: "viewer", status: "active", version: 1 });
  expect(await db.membership.findUnique({ where: { id: ctx.member.id } })).toMatchObject({ role: "owner", version: 1 });
  expect(await db.invitation.findUnique({ where: { id: invitationId } })).toMatchObject({ status: "pending", version: 1 });
  expect(await db.invitation.count({ where: { tenantId } })).toBe(inviteCount);
  expect(await db.job.count({ where: { tenantId } })).toBe(jobCount);
  expect(await db.auditEvent.count({ where: { tenantId } })).toBe(auditCount);
});
test("a changed company selection rejects a stale member mutation", async () => {
  const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
  await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
  await expect(operations.update()).rejects.toMatchObject({ status: 403, code: "COMPANY_CHANGED" });
});
test("a newly enforced MFA policy rejects a stale member mutation", async () => {
  await db.securityPolicy.create({ data: { tenantId, requireMfa: true, passwordMonths: 0 } });
  await expect(operations.update()).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
});
test.each(["session", "role", "company", "closed"] as const)("invitation replay rechecks current %s instead of returning a cached success", async condition => {
  const key = randomUUID(), input = { email: randomUUID() + "@example.test", role: "viewer" as const, serviceIds: [serviceId] };
  const created = await createInvitationRequest(ctx, input, key, randomUUID());
  expect(await createInvitationRequest(ctx, input, key, randomUUID())).toEqual(created);
  if (condition === "session") await db.session.delete({ where: { id: ctx.session.id } });
  if (condition === "role") {
    await db.membership.update({ where: { id: memberId }, data: { role: "owner" } });
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  }
  if (condition === "company") await db.company.update({ where: { id: tenantId }, data: { status: "suspended" } });
  if (condition === "closed") await changeInvitation(ctx, created.body.id, 1, "revoke", randomUUID());
  await expect(createInvitationRequest(ctx, input, key, randomUUID())).rejects.toMatchObject({ status: condition === "session" ? 401 : condition === "closed" ? 410 : 403 });
  expect(await db.invitation.count({ where: { tenantId, email: input.email } })).toBe(1);
});
test("invitation replay returns the current version after resend without another mail", async () => {
  const key = randomUUID(), input = { email: randomUUID() + "@example.test", role: "viewer" as const, serviceIds: [serviceId] };
  const created = await createInvitationRequest(ctx, input, key, randomUUID());
  await changeInvitation(ctx, created.body.id, 1, "resend", randomUUID());
  const jobs = await db.job.count({ where: { tenantId } });
  expect((await createInvitationRequest(ctx, input, key, randomUUID())).body).toMatchObject({ id: created.body.id, version: 2, status: "pending" });
  expect(await db.job.count({ where: { tenantId } })).toBe(jobs);
});
test("member and invitation lists clamp deleted or filtered last pages", async () => {
  expect(await listMembers(ctx, { ...query, page: 999 })).toMatchObject({ total: 2, page: 1 });
  expect(await listInvitations(ctx, { ...query, page: 999 })).toMatchObject({ total: 1, page: 1 });
  expect(await listMembers(ctx, { ...query, page: 999, search: "no-match" })).toMatchObject({ items: [], total: 0, page: 1 });
});
