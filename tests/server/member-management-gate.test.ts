import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { requireActor, requireContext } from "@/server/context";
import { acceptInvitation, updateMember } from "@/server/members";
import { roleCapabilities } from "@/server/permissions";
import { POST as invite } from "@/app/api/v1/invitations/route";
import { POST as invitationAction } from "@/app/api/v1/invitations/[...segments]/route";
import { PATCH as memberPatch } from "@/app/api/v1/members/[...segments]/route";
import { GET as context, POST as selectContext } from "@/app/api/v1/context/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as serviceDetail } from "@/app/api/v1/services/[id]/route";
import { DELETE as archiveService } from "@/app/api/v1/services/[id]/route";
import { GET as assignments, POST as assignExpert } from "@/app/api/v1/expert-assignments/route";
import { GET as companies } from "@/app/api/v1/companies/route";
import { runOneJob } from "@/server/jobs";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Member gate fixtures require the isolated local test database.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Member-gate-password!123";
type Person = { id: string; email: string; cookie: string };
let owner: Person, member: Person, operator: Person, expert: Person;
let trialVersion = "";
function req(path: string, method = "GET", person = owner, value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: person.cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function signup(label: string, platformAdmin = false): Promise<Person> {
  const email = label + "-" + randomUUID() + "@members.test.local";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", { id: "", email, cookie: "" }, { email, name: label, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin } });
  const signed = await auth.handler(req("/auth/sign-in/email", "POST", { id: user.id, email, cookie: "" }, { email, password }));
  expect(signed.status).toBe(200);
  return { id: user.id, email, cookie: signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function company(label: string, limited = false, remainingTrialMs = 7 * 86400000) {
  const row = await db.company.create({ data: { name: label, publicName: label,
    memberships: { create: { userId: owner.id, role: "owner" } }, services: { create: { name: label, externalName: label } } }, include: { services: true } });
  const start = new Date(Date.now() + remainingTrialMs - 7 * 86400000);
  if (limited) await db.billingSubscription.create({ data: { tenantId: row.id, planId: "trial", planVersionId: trialVersion,
    status: "trialing", priceKrw: 0, activationSource: "trial", periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000) } });
  expect((await selectContext(req("/context", "POST", owner, { companyId: row.id }))).status).toBe(200);
  return { id: row.id, serviceId: row.services[0].id };
}
async function invitation(tenant: { serviceId: string }, email = randomUUID() + "@invite.test.local") {
  const result = await invite(req("/invitations", "POST", owner, { email, role: "viewer", serviceIds: [tenant.serviceId] }, { "idempotency-key": randomUUID() }));
  expect(result.status).toBe(201);
  return result.json() as Promise<{ id: string; version: number }>;
}
async function tokenFor(id: string) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + id + ":1" } });
  const mail = decrypt<{ text: string }>(job.payloadCipher);
  const href = mail.text.split("\n").find(line => line.startsWith(origin))!;
  return new URL(href).searchParams.get("token")!;
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  owner = await signup("gate-owner"); member = await signup("gate-member");
  operator = await signup("gate-operator", true); expert = await signup("gate-expert");
  trialVersion = (await db.billingPlanVersion.create({ data: { planId: "trial", number: Date.now() % 1000000000,
    cycle: "trial", priceKrw: 0, memberLimit: 2, features: {} } })).id;
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });

