import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt, decrypt, tokenHash } from "@/server/crypto";
import { requireActor } from "@/server/context";
import { closeAccount } from "@/server/account-closure";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/v1/me/route";
import { GET as closureGet, POST as closurePost } from "@/app/api/v1/me/closure/route";
import { GET as activity } from "@/app/api/v1/me/audit-events/route";
import { GET as activityExport } from "@/app/api/v1/me/audit-events/export/route";
import { GET as sessionList } from "@/app/api/v1/me/sessions/route";
import { DELETE as sessionDelete } from "@/app/api/v1/me/sessions/[id]/route";
import { POST as memberAction } from "@/app/api/v1/members/[...segments]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Account-closure-password!123";
function req(path: string, method = "GET", cookie = "", value?: unknown, requestOrigin = origin) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin: requestOrigin, cookie, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function person(label: string, platformAdmin = false) {
  const email = "closure-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: label, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(response.status).toBe(200); return { ...user, cookie: cookies(response) };
}
async function company(ownerId: string, memberId?: string) {
  return db.company.create({ data: { name: "탈퇴 시험 회사", publicName: "탈퇴 시험", policy: { create: {} },
    memberships: { create: [{ userId: ownerId, role: "owner" }, ...(memberId ? [{ userId: memberId, role: "admin" as const }] : [])] },
    services: { create: { name: "탈퇴 시험 서비스", externalName: "탈퇴 시험" } } }, include: { memberships: true, services: true } });
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

test("프로필은 서버 저장 후 새 세션에서도 유지되며 계정/권한 필드 변경은 거부한다", async () => {
  const user = await person("profile");
  expect((await profileGet(req("/me"))).status).toBe(401);
  expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 1, name: "수정된 이름", department: "개발", jobTitle: "개발 책임자", phone: "010-1234-5678", locale: "en" }))).status).toBe(200);
  const next = await auth.handler(req("/auth/sign-in/email", "POST", "", { email: user.email, password }));
  expect(await (await profileGet(req("/me", "GET", cookies(next)))).json()).toMatchObject({ name: "수정된 이름", department: "개발", jobTitle: "개발 책임자", phone: "010-1234-5678", locale: "en", version: 2 });
  expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 1, name: "오래된 변경" }))).status).toBe(409);
  for (const forbidden of [{ email: "other@example.test" }, { status: "closed" }, { platformAdmin: true }])
    expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 2, name: "변경", ...forbidden }))).status).toBe(422);
  expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 2, name: "외부 변경" }, "https://evil.example"))).status).toBe(403);
  expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 2, name: "수정된 이름", jobTitle: "직".repeat(101) }))).status).toBe(422);
  await expect(db.user.update({ where: { id: user.id }, data: { jobTitle: "직".repeat(101) } })).rejects.toThrow();
  expect((await profilePatch(req("/me", "PATCH", user.cookie, { version: 2, name: "수정된 이름", jobTitle: "" }))).status).toBe(200);
  expect((await (await profileGet(req("/me", "GET", cookies(next)))).json()).jobTitle).toBe("");
});

test("회사 소속이 없어도 본인 활동만 조회·필터·페이지·CSV로 제공하며 원문·식별자는 제외한다", async () => {
  const user = await person("=SUM(A1)"), other = await person("other");
  const from = "2026-09-01T00:00:00Z", to = "2026-09-02T00:00:00Z";
  for (let i = 0; i < 3; i++) await db.auditEvent.create({ data: { actorId: user.id, action: "profile.updated", resource: "user",
    resourceId: "secret-resource", requestId: randomUUID(), createdAt: new Date(i === 2 ? to : from), detail: { token: "PLANTED-SECRET", reason: "sensitive" } } });
  await db.auditEvent.create({ data: { actorId: other.id, action: "profile.updated", resource: "user", requestId: randomUUID(), createdAt: new Date(from), detail: {} } });
  const query = "/me/audit-events?from=" + from + "&to=" + to + "&search=profile.updated&pageSize=1";
  const first = await (await activity(req(query, "GET", user.cookie))).json(), second = await (await activity(req(query + "&page=2", "GET", user.cookie))).json();
  expect(first.total).toBe(2); expect(first.items[0].id).not.toBe(second.items[0].id);
  expect(first.items[0]).toMatchObject({ resourceId: null, serviceId: null, serviceName: null });
  expect(JSON.stringify(first)).not.toMatch(/PLANTED-SECRET|secret-resource|sensitive/);
  expect((await activity(req("/me/audit-events?actorId=" + other.id, "GET", user.cookie))).status).toBe(422);
  expect((await activity(req("/me/audit-events?scope=company", "GET", user.cookie))).status).toBe(422);
  const csv = await (await activityExport(req(query.replace("/me/audit-events?", "/me/audit-events/export?"), "GET", user.cookie))).text();
  expect(csv).toContain("'=SUM(A1)"); expect(csv).not.toMatch(/PLANTED-SECRET|secret-resource|sensitive/);
  expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  expect(await db.auditEvent.count({ where: { actorId: user.id, action: "audit.exported" } })).toBe(1);
});

