import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { contextDto, requireActor, requireContext, requireSsoRecoveryContext } from "@/server/context";
import { ssoSessionState } from "@/server/sso-policy-enforcement";
import { recordSsoSessionProof } from "@/server/sso-session-proof";
import { lockServiceActor, lockSsoRecoveryActor } from "@/server/service-actor";
import { lockFileContext, lockFileIssuer } from "@/server/file-access";
import { currentServiceScope } from "@/server/service-access";
import { lockDownloadActor } from "@/server/download-actor";
import { listCompanies } from "@/server/company-management";
import { selectCompany } from "@/server/context-selection";
import { listOwnSsoAccounts, hasSsoFallback, unlinkOwnSsoAccount } from "@/server/sso-accounts";
import { assertProviderCanStop } from "@/server/sso-provider-lifecycle";
import { startSso } from "@/server/sso";
import { tokenHash, opaqueToken } from "@/server/crypto";
import { acceptInvitationRequest } from "@/server/members";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });
const google = { protocol: "oidc", name: "시험 공급자", issuer: "https://accounts.google.com", clientId: "synthetic-client",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", enabled: true, preflightOk: true };
// Relational fixtures seed provenance explicitly. Signed protocol tests cover acquisition.
async function fixture() {
  const email = randomUUID() + "@policy.test", password = "Policy-guards!123456";
  const call = (path: string, body: unknown) => auth.handler(new Request(origin + "/api/v1/auth/" + path,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect((await call("sign-up/email", { email, password, name: "정책 시험" })).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "회사 A", publicName: "A", billingEmail: "private@billing.test",
    policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "비공개 서비스", externalName: "A" } } } });
  const login = await call("sign-in/email", { email, password }); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const headers = new Headers({ origin, cookie });
  const ctx = await requireContext(headers);
  const service = await db.service.findFirstOrThrow({ where: { tenantId: company.id } });
  const provider = await db.ssoProvider.create({ data: { ...google, tenantId: company.id } });
  const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: google.issuer + "|" + user.id } });
  const policy = (mode: "NONE" | "GOOGLE" | "AZURE") => db.ssoLoginPolicy.upsert({ where: { tenantId: company.id },
    create: { tenantId: company.id, mode }, update: { mode, version: { increment: 1 } } });
  const proof = () => recordSsoSessionProof(db, ctx.session.id, user.id, provider, account.id);
  return { user, company, ctx, service, provider, account, headers, policy, proof };
}
test("정책 없는 회사는 기존 로그인 허용, 제한 저장 후 연결 Account만으로는 통과하지 못한다", async () => {
  const f = await fixture();
  expect(await ssoSessionState(f.company.id, f.user.id, f.ctx.session.id)).toEqual({ mode: "NONE", version: 0, required: false });
  await f.policy("GOOGLE");
  await expect(requireContext(f.headers)).rejects.toMatchObject({ status: 403, code: "GOOGLE_OAUTH_POLICY" });
  expect(await requireActor(f.headers)).toMatchObject({ user: { id: f.user.id } });
  expect(await db.session.count({ where: { id: f.ctx.session.id } })).toBe(1);
});
test.each(["service", "file", "scope", "download"])("%s 트랜잭션은 정책 변경 이전에 캡처한 요청 문맥도 거부한다", async kind => {
  const f = await fixture(); await f.policy("GOOGLE");
  await expect(db.$transaction<unknown>(tx => kind === "service" ? lockServiceActor(tx, f.ctx, "service.read")
    : kind === "file" ? lockFileContext(tx, f.ctx, f.service.id, ["file.read"])
    : kind === "scope" ? currentServiceScope(tx, f.ctx, "service.read")
    : lockDownloadActor(tx, { ...f.ctx, context: f.ctx }, true))).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
});
test("복구 문맥은 회사 선택에 필요한 이름만 유지하고 서비스·업무 권한을 비운다", async () => {
  const f = await fixture(); await f.policy("GOOGLE");
  const context = await contextDto(f.headers);
  expect(context).toMatchObject({ company: { id: f.company.id }, services: [], capabilities: [], serviceId: null,
    ssoLogin: { mode: "GOOGLE", required: true }, memberships: [{ tenantId: f.company.id }] });
  expect(JSON.stringify(context)).not.toContain(f.company.billingEmail);
  expect(await listCompanies(f.user.id, { page: 1, pageSize: 20, search: "" }, null, f.ctx.session.id)).toMatchObject({ items: [], total: 0, blockedTotal: 1 });
});
test("복구용 SSO 연결은 허용하지만 업무 scope는 비어 있고 허용되지 않은 공급자는 시작할 수 없다", async () => {
  const f = await fixture(); await f.policy("GOOGLE");
  const recovery = await requireSsoRecoveryContext(f.headers);
  expect(recovery.capabilities).toEqual([]);
  expect((await db.$transaction(tx => lockSsoRecoveryActor(tx, recovery))).scope.id).toEqual({ in: [] });
  const own = await listOwnSsoAccounts(recovery);
  expect(own).toMatchObject({ loginPolicy: "GOOGLE", items: [{ canUnlink: false }], providers: [{ available: true }] });
  expect((await startSso(f.provider.id, "link", f.headers)).redirect).toContain("https://accounts.google.com/");
  const wrong = await db.ssoProvider.create({ data: { ...google, tenantId: f.company.id, issuer: "https://independent.test" } });
  await expect(startSso(wrong.id, "link", f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
  expect(await db.ssoState.count()).toBe(1);
});
test("해당 회사의 유효한 Google 근거로 통과하며 구독 없음·만료는 저장된 제한을 해제하지 않는다", async () => {
  const f = await fixture(); await f.policy("GOOGLE"); await f.proof();
  expect((await requireContext(f.headers)).tenantId).toBe(f.company.id);
  expect((await contextDto(f.headers)).services).toHaveLength(1);
  await db.billingSubscription.create({ data: { tenantId: f.company.id, planId: "trial", planVersionId: "trial-v1", status: "expired",
    priceKrw: 0, currency: "KRW", activationSource: "trial", periodStart: new Date(Date.now() - 8 * 86400000), periodEnd: new Date(Date.now() - 86400000) } });
  await db.ssoSessionProof.deleteMany({ where: { sessionId: f.ctx.session.id } });
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
});
test("Microsoft 제한·공급자 비활성화·연결 계정 삭제는 이전 Google 근거의 사용을 거부한다", async () => {
  const f = await fixture(); await f.proof(); await f.policy("AZURE");
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "MS_OAUTH_POLICY" });
  await f.policy("GOOGLE"); await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true } });
  await db.account.delete({ where: { id: f.account.id } });
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
});
test("차단된 회사에서 NONE 회사로 전환할 수 있고 다른 회사의 Google 근거는 재사용할 수 없다", async () => {
  const f = await fixture(); await f.policy("GOOGLE");
  const other = await db.company.create({ data: { name: "회사 B", publicName: "B", memberships: { create: { userId: f.user.id, role: "owner" } } } });
  await selectCompany(f.ctx, other.id, null, "leave-blocked-company");
  expect((await selectCompany(f.ctx, f.company.id, null, "blocked-return")).ssoLogin.required).toBe(true);
  expect((await db.session.findUniqueOrThrow({ where: { id: f.ctx.session.id } })).activeServiceId).toBeNull();
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
  expect((await requireSsoRecoveryContext(f.headers)).tenantId).toBe(f.company.id);
  const p = await db.ssoProvider.create({ data: { ...google, tenantId: other.id } });
  const a = await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + p.id, accountId: "other-company" } });
  await recordSsoSessionProof(db, f.ctx.session.id, f.user.id, p, a.id);
  expect((await selectCompany(f.ctx, f.company.id, null, "foreign-proof")).ssoLogin.required).toBe(true);
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
});
test("제한 중 연결 해제와 마지막 허용 공급자 중지는 비밀번호 대체 수단이 있어도 거부한다", async () => {
  const f = await fixture(); await f.policy("GOOGLE"); await f.proof();
  expect(await hasSsoFallback(db, f.user.id, [f.account.id], f.company.id)).toBe(false);
  await expect(unlinkOwnSsoAccount(f.ctx, f.account.id, f.account.updatedAt.toISOString(), randomUUID())).rejects.toMatchObject({ code: "SSO_POLICY_UNLINK_FORBIDDEN" });
  await expect(db.$transaction(tx => assertProviderCanStop(tx, f.ctx, f.provider.id))).rejects.toMatchObject({ code: "SSO_PROVIDER_LAST_LOGIN" });
  expect(await db.account.count({ where: { id: f.account.id } })).toBe(1);
  const p = await db.ssoProvider.create({ data: { ...google, tenantId: f.company.id } });
  await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + p.id, accountId: "allowed-fallback" } });
  expect(await hasSsoFallback(db, f.user.id, [f.account.id], f.company.id)).toBe(true);
});
test("세션 없는 작업 발급자 검사는 로그인 증거를 요구하지 않는다", async () => {
  const f = await fixture(); await f.policy("GOOGLE");
  expect((await db.$transaction(tx => lockFileIssuer(tx, f.ctx, f.service.id, ["file.read"]))).member.id).toBe(f.ctx.member.id);
});
test("초대 수락과 성공 캐시 재전송은 대상 회사의 최신 정책을 검사한다", async () => {
  const f = await fixture();
  const target = await db.company.create({ data: { name: "초대 회사", publicName: "초대", services: { create: { name: "초대 서비스", externalName: "초대" } } } });
  const owner = await db.user.create({ data: { email: randomUUID() + "@owner.test", name: "초대자", emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: target.id, userId: owner.id, role: "owner" } });
  const service = await db.service.findFirstOrThrow({ where: { tenantId: target.id } });
  await grantSecurityTestTrials();
  const token = opaqueToken(), key = randomUUID();
  const invitation = await db.invitation.create({ data: { tenantId: target.id, email: f.user.email, role: "viewer", invitedBy: member.id,
    serviceIds: [service.id], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) } });
  await db.ssoLoginPolicy.create({ data: { tenantId: target.id, mode: "GOOGLE" } });
  const accepted = await acceptInvitationRequest(f.ctx, token, key, "restricted-invite");
  expect(accepted.body.ssoLogin.required).toBe(true);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted");
  expect((await db.session.findUniqueOrThrow({ where: { id: f.ctx.session.id } })).activeServiceId).toBeNull();
  await expect(requireContext(f.headers)).rejects.toMatchObject({ code: "GOOGLE_OAUTH_POLICY" });
  expect((await requireSsoRecoveryContext(f.headers)).tenantId).toBe(target.id);
  await db.ssoLoginPolicy.update({ where: { tenantId: target.id }, data: { mode: "NONE" } });
  expect((await acceptInvitationRequest(f.ctx, token, key, "allowed-replay")).body.ssoLogin.required).toBe(false);
  await db.ssoLoginPolicy.update({ where: { tenantId: target.id }, data: { mode: "GOOGLE" } });
  expect((await acceptInvitationRequest(f.ctx, token, key, "restricted-replay")).body.ssoLogin.required).toBe(true);
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: invitation.id } })).toBe(1);
});

test("NONE 회사도 다른 회사의 정책에 막힌 계정을 대체 로그인 수단으로 세지 않는다", async () => {
  const f = await fixture();
  await db.account.deleteMany({ where: { userId: f.user.id, providerId: "credential" } });
  const other = await db.company.create({ data: { name: "제한 회사", publicName: "제한", memberships: { create: { userId: f.user.id, role: "owner" } } } });
  const provider = await db.ssoProvider.create({ data: { ...google, tenantId: other.id, issuer: "https://independent.test" } });
  await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + provider.id, accountId: "independent-subject" } });
  await db.ssoLoginPolicy.create({ data: { tenantId: other.id, mode: "GOOGLE" } });
  expect(await hasSsoFallback(db, f.user.id, [f.account.id], f.company.id)).toBe(false);
  await expect(unlinkOwnSsoAccount(f.ctx, f.account.id, f.account.updatedAt.toISOString(), randomUUID())).rejects.toMatchObject({ code: "SSO_LAST_LOGIN_METHOD" });
  await db.ssoLoginPolicy.update({ where: { tenantId: other.id }, data: { mode: "NONE" } });
  expect(await hasSsoFallback(db, f.user.id, [f.account.id], f.company.id)).toBe(true);
});