test("만료 초대 재발송은 다른 대기 초대의 좌석 예약을 침범하지 않는다", async () => {
  const tenant = await company("만료 초대 좌석", true), expired = await invitation(tenant);
  await db.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const original = await db.invitation.findUniqueOrThrow({ where: { id: expired.id } });
  await invitation(tenant);
  const response = await invitationAction(req("/invitations/" + expired.id + "/resend", "POST", owner, { version: 1 }));
  expect(response.status).toBe(409); expect((await response.json()).error.code).toBe("QUOTA_EXCEEDED");
  expect(await db.invitation.findUnique({ where: { id: expired.id } })).toMatchObject({ version: 1, tokenHash: original.tokenHash });
  expect(await db.job.count({ where: { dedupeKey: { startsWith: "mail:invitation:" + expired.id + ":" } } })).toBe(1);
});
test("유효한 초대의 재발송은 기존 예약을 이중 계산하지 않는다", async () => {
  const tenant = await company("기존 초대 좌석", true), pending = await invitation(tenant);
  expect((await invitationAction(req("/invitations/" + pending.id + "/resend", "POST", owner, { version: 1 }))).status).toBe(200);
  expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ version: 2, status: "pending" });
});
test("초대 링크가 유효해도 구독이 만료되면 재발송할 수 없다", async () => {
  const tenant = await company("구독 만료 재발송", true, 60000), pending = await invitation(tenant), now = Date.now();
  vi.setSystemTime(now + 120000);
  try {
    const result = await invitationAction(req("/invitations/" + pending.id + "/resend", "POST", owner, { version: 1 }));
    expect(result.status).toBe(402); expect((await result.json()).error.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ version: 1 });
  } finally { vi.useRealTimers(); }
});
test("이미 구성원으로 참여한 이메일에는 남은 초대를 재발송하지 않는다", async () => {
  const tenant = await company("기존 구성원 재발송"), pending = await invitation(tenant, member.email);
  await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer" } });
  const result = await invitationAction(req("/invitations/" + pending.id + "/resend", "POST", owner, { version: 1 }));
  expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("MEMBER_EXISTS");
  expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ version: 1 });
});
test("정지 구성원 복구는 대기 초대를 포함한 좌석 한도를 지킨다", async () => {
  const tenant = await company("정지 복구 좌석", true);
  const row = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer", status: "suspended" } });
  await invitation(tenant);
  const result = await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 1, status: "active" }));
  expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("QUOTA_EXCEEDED");
  expect(await db.membership.findUnique({ where: { id: row.id } })).toMatchObject({ status: "suspended", version: 1 });
});
test("초대 수락은 자신의 예약을 사용하므로 한도가 꽉 차 있어도 허용된다", async () => {
  const tenant = await company("수락 예약 좌석", true), pending = await invitation(tenant, member.email), token = await tokenFor(pending.id);
  expect((await invitationAction(req("/invitations/accept", "POST", member, { token }, { "idempotency-key": randomUUID() }))).status).toBe(200);
  expect(await db.membership.count({ where: { tenantId: tenant.id, status: "active" } })).toBe(2);
  expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ status: "accepted", acceptedBy: member.id });
});
test("신규 전문가 배정도 대기 초대의 좌석 예약을 지킨다", async () => {
  const tenant = await company("전문가 좌석", true); await invitation(tenant);
  const result = await assignExpert(req("/expert-assignments", "POST", operator, { companyId: tenant.id, expertEmail: expert.email,
    serviceIds: [tenant.serviceId], expiresAt: new Date(Date.now() + 86400000).toISOString() }));
  expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("QUOTA_EXCEEDED");
  expect(await db.expertAssignment.count({ where: { tenantId: tenant.id } })).toBe(0);
});
test("서비스 범위를 모두 회수하면 기존 세션의 직접 URL과 목록도 즉시 차단된다", async () => {
  const tenant = await company("서비스 전체 회수");
  const row = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer",
    grants: { create: { serviceId: tenant.serviceId, capabilities: [...roleCapabilities("viewer")] } } } });
  expect((await selectContext(req("/context", "POST", member, { companyId: tenant.id }))).status).toBe(200);
  expect((await selectContext(req("/context", "POST", member, { serviceId: tenant.serviceId }))).status).toBe(200);
  expect((await serviceDetail(req("/services/" + tenant.serviceId, "GET", member))).status).toBe(200);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 1, serviceIds: [] }))).status).toBe(200);
  expect((await serviceDetail(req("/services/" + tenant.serviceId, "GET", member))).status).toBe(403);
  expect((await (await services(req("/services", "GET", member))).json()).total).toBe(0);
  expect(await (await context(req("/context", "GET", member))).json()).toMatchObject({ company: { id: tenant.id }, serviceId: null });
  expect((await db.session.findFirstOrThrow({ where: { userId: member.id, activeCompanyId: tenant.id } })).activeServiceId).toBeNull();
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 2, serviceIds: [tenant.serviceId] }))).status).toBe(200);
  expect((await serviceDetail(req("/services/" + tenant.serviceId, "GET", member))).status).toBe(200);
});
test("회사 잠금 전에 얻은 권한도 실제 계정 정지 후 구성원 변경에 사용할 수 없다", async () => {
  const tenant = await company("변경 계정 재검사");
  const row = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer" } });
  const stale = await requireContext(req("/context").headers, "member.manage");
  await db.user.update({ where: { id: owner.id }, data: { status: "suspended" } });
  try {
    await expect(updateMember(stale, row.id, { version: 1, role: "editor" }, randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await db.membership.findUnique({ where: { id: row.id } })).toMatchObject({ role: "viewer", version: 1 });
  } finally { await db.user.update({ where: { id: owner.id }, data: { status: "active" } }); }
});
test("초대 수락 트랜잭션도 로그인 후 정지된 계정을 재검사한다", async () => {
  const tenant = await company("수락 계정 재검사"), pending = await invitation(tenant, expert.email), token = await tokenFor(pending.id);
  const stale = await requireActor(req("/context", "GET", expert).headers);
  await db.user.update({ where: { id: expert.id }, data: { status: "suspended" } });
  try {
    await expect(db.$transaction(tx => acceptInvitation(stale, token, randomUUID(), tx))).rejects.toMatchObject({ status: 401 });
    expect(await db.membership.count({ where: { tenantId: tenant.id, userId: expert.id } })).toBe(0);
    expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ status: "pending", version: 1 });
  } finally { await db.user.update({ where: { id: expert.id }, data: { status: "active" } }); }
});
test("수락 전에 폐기된 세션은 초대를 소비하거나 구성원 권한을 만들지 않는다", async () => {
  const tenant = await company("폐기 세션 수락"), pending = await invitation(tenant, expert.email), token = await tokenFor(pending.id);
  const stale = await requireActor(req("/context", "GET", expert).headers);
  await db.session.delete({ where: { id: stale.session.id } });
  await expect(db.$transaction(tx => acceptInvitation(stale, token, randomUUID(), tx))).rejects.toMatchObject({ status: 401 });
  expect(await db.invitation.findUnique({ where: { id: pending.id } })).toMatchObject({ status: "pending", version: 1 });
  expect(await db.membership.count({ where: { tenantId: tenant.id, userId: expert.id } })).toBe(0);
  const signed = await auth.handler(req("/auth/sign-in/email", "POST", expert, { email: expert.email, password }));
  expect(signed.status).toBe(200); expert.cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
});
test("초대의 빈 서비스와 구성원의 무변경·중복 서비스 입력은 거부한다", async () => {
  const tenant = await company("엄격 구성원 입력"), row = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer" } });
  expect((await invite(req("/invitations", "POST", owner, { email: expert.email, role: "viewer", serviceIds: [] }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 1 }))).status).toBe(422);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 1, serviceIds: [tenant.serviceId, tenant.serviceId] }))).status).toBe(422);
  expect(await db.membership.findUnique({ where: { id: row.id } })).toMatchObject({ version: 1 });
});
test("전문가 본인 회사 검색은 서버에서 전체 배정과 페이지에 적용된다", async () => {
  const first = await company("검색 대상 회사"), second = await company("검색 제외 회사");
  for (const tenant of [first, second]) expect((await assignExpert(req("/expert-assignments", "POST", operator,
    { companyId: tenant.id, expertEmail: expert.email, serviceIds: [tenant.serviceId], expiresAt: new Date(Date.now() + 86400000).toISOString() }))).status).toBe(201);
  const filtered = await (await assignments(req("/expert-assignments?scope=mine&pageSize=1&search=" + encodeURIComponent("검색 대상"), "GET", expert))).json();
  expect(filtered.total).toBe(1); expect(filtered.items[0].companyId).toBe(first.id);
  const page1 = await (await assignments(req("/expert-assignments?scope=mine&pageSize=1", "GET", expert))).json();
  const page2 = await (await assignments(req("/expert-assignments?scope=mine&pageSize=1&page=2", "GET", expert))).json();
  expect(page1.total).toBe(2); expect(page1.items[0].id).not.toBe(page2.items[0].id);
  expect((await (await assignments(req("/expert-assignments?scope=mine&search=없는회사", "GET", member))).json()).total).toBe(0);
});
test("동시 소유자 권한 회수에서도 DB는 활성 소유자 한 명을 보존한다", async () => {
  const tenant = await company("동시 소유자 보호");
  const second = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "owner" } });
  const first = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } } });
  const result = await Promise.allSettled([first.id, second.id].map(id => db.membership.update({ where: { id }, data: { role: "viewer" } })));
  expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(await db.membership.count({ where: { tenantId: tenant.id, role: "owner", status: "active" } })).toBe(1);
});
test("회사 목록은 실제 소속과 페이지·검색 범위에 한정되고 비밀 필드를 제외한다", async () => {
  const tag = randomUUID(), first = await company("소속 목록 " + tag), second = await company("소속 목록 " + tag);
  await db.membership.create({ data: { tenantId: first.id, userId: member.id, role: "viewer" } });
  const query = "?search=" + encodeURIComponent("소속 목록 " + tag) + "&pageSize=1";
  const page1 = await (await companies(req("/companies" + query))).json(), page2 = await (await companies(req("/companies" + query + "&page=2"))).json();
  expect(page1.total).toBe(2); expect(page1.items[0].id).not.toBe(page2.items[0].id);
  expect(new Set([page1.items[0].id, page2.items[0].id])).toEqual(new Set([first.id, second.id]));
  const own = await (await companies(req("/companies" + query, "GET", member))).json();
  expect(own.total).toBe(1); expect(own.items[0]).toMatchObject({ id: first.id, role: "viewer" });
  expect(own.items[0]).not.toHaveProperty("businessFile"); expect(own.items[0]).not.toHaveProperty("closureReasonCipher");
  expect((await (await companies(req("/companies" + query, "GET", expert))).json()).total).toBe(0);
  expect((await companies(req("/companies", "GET", { id: "", email: "", cookie: "" }))).status).toBe(401);
});
test("worker는 전달 전에 만료된 초대 링크를 확인하고 메일을 남기지 않는다", async () => {
  await db.job.updateMany({ where: { status: { in: ["queued", "retry"] } }, data: { status: "cancelled" } });
  const tenant = await company("만료 초대 worker"), pending = await invitation(tenant);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + pending.id + ":1" } });
  await db.invitation.update({ where: { id: pending.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await runOneJob("member-gate-worker")).toBe(true);
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "cancelled" });
  await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toMatchObject({ code: "ENOENT" });
});
test("보관된 서비스의 기존 권한은 편집할 수 있지만 회수 후 새로 부여할 수 없다", async () => {
  const tenant = await company("보관 서비스 구성원");
  const row = await db.membership.create({ data: { tenantId: tenant.id, userId: member.id, role: "viewer",
    grants: { create: { serviceId: tenant.serviceId, capabilities: [...roleCapabilities("viewer")] } } } });
  expect((await archiveService(req("/services/" + tenant.serviceId, "DELETE", owner, undefined, { "If-Match": "1" }))).status).toBe(204);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 1, role: "editor", serviceIds: [tenant.serviceId] }))).status).toBe(200);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 2, serviceIds: [] }))).status).toBe(200);
  expect((await memberPatch(req("/members/" + row.id, "PATCH", owner, { version: 3, serviceIds: [tenant.serviceId] }))).status).toBe(404);
});
