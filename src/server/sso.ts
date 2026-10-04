import { constants, createHash, createPublicKey, randomBytes, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import type { SsoProvider } from "@/generated/prisma/client";
import type { SsoProviderRecord, ssoProviderCreate, ssoProviderPatch } from "@/contracts/sso";
import { z } from "zod";
import { auth } from "./auth";
import { audit } from "./audit";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";
import { fail, rateLimit } from "./http";
import { trustedClientIp } from "./client-ip";
import { assertQuota } from "./entitlements";
import { replaceGrants, validateServices } from "./members";
import { roleCan } from "./permissions";

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
function mustManage(ctx: Context) {
  if (ctx.member.role !== "owner") fail(403, "FORBIDDEN", "최상위 관리자만 SSO 설정을 변경할 수 있습니다.");
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
  const rows = await db.ssoProvider.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
  return { items: rows.map(dto) };
}
export async function createSsoProvider(ctx: Context, input: z.infer<typeof ssoProviderCreate>, requestId: string) {
  mustManage(ctx);
  assertProviderEndpoints(input);
  const saml = input.protocol === "saml";
  const check = await preflight({ issuer: input.issuer, protocol: input.protocol,
    jwksUrl: saml ? null : input.jwksUrl, idpCert: saml ? input.idpCert : null });
  const row = await db.$transaction(async tx => {
    const created = await tx.ssoProvider.create({ data: { tenantId: ctx.tenantId, name: input.name, issuer: input.issuer,
      protocol: input.protocol,
      clientId: input.clientId, clientSecretCipher: input.clientSecret ? encrypt(input.clientSecret) : null,
      authorizationUrl: input.authorizationUrl,
      tokenUrl: saml ? null : input.tokenUrl, jwksUrl: saml ? null : input.jwksUrl,
      idpCert: saml ? input.idpCert : null,
      scopes: saml ? "" : input.scopes,
      preflightOk: check.ok, preflightDetail: check.detail } });
    await audit(tx, ctx, requestId, "sso.provider_created", "ssoProvider", created.id, ["name", "issuer", "clientId", "protocol"]);
    return created;
  });
  return { ...dto(row), preflight: check };
}
export async function updateSsoProvider(ctx: Context, id: string, input: z.infer<typeof ssoProviderPatch>, requestId: string) {
  mustManage(ctx);
  return db.$transaction(async tx => {
    const row = await tx.ssoProvider.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "SSO 설정을 찾을 수 없습니다.");
    if (row.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
    if (input.enabled === true && !row.preflightOk && input.scopes === undefined && input.clientSecret === undefined && input.name === undefined)
      fail(409, "PREFLIGHT_REQUIRED", "사전검사를 먼저 통과해야 활성화할 수 있습니다.");
    const rest = { name: input.name, enabled: input.enabled, scopes: input.scopes };
    const { clientSecret, idpCert } = input;
    if (idpCert && row.protocol !== "saml") fail(422, "NOT_SAML", "인증서 교체는 SAML 설정에만 적용됩니다.");
    if (input.enabled === true && row.protocol === "saml" && !idpCert && !row.idpCert)
      fail(422, "CERT_REQUIRED", "SAML 활성화에는 IdP 서명 인증서가 필요합니다.");
    const saved = await tx.ssoProvider.update({ where: { id }, data: { ...rest,
      ...(clientSecret ? { clientSecretCipher: encrypt(clientSecret) } : {}),
      ...(idpCert ? { idpCert, preflightOk: false, preflightDetail: "인증서 교체 — 사전검사를 다시 실행하세요." } : {}),
      version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "sso.provider_updated", "ssoProvider", id,
      Object.entries(rest).filter(([, value]) => value !== undefined).map(([key]) => key)
        .concat(clientSecret ? ["clientSecret"] : []).concat(idpCert ? ["idpCert"] : []));
    return dto(saved);
  });
}
export async function removeSsoProvider(ctx: Context, id: string, version: number, requestId: string) {
  mustManage(ctx);
  await db.$transaction(async tx => {
    const row = await tx.ssoProvider.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "SSO 설정을 찾을 수 없습니다.");
    if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
    await tx.ssoProvider.delete({ where: { id } });
    await audit(tx, ctx, requestId, "sso.provider_deleted", "ssoProvider", id, []);
  });
  return { deleted: true };
}
export async function preflightSsoProvider(ctx: Context, id: string, requestId: string) {
  mustManage(ctx);
  return db.$transaction(async tx => {
    const row = await tx.ssoProvider.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "SSO 설정을 찾을 수 없습니다.");
    const check = await preflight(row);
    const saved = await tx.ssoProvider.update({ where: { id }, data: { preflightOk: check.ok, preflightDetail: check.detail, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "sso.provider_preflight", "ssoProvider", id, ["preflightOk"]);
    return { ...dto(saved), preflight: check };
  });
}

// ---- 로그인 플로우 ----

export async function startSso(providerId: string, mode: string, headers: Headers, invitationId?: string) {
  await rateLimit("sso-start:" + trustedClientIp(headers), 20);
  const provider = await db.ssoProvider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled || !provider.preflightOk) fail(404, "NOT_FOUND", "사용할 수 있는 SSO 설정이 없습니다.");
  if (!["login", "link", "invite"].includes(mode)) fail(422, "INVALID_MODE", "지원하지 않는 SSO 모드입니다.");
  let userId: string | null = null;
  if (mode === "link") {
    const session = await auth.api.getSession({ headers }).catch(() => null);
    if (!session) fail(401, "LOGIN_REQUIRED", "계정 연결은 로그인 상태에서만 가능합니다.");
    const member = await db.membership.findFirst({ where: { tenantId: provider.tenantId, userId: session.user.id, status: "active" } });
    if (!member) fail(403, "FORBIDDEN", "이 회사의 구성원만 계정을 연결할 수 있습니다.");
    userId = session.user.id;
  }
  if (mode === "invite") {
    if (!invitationId) fail(422, "INVITATION_REQUIRED", "초대가입에는 초대 ID가 필요합니다.");
    const invitation = await db.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.tenantId !== provider.tenantId || invitation.status !== "pending" || invitation.expiresAt <= new Date())
      fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 취소되었습니다.");
  }
  const state = randomBytes(24).toString("base64url"), nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60000);
  if (provider.protocol === "saml") {
    // SAML: nonceHash 자리에 AuthnRequest ID 해시를, stateHash 자리에 RelayState 해시를 저장한다.
    const requestId = "_" + randomBytes(20).toString("hex");
    const saml = samlFor(provider, requestId);
    await db.ssoState.create({ data: { tenantId: provider.tenantId, providerId, stateHash: sha256(state),
      nonceHash: sha256(requestId), verifierCipher: encrypt(verifier), mode, userId,
      invitationId: invitationId ?? null, expiresAt } });
    const redirect = await saml.getAuthorizeUrlAsync(state, undefined, {});
    return { redirect };
  }
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await db.ssoState.create({ data: { tenantId: provider.tenantId, providerId, stateHash: sha256(state), nonceHash: sha256(nonce),
    verifierCipher: encrypt(verifier), mode, userId, invitationId: invitationId ?? null, expiresAt } });
  const params = new URLSearchParams({ response_type: "code", client_id: provider.clientId,
    redirect_uri: baseUrl() + "/api/v1/auth/sso/callback", scope: provider.scopes, state, nonce,
    code_challenge: challenge, code_challenge_method: "S256" });
  return { redirect: provider.authorizationUrl + (provider.authorizationUrl.includes("?") ? "&" : "?") + params };
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
  await tx.session.create({ data: { token, userId, expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    ipAddress: trustedClientIp(headers), userAgent: headers.get("user-agent") ?? null, activeCompanyId: tenantId } });
  return sessionCookie(token, await makeSignature(token, env.BETTER_AUTH_SECRET));
}