test("기기 세션은 본인만 회수하고 해당 쿠키만 무효화한다", async () => {
  const user = await person("sessions"), other = await person("foreign");
  const second = cookies(await auth.handler(req("/auth/sign-in/email", "POST", "", { email: user.email, password })));
  const firstSession = await requireActor(new Headers({ cookie: user.cookie }));
  const list = await (await sessionList(req("/me/sessions", "GET", second))).json();
  expect(list.items).toHaveLength(2); expect(JSON.stringify(list)).not.toMatch(/session_token|"token"/);
  expect((await sessionDelete(req("/me/sessions/" + firstSession.session.id, "DELETE", other.cookie))).status).toBe(404);
  expect((await sessionDelete(req("/me/sessions/" + firstSession.session.id, "DELETE", second))).status).toBe(204);
  expect((await profileGet(req("/me", "GET", user.cookie))).status).toBe(401);
  expect((await profileGet(req("/me", "GET", second))).status).toBe(200);
});

test("소유권 인계 전 폐쇄는 API와 DB에서 거부하고 인계 후 계정만 폐쇄한다", async () => {
  const owner = await person("owner"), successor = await person("successor"), tenant = await company(owner.id, successor.id);
  const status = await (await closureGet(req("/me/closure", "GET", owner.cookie))).json();
  expect(status.ownedCompanies.map((row: { id: string }) => row.id)).toEqual([tenant.id]);
  expect((await closurePost(req("/me/closure", "POST", owner.cookie, { version: 1, confirmation: owner.email, password }))).status).toBe(409);
  await expect(db.user.update({ where: { id: owner.id }, data: { status: "closed" } })).rejects.toThrow();
  const target = tenant.memberships.find(row => row.userId === successor.id)!;
  expect((await memberAction(req("/members/" + target.id + "/transfer", "POST", owner.cookie, { version: 1, password }))).status).toBe(200);
  expect((await closurePost(req("/me/closure", "POST", owner.cookie, { version: 1, confirmation: owner.email, password }))).status).toBe(200);
  expect((await db.company.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe("active");
  expect(await db.membership.count({ where: { tenantId: tenant.id, role: "owner", status: "active", userId: successor.id } })).toBe(1);
  expect(await db.service.count({ where: { tenantId: tenant.id } })).toBe(1);
});

test("폐쇄에는 이메일·현재 암호·버전·살아 있는 세션이 필요하고 실패하면 상태를 유지한다", async () => {
  const user = await person("checks"), input = { version: 1, confirmation: user.email, password };
  expect((await closureGet(req("/me/closure"))).status).toBe(401);
  expect((await closurePost(req("/me/closure", "POST", user.cookie, { ...input, confirmation: "wrong@example.test" }))).status).toBe(422);
  expect((await closurePost(req("/me/closure", "POST", user.cookie, { ...input, password: "wrong" }))).status).toBe(401);
  expect((await closurePost(req("/me/closure", "POST", user.cookie, { ...input, version: 2 }))).status).toBe(409);
  expect((await closurePost(req("/me/closure", "POST", user.cookie, input, "https://evil.example"))).status).toBe(403);
  const actor = await requireActor(new Headers({ cookie: user.cookie }));
  await db.session.delete({ where: { id: actor.session.id } });
  await expect(closeAccount(actor, input, randomUUID())).rejects.toMatchObject({ status: 401 });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("active");
  expect(await db.accountClosure.count()).toBe(0);
});

test("폐쇄는 모든 회사의 권한·세션·인증·초대와 암호 재설정 링크를 회수하며 사유는 암호화한다", async () => {
  const owner = await person("owner"), user = await person("member"), recipient = await person("recipient");
  const a = await company(owner.id, user.id), b = await company(owner.id, user.id);
  for (const tenant of [a, b]) await db.serviceGrant.create({ data: { tenantId: tenant.id, serviceId: tenant.services[0].id,
    memberId: tenant.memberships.find(row => row.userId === user.id)!.id, capabilities: ["service.read"] } });
  const incoming = await db.invitation.create({ data: { tenantId: a.id, invitedBy: a.memberships.find(row => row.userId === owner.id)!.id,
    email: user.email, role: "viewer", serviceIds: [a.services[0].id], tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 86400000) } });
  const outgoing = await db.invitation.create({ data: { tenantId: a.id, invitedBy: a.memberships.find(row => row.userId === user.id)!.id,
    email: recipient.email, role: "viewer", serviceIds: [a.services[0].id], tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 86400000), version: 2 } });
  const job = await db.job.create({ data: { type: "mail", tenantId: a.id, dedupeKey: "mail:invitation:" + outgoing.id + ":2", payloadCipher: encrypt({ to: recipient.email }) } });
  const second = cookies(await auth.handler(req("/auth/sign-in/email", "POST", "", { email: user.email, password })));
  const verificationMail = (await db.job.findMany({ where: { type: "mail" } })).map(row => decrypt<{ to?: string; text?: string }>(row.payloadCipher))
    .find(mail => mail.to === user.email && mail.text?.includes("verify-email"))!;
  const verificationLink = new URL(verificationMail.text!.match(/https?:\/\/\S+/)![0]);
  expect((await auth.handler(req("/auth/request-password-reset", "POST", "", { email: user.email, redirectTo: origin + "/reset" }))).status).toBe(200);
  const mail = (await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } }))
    .map(row => decrypt<{ to?: string; text?: string }>(row.payloadCipher)).find(value => value.to === user.email && value.text?.includes("reset-password"))!;
  const url = new URL(mail.text!.match(/https?:\/\/\S+/)![0]), token = url.pathname.split("/").pop()!;
  const closed = await closurePost(req("/me/closure", "POST", user.cookie, { version: 1, confirmation: user.email, password, reason: "PRIVATE-CLOSURE-REASON" }));
  expect(closed.status).toBe(200); expect(JSON.stringify(await closed.json())).not.toContain("PRIVATE-CLOSURE-REASON");
  for (const cookie of [user.cookie, second]) expect((await profileGet(req("/me", "GET", cookie))).status).toBe(401);
  const where = { userId: user.id };
  expect(await Promise.all([db.session.count({ where }), db.account.count({ where }), db.twoFactor.count({ where }), db.passwordHistory.count({ where })])).toEqual([0, 0, 0, 0]);
  expect(await db.serviceGrant.count({ where: { member: { userId: user.id } } })).toBe(0);
  expect(await db.membership.count({ where: { userId: user.id, status: "revoked" } })).toBe(2);
  expect(await db.invitation.count({ where: { id: { in: [incoming.id, outgoing.id] }, status: "revoked" } })).toBe(2);
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  const record = await db.accountClosure.findUniqueOrThrow({ where: { userId: user.id } });
  expect(record.reasonCipher).not.toContain("PRIVATE-CLOSURE-REASON"); expect(decrypt(record.reasonCipher!)).toBe("PRIVATE-CLOSURE-REASON");
  expect((await auth.handler(req("/auth/sign-in/email", "POST", "", { email: user.email, password }))).status).toBe(401);
  expect((await auth.handler(req("/auth/reset-password", "POST", "", { token, newPassword: "Fresh-closure-password!456" }))).status).toBe(400);
  expect((await auth.handler(new Request(verificationLink))).status).toBe(401);
  await auth.handler(req("/auth/sign-up/email", "POST", "", { name: "복구 시도", email: user.email, password }));
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("closed");
  expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { actorId: user.id, action: "account.closed" } })).toBe(3);
  expect(JSON.stringify(await db.auditEvent.findMany({ where: { actorId: user.id, action: "account.closed" } }))).not.toContain("PRIVATE-CLOSURE-REASON");
  await expect(db.user.update({ where: { id: user.id }, data: { status: "active" } })).rejects.toThrow();
  await expect(db.membership.update({ where: { id: a.memberships.find(row => row.userId === user.id)!.id }, data: { status: "active" } })).rejects.toThrow();
  await expect(db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 86400000) } })).rejects.toThrow();
  await expect(db.accountClosure.update({ where: { id: record.id }, data: { reasonCipher: null } })).rejects.toThrow();
  await expect(db.accountClosure.delete({ where: { id: record.id } })).rejects.toThrow();
});

