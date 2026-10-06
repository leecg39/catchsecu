import { constants, createHash, createPublicKey, randomBytes, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import type { SsoProvider, SsoState } from "@/generated/prisma/client";
import type { SsoProviderRecord, ssoProviderCreate, ssoProviderPatch } from "@/contracts/sso";
import { z } from "zod";
import { audit } from "./audit";
import { activeMembershipWhere, requireContext, type Context } from "./context";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { env } from "./env";
import { fail, rateLimit } from "./http";
import { trustedClientIp } from "./client-ip";
import { assertQuota } from "./entitlements";
import { mayAssign, replaceGrants, revokeInvitedExpert, validateServices } from "./members";
import { roleCan, roleCapabilities } from "./permissions";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { assertCompanyIp } from "./ip-enforcement";
import { Prisma } from "@/generated/prisma/client";
import { assertProviderCanStop, removeProviderAccounts } from "./sso-provider-lifecycle";
import { assertFreshSsoSession } from "./sso-accounts";
import { issueSsoMfa } from "./sso-mfa";
import { validateSamlEnvelope, validatedSamlSubject } from "./saml-validation";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const baseUrl = () => env.BETTER_AUTH_URL.replace(/\/$/, "");

function assertEndpoint(url: string, field: string) {
  const parsed = new URL(url);
  const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && (!loopback || process.env.NODE_ENV === "production"))
    fail(422, "INSECURE_URL", `${field}는 HTTPS 주소만 허용됩니다.`);
  if (parsed.username || parsed.password) fail(422, "INVALID_URL", `${field}에 자격증명을 포함할 수 없습니다.`);
}
function assertProviderEndpoints(input: { issuer: string; authorizationUrl: string; tokenUrl?: string | null; jwksUrl?: string | null; protocol?: string }) {
  assertEndpoint(input.authorizationUrl, "인증 URL");
  if (input.protocol !== "saml") {
    assertEndpoint(input.tokenUrl ?? "", "토큰 URL"); assertEndpoint(input.jwksUrl ?? "", "JWKS URL");
    const issuer = new URL(input.issuer);
    if (issuer.protocol !== "https:" && !(issuer.protocol === "http:" && process.env.NODE_ENV !== "production"))
      fail(422, "INSECURE_URL", "issuer는 HTTPS 주소만 허용됩니다.");
  }
}

function dto(row: SsoProvider): SsoProviderRecord {
  return { id: row.id, name: row.name, protocol: row.protocol === "saml" ? "saml" : "oidc", issuer: row.issuer, clientId: row.clientId, authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl, jwksUrl: row.jwksUrl, scopes: row.scopes, enabled: row.enabled, hasSecret: row.clientSecretCipher !== null,
    hasCert: row.idpCert !== null,
    preflightOk: row.preflightOk, preflightDetail: row.preflightDetail, version: row.version, createdAt: row.createdAt.toISOString() };
}
async function lockSsoActor(tx: Transaction, ctx: Context, write = false) {
  // 구성원 회수·소유권 이전과 같은 순서로 잠가 현재 권한을 확인한다.
  if (write) await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', ctx.tenantId);
  const actor = await lockServiceActor(tx, ctx, write ? "security.write" : "security.read");
  if (actor.member.accessKind !== "direct" || (write && actor.member.role !== "owner"))
    fail(403, "FORBIDDEN", "회사에 직접 소속된 최상위 관리자만 SSO 설정을 변경할 수 있습니다.");
  return actor;
}
async function providerForUpdate(tx: Transaction, ctx: Pick<Context, "tenantId">, id: string) {
  await tx.$queryRawUnsafe('SELECT id FROM "SsoProvider" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE', id, ctx.tenantId);
  const row = await tx.ssoProvider.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "SSO 설정을 찾을 수 없습니다.");
  return row;
}
async function fetchJson(url: string, timeoutMs = 8000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}
async function preflight(input: { issuer: string; jwksUrl: string | null; protocol: string; idpCert: string | null }): Promise<{ ok: boolean; detail: string }> {
  if (input.protocol === "saml") {
    try {
      if (!input.idpCert) return { ok: false, detail: "IdP 서명 인증서가 없습니다." };
      const cert = new X509Certificate(input.idpCert);
      if (new Date(cert.validFrom) > new Date()) return { ok: false, detail: "인증서가 아직 유효하지 않습니다." };
      if (new Date(cert.validTo) <= new Date()) return { ok: false, detail: `인증서가 만료되었습니다 (${cert.validTo}).` };
      return { ok: true, detail: `서명 인증서 확인 — ${cert.subject.split("\n")[0]}, 만료 ${cert.validTo}` };
    } catch (error) { return { ok: false, detail: `인증서 해석 실패: ${error instanceof Error ? error.message : "오류"}` }; }
  }
  try {
    const jwks = await fetchJson(input.jwksUrl ?? "");
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    if (!keys.length) return { ok: false, detail: "JWKS에 서명 키가 없습니다." };
    return { ok: true, detail: `JWKS 키 ${keys.length}개 확인` };
  } catch (error) { return { ok: false, detail: `JWKS 조회 실패: ${error instanceof Error ? error.message : "오류"}` }; }
}

