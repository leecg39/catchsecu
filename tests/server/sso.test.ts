import { SsoTestBrowser } from "../helpers/sso-browser";
import { ssoProviderCheckedRecord } from "@/contracts/sso";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { createHash, generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { opaqueToken, tokenHash } from "@/server/crypto";

const ssoFault = vi.hoisted(() => ({ audit: false, unlinkAudit: false, unlinkAuditSeen: false, providerAudit: false, providerAuditSeen: false, providerUpdateAudit: false }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    if (ssoFault.providerUpdateAudit && args[3] === "sso.provider_updated") throw new Error("provider update audit fixture failure");
    if (ssoFault.providerAudit && args[3] === "sso.provider_deleted") { ssoFault.providerAuditSeen = true; throw new Error("provider audit fixture failure"); }
    if (ssoFault.unlinkAudit && args[3] === "sso.account_unlinked") { ssoFault.unlinkAuditSeen = true; throw new Error("unlink audit fixture failure"); }
    if (ssoFault.audit && args[3] === "sso.login") throw new Error("SSO audit fixture failure");
    return actual.audit(...args);
  } };
});

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const browser = new SsoTestBrowser();
const password = "Sso-owner!12345";

// 실제 RSA 키와 HTTP 서버를 사용하는 로컬 OIDC IdP. 서명·JWKS·PKCE·claim을 모두 실제로 검증한다.
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "idp-key-1";
const jwk = { ...(pair.publicKey.export({ format: "jwk" }) as Record<string, string>), kid, use: "sig", alg: "RS256" };
type Claims = Record<string, string | number | boolean>;
interface AuthRequest { state: string; nonce: string; challenge: string; clientId: string; redirectUri: string }
const idp = { issuer: "", codes: new Map<string, { challenge: string; request: AuthRequest; claims: Claims }>(), lastAuth: null as AuthRequest | null,
  failToken: null as null | "http500" | "no_id_token", wrongKey: false };
const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64url");
function idToken(claims: Claims, key = pair.privateKey) {
  const head = b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), payload = b64(JSON.stringify(claims));
  return `${head}.${payload}.${cryptoSign("sha256", Buffer.from(`${head}.${payload}`), key).toString("base64url")}`;
}
let jwksGate: { entered: () => void; release: Promise<void> } | undefined;
const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/jwks.json") {
    const reply = () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); };
    if (jwksGate) { jwksGate.entered(); void jwksGate.release.then(reply); } else reply();
    return;
  }
  if (url.pathname === "/authorize") {
    const request: AuthRequest = { state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")!,
      challenge: url.searchParams.get("code_challenge")!, clientId: url.searchParams.get("client_id")!, redirectUri: url.searchParams.get("redirect_uri")! };
    idp.lastAuth = request;
    const code = "code-" + randomUUID();
    idp.codes.set(code, { challenge: request.challenge, request, claims: { sub: "idp-sub-1", email: "sso-user@catchsecu.test", email_verified: true, name: "SSO 사용자" } });
    res.writeHead(302, { location: `${request.redirectUri}?code=${code}&state=${request.state}` }); res.end(); return;
  }
  if (url.pathname === "/token" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      if (idp.failToken === "http500") { res.writeHead(500); res.end("{}"); return; }
      const form = new URLSearchParams(chunks.concat().toString());
      const entry = idp.codes.get(form.get("code") ?? "");
      if (!entry) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_grant" })); return; }
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== entry.challenge) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE" })); return; }
      if (form.get("client_id") !== entry.request.clientId) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_client" })); return; }
      idp.codes.delete(form.get("code")!);
      const claims: Claims = { iss: idp.issuer, aud: entry.request.clientId, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
        nonce: entry.request.nonce, ...entry.claims };
      const body = idp.failToken === "no_id_token" ? { access_token: "x" } : { id_token: idToken(claims, idp.wrongKey ? other.privateKey : pair.privateKey) };
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body));
    });
    return;
  }
  res.writeHead(404); res.end();
});
// Capture the company selected by each fixture; never infer it from a later shared-session change.
const fixtureCompanies = new Map<string, string>();
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  if (path === "/security/sso" && method === "POST" && input && typeof input === "object") input = { tenantId: fixtureCompanies.get(cookie), ...input };
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: browser.cookie(cookie),
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ownerCookie() {
  const email = "sso-" + randomUUID() + "@catchsecu.test";
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "소유자", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "SSO 회사", publicName: "SSO", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } } } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  fixtureCompanies.set(cookie, company.id);
  return { cookie, company, user, email };
}
beforeEach(async () => {
  browser.reset(); fixtureCompanies.clear();
  ssoFault.providerUpdateAudit = false; ssoFault.providerAudit = false; ssoFault.providerAuditSeen = false; ssoFault.unlinkAuditSeen = false; ssoFault.unlinkAudit = false; ssoFault.audit = false; jwksGate = undefined; idp.codes.clear(); idp.lastAuth = null; idp.failToken = null; idp.wrongKey = false;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE');
});
afterAll(async () => { server.close(); await db.$disconnect(); });
server.listen(0, "127.0.0.1");

async function ssoFlow() {
  const { GET: startRoute } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  const { GET: callbackRoute } = await import("@/app/api/v1/auth/sso/callback/route");
  const { POST: createProvider, GET: listProviders } = await import("@/app/api/v1/security/sso/route");
  const { PATCH: patchProvider } = await import("@/app/api/v1/security/sso/[id]/route");
  return { startRoute: browser.wrap(startRoute), callbackRoute: browser.wrap(callbackRoute), createProvider, listProviders, patchProvider };
}

test("E2 사설 HTTPS JWKS는 네트워크에 전달하기 전에 사전검사에서 거절한다", async () => {
  const { cookie } = await ownerCookie(), { createProvider } = await ssoFlow();
  const outbound = vi.fn(async () => Response.json({ keys: [jwk] }));
  vi.stubGlobal("fetch", outbound);
  try {
    const response = await createProvider(req("/security/sso", cookie, "POST", { name: "사설망 거절", protocol: "oidc",
      issuer: "https://idp.example.test", clientId: "test", authorizationUrl: "https://idp.example.test/authorize",
      tokenUrl: "https://idp.example.test/token", jwksUrl: "https://169.254.169.254/jwks", scopes: "openid email" }, randomUUID()));
    expect(response.status).toBe(201);
    expect((await response.json()).preflightOk).toBe(false);
    expect(outbound).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

test("SSO 제공자 CRUD·사전검사·활성화 게이트", async () => {
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  idp.issuer = `http://127.0.0.1:${port}`;
  const { cookie } = await ownerCookie();
  const { createProvider, listProviders, patchProvider } = await ssoFlow();
  const input = { name: "테스트 IdP", issuer: idp.issuer, clientId: "catchsecu", clientSecret: "shh",
    authorizationUrl: `${idp.issuer}/authorize`, tokenUrl: `${idp.issuer}/token`, jwksUrl: `${idp.issuer}/jwks.json`,
    scopes: "openid profile email" };
  const created = await createProvider(req("/security/sso", cookie, "POST", input, randomUUID()));
  expect(created.status).toBe(201);
  const provider = ssoProviderCheckedRecord.parse(await created.json());
  expect(provider.preflightOk).toBe(true);
  expect(provider.hasSecret).toBe(true);
  expect(provider.enabled).toBe(false);
  const enabled = await patchProvider(req(`/security/sso/${provider.id}`, cookie, "PATCH", { version: provider.version, enabled: true }));
  expect(enabled.status).toBe(200);
  expect((await enabled.json()).enabled).toBe(true);
  const list = await (await listProviders(req("/security/sso", cookie))).json();
  expect(list.items).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain("shh");
  // 사전검사 실패한 제공자는 활성화 불가
  const dead = await createProvider(req("/security/sso", cookie, "POST", { ...input, name: "죽은 IdP",
    jwksUrl: `${idp.issuer}/dead-jwks` }, randomUUID()));
  const deadProvider = await dead.json();
  expect(deadProvider.preflightOk).toBe(false);
  expect((await patchProvider(req(`/security/sso/${deadProvider.id}`, cookie, "PATCH", { version: deadProvider.version, enabled: true }))).status).toBe(409);
  // http 비루프백 URL 거부
  const insecure = await createProvider(req("/security/sso", cookie, "POST", { ...input, name: "약한 IdP",
    authorizationUrl: "http://idp.example.com/authorize" }, randomUUID()));
  expect(insecure.status).toBe(422);
});

test("실제 OIDC 로그인: state→PKCE→서명검증→세션발급→재전송 차단", async () => {
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  idp.issuer = `http://127.0.0.1:${port}`;
  const { cookie, company } = await ownerCookie();
  const { createProvider, startRoute, callbackRoute } = await ssoFlow();
  const provider = await (await createProvider(req("/security/sso", cookie, "POST", { name: "IdP", issuer: idp.issuer,
    clientId: "catchsecu", clientSecret: "shh", authorizationUrl: `${idp.issuer}/authorize`, tokenUrl: `${idp.issuer}/token`,
    jwksUrl: `${idp.issuer}/jwks.json`, scopes: "openid profile email" }, randomUUID()))).json();
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true, preflightOk: true } });
  // 시작 → IdP authorize로 302
  const started = await startRoute(req(`/auth/sso/${provider.id}?mode=login`));
  expect(started.status).toBe(302);
  const authorizeUrl = new URL(started.headers.get("location")!);
  expect(authorizeUrl.origin).toBe(idp.issuer);
  expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
  const state = authorizeUrl.searchParams.get("state")!;
  // IdP에 직접 요청해 실제 리다이렉트(code+state) 획득
  const authResp = await fetch(authorizeUrl, { redirect: "manual" });
  const callback = new URL(authResp.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code")!;
  const first = await callbackRoute(req(`/auth/sso/callback?${callback.searchParams}`));
  if (first.status !== 302) console.log("CALLBACK BODY:", await first.clone().text());
  expect(first.status).toBe(302);
  expect(first.headers.get("location")).toBe("/dashboard");
  const sessionCookie = first.headers.get("set-cookie")!;
  expect(sessionCookie).toContain("better-auth.session_token=");
  // 발급된 세션으로 실제 인증 확인
  const { GET: meRoute } = await import("@/app/api/v1/me/route");
  const me = await meRoute(req("/me", sessionCookie.split(";")[0]));
  expect(me.status).toBe(200);
  const meBody = await me.json();
  expect(meBody.email ?? meBody.user?.email).toBe("sso-user@catchsecu.test");
  // JIT 프로비저닝: viewer 멤버십 + 연결된 계정
  const user = await db.user.findUniqueOrThrow({ where: { email: "sso-user@catchsecu.test" } });
  const member = await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: user.id } });
  expect(member.role).toBe("viewer");
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + provider.id } });
  expect(account.accountId).toBe(`${idp.issuer}|idp-sub-1`);
  expect(await db.ssoSessionProof.findFirst({ where: { userId: user.id } })).toMatchObject({ tenantId: company.id, providerId: provider.id, accountId: account.id, identityProvider: "OTHER" });
  // state 재전송 → 일회성 소비로 차단
  const replay = await callbackRoute(req(`/auth/sso/callback?${callback.searchParams}`));
  expect(replay.status).toBe(401);
  // code 재사용도 IdP가 거절(코드 소비)
  const again = await callbackRoute(req(`/auth/sso/callback?state=${randomUUID()}&code=${code}`));
  expect(again.status).toBe(401);
});