export async function handleSsoCallback(query: URLSearchParams, headers: Headers) {
  const stateParam = query.get("state"), code = query.get("code"), error = query.get("error");
  if (error) fail(401, "PROVIDER_DENIED", `IdP가 로그인을 거절했습니다: ${query.get("error_description") ?? error}`);
  if (!stateParam || !code) fail(422, "INVALID_CALLBACK", "state와 code가 필요합니다.");
  await rateLimit("sso-callback:" + trustedClientIp(headers), 20);
  const stateHash = sha256(stateParam);
  const state = await db.ssoState.findUnique({ where: { stateHash } });
  if (!state || state.expiresAt <= new Date()) fail(401, "STATE_INVALID", "state가 만료되었거나 존재하지 않습니다.");
  // 소비 일회성: 행을 조건부 삭제해 같은 state의 동시·재전송 요청을 한 번만 통과시킨다.
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
  const provider = await db.ssoProvider.findUnique({ where: { id: state.providerId } });
  if (!provider || !provider.enabled) fail(404, "NOT_FOUND", "SSO 설정이 해제되었습니다.");
  const form = new URLSearchParams({ grant_type: "authorization_code", code,
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
    fail(401, "TOKEN_REJECTED", `IdP가 코드를 거절했습니다: ${tokenBody.error ?? tokenResponse.status}`);
  const claims = await verifyIdToken(tokenBody.id_token, provider, state.nonceHash);
  return completeSso(provider, state,
    { sub: claims.sub, iss: claims.iss, email: claims.email, name: claims.name, emailVerified: claims.email_verified === true },
    headers);
}

type SsoSubject = { sub: string; iss: string; email?: string; name?: string; emailVerified: boolean };

async function completeSso(provider: SsoProvider, state: { mode: string; userId: string | null; invitationId: string | null }, subject: SsoSubject, headers: Headers) {
  const accountKey = `${subject.iss}|${subject.sub}`;
  return db.$transaction(async tx => {
    let user = await tx.account.findUnique({ where: { providerId_accountId: { providerId: "sso:" + provider.id, accountId: accountKey } } })
      .then(account => account ? tx.user.findUniqueOrThrow({ where: { id: account.userId } }) : null);
    if (!user) {
      if (state.mode === "link") {
        const linked = await tx.user.findUniqueOrThrow({ where: { id: state.userId! } });
        await tx.account.create({ data: { providerId: "sso:" + provider.id, accountId: accountKey, userId: linked.id,
          scope: provider.scopes } });
        await audit(tx, { tenantId: provider.tenantId, user: { id: linked.id } }, "sso-link", "sso.account_linked", "user", linked.id, []);
        user = linked;
      } else {
        if (!subject.email || !subject.emailVerified)
          fail(403, "EMAIL_UNVERIFIED", "IdP에서 확인된 이메일이 없어 계정을 연결할 수 없습니다. 회사 관리자에게 문의하세요.");
        user = await tx.user.findUnique({ where: { email: subject.email.toLowerCase() } });
        if (user && !user.emailVerified)
          fail(403, "LINK_FORBIDDEN", "이메일 미인증 계정에는 SSO를 연결할 수 없습니다. 먼저 이메일을 인증하세요.");
        if (!user) {
          user = await tx.user.create({ data: { email: subject.email.toLowerCase(), name: subject.name ?? subject.email.split("@")[0],
            emailVerified: true } });
        }
        await tx.account.create({ data: { providerId: "sso:" + provider.id, accountId: accountKey, userId: user.id, scope: provider.scopes } });
        if (state.mode === "invite") {
          // 초대가입: 초대를 조건부 수락하고 초대된 역할·서비스로 멤버십을 만든다.
          const invitation = await tx.invitation.findUnique({ where: { id: state.invitationId ?? "" } });
          if (!invitation || invitation.tenantId !== provider.tenantId || invitation.status !== "pending"
            || invitation.expiresAt <= new Date() || invitation.email !== subject.email.toLowerCase())
            fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 이 계정의 초대가 아닙니다.");
          const inviter = await tx.membership.findFirst({ where: { id: invitation.invitedBy, tenantId: invitation.tenantId, status: "active" } });
          if (!inviter || !roleCan(inviter.role, "member.manage"))
            fail(409, "INVITER_UNAVAILABLE", "초대한 담당자의 권한이 변경되었습니다. 다시 초대를 요청해주세요.");
          await validateServices(tx, invitation.tenantId, invitation.serviceIds);
          const accepted = await tx.invitation.updateMany({ where: { id: invitation.id, status: "pending", expiresAt: { gt: new Date() } },
            data: { status: "accepted", acceptedBy: user.id, version: { increment: 1 } } });
          if (!accepted.count) fail(410, "INVITATION_UNAVAILABLE", "초대가 이미 사용되었거나 취소되었습니다.");
          await assertQuota(tx, invitation.tenantId, "members", true, invitation.id);
          const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } } });
          if (existing && existing.status !== "revoked") fail(409, "MEMBER_EXISTS", "이미 회사에 소속된 계정입니다.");
          const member = existing
            ? await tx.membership.update({ where: { id: existing.id }, data: { role: invitation.role, status: "active",
              accessKind: "direct", expertAssignmentId: null, version: { increment: 1 } } })
            : await tx.membership.create({ data: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role } });
          await replaceGrants(tx, invitation.tenantId, member.id, invitation.serviceIds, invitation.role);
          await audit(tx, { tenantId: provider.tenantId, user: { id: user.id } }, "sso-invite", "invitation.accepted", "invitation", invitation.id, ["status", "membership"]);
        } else {
          const member = await tx.membership.findFirst({ where: { tenantId: provider.tenantId, userId: user.id } });
          if (!member) await tx.membership.create({ data: { tenantId: provider.tenantId, userId: user.id, role: "viewer" } });
        }
      }
    }
    const member = await tx.membership.findFirst({ where: { tenantId: provider.tenantId, userId: user.id, status: "active" } });
    if (!member) fail(403, "NOT_A_MEMBER", "이 회사의 구성원이 아닙니다.");
    if (user.status !== "active") fail(403, "ACCOUNT_DISABLED", "비활성화된 계정입니다.");
    const cookie = await mintSession(tx, user.id, provider.tenantId, headers);
    await audit(tx, { tenantId: provider.tenantId, user: { id: user.id } }, "sso-callback", "sso.login", "user", user.id, []);
    return { redirect: "/dashboard", cookie };
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
  if (!provider || !provider.enabled || provider.protocol !== "saml" || !provider.idpCert)
    fail(404, "NOT_FOUND", "SAML 설정이 해제되었습니다.");
  const acsUrl = baseUrl() + "/api/v1/auth/sso/saml";
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
  } catch (error) {
    fail(401, "SAML_INVALID", `SAML 응답 검증 실패: ${error instanceof Error ? error.message : "오류"}`);
  }
  if (!profile) fail(401, "SAML_INVALID", "SAML 응답에 프로필이 없습니다.");
  // node-saml은 로그인 응답의 issuer를 idpIssuer와 대조하지 않으므로 직접 강제한다.
  if (profile.issuer !== provider.issuer) fail(401, "ISSUER_MISMATCH", "SAML 발급자가 설정된 IdP와 일치하지 않습니다.");
  // node-saml이 어서션 존재 시 검증하지 않는 항목을 직접 확인한다: Status=Success, Recipient=ACS.
  const xml = Buffer.from(responseB64, "base64").toString("utf8");
  const status = /StatusCode Value="([^"]+)"/.exec(xml)?.[1];
  if (status && status !== "urn:oasis:names:tc:SAML:2.0:status:Success")
    fail(401, "SAML_DENIED", `IdP가 로그인을 거절했습니다: ${status.split(":").pop()}`);
  const recipient = /Recipient="([^"]+)"/.exec(xml)?.[1];
  if (recipient && recipient !== acsUrl) fail(401, "RECIPIENT_MISMATCH", "SAML 응답 수신자가 일치하지 않습니다.");
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "RelayState가 이미 사용되었습니다.");
  return completeSso(provider, state,
    { sub: profile.nameID, iss: provider.issuer, email: samlEmail(profile),
      name: typeof profile.name === "string" ? profile.name : undefined, emailVerified: true }, headers);
}