export async function listSsoProviders(ctx: Context) {
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx);
    const rows = await tx.ssoProvider.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const result = { items: rows.map(dto) };
    assertFileDeadlines(actor.deadlines);
    return result;
  });
}
export async function createSsoProvider(ctx: Context, input: z.infer<typeof ssoProviderCreate>, requestId: string) {
  assertProviderEndpoints(input);
  await db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    assertFileDeadlines(actor.deadlines);
  });
  const saml = input.protocol === "saml";
  // 외부 요청 중에는 DB 잠금을 유지하지 않고 결과 저장 직전에 권한을 다시 확인한다.
  const check = await preflight({ issuer: input.issuer, protocol: input.protocol,
    jwksUrl: saml ? null : input.jwksUrl, idpCert: saml ? input.idpCert : null });
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    const created = await tx.ssoProvider.create({ data: { tenantId: ctx.tenantId, name: input.name, issuer: input.issuer,
      protocol: input.protocol,
      clientId: input.clientId, clientSecretCipher: input.clientSecret ? encrypt(input.clientSecret) : null,
      authorizationUrl: input.authorizationUrl,
      tokenUrl: saml ? null : input.tokenUrl, jwksUrl: saml ? null : input.jwksUrl,
      idpCert: saml ? input.idpCert : null,
      scopes: saml ? "" : input.scopes,
      preflightOk: check.ok, preflightDetail: check.detail } });
    await audit(tx, ctx, requestId, "sso.provider_created", "ssoProvider", created.id, ["name", "issuer", "clientId", "protocol"]);
    assertFileDeadlines(actor.deadlines);
    return { ...dto(created), preflight: check };
  });
}
export async function updateSsoProvider(ctx: Context, id: string, input: z.infer<typeof ssoProviderPatch>, requestId: string) {
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const actor = await lockSsoActor(tx, ctx, true);
      const row = await providerForUpdate(tx, ctx, id);
      if (row.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
      const { clientSecret, idpCert } = input;
      if (idpCert && row.protocol !== "saml") fail(422, "NOT_SAML", "인증서 교체는 SAML 설정에만 적용됩니다.");
      if (input.enabled === true && row.protocol === "saml" && !idpCert && !row.idpCert)
        fail(422, "CERT_REQUIRED", "SAML 활성화에는 IdP 서명 인증서가 필요합니다.");
      const authenticationChanged = !!clientSecret || (!!idpCert && idpCert !== row.idpCert)
        || (input.scopes !== undefined && input.scopes !== row.scopes);
      if (input.enabled === true && (!row.preflightOk || authenticationChanged))
        fail(409, "PREFLIGHT_REQUIRED", "변경한 인증 설정의 사전검사를 먼저 통과해야 활성화할 수 있습니다.");
      if (row.enabled && (input.enabled === false || authenticationChanged)) await assertProviderCanStop(tx, ctx, id);
      const rest = { name: input.name, enabled: authenticationChanged ? false : input.enabled, scopes: input.scopes };
      const saved = await tx.ssoProvider.update({ where: { id }, data: { ...rest,
        ...(clientSecret ? { clientSecretCipher: encrypt(clientSecret) } : {}),
        ...(idpCert ? { idpCert } : {}),
        ...(authenticationChanged ? { preflightOk: false, preflightDetail: "인증 설정 변경 — 사전검사를 다시 실행해주세요." } : {}),
        version: { increment: 1 } } });
      await audit(tx, ctx, requestId, "sso.provider_updated", "ssoProvider", id,
        Object.entries(rest).filter(([, value]) => value !== undefined).map(([key]) => key)
          .concat(clientSecret ? ["clientSecret"] : []).concat(idpCert ? ["idpCert"] : [])
          .concat(authenticationChanged ? ["preflightOk"] : []));
      assertFileDeadlines(actor.deadlines);
      return dto(saved);
    }, { isolationLevel: "Serializable", timeout: 15000 });
  } catch (error) { rethrowSsoConcurrency(error); }
}
export async function removeSsoProvider(ctx: Context, id: string, version: number, requestId: string) {
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const actor = await lockSsoActor(tx, ctx, true);
      const session = await tx.session.findUniqueOrThrow({ where: { id: ctx.session.id } });
      assertFreshSsoSession(session);
      const row = await providerForUpdate(tx, ctx, id);
      if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
      const removed = await removeProviderAccounts(tx, ctx, id, requestId);
      await tx.ssoProvider.delete({ where: { id } });
      await audit(tx, ctx, requestId, "sso.provider_deleted", "ssoProvider", id, ["provider", "accounts", "sessions", "verification"]);
      assertFileDeadlines(actor.deadlines);
      assertFreshSsoSession(session);
      return { deleted: true, ...removed };
    }, { isolationLevel: "Serializable", timeout: 15000 });
  } catch (error) { rethrowSsoConcurrency(error); }
}
function rethrowSsoConcurrency(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const driver = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown; code?: unknown } } | undefined;
    const sqlState = String(error.meta?.code ?? driver?.cause?.originalCode ?? driver?.cause?.code ?? "");
    if (error.code === "P2034" || (error.code === "P2010" && ["40001", "40P01", "55P03"].includes(sqlState)))
      fail(409, "CONCURRENT_CHANGE", "연결 계정이나 설정이 동시에 변경되었습니다. 목록을 다시 불러온 뒤 시도해주세요.");
  }
  throw error;
}