test("서명·issuer·audience·nonce·만료 위조는 모두 거부된다", async () => {
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  idp.issuer = `http://127.0.0.1:${port}`;
  const { cookie } = await ownerCookie();
  const { createProvider, startRoute, callbackRoute } = await ssoFlow();
  const provider = await (await createProvider(req("/security/sso", cookie, "POST", { name: "IdP2", issuer: idp.issuer,
    clientId: "catchsecu", clientSecret: "shh", authorizationUrl: `${idp.issuer}/authorize`, tokenUrl: `${idp.issuer}/token`,
    jwksUrl: `${idp.issuer}/jwks.json`, scopes: "openid profile email" }, randomUUID()))).json();
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true, preflightOk: true } });
  const run = async () => {
    const started = await startRoute(req(`/auth/sso/${provider.id}?mode=login`));
    const authResp = await fetch(started.headers.get("location")!, { redirect: "manual" });
    const callback = new URL(authResp.headers.get("location")!);
    return callbackRoute(req(`/auth/sso/callback?${callback.searchParams}`));
  };
  // 잘못된 서명 키
  idp.wrongKey = true;
  expect((await run()).status).toBe(401);
  idp.wrongKey = false;
  const badClaims = async (mutate: (claims: Claims) => void, expected = 401) => {
    const started = await startRoute(req(`/auth/sso/${provider.id}?mode=login`));
    const authResp = await fetch(started.headers.get("location")!, { redirect: "manual" });
    const callback = new URL(authResp.headers.get("location")!);
    mutate(idp.codes.get(callback.searchParams.get("code")!)!.claims);
    const result = await callbackRoute(req(`/auth/sso/callback?${callback.searchParams}`));
    expect(result.status).toBe(expected);
    return result;
  };
  // issuer 불일치
  await badClaims(c => { c.iss = "http://evil.example.com"; });
  await badClaims(c => { c.aud = "other-client"; });
  await badClaims(c => { c.nonce = "forged-nonce"; });
  await badClaims(c => { c.exp = Math.floor(Date.now() / 1000) - 3600; });
  // 이메일 미검증 계정으로 기존 계정 탈취 시도 → 거부
  await badClaims(c => { c.sub = "attacker-sub"; c.email = "sso-user@catchsecu.test"; c.email_verified = false; }, 403);
  // 토큰 엔드포인트 HTTP 500 → 401
  idp.failToken = "http500";
  expect((await run()).status).toBe(401);
  idp.failToken = null;
  // 잘못된 state → 401
  expect((await callbackRoute(req(`/auth/sso/callback?state=${randomUUID()}&code=x`))).status).toBe(401);
});

async function providerSettingsFixture() {
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  idp.issuer = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const owner = await ownerCookie();
  await db.membership.create({ data: { tenant: { connect: { id: owner.company.id } }, role: "owner", user: {
    create: { id: randomUUID(), name: "복구 관리자", email: "recovery-" + randomUUID() + "@catchsecu.test", emailVerified: true },
  } } });
  const { requireContext } = await import("@/server/context");
  const ctx = await requireContext(req("/security/sso", owner.cookie).headers);
  const input = { tenantId: owner.company.id, protocol: "oidc" as const, name: "관리 시험 IdP", issuer: idp.issuer, clientId: "catchsecu",
    authorizationUrl: idp.issuer + "/authorize", tokenUrl: idp.issuer + "/token",
    jwksUrl: idp.issuer + "/jwks.json", scopes: "openid profile email" };
  const provider = await db.ssoProvider.create({ data: { ...input, tenantId: owner.company.id, preflightOk: true } });
  return { ...owner, ctx, input, provider };
}
function gateJwks() {
  let entered!: () => void, release!: () => void;
  const seen = new Promise<void>(resolve => { entered = resolve; });
  jwksGate = { entered, release: new Promise<void>(resolve => { release = resolve; }) };
  return { seen, release };
}

test.each([{ name: "이름 변경" }, { scopes: "openid email" }, { clientSecret: "new-secret" }])(
  "P11 설정: 다른 필드와 함께 요청해도 사전검사 실패 설정을 활성화할 수 없다 %j", async patch => {
    const { cookie, provider } = await providerSettingsFixture();
    await db.ssoProvider.update({ where: { id: provider.id }, data: { preflightOk: false } });
    const { patchProvider } = await ssoFlow();
    const response = await patchProvider(req("/security/sso/" + provider.id, cookie, "PATCH",
      { version: provider.version, enabled: true, ...patch }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("PREFLIGHT_REQUIRED");
    expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ enabled: false, version: 1 });
    expect(await db.auditEvent.count({ where: { resourceId: provider.id } })).toBe(0);
  });

const settingsOperations = ["list", "create", "update", "remove", "preflight"] as const;
test.each(settingsOperations)("P11 설정: 회수된 owner의 이전 Context로 %s 불가", async operation => {
  const { ctx, input, provider } = await providerSettingsFixture();
  const sso = await import("@/server/sso");
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  const calls = {
    list: () => sso.listSsoProviders(ctx),
    create: () => sso.createSsoProvider(ctx, input, randomUUID()),
    update: () => sso.updateSsoProvider(ctx, provider.id, { version: 1, name: "변조" }, randomUUID()),
    remove: () => sso.removeSsoProvider(ctx, provider.id, 1, randomUUID()),
    preflight: () => sso.preflightSsoProvider(ctx, provider.id, randomUUID()),
  };
  await expect(calls[operation]()).rejects.toMatchObject({ status: 403 });
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ version: 1, name: input.name });
});

test.each(settingsOperations)("P11 설정: 폐기된 세션의 이전 Context로 %s 불가", async operation => {
  const { ctx, input, provider } = await providerSettingsFixture();
  const sso = await import("@/server/sso");
  await db.session.delete({ where: { id: ctx.session.id } });
  const calls = {
    list: () => sso.listSsoProviders(ctx),
    create: () => sso.createSsoProvider(ctx, input, randomUUID()),
    update: () => sso.updateSsoProvider(ctx, provider.id, { version: 1, name: "변조" }, randomUUID()),
    remove: () => sso.removeSsoProvider(ctx, provider.id, 1, randomUUID()),
    preflight: () => sso.preflightSsoProvider(ctx, provider.id, randomUUID()),
  };
  await expect(calls[operation]()).rejects.toMatchObject({ status: 401 });
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ version: 1 });
});

test("P11 설정: 같은 version 동시 변경은 하나만 성공한다", async () => {
  const { ctx, provider } = await providerSettingsFixture();
  const { updateSsoProvider } = await import("@/server/sso");
  const results = await Promise.allSettled(["A", "B"].map(name =>
    updateSsoProvider(ctx, provider.id, { version: 1, name }, randomUUID())));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409, code: expect.stringMatching(/^(VERSION_CONFLICT|CONCURRENT_CHANGE)$/) } });
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ version: 2 });
});

test("P11 설정: 느린 사전검사 중 저장한 새 설정을 이전 검사 결과로 덮어쓰지 않는다", async () => {
  const { ctx, provider } = await providerSettingsFixture();
  const { preflightSsoProvider, updateSsoProvider } = await import("@/server/sso");
  const gate = gateJwks();
  const pending = preflightSsoProvider(ctx, provider.id, randomUUID()).then(value => ({ value }), error => ({ error }));
  try {
    await gate.seen;
    await updateSsoProvider(ctx, provider.id, { version: 1, name: "새 설정" }, randomUUID());
  } finally { gate.release(); }
  expect(await pending).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ name: "새 설정", version: 2 });
});

test("P11 설정: 신규 사전검사 도중 권한이 회수되면 생성과 감사를 남기지 않는다", async () => {
  const { ctx, input } = await providerSettingsFixture();
  const { createSsoProvider } = await import("@/server/sso");
  const gate = gateJwks();
  const pending = createSsoProvider(ctx, { ...input, name: "취소되어야 할 설정" }, randomUUID())
    .then(value => ({ value }), error => ({ error }));
  try {
    await gate.seen;
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  } finally { gate.release(); }
  expect(await pending).toMatchObject({ error: { status: 403 } });
  expect(await db.ssoProvider.count()).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_created" } })).toBe(0);
});

test("P11 설정: 인증 설정 교체는 연결을 중지하고 재검사 후 명시적으로 활성화한다", async () => {
  const { ctx, provider } = await providerSettingsFixture();
  const { updateSsoProvider, preflightSsoProvider } = await import("@/server/sso");
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const rotated = await updateSsoProvider(ctx, provider.id, { version: 1, clientSecret: "replacement-secret" }, randomUUID());
  expect(rotated).toMatchObject({ enabled: false, preflightOk: false, version: 2 });
  await expect(updateSsoProvider(ctx, provider.id, { version: 2, enabled: true, name: "새 이름" }, randomUUID()))
    .rejects.toMatchObject({ code: "PREFLIGHT_REQUIRED" });
  const checked = await preflightSsoProvider(ctx, provider.id, randomUUID());
  expect(checked).toMatchObject({ enabled: false, preflightOk: true, version: 3 });
  expect(await updateSsoProvider(ctx, provider.id, { version: 3, enabled: true }, randomUUID()))
    .toMatchObject({ enabled: true, preflightOk: true, version: 4 });
});
test("P11 설정: 사용 중 설정의 재검사가 실패하면 활성 상태도 해제한다", async () => {
  const { ctx, provider } = await providerSettingsFixture();
  const { preflightSsoProvider } = await import("@/server/sso");
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true, jwksUrl: idp.issuer + "/dead-jwks" } });
  expect(await preflightSsoProvider(ctx, provider.id, randomUUID())).toMatchObject({ enabled: false, preflightOk: false, version: 2 });
});
test("P11 설정: 표시 이름과 기존 scope만 저장하면 사용 상태를 유지한다", async () => {
  const { ctx, provider } = await providerSettingsFixture();
  const { updateSsoProvider } = await import("@/server/sso");
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  expect(await updateSsoProvider(ctx, provider.id, { version: 1, name: "표시 이름", scopes: provider.scopes }, randomUUID()))
    .toMatchObject({ enabled: true, preflightOk: true, version: 2 });
});

