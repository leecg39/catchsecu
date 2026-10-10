import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { SsoPolicyView } from "@/contracts/sso-login-policy";
import { ssoIdentityKind, ssoLoginModeLabels, ssoLoginModes, ssoPolicySave, ssoPolicySelection } from "@/contracts/sso-login-policy";
import { audit } from "./audit";
import type { Context } from "./context";
import { tokenHash } from "./crypto";
import { db, type Transaction } from "./db";
import { lockSecurityEntitlements } from "./feature-entitlements";
import { assertFileDeadlines } from "./file-access";
import { fail, requireVersion } from "./http";
import { enqueueMail } from "./jobs";
import { lockServiceActor } from "./service-actor";
import { ssoIdentityProvider } from "./sso-identity";
import { ssoPolicy } from "./sso-policy-enforcement";
import { currentSsoSessionProof } from "./sso-session-proof";

const FEATURE = "security.sso_login_policy", FRESH_MS = 5 * 60000, CODE_MS = 5 * 60000, RETRY_MS = 60000;
type Selection = z.infer<typeof ssoPolicySelection>;
const canManage = (member: { role: string; accessKind: string }) => member.accessKind === "direct" && ["owner", "security"].includes(member.role);

async function lockPolicyActor(tx: Transaction, ctx: Context, write: boolean) {
  // Serialize absent-row creation, challenges and changes before taking actor locks.
  if (write) await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR UPDATE`;
  const actor = await lockServiceActor(tx, ctx, write ? "security.write" : "security.read");
  if (actor.member.accessKind !== "direct" || (write && !canManage(actor.member)))
    fail(403, "FORBIDDEN", "회사 소유자 또는 보안 담당자만 로그인 정책을 변경할 수 있습니다.");
  const entitlements = await lockSecurityEntitlements(tx, ctx.tenantId);
  if (write) entitlements.assert(FEATURE);
  return { ...actor, entitlements };
}
async function selectionGuard(tx: Transaction, ctx: Context, input: Selection) {
  if (input.tenantId !== ctx.tenantId) fail(403, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 화면을 다시 불러와주세요.");
  const current = await ssoPolicy(tx, ctx.tenantId);
  requireVersion(input, current);
  if (current.mode === input.mode) fail(409, "SSO_POLICY_UNCHANGED", "이미 적용된 로그인 정책입니다.");
  // Switching restricted providers first requires an explicit, reauthenticated NONE transition.
  if (current.mode !== "NONE" && input.mode !== "NONE")
    fail(409, "SSO_POLICY_SWITCH_REQUIRES_NONE", "다른 SSO로 변경하려면 먼저 아이디 및 SSO 로그인을 허용한 뒤 새 SSO로 인증해주세요.");
  const required = input.mode === "NONE" ? current.mode : input.mode;
  const proof = await currentSsoSessionProof(tx, ctx.session.id, ctx.user.id);
  if (!proof || proof.tenantId !== ctx.tenantId || proof.identityProvider !== required)
    fail(403, "SSO_POLICY_REAUTH_REQUIRED", "적용할 SSO 계정으로 다시 로그인한 후 진행해주세요.");
  const freshUntil = new Date(proof.authenticatedAt.getTime() + FRESH_MS);
  const assertFresh = () => {
    if (freshUntil <= new Date()) fail(403, "SSO_POLICY_REAUTH_REQUIRED", "SSO 인증 후 5분이 지났습니다. 다시 로그인해주세요.");
  };
  assertFresh(); return { current, assertFresh };
}

export async function readSsoLoginPolicy(ctx: Context): Promise<SsoPolicyView> {
  return db.$transaction(async tx => {
    const actor = await lockPolicyActor(tx, ctx, false), policy = await ssoPolicy(tx, ctx.tenantId);
    const providers = await tx.ssoProvider.findMany({ where: { tenantId: ctx.tenantId, enabled: true, preflightOk: true }, include: { accounts: { select: { userId: true } } } });
    const members = await tx.membership.findMany({ where: { tenantId: ctx.tenantId, status: "active", accessKind: "direct", user: { status: "active", emailVerified: true } }, select: { userId: true } });
    const proof = await currentSsoSessionProof(tx, ctx.session.id, ctx.user.id);
    const ownProof = proof?.tenantId === ctx.tenantId ? proof : null;
    const result: SsoPolicyView = { tenantId: ctx.tenantId, ...policy, canManage: canManage(actor.member), entitlement: actor.entitlements.snapshot()[FEATURE],
      authentication: { identityProvider: ownProof ? ssoIdentityKind.parse(ownProof.identityProvider) : null, freshUntil: ownProof ? new Date(ownProof.authenticatedAt.getTime() + FRESH_MS).toISOString() : null },
      options: ssoLoginModes.map(mode => {
        const matching = providers.filter(provider => ssoIdentityProvider(provider) === mode);
        const linked = new Set(matching.flatMap(provider => provider.accounts.map(account => account.userId)));
        const linkedMembers = mode === "NONE" ? members.length : members.filter(member => linked.has(member.userId)).length;
        return { mode, configured: mode === "NONE" || matching.length > 0, linked: mode === "NONE" || linked.has(ctx.user.id),
          activeMembers: members.length, linkedMembers, unlinkedMembers: members.length - linkedMembers };
      }) };
    assertFileDeadlines(actor.deadlines); return result;
  });
}

export async function requestSsoPolicyChallenge(ctx: Context, raw: Selection, requestId: string) {
  const input = ssoPolicySelection.parse(raw);
  return db.$transaction(async tx => {
    const actor = await lockPolicyActor(tx, ctx, true), selection = await selectionGuard(tx, ctx, input);
    const now = new Date(), since = new Date(now.getTime() - 3600000);
    const recent = await tx.ssoPolicyChallenge.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.user.id, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: 10 });
    if (recent.length >= 10 || (recent[0] && recent[0].createdAt.getTime() + RETRY_MS > now.getTime()))
      fail(429, "SSO_POLICY_CHALLENGE_RATE_LIMITED", "인증번호를 너무 자주 요청했습니다. 잠시 후 다시 시도해주세요.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    const superseded = await tx.ssoPolicyChallenge.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.user.id, consumedAt: null, revokedAt: null }, select: { id: true } });
    await tx.ssoPolicyChallenge.updateMany({ where: { id: { in: superseded.map(row => row.id) } }, data: { revokedAt: now } });
    await tx.job.updateMany({ where: { tenantId: ctx.tenantId, dedupeKey: { in: superseded.map(row => "mail:sso-policy:" + row.id) }, status: { in: ["queued", "retry"] } }, data: { status: "cancelled", completedAt: now } });
    const id = randomUUID(), code = randomInt(0, 1000000).toString().padStart(6, "0"), expiresAt = new Date(now.getTime() + CODE_MS);
    await tx.ssoPolicyChallenge.create({ data: { id, tenantId: ctx.tenantId, userId: ctx.user.id, sessionId: ctx.session.id,
      policyVersion: input.version, mode: input.mode, emailHash: tokenHash(user.email), codeHash: tokenHash(id + ":" + code), expiresAt, createdAt: now } });
    await enqueueMail({ to: user.email, subject: "캐치시큐 SSO 로그인 정책 변경 인증번호",
      text: `${actor.member.tenant.name}의 로그인 정책을 '${ssoLoginModeLabels[input.mode]}'으로 변경하기 위한 인증번호입니다.\n인증번호: ${code}\n5분 이내에 현재 로그인한 화면에서 입력해주세요. 요청하지 않았다면 사용하지 마세요.` }, "sso-policy:" + id, tx, ctx.tenantId);
    await audit(tx, ctx, requestId, "sso.policy_challenge_requested", "ssoPolicyChallenge", id, ["mode", "policyVersion"]);
    actor.entitlements.assert(FEATURE); selection.assertFresh(); assertFileDeadlines(actor.deadlines);
    return { challengeId: id, expiresAt: expiresAt.toISOString(), retryAt: new Date(now.getTime() + RETRY_MS).toISOString() };
  });
}

export async function saveSsoLoginPolicy(ctx: Context, raw: z.infer<typeof ssoPolicySave>, requestId: string) {
  const input = ssoPolicySave.parse(raw);
  const result = await db.$transaction(async tx => {
    const actor = await lockPolicyActor(tx, ctx, true), selection = await selectionGuard(tx, ctx, input);
    await tx.$queryRaw`SELECT id FROM "SsoPolicyChallenge" WHERE id=${input.challengeId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const challenge = await tx.ssoPolicyChallenge.findUnique({ where: { id: input.challengeId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!challenge || challenge.tenantId !== ctx.tenantId || challenge.userId !== ctx.user.id || challenge.sessionId !== ctx.session.id
      || challenge.policyVersion !== input.version || challenge.mode !== input.mode || challenge.emailHash !== tokenHash(user.email))
      fail(404, "SSO_POLICY_CHALLENGE_NOT_FOUND", "현재 요청에 해당하는 인증번호를 찾을 수 없습니다. 다시 요청해주세요.");
    const assertChallenge = () => {
      if (challenge.consumedAt || challenge.revokedAt || challenge.attempts >= 5 || challenge.expiresAt <= new Date())
        fail(422, "SSO_POLICY_CHALLENGE_INVALID", "인증번호가 만료되었거나 사용할 수 없습니다. 다시 요청해주세요.");
    };
    assertChallenge();
    if (!timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(tokenHash(challenge.id + ":" + input.code), "hex"))) {
      await tx.ssoPolicyChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      await audit(tx, ctx, requestId, "sso.policy_challenge_rejected", "ssoPolicyChallenge", challenge.id, ["attempts"]);
      const exhausted = challenge.attempts + 1 >= 5;
      if (exhausted) await tx.job.updateMany({ where: { tenantId: ctx.tenantId, dedupeKey: "mail:sso-policy:" + challenge.id,
        status: { in: ["queued", "retry"] } }, data: { status: "cancelled", completedAt: new Date() } });
      actor.entitlements.assert(FEATURE); selection.assertFresh(); assertChallenge(); assertFileDeadlines(actor.deadlines);
      return { rejected: true, exhausted } as const; // Commit failed attempts before returning the HTTP error.
    }
    const saved = await tx.ssoLoginPolicy.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, mode: input.mode },
      update: { mode: input.mode, version: { increment: 1 } } });
    await tx.ssoPolicyChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    await tx.job.updateMany({ where: { tenantId: ctx.tenantId, dedupeKey: "mail:sso-policy:" + challenge.id, status: { in: ["queued", "retry"] } }, data: { status: "cancelled", completedAt: new Date() } });
    await audit(tx, ctx, requestId, "sso.policy_updated", "ssoLoginPolicy", ctx.tenantId, ["mode", "version"]);
    actor.entitlements.assert(FEATURE); selection.assertFresh(); assertChallenge(); assertFileDeadlines(actor.deadlines);
    return { tenantId: ctx.tenantId, mode: input.mode, version: saved.version };
  });
  if ("rejected" in result) {
    if (result.exhausted) fail(422, "SSO_POLICY_CHALLENGE_INVALID", "인증번호를 5회 잘못 입력했습니다. 새 인증번호를 요청해주세요.");
    fail(422, "SSO_POLICY_CODE_INVALID", "인증번호가 올바르지 않습니다. 5회 실패하면 다시 요청해야 합니다.");
  }
  return result;
}
