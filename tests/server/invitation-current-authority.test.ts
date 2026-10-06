import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireActor } from "@/server/context";
import { opaqueToken, tokenHash } from "@/server/crypto";
import { acceptInvitation, acceptInvitationRequest, previewInvitation } from "@/server/members";
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
  throw new Error("Invitation authority tests require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Invitation-authority-test!123", email = "invitation-recipient@example.test";
let recipientId: string, ownerId: string, actor: Awaited<ReturnType<typeof requireActor>>, tenantId: string, invitationId: string, token: string;
function request(path: string, cookie = "", data?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: data ? "POST" : "GET", headers: { origin, cookie,
    ...(data ? { "content-type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const address of [email, "invitation-owner@example.test"]) {
    expect((await auth.handler(request("/auth/sign-up/email", "", { email: address, name: address, password }))).status).toBe(200);
    const user = await db.user.update({ where: { email: address }, data: { emailVerified: true } });
    if (address === email) recipientId = user.id; else ownerId = user.id;
  }
});
beforeEach(async () => {
  vi.useRealTimers(); clock.advanceAfterAudit = false;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "초대 수락 검사", publicName: "초대 수락 검사",
    memberships: { create: { userId: ownerId, role: "owner" } }, services: { create: { name: "서비스", externalName: "서비스" } },
  }, include: { memberships: true, services: true } });
  tenantId = company.id; token = opaqueToken();
  invitationId = (await db.invitation.create({ data: { tenantId, email, role: "viewer", serviceIds: [company.services[0].id],
    invitedBy: company.memberships[0].id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 86400000) } })).id;
  const signed = await auth.handler(request("/auth/sign-in/email", "", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  actor = await requireActor(request("/context", cookie).headers);
});
afterAll(async () => { clock.advanceAfterAudit = false; vi.useRealTimers(); await db.$disconnect(); });
test("preview rejects a revoked session after request authentication", async () => {
  await db.session.delete({ where: { id: actor.session.id } });
  await expect(previewInvitation(actor, token)).rejects.toMatchObject({ status: 401 });
});
test.each(["session", "invitation"] as const)("acceptance rolls back if %s expires while saving", async condition => {
  if (condition === "session") await db.session.update({ where: { id: actor.session.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
  else await db.invitation.update({ where: { id: invitationId }, data: { expiresAt: new Date(Date.now() + 60000) } });
  clock.advanceAfterAudit = true;
  try { await expect(db.$transaction(tx => acceptInvitation(actor, token, randomUUID(), tx))).rejects.toMatchObject({ status: condition === "session" ? 401 : 410 }); }
  finally { clock.advanceAfterAudit = false; vi.useRealTimers(); }
  expect(await db.invitation.findUnique({ where: { id: invitationId } })).toMatchObject({ status: "pending", version: 1 });
  expect(await db.membership.count({ where: { tenantId, userId: recipientId } })).toBe(0);
  expect(await db.serviceGrant.count({ where: { tenantId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { tenantId } })).toBe(0);
  expect(await db.session.findUnique({ where: { id: actor.session.id } })).toMatchObject({ activeCompanyId: null });
});

test.each(["session", "member", "company", "email"] as const)("acceptance replay rechecks current %s", async condition => {
  const key = randomUUID();
  const created = await acceptInvitationRequest(actor, token, key, randomUUID());
  expect(await acceptInvitationRequest(actor, token, key, randomUUID())).toEqual(created);
  const audits = await db.auditEvent.count({ where: { tenantId } });
  if (condition === "session") await db.session.delete({ where: { id: actor.session.id } });
  if (condition === "member") await db.membership.update({ where: { id: created.body.memberId }, data: { status: "revoked" } });
  if (condition === "company") await db.company.update({ where: { id: tenantId }, data: { status: "suspended" } });
  if (condition === "email") await db.user.update({ where: { id: recipientId }, data: { email: "changed-recipient@example.test" } });
  try { await expect(acceptInvitationRequest(actor, token, key, randomUUID())).rejects.toMatchObject({ status: condition === "session" ? 401 : 410 }); }
  finally { if (condition === "email") await db.user.update({ where: { id: recipientId }, data: { email } }); }
  expect(await db.auditEvent.count({ where: { tenantId } })).toBe(audits);
  expect(await db.membership.count({ where: { tenantId, userId: recipientId } })).toBe(1);
});
test("acceptance replay uses the current company name without duplicate grants or audit", async () => {
  const key = randomUUID(), created = await acceptInvitationRequest(actor, token, key, randomUUID());
  await db.company.update({ where: { id: tenantId }, data: { name: "바뀐 회사 이름" } });
  expect((await acceptInvitationRequest(actor, token, key, randomUUID())).body).toEqual({ ...created.body, companyName: "바뀐 회사 이름" });
  expect(await db.serviceGrant.count({ where: { tenantId } })).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId } })).toBe(1);
});

test("이메일 재초대도 이전 전문가 배정을 종료하고 회수 감사를 남긴다", async () => {
  const service = await db.service.findFirstOrThrow({ where: { tenantId } });
  const assignment = await db.expertAssignment.create({ data: { tenantId, expertUserId: recipientId, assignedById: ownerId,
    expiresAt: new Date(Date.now() + 3600000), services: { create: { serviceId: service.id } } } });
  const member = await db.membership.create({ data: { tenantId, userId: recipientId, role: "viewer", status: "revoked",
    accessKind: "expert", expertAssignmentId: assignment.id } });
  const requestId = randomUUID();
  await acceptInvitationRequest(actor, token, randomUUID(), requestId);
  expect(await db.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ status: "active", accessKind: "direct", expertAssignmentId: null });
  expect(await db.expertAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).toMatchObject({ status: "revoked", version: 2 });
  const audit = await db.auditEvent.findMany({ where: { tenantId, requestId } });
  expect(audit.map(event => event.action).sort()).toEqual(["expert.revoked", "invitation.accepted"]);
});
