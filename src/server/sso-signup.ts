import { z } from "zod";
import type { SsoProvider, SsoState } from "@/generated/prisma/client";
import { ssoSignupAccept, signupLegalVersions, type SsoSignupView } from "@/contracts/sso-signup";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { env } from "./env";
import { fail, rateLimit } from "./http";
import { assertSsoBrowser } from "./sso-browser";
import { assertSsoProviderPolicy } from "./sso-policy-enforcement";
import { assertSsoState, completeSsoInTransaction, lockSsoCompany, lockSsoInvitation, type SsoSubject } from "./sso";

const cookieName = () => (env.BETTER_AUTH_URL.startsWith("https:") ? "__Host-" : "") + "catchsecu-sso-signup";
function cookie(value: string, seconds: number) {
  return `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${env.BETTER_AUTH_URL.startsWith("https:") ? "; Secure" : ""}`;
}
export const clearSsoSignupCookie = () => cookie("", 0);
function tokenFrom(headers: Headers) {
  const values = (headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(cookieName() + "="));
  const value = values.length === 1 ? values[0].slice(cookieName().length + 1) : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) fail(410, "SSO_SIGNUP_UNAVAILABLE", "가입 인증이 없거나 만료되었습니다. 회사 SSO 로그인에서 다시 시작해주세요.");
  return value;
}
type Payload = { state: Omit<SsoState, "expiresAt" | "createdAt"> & { expiresAt: string; createdAt: string }; subject: SsoSubject };
export async function issueSsoSignup(tx: Transaction, provider: SsoProvider, state: SsoState, subject: SsoSubject) {
  if (provider.protocol !== "oidc" || !["login", "invite"].includes(state.mode) || !state.browserHash || !subject.emailVerified
    || !z.email().max(320).safeParse(subject.email).success) fail(401, "SSO_SIGNUP_INVALID", "가입할 인증 정보를 확인할 수 없습니다.");
  const now = new Date(), expiresAt = new Date(Math.min(now.getTime() + 300000, state.expiresAt.getTime()));
  if (expiresAt <= now) fail(410, "SSO_SIGNUP_UNAVAILABLE", "인증 기한이 끝났습니다. 다시 로그인해주세요.");
  const token = opaqueToken();
  await tx.ssoSignupIntent.create({ data: { tenantId: provider.tenantId, providerId: provider.id, providerVersion: provider.version,
    stateId: state.id, tokenHash: tokenHash(token), browserHash: state.browserHash, mode: state.mode,
    payloadCipher: encrypt({ state, subject }), createdAt: now, expiresAt } });
  return { redirect: "/oauth2/signup", cookie: cookie(token, Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))), clearSessionCookie: undefined };
}
async function withIntent<T>(headers: Headers, expectedId: string | undefined, action: (tx: Transaction, intent: Awaited<ReturnType<typeof lockedIntent>>) => Promise<T>) {
  const hash = tokenHash(tokenFrom(headers)); await rateLimit("sso-signup:" + hash, 60);
  return db.$transaction(async tx => action(tx, await lockedIntent(tx, hash, headers, expectedId)), { timeout: 15000 });
}
async function lockedIntent(tx: Transaction, hash: string, headers: Headers, expectedId?: string) {
  const initial = await tx.ssoSignupIntent.findUnique({ where: { tokenHash: hash } });
  if (!initial || initial.expiresAt <= new Date() || (expectedId && expectedId !== initial.id))
    fail(410, "SSO_SIGNUP_UNAVAILABLE", "가입 인증이 만료되었거나 이미 사용되었습니다. 다시 로그인해주세요.");
  assertSsoBrowser(initial, headers, "oidc");
  await lockSsoCompany(tx, initial.tenantId, headers);
  await tx.$queryRaw`SELECT id FROM "SsoProvider" WHERE id=${initial.providerId} AND "tenantId"=${initial.tenantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SsoSignupIntent" WHERE id=${initial.id} FOR UPDATE`;
  const row = await tx.ssoSignupIntent.findUnique({ where: { id: initial.id } });
  if (!row || row.expiresAt <= new Date()) fail(410, "SSO_SIGNUP_UNAVAILABLE", "가입 인증이 만료되었거나 이미 사용되었습니다.");
  const payload = decrypt<Payload>(row.payloadCipher), state = { ...payload.state, expiresAt: new Date(payload.state.expiresAt), createdAt: new Date(payload.state.createdAt) };
  const provider = await tx.ssoProvider.findUnique({ where: { id: row.providerId } });
  if (!provider || provider.protocol !== "oidc" || provider.tenantId !== row.tenantId || provider.version !== row.providerVersion
    || state.providerId !== row.providerId || state.providerVersion !== row.providerVersion || state.id !== row.stateId || state.browserHash !== row.browserHash || state.mode !== row.mode)
    fail(409, "SSO_CONFIGURATION_CHANGED", "SSO 가입 설정이 변경되었습니다. 다시 로그인해주세요.");
  assertSsoState(provider, state); assertSsoBrowser(state, headers, "oidc"); await assertSsoProviderPolicy(tx, provider);
  if (state.mode === "invite") await lockSsoInvitation(tx, provider, state, payload.subject);
  return { row, provider, state, subject: payload.subject };
}
export async function getSsoSignup(headers: Headers): Promise<SsoSignupView> {
  return withIntent(headers, undefined, async (tx, { row, subject, state }) => {
    const company = state.mode === "invite" ? await tx.company.findUniqueOrThrow({ where: { id: row.tenantId }, select: { name: true } }) : null;
    return { id: row.id, email: subject.email!, name: subject.name ?? subject.email!.split("@")[0], companyName: company?.name ?? null,
      expiresAt: row.expiresAt.toISOString(), termsVersion: signupLegalVersions.terms, privacyVersion: signupLegalVersions.privacy };
  });
}
export async function acceptSsoSignup(headers: Headers, input: z.infer<typeof ssoSignupAccept>) {
  const accepted = ssoSignupAccept.parse(input);
  return withIntent(headers, accepted.intentId, async (tx, { row, provider, state, subject }) => {
    const result = await completeSsoInTransaction(tx, provider, state, subject, headers, undefined, { ...accepted, authenticatedAt: row.createdAt });
    if (row.expiresAt <= new Date()) fail(410, "SSO_SIGNUP_UNAVAILABLE", "가입 인증이 만료되었습니다. 다시 로그인해주세요.");
    await tx.ssoSignupIntent.delete({ where: { id: row.id } });
    return result;
  });
}
export async function cancelSsoSignup(headers: Headers, intentId: string) {
  return withIntent(headers, intentId, async (tx, { row }) => { await tx.ssoSignupIntent.delete({ where: { id: row.id } }); return { cancelled: true }; });
}
export async function cleanupSsoSignup() {
  return db.ssoSignupIntent.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