async function pendingOidc(mode = "login") {
  const fixture = await providerSettingsFixture();
  await db.ssoProvider.update({ where: { id: fixture.provider.id }, data: { enabled: true } });
  const routes = await ssoFlow();
  const started = await routes.startRoute(req("/auth/sso/" + fixture.provider.id + "?mode=" + mode, fixture.cookie));
  expect(started.status).toBe(302);
  const authorize = await fetch(started.headers.get("location")!, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  return { ...fixture, ...routes, callback };
}
test("P11 콜백: 연결 시작 후 로그아웃하면 계정과 세션을 생성하지 않는다", async () => {
  const f = await pendingOidc("link");
  await db.session.delete({ where: { id: f.ctx.session.id } });
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(response.status).toBe(401);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.account_linked" } })).toBe(0);
});
test("P11 콜백: 다른 사용자에게 연결된 외부 계정으로 현재 사용자를 바꾸지 않는다", async () => {
  const f = await pendingOidc("link");
  const other = await db.user.create({ data: { name: "별도 사용자", email: "different@catchsecu.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: f.company.id, userId: other.id, role: "viewer" } });
  await db.account.create({ data: { providerId: "sso:" + f.provider.id, accountId: idp.issuer + "|idp-sub-1", userId: other.id } });
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams, f.cookie));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("SSO_ACCOUNT_ALREADY_LINKED");
  expect(await db.session.count({ where: { userId: other.id } })).toBe(0);
});
test("P11 콜백: 시작 브라우저와 유효한 세션은 인증 세션 쿠키 없이도 같은 사용자에게만 연결한다", async () => {
  const f = await pendingOidc("link");
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(response.status).toBe(302);
  expect(await db.account.findFirst({ where: { providerId: "sso:" + f.provider.id } })).toMatchObject({ userId: f.user.id });
});
test("P11 콜백: 시작 이후 설정 버전이 바뀌면 이전 로그인 요청을 거부한다", async () => {
  const f = await pendingOidc();
  const { updateSsoProvider } = await import("@/server/sso");
  await updateSsoProvider(f.ctx, f.provider.id, { version: 1, name: "변경된 설정" }, randomUUID());
  expect((await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams))).status).toBe(409);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test.each(["disable", "close-company", "expire-state"] as const)(
  "P11 콜백: 키 확인 대기 중 %s 변경이 세션 발급을 차단한다", async action => {
    const f = await pendingOidc();
    const gate = gateJwks();
    const expiry = Date.now() + 3000;
    if (action === "expire-state") await db.ssoState.updateMany({ where: { providerId: f.provider.id }, data: { expiresAt: new Date(expiry) } });
    const pending = f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
    try {
      await gate.seen;
      if (action === "disable") {
        const { updateSsoProvider } = await import("@/server/sso");
        await updateSsoProvider(f.ctx, f.provider.id, { version: 1, enabled: false }, randomUUID());
      } else if (action === "close-company") {
        await db.company.update({ where: { id: f.company.id }, data: { status: "closed" } });
      } else {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now() + 50)));
      }
    } finally { gate.release(); }
    const response = await pending;
    expect(response.status).toBe(action === "disable" ? 409 : action === "expire-state" ? 401 : 403);
    expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
    expect(await db.user.findUnique({ where: { email: "sso-user@catchsecu.test" } })).toBeNull();
  });
test("P11 콜백: 연결 시작 세션의 회사 선택이 바뀌면 연결을 중단한다", async () => {
  const f = await pendingOidc("link");
  const company = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사", policy: { create: {} } } });
  await db.session.update({ where: { id: f.ctx.session.id }, data: { activeCompanyId: company.id } });
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(response.status).toBe(403);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test("P11 콜백: 이미 연결된 계정도 취소된 초대를 우회할 수 없다", async () => {
  const f = await pendingOidc();
  const first = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(first.status).toBe(302);
  const token = opaqueToken();
  const { POST: inviteStart } = await import("@/app/api/v1/invitations/sso/start/route");
  const invitation = await db.invitation.create({ data: { tenantId: f.company.id, invitedBy: f.ctx.member.id,
    email: "sso-user@catchsecu.test", role: "viewer", serviceIds: [], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) } });
  const started = await browser.wrap(inviteStart)(req("/invitations/sso/start", "", "POST", { token, providerId: f.provider.id }));
  expect(started.status).toBe(200);
  const authorize = await fetch((await started.json()).redirect, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  await db.invitation.update({ where: { id: invitation.id }, data: { status: "revoked", version: { increment: 1 } } });
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(410);
});

test("P11 콜백: IdP 이메일 주장만으로 기존 계정에 자동 연결하지 않는다", async () => {
  const f = await pendingOidc();
  idp.codes.get(f.callback.searchParams.get("code")!)!.claims.email = f.email;
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("SSO_LINK_REQUIRED");
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(1);
});
test("P11 콜백: 원래 연결 세션의 만료는 새 연결과 감사를 롤백한다", async () => {
  const f = await pendingOidc("link");
  await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  expect((await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams))).status).toBe(401);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.account_linked" } })).toBe(0);
});
test("P11 콜백: 기존 연결 계정의 재초대도 초대 역할과 서비스 권한을 적용한다", async () => {
  const f = await pendingOidc();
  expect((await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams))).status).toBe(302);
  const user = await db.user.findUniqueOrThrow({ where: { email: "sso-user@catchsecu.test" } });
  const member = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: f.company.id, userId: user.id } } });
  await db.membership.update({ where: { id: member.id }, data: { status: "revoked", version: { increment: 1 } } });
  const service = await db.service.create({ data: { tenantId: f.company.id, name: "초대 서비스", externalName: "초대 서비스" } });
  const token = opaqueToken();
  const { POST: inviteStart } = await import("@/app/api/v1/invitations/sso/start/route");
  const invitation = await db.invitation.create({ data: { tenantId: f.company.id, invitedBy: f.ctx.member.id,
    email: user.email, role: "editor", serviceIds: [service.id], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) } });
  const started = await browser.wrap(inviteStart)(req("/invitations/sso/start", "", "POST", { token, providerId: f.provider.id }));
  expect(started.status).toBe(200);
  const authorize = await fetch((await started.json()).redirect, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  expect((await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))).status).toBe(302);
  expect(await db.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ status: "active", role: "editor" });
  expect(await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).toMatchObject({ status: "accepted", acceptedBy: user.id });
  expect(await db.serviceGrant.findFirst({ where: { memberId: member.id, serviceId: service.id } })).not.toBeNull();
});
test("P11 콜백: JIT 가입도 회사 구성원 한도를 초과할 수 없다", async () => {
  const f = await pendingOidc();
  const start = new Date();
  await db.billingSubscription.create({ data: { tenantId: f.company.id, planId: "trial", planVersionId: "trial-v1",
    status: "trialing", priceKrw: 0, activationSource: "trial", periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000) } });
  for (let i = 0; i < 8; i++) {
    const user = await db.user.create({ data: { name: "한도 시험", email: "quota-" + i + "@catchsecu.test", emailVerified: true } });
    await db.membership.create({ data: { tenantId: f.company.id, userId: user.id, role: "viewer" } });
  }
  const response = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("QUOTA_EXCEEDED");
  expect(await db.user.findUnique({ where: { email: "sso-user@catchsecu.test" } })).toBeNull();
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test("P11 콜백: DB가 다른 회사 provider 및 다른 사용자의 연결 세션을 거부한다", async () => {
  const f = await pendingOidc("link");
  const state = await db.ssoState.findFirstOrThrow({ where: { providerId: f.provider.id } });
  const other = await db.company.create({ data: { name: "외부 회사", publicName: "외부 회사" } });
  await expect(db.ssoState.update({ where: { id: state.id }, data: { tenantId: other.id } })).rejects.toThrow();
  const recovery = await db.membership.findFirstOrThrow({ where: { tenantId: f.company.id, userId: { not: f.user.id } } });
  await expect(db.ssoState.update({ where: { id: state.id }, data: { userId: recovery.userId } })).rejects.toThrow();
  await expect(db.ssoState.update({ where: { id: state.id }, data: { sessionId: null } })).rejects.toThrow();
});

const responseCookies = (r: Response) => r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function ssoMfaFixture() {
  const f = await pendingOidc();
  await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id,
    accountId: idp.issuer + "|idp-sub-1" } });
  const setup = await auth.handler(req("/auth/two-factor/enable", f.cookie, "POST", { password }));
  expect(setup.status).toBe(200);
  const data = await setup.json();
  const secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  const code = () => createOTP(secret, { digits: 6, period: 30 }).totp();
  const enabled = await auth.handler(req("/auth/two-factor/verify-totp", f.cookie, "POST", { code: await code() }));
  expect(enabled.status).toBe(200);
  const enrolledCookie = responseCookies(enabled);
  expect((await auth.handler(req("/auth/sign-out", enrolledCookie, "POST", {}))).status).toBe(200);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
  return { ...f, code, backup: data.backupCodes[0] as string };
}
test("SSO MFA: 코드 검증 전 세션0, 검증 후 대상 회사 세션1과 감사", async () => {
  const f = await ssoMfaFixture();
  const callback = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe("/login-otp?returnTo=%2Fdashboard");
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
  const cookie = responseCookies(callback);
  const { GET: me } = await import("@/app/api/v1/me/route");
  expect((await me(req("/me", cookie))).status).toBe(401);
  const verified = await auth.handler(req("/auth/two-factor/verify-totp", cookie, "POST", { code: await f.code() }));
  expect(verified.status).toBe(200);
  const session = await db.session.findFirstOrThrow({ where: { userId: f.user.id } });
  expect(session.activeCompanyId).toBe(f.company.id);
  expect(await db.ssoSessionProof.findUnique({ where: { sessionId: session.id } })).toMatchObject({ userId: f.user.id, providerId: f.provider.id, tenantId: f.company.id, identityProvider: "OTHER" });
  expect(await db.auditEvent.count({ where: { action: "session.created", resourceId: session.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: f.user.id } })).toBe(1);
  expect((await auth.handler(req("/auth/two-factor/verify-totp", cookie, "POST", { code: await f.code() }))).status).toBe(401);
});