export async function preflightSsoProvider(ctx: Context, id: string, requestId: string) {
  const snapshot = await db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    const row = await providerForUpdate(tx, ctx, id);
    assertFileDeadlines(actor.deadlines);
    return row;
  });
  const check = await preflight(snapshot);
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    const row = await providerForUpdate(tx, ctx, id);
    if (row.version !== snapshot.version)
      fail(409, "VERSION_CONFLICT", "검사 중 설정이 변경되었습니다. 최신 설정으로 사전검사를 다시 실행해주세요.");
    const saved = await tx.ssoProvider.update({ where: { id }, data: {
      preflightOk: check.ok, preflightDetail: check.detail, enabled: row.enabled && check.ok, version: { increment: 1 },
    } });
    await audit(tx, ctx, requestId, "sso.provider_preflight", "ssoProvider", id, ["preflightOk", "enabled"]);
    assertFileDeadlines(actor.deadlines);
    return { ...dto(saved), preflight: check };
  });
}

// ---- 로그인 플로우 ----

async function lockSsoCompany(tx: Transaction, tenantId: string, headers: Headers) {
  await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', tenantId);
  const company = await tx.company.findUnique({ where: { id: tenantId } });
  if (!company || company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
  await assertCompanyIp(tenantId, trustedClientIp(headers), tx);
}
function assertSsoState(provider: SsoProvider, state: SsoState) {
  if (state.expiresAt <= new Date()) fail(401, "STATE_INVALID", "로그인 요청이 만료되었습니다. 다시 시작해주세요.");
  if (state.tenantId !== provider.tenantId || !provider.enabled || !provider.preflightOk
    || state.providerVersion !== provider.version || state.providerVersion === 0)
    fail(409, "SSO_CONFIGURATION_CHANGED", "SSO 설정이 변경되었습니다. 로그인을 다시 시작해주세요.");
}
// A bearer invitation only reveals usable provider labels, never email, role or configuration.
async function checkedSsoInvitation(tx: Transaction, token: string | undefined, tenantId?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    fail(422, "INVITATION_REQUIRED", "받은 초대 링크에서 다시 시작해주세요.");
  const invitation = await tx.invitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { tenant: { select: { status: true } } } });
  if (!invitation || (tenantId && invitation.tenantId !== tenantId) || invitation.status !== "pending"
    || invitation.expiresAt <= new Date() || invitation.tenant.status !== "active")
    fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 사용할 수 없습니다. 새 초대를 요청해주세요.");
  return invitation;
}
export async function ssoInvitationOptions(token: string, headers: Headers) {
  await rateLimit("sso-invite-options:" + trustedClientIp(headers), 20);
  return db.$transaction(async tx => {
    const found = await checkedSsoInvitation(tx, token);
    await lockSsoCompany(tx, found.tenantId, headers);
    await checkedSsoInvitation(tx, token, found.tenantId);
    const providers = await tx.ssoProvider.findMany({ where: { tenantId: found.tenantId, enabled: true, preflightOk: true },
      select: { id: true, name: true, protocol: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    return { providers };
  });
}
export async function startSso(providerId: string, mode: string, headers: Headers, invitationToken?: string) {
  await rateLimit("sso-start:" + trustedClientIp(headers), 20);
  if (!["login", "link", "invite"].includes(mode)) fail(422, "INVALID_MODE", "지원하지 않는 SSO 모드입니다.");
  const initial = await db.ssoProvider.findUnique({ where: { id: providerId } });
  if (!initial) fail(404, "NOT_FOUND", "사용할 수 있는 SSO 설정이 없습니다.");
  const linkContext = mode === "link" ? await requireContext(headers) : null;
  return db.$transaction(async tx => {
    await lockSsoCompany(tx, initial.tenantId, headers);
    const provider = await providerForUpdate(tx, { tenantId: initial.tenantId }, providerId);
    if (!provider.enabled || !provider.preflightOk) fail(404, "NOT_FOUND", "사용할 수 있는 SSO 설정이 없습니다.");
    let linkActor: Awaited<ReturnType<typeof lockServiceActor>> | null = null;
    if (linkContext) {
      const currentSession = await tx.session.findUnique({ where: { id: linkContext.session.id } });
      if (!currentSession) fail(401, "SESSION_EXPIRED", "다시 로그인해주세요.");
      assertFreshSsoSession(currentSession);
      if (linkContext.tenantId !== provider.tenantId) fail(403, "COMPANY_CHANGED", "연결할 회사로 전환한 뒤 다시 시작해주세요.");
      linkActor = await lockServiceActor(tx, linkContext, "service.read");
      if (linkActor.member.accessKind !== "direct") fail(403, "FORBIDDEN", "직접 소속 구성원만 회사 계정을 연결할 수 있습니다.");
    }
    const invitation = mode === "invite" ? await checkedSsoInvitation(tx, invitationToken, provider.tenantId) : null;
    const state = randomBytes(24).toString("base64url"), nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const requestId = "_" + randomBytes(20).toString("hex");
    await tx.ssoState.create({ data: { tenantId: provider.tenantId, providerId, providerVersion: provider.version,
      stateHash: sha256(state), nonceHash: sha256(provider.protocol === "saml" ? requestId : nonce),
      verifierCipher: encrypt(verifier), mode, userId: linkContext?.user.id ?? null,
      sessionId: linkContext?.session.id ?? null, invitationId: invitation?.id ?? null,
      invitationVersion: invitation?.version ?? null, invitationTokenHash: invitation?.tokenHash ?? null,
      expiresAt: new Date(Date.now() + 10 * 60000) } });
    const params = new URLSearchParams({ response_type: "code", client_id: provider.clientId,
      redirect_uri: baseUrl() + "/api/v1/auth/sso/callback", scope: provider.scopes, state, nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    const redirect = provider.protocol === "saml"
      ? await samlFor(provider, requestId).getAuthorizeUrlAsync(state, undefined, {})
      : provider.authorizationUrl + (provider.authorizationUrl.includes("?") ? "&" : "?") + params;
    if (linkActor) { assertFileDeadlines(linkActor.deadlines); assertFreshSsoSession(linkContext!.session); }
    if (invitation && invitation.expiresAt <= new Date()) fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었습니다.");
    return { redirect };
  });
}

const idTokenHeader = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(200), typ: z.string().optional() }).loose();
const idTokenClaims = z.object({
  iss: z.string(), aud: z.union([z.string(), z.array(z.string())]), sub: z.string().min(1).max(300),
  exp: z.number(), iat: z.number().optional(), nonce: z.string().min(1).max(300),
  email: z.string().email().optional(), email_verified: z.boolean().optional(), name: z.string().max(200).optional(),
}).loose();

async function verifyIdToken(token: string, provider: SsoProvider, nonceHash: string) {
  const [head, payload, signature] = token.split(".");
  if (!head || !payload || !signature) fail(401, "INVALID_TOKEN", "id_token 형식이 올바르지 않습니다.");
  const header = idTokenHeader.parse(JSON.parse(Buffer.from(head, "base64url").toString()));
  const claims = idTokenClaims.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  if (claims.iss !== provider.issuer) fail(401, "ISSUER_MISMATCH", "토큰 발급자가 일치하지 않습니다.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(provider.clientId)) fail(401, "AUDIENCE_MISMATCH", "토큰 대상이 일치하지 않습니다.");
  if (claims.exp * 1000 <= Date.now() - 60000) fail(401, "TOKEN_EXPIRED", "토큰이 만료되었습니다.");
  if (claims.iat && claims.iat * 1000 > Date.now() + 60000) fail(401, "TOKEN_NOT_YET", "토큰 발급 시각이 미래입니다.");
  if (sha256(claims.nonce) !== nonceHash) fail(401, "NONCE_MISMATCH", "nonce가 일치하지 않습니다.");
  const jwks = await fetchJson(provider.jwksUrl ?? "").catch(() => fail(502, "JWKS_UNAVAILABLE", "IdP 키를 조회할 수 없습니다."));
  const keys = (jwks.keys ?? []) as { kid?: string; kty?: string; use?: string }[];
  const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk) fail(401, "UNKNOWN_KEY", "토큰 서명 키를 JWKS에서 찾을 수 없습니다.");
  const key = createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
  const ok = cryptoVerify("sha256", Buffer.from(`${head}.${payload}`), { key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signature, "base64url"));
  if (!ok) fail(401, "BAD_SIGNATURE", "토큰 서명이 올바르지 않습니다.");
  return claims;
}

function sessionCookie(token: string, signature: string) {
  const secure = env.BETTER_AUTH_URL.startsWith("https:");
  const name = (secure ? "__Secure-" : "") + "better-auth.session_token";
  return `${name}=${token}.${signature}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
async function mintSession(tx: Transaction, userId: string, tenantId: string, headers: Headers) {
  const token = randomBytes(32).toString("base64url");
  const session = await tx.session.create({ data: { token, userId, expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    ipAddress: trustedClientIp(headers), userAgent: headers.get("user-agent") ?? null, activeCompanyId: tenantId } });
  await audit(tx, { tenantId, user: { id: userId } }, "sso-callback", "session.created", "session", session.id);
  return sessionCookie(token, await makeSignature(token, env.BETTER_AUTH_SECRET));
}

export async function handleSsoCallback(query: URLSearchParams, headers: Headers) {
  const stateParam = query.get("state"), code = query.get("code"), error = query.get("error");
  if (!stateParam || (!code && !error)) fail(422, "INVALID_CALLBACK", "state와 code가 필요합니다.");
  await rateLimit("sso-callback:" + trustedClientIp(headers), 20);
  const stateHash = sha256(stateParam);
  const state = await db.ssoState.findUnique({ where: { stateHash } });
  if (!state || state.expiresAt <= new Date()) fail(401, "STATE_INVALID", "state가 만료되었거나 존재하지 않습니다.");
  // 소비 일회성: 행을 조건부 삭제해 같은 state의 동시·재전송 요청을 한 번만 통과시킨다.
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
  const provider = await db.ssoProvider.findUnique({ where: { id: state.providerId } });
  if (!provider || provider.protocol !== "oidc") fail(404, "NOT_FOUND", "SSO 설정이 해제되었습니다.");
  assertSsoState(provider, state);
  if (error) fail(401, "PROVIDER_DENIED", "IdP가 로그인을 취소하거나 거절했습니다.");
  const form = new URLSearchParams({ grant_type: "authorization_code", code: code!,
    redirect_uri: baseUrl() + "/api/v1/auth/sso/callback", client_id: provider.clientId,
    code_verifier: decrypt<string>(state.verifierCipher) });
  const tokenHeaders: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (provider.clientSecretCipher) {
    const secret = decrypt<string>(provider.clientSecretCipher);
    tokenHeaders.authorization = "Basic " + Buffer.from(`${provider.clientId}:${secret}`).toString("base64");
  }
  const tokenResponse = await fetch(provider.tokenUrl ?? "", { method: "POST", headers: tokenHeaders, body: form,
    signal: AbortSignal.timeout(10000), redirect: "error" }).catch(() => fail(502, "TOKEN_EXCHANGE_FAILED", "IdP 토큰 교환에 실패했습니다."));
  const tokenBody = await tokenResponse.json().catch(() => ({})) as { id_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.id_token)
    fail(401, "TOKEN_REJECTED", "IdP가 인증 코드를 거절했습니다. 로그인을 다시 시작해주세요.");
  const claims = await verifyIdToken(tokenBody.id_token, provider, state.nonceHash);
  return completeSso(provider, state,
    { sub: claims.sub, iss: claims.iss, email: claims.email, name: claims.name, emailVerified: claims.email_verified === true },
    headers);
}

type SsoSubject = { sub: string; iss: string; email?: string; name?: string; emailVerified: boolean };

async function linkActorForState(tx: Transaction, provider: SsoProvider, state: SsoState, headers: Headers) {
  if (!state.userId || !state.sessionId) fail(401, "LINK_SESSION_REQUIRED", "계정 연결을 다시 시작해주세요.");
  const session = await tx.session.findFirst({ where: { id: state.sessionId, userId: state.userId } });
  const user = await tx.user.findUnique({ where: { id: state.userId } });
  if (!session || !user) fail(401, "SESSION_EXPIRED", "계정 연결을 시작한 로그인이 종료되었습니다.");
  assertFreshSsoSession(session);
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(user.id, provider.tenantId), accessKind: "direct" },
    include: { tenant: { include: { policy: true } }, grants: true, expertAssignment: { include: { services: true } } } });
  if (!member) fail(403, "NOT_A_MEMBER", "이 회사의 구성원이 아닙니다.");
  const ctx: Context = { user, session, member, tenantId: provider.tenantId, clientIp: trustedClientIp(headers), capabilities: roleCapabilities(member.role) };
  const actor = await lockServiceActor(tx, ctx, "service.read");
  return { user, actor, session };
}
async function lockSsoInvitation(tx: Transaction, provider: SsoProvider, state: SsoState, subject: SsoSubject) {
  await tx.$queryRawUnsafe('SELECT id FROM "Invitation" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE', state.invitationId ?? "", provider.tenantId);
  const invitation = await tx.invitation.findUnique({ where: { id: state.invitationId ?? "" } });
  if (!invitation || !state.invitationTokenHash || !state.invitationVersion
    || invitation.tokenHash !== state.invitationTokenHash || invitation.version !== state.invitationVersion
    || invitation.tenantId !== provider.tenantId || invitation.status !== "pending"
    || invitation.expiresAt <= new Date() || !subject.emailVerified || !subject.email
    || invitation.email !== subject.email.toLowerCase())
    fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 이 계정의 초대가 아닙니다.");
  return invitation;
}
async function completeSso(initialProvider: SsoProvider, state: SsoState, subject: SsoSubject, headers: Headers) {
  const accountKey = subject.iss + "|" + subject.sub;
  return db.$transaction(async tx => {
    await lockSsoCompany(tx, initialProvider.tenantId, headers);
    const provider = await providerForUpdate(tx, { tenantId: initialProvider.tenantId }, initialProvider.id);
    assertSsoState(provider, state);
    const invitation = state.mode === "invite" ? await lockSsoInvitation(tx, provider, state, subject) : null;
    const linking = state.mode === "link" ? await linkActorForState(tx, provider, state, headers) : null;
    const account = await tx.account.findUnique({ where: { providerId_accountId: { providerId: "sso:" + provider.id, accountId: accountKey } } });
    if (linking && account && account.userId !== linking.user.id)
      fail(409, "SSO_ACCOUNT_ALREADY_LINKED", "이미 다른 사용자에게 연결된 외부 계정입니다.");
    let user = account ? await tx.user.findUniqueOrThrow({ where: { id: account.userId } }) : linking?.user ?? null;
    if (!user) {
      if (!subject.email || !subject.emailVerified)
        fail(403, "EMAIL_UNVERIFIED", "IdP에서 확인된 이메일이 없어 계정을 연결할 수 없습니다.");
      const existing = await tx.user.findUnique({ where: { email: subject.email.toLowerCase() } });
      if (existing)
        fail(409, "SSO_LINK_REQUIRED", "기존 계정으로 로그인한 뒤 외부 계정을 연결해주세요.");
      user = await tx.user.create({ data: { email: subject.email.toLowerCase(),
        name: subject.name ?? subject.email.split("@")[0], emailVerified: true } });
    }
    await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR SHARE', user.id);
    user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (user.status !== "active" || !user.emailVerified) fail(403, "ACCOUNT_DISABLED", "사용할 수 없는 계정입니다.");
    if (!account) {
      await tx.account.create({ data: { providerId: "sso:" + provider.id, accountId: accountKey, userId: user.id, scope: provider.scopes } });
      await audit(tx, { tenantId: provider.tenantId, user: { id: user.id } }, "sso-link", "sso.account_linked", "user", user.id, []);
    }
    let invitationDeadline: Date | null = null;
    if (invitation) {
      if (invitation.email !== user.email.toLowerCase())
        fail(410, "INVITATION_UNAVAILABLE", "초대가 이 계정의 초대가 아닙니다.");
      const inviter = await tx.membership.findFirst({ where: { id: invitation.invitedBy, tenantId: invitation.tenantId,
        status: "active", accessKind: "direct", user: { status: "active", emailVerified: true } } });
      if (!inviter || !roleCan(inviter.role, "member.manage"))
        fail(409, "INVITER_UNAVAILABLE", "초대한 담당자의 권한이 변경되었습니다. 다시 초대를 요청해주세요.");
      mayAssign(inviter.role, invitation.role);
      await validateServices(tx, invitation.tenantId, invitation.serviceIds);
      await assertQuota(tx, invitation.tenantId, "members", true, invitation.id);
      const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } } });
      if (existing && existing.status !== "revoked") fail(409, "MEMBER_EXISTS", "이미 회사에 소속된 계정입니다.");
      const member = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { role: invitation.role, status: "active",
          accessKind: "direct", expertAssignmentId: null, version: { increment: 1 } } })
        : await tx.membership.create({ data: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role } });
      await revokeInvitedExpert(tx, existing, "sso-invite");
      await replaceGrants(tx, invitation.tenantId, member.id, invitation.serviceIds, invitation.role);
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: "accepted", acceptedBy: user.id, version: { increment: 1 } } });
      invitationDeadline = invitation.expiresAt;
      await audit(tx, { tenantId: provider.tenantId, user: { id: user.id } }, "sso-invite", "invitation.accepted", "invitation", invitation.id, ["status", "membership"]);
    } else if (state.mode === "login") {
      const member = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: provider.tenantId, userId: user.id } } });
      if (!member) {
        if (account) fail(403, "SSO_MEMBERSHIP_REQUIRED", "회사 소속이 해제되었습니다. 새 초대를 요청해주세요.");
        await assertQuota(tx, provider.tenantId, "members", true);
        await tx.membership.create({ data: { tenantId: provider.tenantId, userId: user.id, role: "viewer" } });
      }
    }
    const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(user.id, provider.tenantId), accessKind: "direct" } });
    if (!member) fail(403, "NOT_A_MEMBER", "이 회사의 구성원이 아닙니다.");
    const linkedAccount = await tx.account.findUniqueOrThrow({ where: { providerId_accountId: { providerId: "sso:" + provider.id, accountId: accountKey } } });
    const result = user.twoFactorEnabled
      ? await issueSsoMfa(tx, { userId: user.id, tenantId: provider.tenantId, providerId: provider.id,
        providerVersion: provider.version, accountId: linkedAccount.id, memberId: member.id, memberVersion: member.version,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null, originalSessionId: state.mode === "link" ? state.sessionId : null })
      : { redirect: state.mode === "link" ? "/link/oauth2/verified" : "/dashboard", cookie: await mintSession(tx, user.id, provider.tenantId, headers), clearSessionCookie: undefined };
    if (!user.twoFactorEnabled)
      await audit(tx, { tenantId: provider.tenantId, user: { id: user.id } }, "sso-callback", "sso.login", "user", user.id, []);
    assertSsoState(provider, state);
    if (linking) { assertFileDeadlines(linking.actor.deadlines); assertFreshSsoSession(linking.session); }
    if (invitationDeadline && invitationDeadline <= new Date()) fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었습니다.");
    return result;
  }, { timeout: 15000 });
}

// ---- SAML 2.0 (HTTP-POST 바인딩) ----

const samlCache = (stateNonceHash: string): CacheProvider => ({
  // AuthnRequest ID 저장은 ssoState.nonceHash가 담당한다. 검증 시 해시 일치 여부만 확인한다.
  saveAsync: async () => null,
  getAsync: async key => (sha256(key) === stateNonceHash ? new Date().toISOString() : null),
  removeAsync: async () => null,
});

function samlFor(provider: SsoProvider, requestId?: string) {
  return new SAML({
    issuer: provider.clientId,
    callbackUrl: baseUrl() + "/api/v1/auth/sso/saml",
    entryPoint: provider.authorizationUrl,
    idpCert: provider.idpCert ?? "",
    idpIssuer: provider.issuer,
    audience: provider.clientId,
    // 응답 또는 어서션 중 하나는 반드시 서명돼야 한다(둘 다 없으면 거부).
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    acceptedClockSkewMs: 60000,
    cacheProvider: samlCache(requestId ? sha256(requestId) : "-"),
    generateUniqueId: () => requestId ?? "_" + randomBytes(20).toString("hex"),
  });
}

const samlEmail = (profile: Profile) => {
  const candidates = [profile.email, profile.mail, profile["urn:oid:0.9.2342.19200300.100.1.3"],
    profile.emailAddress, profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
    profile["http://schemas.xmlsoap.org/claims/EmailAddress"]];
  return candidates.find(v => typeof v === "string" && v.includes("@")) as string | undefined;
};

export async function handleSamlCallback(body: { SAMLResponse?: string; RelayState?: string }, headers: Headers) {
  const relay = body.RelayState ?? "", responseB64 = body.SAMLResponse ?? "";
  if (!relay || !responseB64) fail(422, "INVALID_CALLBACK", "SAMLResponse와 RelayState가 필요합니다.");
  await rateLimit("sso-callback:" + trustedClientIp(headers), 20);
  const state = await db.ssoState.findUnique({ where: { stateHash: sha256(relay) } });
  if (!state || state.expiresAt <= new Date()) fail(401, "STATE_INVALID", "RelayState가 만료되었거나 존재하지 않습니다.");
  const provider = await db.ssoProvider.findUnique({ where: { id: state.providerId } });
  if (!provider || provider.protocol !== "saml" || !provider.idpCert)
    fail(404, "NOT_FOUND", "SAML 설정이 해제되었습니다.");
  assertSsoState(provider, state);
  const acsUrl = baseUrl() + "/api/v1/auth/sso/saml";
  validateSamlEnvelope(responseB64, acsUrl, state.nonceHash);
  let profile: Profile | null;
  try {
    ({ profile } = await new SAML({
      issuer: provider.clientId, callbackUrl: acsUrl, entryPoint: provider.authorizationUrl,
      idpCert: provider.idpCert, idpIssuer: provider.issuer, audience: provider.clientId,
      wantAssertionsSigned: false, wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always, acceptedClockSkewMs: 60000,
      cacheProvider: samlCache(state.nonceHash),
      generateUniqueId: () => "_" + randomBytes(20).toString("hex"),
    }).validatePostResponseAsync({ SAMLResponse: responseB64 }));
  } catch {
    fail(401, "SAML_INVALID", "SAML 응답의 서명 또는 인증 정보를 확인할 수 없습니다.");
  }
  if (!profile) fail(401, "SAML_INVALID", "SAML 응답에 프로필이 없습니다.");
  const subject = validatedSamlSubject(profile, provider.issuer, acsUrl, state.nonceHash);
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "RelayState가 이미 사용되었습니다.");
  return completeSso(provider, state,
    { sub: subject, iss: provider.issuer, email: samlEmail(profile),
      name: typeof profile.name === "string" ? profile.name : undefined, emailVerified: true }, headers);
}