test("전문가의 폐쇄는 배정·서비스 범위를 회수하고 감사 연결을 보존한다", async () => {
  const owner = await person("owner"), expert = await person("expert"), tenant = await company(owner.id);
  const assignment = await db.expertAssignment.create({ data: { tenantId: tenant.id, expertUserId: expert.id, assignedById: owner.id,
    expiresAt: new Date(Date.now() + 86400000), services: { create: { serviceId: tenant.services[0].id } } } });
  const member = await db.membership.create({ data: { userId: expert.id, tenantId: tenant.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  await db.serviceGrant.create({ data: { tenantId: tenant.id, memberId: member.id, serviceId: tenant.services[0].id, capabilities: ["service.read"] } });
  expect((await closurePost(req("/me/closure", "POST", expert.cookie, { version: 1, confirmation: expert.email, password }))).status).toBe(200);
  expect(await db.expertAssignment.findUnique({ where: { id: assignment.id } })).toMatchObject({ status: "revoked", version: 2 });
  expect(await db.serviceGrant.count({ where: { memberId: member.id } })).toBe(0);
  expect(await db.expertAssignmentService.count({ where: { assignmentId: assignment.id } })).toBe(1);
});

test("마지막 플랫폼 운영자의 폐쇄를 막고 동시 폐쇄 후에도 한 명을 유지한다", async () => {
  const first = await person("admin-a", true);
  expect((await closureGet(req("/me/closure", "GET", first.cookie))).status).toBe(200);
  expect((await closurePost(req("/me/closure", "POST", first.cookie, { version: 1, confirmation: first.email, password }))).status).toBe(409);
  const second = await person("admin-b", true);
  const results = await Promise.all([first, second].map(user => closurePost(req("/me/closure", "POST", user.cookie, { version: 1, confirmation: user.email, password }))));
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await db.user.count({ where: { platformAdmin: true, status: "active" } })).toBe(1);
  expect(await db.accountClosure.count()).toBe(1);
});