async function pendingSsoMfa() {
  const f = await ssoMfaFixture();
  const callback = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toContain("/login-otp");
  return { ...f, mfaCookie: responseCookies(callback) };
}
test.each(["provider", "membership", "account", "closed", "password", "binding", "expiry", "ip", "ssoPolicy"])("SSO MFA: %s 변경 후 새 세션을 만들지 않는다", async kind => {
  const f = await pendingSsoMfa();
  if (kind === "provider") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { version: { increment: 1 } } });
  if (kind === "ssoPolicy") await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id, mode: "GOOGLE" } });
  if (kind === "membership") await db.membership.update({ where: { id: f.ctx.member.id }, data: { status: "revoked", version: { increment: 1 } } });
  if (kind === "account") await db.account.deleteMany({ where: { userId: f.user.id, providerId: "sso:" + f.provider.id } });
  if (kind === "closed") {
    await db.membership.update({ where: { id: f.ctx.member.id }, data: { role: "viewer" } });
    await db.user.update({ where: { id: f.user.id }, data: { status: "closed" } });
  }
  if (kind === "password") await db.user.update({ where: { id: f.user.id }, data: { passwordChangedAt: new Date() } });
  if (kind === "binding") await db.verification.deleteMany({ where: { value: { startsWith: "v1." } } });
  if (kind === "expiry") await db.verification.updateMany({ where: { value: { startsWith: "v1." } }, data: { expiresAt: new Date(Date.now() - 1) } });
  if (kind === "ip") {
    await db.ipRule.create({ data: { tenantId: f.company.id, description: "허용된 원격 IP", cidr: "192.0.2.1/32", enabled: true } });
    await db.ipAccessPolicy.create({ data: { tenantId: f.company.id, enabled: true } });
  }
  const verified = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }));
  expect([401, 403, 409]).toContain(verified.status);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: f.user.id } })).toBe(0);
});
test("SSO MFA: 복구코드 동시 소비는 대상 회사 세션 한 개만 생성한다", async () => {
  const f = await pendingSsoMfa();
  const verified = await Promise.all([1, 2].map(() => auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }))));
  expect(verified.map(r => r.status).sort()).toEqual([200, 401]);
  expect(await db.session.count({ where: { userId: f.user.id, activeCompanyId: f.company.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: f.user.id } })).toBe(1);
});
test("SSO MFA: 이메일 코드 전송과 검증에 같은 회사 권한을 적용한다", async () => {
  const f = await pendingSsoMfa();
  expect((await auth.handler(req("/auth/two-factor/send-otp", f.mfaCookie, "POST", {}))).status).toBe(200);
  const { decrypt } = await import("@/server/crypto");
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
  const mail = jobs.map(j => decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher))
    .find(m => m.to === f.email && m.subject === "로그인 인증코드")!;
  const code = /인증코드: ([0-9]{6})/.exec(mail.text)![1];
  expect((await auth.handler(req("/auth/two-factor/verify-otp", f.mfaCookie, "POST", { code }))).status).toBe(200);
  expect(await db.session.count({ where: { userId: f.user.id, activeCompanyId: f.company.id } })).toBe(1);
});
test("SSO MFA: 잘못된 코드 시도 제한 이후 올바른 코드도 거부한다", async () => {
  const f = await pendingSsoMfa();
  for (let i = 0; i < 6; i++) {
    const failed = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: "invalid-backup-code" }));
    expect([400, 401, 403, 429]).toContain(failed.status);
  }
  const verified = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }));
  expect(verified.status).not.toBe(200);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
});
test("SSO MFA: 다른 회사가 먼저 가입됐어도 대상 회사로 로그인한다", async () => {
  const f = await pendingSsoMfa();
  const other = await db.company.create({ data: { name: "이전 회사", publicName: "이전", policy: { create: {} },
    memberships: { create: { userId: f.user.id, role: "owner", createdAt: new Date(0) } } } });
  expect(other.id).not.toBe(f.company.id);
  const verified = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }));
  expect(verified.status).toBe(200);
  expect((await db.session.findFirstOrThrow({ where: { userId: f.user.id } })).activeCompanyId).toBe(f.company.id);
});

async function normalMfaSession(f: Awaited<ReturnType<typeof ssoMfaFixture>>) {
  const first = await auth.handler(req("/auth/sign-in/email", "", "POST", { email: f.email, password }));
  expect(first.status).toBe(200);
  const verified = await auth.handler(req("/auth/two-factor/verify-totp", responseCookies(first), "POST", { code: await f.code() }));
  expect(verified.status).toBe(200);
  return responseCookies(verified);
}
test("SSO MFA: 기존 세션을 섞어 인증코드 검증을 생략할 수 없다", async () => {
  const f = await pendingSsoMfa();
  const ordinary = await normalMfaSession(f);
  const combined = f.mfaCookie.split("; ").filter(v => !v.includes("session_token=")).join("; ") + "; "
    + ordinary.split("; ").filter(v => v.includes("session_token=")).join("; ");
  const result = await auth.handler(req("/auth/two-factor/verify-backup-code", combined, "POST", { code: "invalid-code" }));
  expect(result.status).toBe(401);
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: f.user.id } })).toBe(0);
});
test("SSO MFA: link 원래 세션이 코드 입력 전에 종료되면 연결 로그인을 거부한다", async () => {
  const f = await ssoMfaFixture();
  const ordinary = await normalMfaSession(f);
  const started = await f.startRoute(req("/auth/sso/" + f.provider.id + "?mode=link", ordinary));
  expect(started.status).toBe(302);
  const authorize = await fetch(started.headers.get("location")!, { redirect: "manual" });
  const callback = await f.callbackRoute(new Request(authorize.headers.get("location")!));
  expect(callback.headers.get("location")).toContain("/login-otp");
  expect((await auth.handler(req("/auth/sign-out", ordinary, "POST", {}))).status).toBe(200);
  const result = await auth.handler(req("/auth/two-factor/verify-backup-code", responseCookies(callback), "POST", { code: f.backup }));
  expect(result.status).toBe(401);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
});
test("SSO MFA: 감사 저장 실패는 세션·복구코드·SSO 바인딩 소비를 롤백한다", async () => {
  const f = await pendingSsoMfa();
  ssoFault.audit = true;
  const failed = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }));
  ssoFault.audit = false;
  expect(failed.status).toBe(500);
  expect(failed.headers.getSetCookie()).toHaveLength(0);
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
  expect(await db.ssoSessionProof.count({ where: { userId: f.user.id } })).toBe(0);
  const retry = await auth.handler(req("/auth/two-factor/verify-backup-code", f.mfaCookie, "POST", { code: f.backup }));
  expect(retry.status).toBe(200);
  expect(await db.ssoSessionProof.count({ where: { userId: f.user.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: f.user.id } })).toBe(1);
});

test("SSO JIT: 이미 연결된 계정의 삭제된 소속을 자동 복구하지 않는다", async () => {
  const f = await pendingOidc();
  const user = await db.user.create({ data: { email: "sso-user@catchsecu.test", name: "제거된 구성원", emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: user.id, role: "viewer" } });
  await db.account.create({ data: { userId: user.id, providerId: "sso:" + f.provider.id, accountId: idp.issuer + "|idp-sub-1" } });
  await db.membership.delete({ where: { id: member.id } });
  const callback = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(callback.status).toBe(403);
  expect(await db.membership.count({ where: { userId: user.id, tenantId: f.company.id } })).toBe(0);
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
});

test("SSO 취소: 유효 state를 소비하고 IdP 상세나 토큰을 반환하지 않는다", async () => {
  const f = await pendingOidc();
  const before = await db.session.count();
  const params = new URLSearchParams({ state: f.callback.searchParams.get("state")!, error: "access_denied", error_description: "PRIVATE-IDP-DETAIL" });
  const request = req("/auth/sso/callback?" + params);
  request.headers.set("accept", "text/html");
  const response = await f.callbackRoute(request);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=SSO_CANCELLED");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await db.ssoState.count()).toBe(0);
  expect(await db.session.count()).toBe(before);
  // 취소 전에 받은 정상 code라도 취소한 state로 세션을 만들 수 없다.
  expect((await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams))).status).toBe(401);
  expect(await db.session.count()).toBe(before);
});
test("SSO 취소: 존재하지 않는 state는 공급자 취소로 처리하지 않는다", async () => {
  const { callbackRoute } = await ssoFlow();
  const response = await callbackRoute(req("/auth/sso/callback?state=unknown&error=access_denied&error_description=PRIVATE"));
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("STATE_INVALID");
});
test.each(["expiry", "configuration"])("SSO 브라우저: %s 오류는 새 로그인 안내로 이동한다", async kind => {
  const f = await pendingOidc();
  if (kind === "expiry") await db.ssoState.updateMany({ data: { expiresAt: new Date(0) } });
  else await db.ssoProvider.update({ where: { id: f.provider.id }, data: { version: { increment: 1 } } });
  const request = req("/auth/sso/callback?" + f.callback.searchParams);
  request.headers.set("accept", "text/html");
  const response = await f.callbackRoute(request);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`/login?error=${kind === "expiry" ? "SSO_EXPIRED" : "SSO_CHANGED"}`);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test("SSO 브라우저: 성공 리디렉션과 로그인 쿠키는 유지된다", async () => {
  const f = await pendingOidc();
  const request = req("/auth/sso/callback?" + f.callback.searchParams);
  request.headers.set("accept", "text/html");
  const response = await f.callbackRoute(request);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/dashboard");
  expect(response.headers.get("set-cookie")).toContain("better-auth.session_token=");
});

async function ownAccountsFixture() {
  const f = await providerSettingsFixture();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true } });
  const account = await db.account.create({ data: { userId: f.ctx.user.id, providerId: "sso:" + f.provider.id,
    accountId: "private-subject", accessToken: "private-access-token", refreshToken: "private-refresh-token" } });
  const { GET: list } = await import("@/app/api/v1/me/sso-accounts/route");
  const { DELETE: unlink } = await import("@/app/api/v1/me/sso-accounts/[id]/route");
  const remove = () => unlink(req("/me/sso-accounts/" + account.id, f.cookie, "DELETE", { updatedAt: account.updatedAt.toISOString(), confirm: true }));
  return { ...f, account, list, unlink, remove };
}
test("내 SSO 연결 목록: 회사·본인만 반환하고 토큰·외부 신원·설정 비밀은 숨긴다", async () => {
  const f = await ownAccountsFixture();
  const other = await db.user.create({ data: { name: "다른 사용자", email: randomUUID() + "@example.test", emailVerified: true } });
  await db.account.create({ data: { userId: other.id, providerId: "sso:" + f.provider.id, accountId: "other-subject" } });
  await db.membership.update({ where: { id: f.ctx.member.id }, data: { role: "viewer" } });
  const response = await f.list(req("/me/sso-accounts", f.cookie));
  expect(response.status).toBe(200);
  const text = await response.text(), value = JSON.parse(text);
  expect(value.items).toHaveLength(1); expect(value.items[0].id).toBe(f.account.id);
  expect(value.providers).toHaveLength(1); expect(value.items[0].canUnlink).toBe(true);
  for (const hidden of ["private-subject", "private-access-token", "private-refresh-token", "other-subject", "authorizationUrl", "clientSecret"])
    expect(text).not.toContain(hidden);
  expect((await f.list(req("/me/sso-accounts"))).status).toBe(401);
});
test("SSO 연결 해제: 모든 본인 세션·대기 연결·인증을 제거하고 같은 요청 ID로 감사를 남긴다", async () => {
  const f = await ownAccountsFixture();
  const second = await db.session.create({ data: { userId: f.ctx.user.id, activeCompanyId: f.company.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  await db.verification.create({ data: { identifier: "pending-own-proof", value: f.ctx.user.id, expiresAt: new Date(Date.now() + 60000) } });
  expect((await (await ssoFlow()).startRoute(req("/auth/sso/" + f.provider.id + "?mode=link", f.cookie))).status).toBe(302);
  const response = await f.remove(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ unlinked: true, signedOut: true });
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).toBeNull();
  expect(await db.session.count({ where: { userId: f.ctx.user.id } })).toBe(0);
  expect(await db.ssoState.count({ where: { userId: f.ctx.user.id } })).toBe(0);
  expect(await db.verification.count({ where: { value: f.ctx.user.id } })).toBe(0);
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers.get("x-request-id")! } });
  expect(events.filter(e => e.action === "session.ended").map(e => e.resourceId).sort()).toEqual([f.ctx.session.id, second.id].sort());
  expect(events.filter(e => e.action === "sso.account_unlinked")).toHaveLength(1);
  expect((await f.list(req("/me/sso-accounts", f.cookie))).status).toBe(401);
});
test.each(["stale", "version", "last", "foreign", "revoked"])("SSO 해제 거부: %s", async kind => {
  const f = await ownAccountsFixture();
  let expected = 409;
  if (kind === "stale") { await db.session.update({ where: { id: f.ctx.session.id }, data: { createdAt: new Date(Date.now() - 301000) } }); expected = 401; }
  if (kind === "version") await db.account.update({ where: { id: f.account.id }, data: { scope: "changed", updatedAt: new Date(Date.now() + 1000) } });
  if (kind === "last") await db.account.deleteMany({ where: { userId: f.ctx.user.id, providerId: "credential" } });
  if (kind === "foreign") { await db.account.update({ where: { id: f.account.id }, data: { userId: (await db.user.create({ data: { email: randomUUID() + "@example.test", name: "다른 계정" } })).id } }); expected = 404; }
  if (kind === "revoked") { await db.membership.update({ where: { id: f.ctx.member.id }, data: { status: "revoked" } }); expected = 403; }
  const response = await f.remove(); expect(response.status).toBe(expected);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "sso.account_unlinked" } })).toBe(0);
});
test.each([true, false])("SSO만 있는 사용자: 다른 공급자 available=%s일 때 마지막 수단 검사", async enabled => {
  const f = await ownAccountsFixture();
  await db.account.deleteMany({ where: { userId: f.ctx.user.id, providerId: "credential" } });
  const other = await db.ssoProvider.create({ data: { ...f.input, name: "다른 SSO", tenantId: f.company.id, preflightOk: true, enabled } });
  await db.account.create({ data: { userId: f.ctx.user.id, providerId: "sso:" + other.id, accountId: "other" } });
  expect((await f.remove()).status).toBe(enabled ? 200 : 409);
});
test("SSO 연결 해제 감사 실패는 계정·세션·인증 삭제를 롤백한다", async () => {
  const f = await ownAccountsFixture();
  ssoFault.unlinkAudit = true;
  expect((await f.remove()).status).toBe(500);
  expect(ssoFault.unlinkAuditSeen).toBe(true);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
  expect(await db.session.findUnique({ where: { id: f.ctx.session.id } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "session.ended" } })).toBe(0);
});
test("라이브러리의 일반 연결 해제 경로로 회사 권한·감사를 우회할 수 없다", async () => {
  const f = await ownAccountsFixture();
  const result = await auth.handler(req("/auth/unlink-account", f.cookie, "POST", { accountId: f.account.id }));
  expect(result.status).toBe(403);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
});
test("SSO 연결 시작·콜백은 실제 최근 로그인 시각을 확인한다", async () => {
  const f = await pendingOidc("link");
  await db.session.update({ where: { id: f.ctx.session.id }, data: { createdAt: new Date(Date.now() - 301000), updatedAt: new Date() } });
  const begin = await f.startRoute(req("/auth/sso/" + f.provider.id + "?mode=link", f.cookie));
  expect(begin.status).toBe(401); expect((await begin.json()).error.code).toBe("SSO_REAUTH_REQUIRED");
  const finish = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(finish.status).toBe(401);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test("SSO 링크 성공은 실제 본인 연결을 저장하고 연결 관리로 돌아온다", async () => {
  const f = await pendingOidc("link");
  const result = await f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  expect(result.status).toBe(302); expect(result.headers.get("location")).toBe("/link/oauth2/verified");
  expect(await db.account.findFirst({ where: { userId: f.ctx.user.id, providerId: "sso:" + f.provider.id } })).not.toBeNull();
});
test("SSO 동시 해제는 한 번만 변경하고 두 번째 요청을 거부한다", async () => {
  const f = await ownAccountsFixture();
  const responses = await Promise.all([f.remove(), f.remove()]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
  expect(await db.auditEvent.count({ where: { action: "sso.account_unlinked" } })).toBe(1);
});
test("내 연결 목록·삭제는 같은 사용자의 다른 회사 계정도 공개하지 않는다", async () => {
  const f = await ownAccountsFixture();
  const company = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
  const provider = await db.ssoProvider.create({ data: { ...f.input, tenantId: company.id } });
  const other = await db.account.create({ data: { userId: f.ctx.user.id, providerId: "sso:" + provider.id, accountId: "other-company" } });
  const response = await f.list(req("/me/sso-accounts", f.cookie));
  expect(await response.text()).not.toContain(other.id);
  expect((await f.unlink(req("/me/sso-accounts/" + other.id, f.cookie, "DELETE", { confirm: true, updatedAt: other.updatedAt.toISOString() }))).status).toBe(404);
});
test("SSO 해제 전 회사가 바뀐 오래된 Context는 트랜잭션에서 다시 거부한다", async () => {
  const f = await ownAccountsFixture();
  const company = await db.company.create({ data: { name: "변경한 회사", publicName: "변경한 회사" } });
  await db.session.update({ where: { id: f.ctx.session.id }, data: { activeCompanyId: company.id } });
  const { unlinkOwnSsoAccount } = await import("@/server/sso-accounts");
  await expect(unlinkOwnSsoAccount(f.ctx, f.account.id, f.account.updatedAt.toISOString(), randomUUID()))
    .rejects.toMatchObject({ code: "COMPANY_CHANGED" });
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
});
test("해제 확인 누락·CSRF는 거부하며 기존 연결을 보존한다", async () => {
  const f = await ownAccountsFixture();
  const path = "/me/sso-accounts/" + f.account.id;
  expect((await f.unlink(req(path, f.cookie, "DELETE", { updatedAt: f.account.updatedAt.toISOString() }))).status).toBe(422);
  const forged = req(path, f.cookie, "DELETE", { confirm: true, updatedAt: f.account.updatedAt.toISOString() });
  forged.headers.set("origin", "https://attacker.test");
  expect((await f.unlink(forged)).status).toBe(403);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
});

async function providerRemovalFixture() {
  const f = await ownAccountsFixture();
  const { DELETE: remove } = await import("@/app/api/v1/security/sso/[id]/route");
  return { ...f, removeProvider: () => remove(req("/security/sso/" + f.provider.id, f.cookie, "DELETE", { version: 1 })) };
}
test("공급자 삭제: 연결·세션·인증과 대기 요청을 원자 정리한다", async () => {
  const f = await providerRemovalFixture();
  const other = await db.user.create({ data: { name: "보존", email: randomUUID() + "@example.test", emailVerified: true } });
  const untouched = await db.session.create({ data: { userId: other.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  await db.verification.create({ data: { identifier: "pending-proof", value: f.ctx.user.id, expiresAt: new Date(Date.now() + 60000) } });
  expect((await (await ssoFlow()).startRoute(req("/auth/sso/" + f.provider.id, f.cookie))).status).toBe(302);
  const response = await f.removeProvider(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ deleted: true, removedAccounts: 1, signedOut: true });
  expect(await db.ssoProvider.count({ where: { id: f.provider.id } })).toBe(0);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect(await db.session.count({ where: { userId: f.ctx.user.id } })).toBe(0);
  expect(await db.verification.count({ where: { value: f.ctx.user.id } })).toBe(0);
  expect(await db.ssoState.count({ where: { providerId: f.provider.id } })).toBe(0);
  expect(await db.session.findUnique({ where: { id: untouched.id } })).not.toBeNull();
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers.get("x-request-id")! } });
  expect(events.map(e => e.action).sort()).toEqual(["session.ended", "sso.account_removed_with_provider", "sso.provider_deleted"]);
});
test("공급자 삭제: 같은 공급자의 연결이 여러 개여도 다른 로그인 수단으로 세지 않는다", async () => {
  const f = await providerRemovalFixture();
  await db.account.deleteMany({ where: { userId: f.ctx.user.id, providerId: "credential" } });
  await db.account.create({ data: { userId: f.ctx.user.id, providerId: "sso:" + f.provider.id, accountId: "second-subject" } });
  const response = await f.removeProvider(); expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("SSO_PROVIDER_LAST_LOGIN");
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(2);
  expect(await db.session.count({ where: { userId: f.ctx.user.id } })).toBe(1);
});
test("공급자 삭제: 회수된 소속의 사용하지 못하는 연결은 정리할 수 있다", async () => {
  const f = await providerRemovalFixture();
  const revoked = await db.user.create({ data: { name: "회수", email: randomUUID() + "@example.test", emailVerified: true,
    memberships: { create: { tenantId: f.company.id, role: "viewer", status: "revoked" } },
    accounts: { create: { providerId: "sso:" + f.provider.id, accountId: "revoked" } } } });
  expect((await f.removeProvider()).status).toBe(200);
  expect(await db.account.count({ where: { userId: revoked.id } })).toBe(0);
});
test("공급자 삭제 감사 실패는 공급자·연결·세션 삭제를 롤백한다", async () => {
  const f = await providerRemovalFixture(); ssoFault.providerAudit = true;
  expect((await f.removeProvider()).status).toBe(500); expect(ssoFault.providerAuditSeen).toBe(true);
  expect(await db.ssoProvider.findUnique({ where: { id: f.provider.id } })).not.toBeNull();
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
  expect(await db.session.findUnique({ where: { id: f.ctx.session.id } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "session.ended" } })).toBe(0);
});
test("공급자 삭제에는 최근 로그인과 현재 버전이 필요하다", async () => {
  const f = await providerRemovalFixture();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { version: 2 } });
  expect((await f.removeProvider()).status).toBe(409);
  await db.session.update({ where: { id: f.ctx.session.id }, data: { createdAt: new Date(Date.now() - 301000) } });
  expect((await f.removeProvider()).status).toBe(401);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
});
test("공급자 삭제 후 이미 진행 중인 콜백은 계정·세션을 다시 만들지 않는다", async () => {
  const f = await pendingOidc("link");
  const { removeSsoProvider } = await import("@/server/sso");
  const gate = gateJwks();
  const pending = f.callbackRoute(req("/auth/sso/callback?" + f.callback.searchParams));
  await gate.seen;
  try { await removeSsoProvider(f.ctx, f.provider.id, 1, randomUUID()); }
  finally { gate.release(); }
  expect((await pending).status).toBe(404);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});
test("공급자 동시 삭제는 남은 SSO 로그인 수단까지 모두 제거하지 않는다", async () => {
  const f = await providerRemovalFixture();
  // 관리자는 연결 사용자와 분리해 두 번째 요청의 세션 종료가 마지막 수단 검사를 가리지 않게 한다.
  await db.account.delete({ where: { id: f.account.id } });
  const user = await db.user.create({ data: { name: "SSO만 사용", email: randomUUID() + "@example.test", emailVerified: true,
    memberships: { create: { tenantId: f.company.id, role: "viewer" } } } });
  const second = await db.ssoProvider.create({ data: { ...f.input, tenantId: f.company.id, enabled: true, preflightOk: true } });
  for (const provider of [f.provider.id, second.id]) await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider, accountId: "only-sso" } });
  const { removeSsoProvider } = await import("@/server/sso");
  const results = await Promise.allSettled([f.provider.id, second.id].map(id => removeSsoProvider(f.ctx, id, 1, randomUUID())));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
});
test("다른 회사의 두 공급자를 동시에 삭제해도 공통 사용자의 마지막 로그인 수단을 보존한다", async () => {
  const f = await providerRemovalFixture();
  await db.account.delete({ where: { id: f.account.id } });
  const company = await db.company.create({ data: { name: "두 번째 회사", publicName: "두 번째 회사", policy: { create: {} } } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: f.ctx.user.id, role: "owner" },
    include: { tenant: { include: { policy: true } }, grants: true, expertAssignment: { include: { services: true } } } });
  const session = await db.session.create({ data: { userId: f.ctx.user.id, activeCompanyId: company.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const second = await db.ssoProvider.create({ data: { ...f.input, tenantId: company.id, enabled: true, preflightOk: true } });
  const user = await db.user.create({ data: { name: "공통 사용자", email: randomUUID() + "@example.test", emailVerified: true } });
  for (const [tenantId, providerId] of [[f.company.id, f.provider.id], [company.id, second.id]]) {
    await db.membership.create({ data: { tenantId, userId: user.id, role: "viewer" } });
    await db.account.create({ data: { userId: user.id, providerId: "sso:" + providerId, accountId: "common-user" } });
  }
  const { removeSsoProvider } = await import("@/server/sso");
  const outcomes = await Promise.allSettled([
    removeSsoProvider(f.ctx, f.provider.id, 1, randomUUID()),
    removeSsoProvider({ ...f.ctx, tenantId: company.id, member, session }, second.id, 1, randomUUID()),
  ]);
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
  expect(await db.ssoProvider.count({ where: { id: { in: [f.provider.id, second.id] } } })).toBe(1);
});

test("P11 초대 진입: 초대 UUID만으로는 SSO를 시작할 수 없다", async () => {
  const f = await providerSettingsFixture();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true } });
  const invitation = await db.invitation.create({ data: { tenantId: f.company.id, invitedBy: f.ctx.member.id,
    email: "sso-user@catchsecu.test", role: "viewer", serviceIds: [], tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  const { startRoute } = await ssoFlow();
  const response = await startRoute(req("/auth/sso/" + f.provider.id + "?mode=invite&invitation=" + invitation.id));
  expect(response.status).toBe(422);
  expect(await db.ssoState.count()).toBe(0);
});

async function invitationSsoFixture() {
  const f = await providerSettingsFixture();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true } });
  const token = opaqueToken();
  const service = await db.service.create({ data: { tenantId: f.company.id, name: "초대 서비스", externalName: "초대 서비스" } });
  const invitation = await db.invitation.create({ data: { tenantId: f.company.id, invitedBy: f.ctx.member.id,
    email: "sso-user@catchsecu.test", role: "editor", serviceIds: [service.id], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 600000) } });
  const { POST: options } = await import("@/app/api/v1/invitations/sso/options/route");
  const { POST: start } = await import("@/app/api/v1/invitations/sso/start/route");
  const { callbackRoute } = await ssoFlow();
  async function begin() {
    const response = await browser.wrap(start)(req("/invitations/sso/start", "", "POST", { token, providerId: f.provider.id }));
    expect(response.status).toBe(200);
    const { redirect } = await response.json();
    expect(redirect).not.toContain(token);
    const state = await db.ssoState.findUniqueOrThrow({ where: { stateHash: createHash("sha256").update(new URL(redirect).searchParams.get("state")!).digest("hex") } });
    expect(state).toMatchObject({ invitationId: invitation.id, invitationVersion: invitation.version, invitationTokenHash: tokenHash(token) });
    const authorize = await fetch(redirect, { redirect: "manual" });
    return new URL(authorize.headers.get("location")!);
  }
  return { ...f, token, service, invitation, options, start, begin, callbackRoute };
}
test("P11 초대 SSO: 토큰 보유자에게 같은 회사의 사용 가능한 공급자 라벨만 노출", async () => {
  const f = await invitationSsoFixture();
  await db.ssoProvider.create({ data: { ...f.input, tenantId: f.company.id, protocol: "oidc", name: "비활성" } });
  const other = await ownerCookie();
  await db.ssoProvider.create({ data: { ...f.input, tenantId: other.company.id, protocol: "oidc", enabled: true, preflightOk: true, name: "다른 회사" } });
  const response = await f.options(req("/invitations/sso/options", "", "POST", { token: f.token }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ providers: [{ id: f.provider.id, name: f.provider.name, protocol: "oidc" }] });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await db.ssoState.count()).toBe(0);
});
test.each(["malformed", "unknown", "expired", "revoked", "resend", "company"])("P11 초대 SSO: %s 토큰으로 공급자 목록과 시작 차단", async kind => {
  const f = await invitationSsoFixture();
  const token = kind === "malformed" ? f.invitation.id : kind === "unknown" ? opaqueToken() : f.token;
  if (kind === "expired") await db.invitation.update({ where: { id: f.invitation.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  if (kind === "revoked") await db.invitation.update({ where: { id: f.invitation.id }, data: { status: "revoked" } });
  if (kind === "resend") await db.invitation.update({ where: { id: f.invitation.id }, data: { tokenHash: tokenHash(opaqueToken()), version: { increment: 1 } } });
  if (kind === "company") await db.company.update({ where: { id: f.company.id }, data: { status: "closed" } });
  for (const route of [f.options, f.start]) {
    const result = await route(req("/invitations/sso/" + (route === f.start ? "start" : "options"), "", "POST", { token, ...(route === f.start ? { providerId: f.provider.id } : {}) }));
    expect(result.status).toBe(kind === "malformed" ? 422 : kind === "company" && route === f.start ? 403 : 410);
  }
  expect(await db.ssoState.count()).toBe(0);
});
test("P11 초대 SSO: 다른 회사 공급자로 시작하거나 외부 출처로 POST 불가", async () => {
  const f = await invitationSsoFixture(), other = await ownerCookie();
  const provider = await db.ssoProvider.create({ data: { ...f.input, tenantId: other.company.id, protocol: "oidc", enabled: true, preflightOk: true } });
  expect((await f.start(req("/invitations/sso/start", "", "POST", { token: f.token, providerId: provider.id }))).status).toBe(410);
  for (const route of [f.options, f.start]) {
    const request = req("/invitations/sso/start", "", "POST", { token: f.token, providerId: f.provider.id });
    request.headers.set("origin", "https://other.example.test");
    expect((await route(request)).status).toBe(403);
  }
  expect(await db.ssoState.count()).toBe(0);
});
test("P11 초대 SSO: 새 사용자·지정 역할·서비스 권한·수락·세션을 함께 저장", async () => {
  const f = await invitationSsoFixture(), callback = await f.begin();
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/dashboard");
  const user = await db.user.findUniqueOrThrow({ where: { email: f.invitation.email } });
  const member = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: f.company.id, userId: user.id } } });
  expect(member).toMatchObject({ role: "editor", status: "active", accessKind: "direct" });
  expect(await db.serviceGrant.count({ where: { memberId: member.id, serviceId: f.service.id } })).toBe(1);
  expect(await db.invitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).toMatchObject({ status: "accepted", acceptedBy: user.id, version: 2 });
  expect(await db.session.count({ where: { userId: user.id, activeCompanyId: f.company.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(1);
  expect((await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))).status).toBe(401);
});
test.each(["resend", "version", "expired", "legacy", "wrong-email", "unverified-email", "inviter", "service", "role"])("P11 초대 SSO: 인증 대기 중 %s 변경 시 모든 가입 변경 롤백", async kind => {
  const f = await invitationSsoFixture(), callback = await f.begin();
  if (kind === "resend") await db.invitation.update({ where: { id: f.invitation.id }, data: { tokenHash: tokenHash(opaqueToken()), version: { increment: 1 } } });
  if (kind === "version") await db.invitation.update({ where: { id: f.invitation.id }, data: { version: { increment: 1 }, role: "viewer" } });
  if (kind === "expired") await db.invitation.update({ where: { id: f.invitation.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  if (kind === "legacy") await db.ssoState.updateMany({ data: { invitationTokenHash: null, invitationVersion: null } });
  if (kind === "wrong-email") idp.codes.get(callback.searchParams.get("code")!)!.claims.email = "different@catchsecu.test";
  if (kind === "unverified-email") idp.codes.get(callback.searchParams.get("code")!)!.claims.email_verified = false;
  if (kind === "inviter") await db.invitation.update({ where: { id: f.invitation.id }, data: { invitedBy: randomUUID() } });
  if (kind === "service") await db.service.update({ where: { id: f.service.id }, data: { status: "archived" } });
  if (kind === "role") await db.invitation.update({ where: { id: f.invitation.id }, data: { role: "owner" } });
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(kind === "service" ? 404 : kind === "inviter" ? 409 : kind === "role" ? 403 : 410);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect(await db.user.findUnique({ where: { email: f.invitation.email } })).toBeNull();
  expect((await db.invitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).status).toBe("pending");
  expect(await db.auditEvent.count({ where: { action: { in: ["invitation.accepted", "sso.account_linked"] } } })).toBe(0);
});
test("P11 초대 SSO: 기존 이메일 계정 자동 연결 거부 후 로그인 초대 수락 경로 유지", async () => {
  const f = await invitationSsoFixture();
  await auth.handler(req("/auth/sign-up/email", "", "POST", { email: f.invitation.email, name: "초대된 기존 계정", password }));
  const user = await db.user.update({ where: { email: f.invitation.email }, data: { emailVerified: true } });
  const callback = await f.begin();
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("SSO_LINK_REQUIRED");
  expect(await db.account.count({ where: { userId: user.id, providerId: "sso:" + f.provider.id } })).toBe(0);
  const cookie = responseCookies(await auth.handler(req("/auth/sign-in/email", "", "POST", { email: f.invitation.email, password })));
  const { POST: accept } = await import("@/app/api/v1/invitations/[...segments]/route");
  expect((await accept(req("/invitations/accept", cookie, "POST", { token: f.token }, randomUUID()))).status).toBe(200);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedBy).toBe(user.id);
});
test("P11 초대 SSO: 서로 다른 인증 state로 동시 수락해도 한 번만 가입", async () => {
  const f = await invitationSsoFixture(), first = await f.begin(), second = await f.begin();
  const responses = await Promise.all([first, second].map(callback => f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))));
  expect(responses.map(response => response.status).sort()).toEqual([302, 410]);
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(1);
  const user = await db.user.findUniqueOrThrow({ where: { email: f.invitation.email } });
  expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
});
test("P11 초대 SSO: 기존 연결 계정의 2FA 확인 전에는 로그인 세션을 발급하지 않는다", async () => {
  const f = await ssoMfaFixture();
  const manager = await db.user.create({ data: { email: "inviter-" + randomUUID() + "@catchsecu.test", name: "초대 담당자", emailVerified: true } });
  const inviter = await db.membership.create({ data: { tenantId: f.company.id, userId: manager.id, role: "owner" } });
  await db.membership.update({ where: { id: f.ctx.member.id }, data: { status: "revoked", version: { increment: 1 } } });
  const token = opaqueToken();
  const invitation = await db.invitation.create({ data: { tenantId: f.company.id, invitedBy: inviter.id,
    email: f.email, role: "viewer", serviceIds: [], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 600000) } });
  const { POST: start } = await import("@/app/api/v1/invitations/sso/start/route");
  const started = await browser.wrap(start)(req("/invitations/sso/start", "", "POST", { token, providerId: f.provider.id }));
  expect(started.status).toBe(200);
  const authorize = await fetch((await started.json()).redirect, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  idp.codes.get(callback.searchParams.get("code")!)!.claims.email = f.email;
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/login-otp?returnTo=%2Fdashboard");
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(0);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted");
  const verified = await auth.handler(req("/auth/two-factor/verify-totp", responseCookies(response), "POST", { code: await f.code() }));
  expect(verified.status).toBe(200);
  expect(await db.session.count({ where: { userId: f.user.id, activeCompanyId: f.company.id } })).toBe(1);
});
test("P11 초대 SSO: 감사 쓰기 실패 시 사용자·계정·권한·수락·세션 원자 롤백", async () => {
  const f = await invitationSsoFixture(), callback = await f.begin();
  ssoFault.audit = true;
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(500);
  expect(await db.user.count({ where: { email: f.invitation.email } })).toBe(0);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).status).toBe("pending");
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(0);
});
test("공급자 삭제: 실제 PostgreSQL 잠금 시간 초과는 409로 안내하고 자료를 보존", async () => {
  const f = await providerRemovalFixture();
  let entered!: () => void, release!: () => void;
  const locked = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const holder = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${f.company.id} FOR UPDATE`;
    entered(); await gate;
  }, { timeout: 10000 });
  await locked;
  try {
    const response = await f.removeProvider();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONCURRENT_CHANGE");
  } finally { release(); await holder; }
  expect(await db.ssoProvider.count({ where: { id: f.provider.id } })).toBe(1);
  expect(await db.account.count({ where: { id: f.account.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_deleted", resourceId: f.provider.id } })).toBe(0);
});

async function expertReinvitationFixture(state: "active" | "expired" | "revoked" = "active") {
  const f = await invitationSsoFixture();
  const user = await db.user.create({ data: { email: f.invitation.email, name: "재초대 전문가", emailVerified: true } });
  await db.account.create({ data: { userId: user.id, providerId: "sso:" + f.provider.id, accountId: idp.issuer + "|idp-sub-1" } });
  const oldService = await db.service.create({ data: { tenantId: f.company.id, name: "이전 전문가 범위", externalName: "이전 전문가 범위" } });
  const assignment = await db.expertAssignment.create({ data: { tenantId: f.company.id, expertUserId: user.id, assignedById: f.user.id,
    status: state === "revoked" ? "revoked" : "active", revokedAt: state === "revoked" ? new Date() : null,
    createdAt: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() + (state === "expired" ? -60000 : 3600000)),
    services: { create: { serviceId: oldService.id } } } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: user.id, role: "viewer", status: "revoked",
    accessKind: "expert", expertAssignmentId: assignment.id, grants: { create: { serviceId: oldService.id, capabilities: ["service.read"] } } } });
  const otherCompany = await db.company.create({ data: { name: "다른 배정 회사", publicName: "다른 배정 회사" } });
  const otherAssignment = await db.expertAssignment.create({ data: { tenantId: otherCompany.id, expertUserId: user.id,
    assignedById: f.user.id, expiresAt: new Date(Date.now() + 3600000) } });
  return { ...f, recipient: user, oldService, assignment, member, otherAssignment };
}
test.each(["active", "expired", "revoked"] as const)("P11 전문가 재초대: %s 배정을 종료하고 초대된 직접 소속만 부여", async state => {
  const f = await expertReinvitationFixture(state), callback = await f.begin();
  const response = await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(response.status).toBe(302);
  const assignment = await db.expertAssignment.findUniqueOrThrow({ where: { id: f.assignment.id } });
  expect(assignment).toMatchObject({ status: "revoked", version: state === "revoked" ? 1 : 2 });
  expect(assignment.revokedAt).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "expert.revoked", resourceId: f.assignment.id } })).toBe(state === "revoked" ? 0 : 1);
  if (state === "revoked") expect(assignment.revokedAt).toEqual(f.assignment.revokedAt);
  expect(await db.membership.findUniqueOrThrow({ where: { id: f.member.id } })).toMatchObject({ status: "active", role: "editor", accessKind: "direct", expertAssignmentId: null, version: 2 });
  const grants = await db.serviceGrant.findMany({ where: { memberId: f.member.id } });
  expect(grants.map(grant => grant.serviceId)).toEqual([f.service.id]);
  expect(await db.expertAssignment.findUniqueOrThrow({ where: { id: f.otherAssignment.id } })).toEqual(f.otherAssignment);
  expect(await db.expertAssignmentService.count({ where: { assignmentId: f.assignment.id } })).toBe(1);
  expect(await db.session.count({ where: { userId: f.recipient.id, activeCompanyId: f.company.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(1);
  const { GET: list } = await import("@/app/api/v1/expert-assignments/route");
  const listed = await list(req("/expert-assignments?scope=mine", responseCookies(response)));
  expect(listed.status).toBe(200);
  expect((await listed.json()).items.find((item: { id: string }) => item.id === f.assignment.id)).toMatchObject({ status: "revoked", canSelect: false });
});
test("P11 전문가 재초대: 감사 실패 시 배정·소속·권한·수락을 모두 롤백", async () => {
  const f = await expertReinvitationFixture(), callback = await f.begin();
  ssoFault.audit = true;
  expect((await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))).status).toBe(500);
  expect(await db.expertAssignment.findUniqueOrThrow({ where: { id: f.assignment.id } })).toEqual(f.assignment);
  expect(await db.membership.findUniqueOrThrow({ where: { id: f.member.id } })).toEqual(f.member);
  expect((await db.serviceGrant.findMany({ where: { memberId: f.member.id } })).map(grant => grant.serviceId)).toEqual([f.oldService.id]);
  expect(await db.invitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).toMatchObject({ status: "pending", version: 1 });
  expect(await db.session.count({ where: { userId: f.recipient.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(0);
});
test("P11 전문가 재초대: 활성 전문가 소속은 초대로 덮어쓰지 않는다", async () => {
  const f = await expertReinvitationFixture();
  await db.membership.update({ where: { id: f.member.id }, data: { status: "active" } });
  const callback = await f.begin();
  expect((await f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))).status).toBe(409);
  expect(await db.expertAssignment.findUniqueOrThrow({ where: { id: f.assignment.id } })).toEqual(f.assignment);
  expect(await db.membership.findUniqueOrThrow({ where: { id: f.member.id } })).toMatchObject({ accessKind: "expert", expertAssignmentId: f.assignment.id, status: "active" });
  expect(await db.session.count({ where: { userId: f.recipient.id } })).toBe(0);
});
test("P11 전문가 재초대: 동시 수락은 한 번만 배정 종료·직접 소속 전환", async () => {
  const f = await expertReinvitationFixture(), a = await f.begin(), b = await f.begin();
  const responses = await Promise.all([a, b].map(callback => f.callbackRoute(req("/auth/sso/callback?" + callback.searchParams))));
  expect(responses.map(response => response.status).sort()).toEqual([302, 410]);
  expect(await db.expertAssignment.findUniqueOrThrow({ where: { id: f.assignment.id } })).toMatchObject({ status: "revoked", version: 2 });
  expect(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: f.invitation.id } })).toBe(1);
  expect(await db.session.count({ where: { userId: f.recipient.id } })).toBe(1);
});

test.each(["disable", "secret", "scopes"] as const)("P11 공급자 중지: 마지막 로그인 수단의 %s 변경 거부", async kind => {
  const f = await ownAccountsFixture();
  await db.account.deleteMany({ where: { userId: f.user.id, providerId: "credential" } });
  await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "same-provider-second-subject" } });
  const before = await db.ssoProvider.findUniqueOrThrow({ where: { id: f.provider.id } });
  const { updateSsoProvider } = await import("@/server/sso");
  const change = kind === "disable" ? { enabled: false } : kind === "secret" ? { clientSecret: "new-client-secret" } : { scopes: "openid email" };
  await expect(updateSsoProvider(f.ctx, f.provider.id, { version: 1, ...change }, randomUUID())).rejects.toMatchObject({ status: 409, code: "SSO_PROVIDER_LAST_LOGIN" });
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: f.provider.id } })).toEqual(before);
  expect(await db.account.count({ where: { userId: f.user.id } })).toBe(2);
  expect(await db.session.findUnique({ where: { id: f.ctx.session.id } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "sso.provider_updated", resourceId: f.provider.id } })).toBe(0);
});

test("P11 공급자 중지: 회사 간 동시 비활성화에서도 마지막 로그인 보존", async () => {
  const f = await providerRemovalFixture();
  await db.account.delete({ where: { id: f.account.id } });
  const company = await db.company.create({ data: { name: "두 번째 회사", publicName: "두 번째 회사", policy: { create: {} } } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: f.ctx.user.id, role: "owner" },
    include: { tenant: { include: { policy: true } }, grants: true, expertAssignment: { include: { services: true } } } });
  const session = await db.session.create({ data: { userId: f.ctx.user.id, activeCompanyId: company.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const second = await db.ssoProvider.create({ data: { ...f.input, tenantId: company.id, enabled: true, preflightOk: true } });
  const user = await db.user.create({ data: { name: "공통 사용자", email: randomUUID() + "@example.test", emailVerified: true } });
  for (const [tenantId, providerId] of [[f.company.id, f.provider.id], [company.id, second.id]]) {
    await db.membership.create({ data: { tenantId, userId: user.id, role: "viewer" } });
    await db.account.create({ data: { userId: user.id, providerId: "sso:" + providerId, accountId: "common-user" } });
  }
  const { updateSsoProvider } = await import("@/server/sso");
  const outcomes = await Promise.allSettled([
    updateSsoProvider(f.ctx, f.provider.id, { version: 1, enabled: false }, randomUUID()),
    updateSsoProvider({ ...f.ctx, tenantId: company.id, member, session }, second.id, { version: 1, enabled: false }, randomUUID()),
  ]);
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await db.account.count({ where: { userId: user.id } })).toBe(2);
  expect(await db.ssoProvider.count({ where: { id: { in: [f.provider.id, second.id] }, enabled: true } })).toBe(1);
});
test("P11 공급자 중지: 이름만 수정할 때는 유일한 SSO 수단도 유지", async () => {
  const f = await ownAccountsFixture();
  await db.account.deleteMany({ where: { userId: f.user.id, providerId: "credential" } });
  const { updateSsoProvider } = await import("@/server/sso");
  expect(await updateSsoProvider(f.ctx, f.provider.id, { version: 1, name: "새 표시 이름", scopes: f.input.scopes }, randomUUID()))
    .toMatchObject({ enabled: true, preflightOk: true, version: 2 });
});
test("P11 공급자 중지: 명시적 중지는 새 로그인·대기 콜백을 차단하고 기존 세션 유지", async () => {
  const f = await ownAccountsFixture();
  const { startRoute, callbackRoute } = await ssoFlow();
  const started = await startRoute(req("/auth/sso/" + f.provider.id + "?mode=login"));
  const authorize = await fetch(started.headers.get("location")!, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  const { updateSsoProvider } = await import("@/server/sso");
  expect(await updateSsoProvider(f.ctx, f.provider.id, { version: 1, enabled: false }, randomUUID())).toMatchObject({ enabled: false, version: 2 });
  expect((await startRoute(req("/auth/sso/" + f.provider.id + "?mode=login"))).status).toBe(404);
  const result = await callbackRoute(req("/auth/sso/callback?" + callback.searchParams));
  expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("SSO_CONFIGURATION_CHANGED");
  const { GET: me } = await import("@/app/api/v1/me/route");
  expect((await me(req("/me", f.cookie))).status).toBe(200);
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
});
test("P11 공급자 중지: 사전검사 실패 시 마지막 수단이어도 검증 실패 공급자는 비활성화", async () => {
  const f = await ownAccountsFixture();
  await db.account.deleteMany({ where: { userId: f.user.id, providerId: "credential" } });
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { jwksUrl: idp.issuer + "/dead-jwks" } });
  const { preflightSsoProvider } = await import("@/server/sso");
  expect(await preflightSsoProvider(f.ctx, f.provider.id, randomUUID())).toMatchObject({ enabled: false, preflightOk: false, version: 2 });
  expect(await db.session.findUnique({ where: { id: f.ctx.session.id } })).not.toBeNull();
});
test("P11 공급자 중지: 감사 실패 시 활성 상태·version·계정·세션 보존", async () => {
  const f = await ownAccountsFixture();
  ssoFault.providerUpdateAudit = true;
  const { updateSsoProvider } = await import("@/server/sso");
  await expect(updateSsoProvider(f.ctx, f.provider.id, { version: 1, enabled: false }, randomUUID())).rejects.toThrow("provider update audit fixture failure");
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: f.provider.id } })).toMatchObject({ enabled: true, version: 1 });
  expect(await db.account.findUnique({ where: { id: f.account.id } })).not.toBeNull();
  expect(await db.session.findUnique({ where: { id: f.ctx.session.id } })).not.toBeNull();
});

test.each(["login", "link"])("E1 %s 콜백은 시작 브라우저 쿠키가 없으면 취소 응답도 소비하지 않는다", async mode => {
  const f = await pendingOidc(mode);
  const { GET: rawCallback } = await import("@/app/api/v1/auth/sso/callback/route");
  const state = f.callback.searchParams.get("state")!;
  const response = await rawCallback(new Request(origin + "/api/v1/auth/sso/callback?" + new URLSearchParams({ state, error: "access_denied" })));
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("SSO_BROWSER_MISMATCH");
  expect(await db.ssoState.count()).toBe(1);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
});

test.each(["other", "duplicate", "malformed", "legacy"])("E1 OIDC %s 브라우저 결합 거절은 state와 인증 코드를 소비하지 않는다", async variant => {
  const f = await pendingOidc();
  const { GET: rawCallback } = await import("@/app/api/v1/auth/sso/callback/route");
  const state = await db.ssoState.findFirstOrThrow();
  const bindingName = browser.cookie().split("=", 1)[0];
  const cookie = variant === "other" ? bindingName + "=" + "x".repeat(43)
    : variant === "duplicate" ? browser.cookie() + "; " + browser.cookie()
    : variant === "malformed" ? bindingName + "=invalid" : browser.cookie();
  if (variant === "legacy") await db.ssoState.update({ where: { id: state.id }, data: { browserHash: null } });
  const response = await rawCallback(new Request(f.callback, { headers: { cookie } }));
  expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("SSO_BROWSER_MISMATCH");
  expect(await db.ssoState.count({ where: { id: state.id } })).toBe(1);
  expect(idp.codes.has(f.callback.searchParams.get("code")!)).toBe(true);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(0);
  if (variant !== "legacy") expect((await f.callbackRoute(new Request(f.callback))).status).toBe(302);
});
test("E1 같은 브라우저의 두 OIDC 시작과 콜백은 서로의 쿠키를 지우지 않는다", async () => {
  const first = await pendingOidc(), firstCookie = browser.cookie();
  const firstState = await db.ssoState.findFirstOrThrow();
  const secondStart = await first.startRoute(req("/auth/sso/" + first.provider.id));
  expect(browser.cookie()).toBe(firstCookie);
  const secondAuth = await fetch(secondStart.headers.get("location")!, { redirect: "manual" });
  const secondCallback = new URL(secondAuth.headers.get("location")!);
  const states = await db.ssoState.findMany();
  expect(states).toHaveLength(2); expect(new Set(states.map(s => s.browserHash)).size).toBe(1);
  expect(new Set(states.map(s => s.nonceHash)).size).toBe(2);
  expect(firstState.browserHash).not.toBeNull();
  const firstDone = await first.callbackRoute(new Request(first.callback));
  const secondDone = await first.callbackRoute(new Request(secondCallback));
  expect(firstDone.status).toBe(302); expect(secondDone.status).toBe(302);
  for (const response of [firstDone, secondDone]) expect(response.headers.getSetCookie().some(c => c.startsWith("catchsecu-sso-browser-local-"))).toBe(false);
  expect(await db.ssoState.count()).toBe(0);
});

test("E1 쿠키 없는 두 OIDC 동시 시작은 양쪽 실제 PKCE 콜백이 성공한다", async () => {
  const f = await providerSettingsFixture();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true } });
  const { GET: start } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  const { GET: callback } = await import("@/app/api/v1/auth/sso/callback/route");
  const responses = await Promise.all([1, 2].map(() => start(new Request(origin + "/api/v1/auth/sso/" + f.provider.id))));
  for (const response of responses) { expect(response.status).toBe(302); browser.capture(response); }
  const states = await db.ssoState.findMany();
  expect(new Set(states.map(s => s.browserHash)).size).toBe(2);
  expect(new Set(states.map(s => s.nonceHash)).size).toBe(2);
  for (const response of responses) {
    const authorize = await fetch(response.headers.get("location")!, { redirect: "manual" });
    expect((await callback(new Request(authorize.headers.get("location")!, { headers: { cookie: browser.cookie() } }))).status).toBe(302);
  }
  expect(await db.ssoState.count()).toBe(0);
  expect(await db.account.count({ where: { providerId: "sso:" + f.provider.id } })).toBe(1);
});
