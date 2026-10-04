import { createHash, generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
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
const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/jwks.json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); return; }
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
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
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
  return { cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), company, user, email };
}
beforeEach(async () => {
  idp.codes.clear(); idp.lastAuth = null; idp.failToken = null; idp.wrongKey = false;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE');
});
afterAll(async () => { server.close(); await db.$disconnect(); });
server.listen(0, "127.0.0.1");

async function ssoFlow() {
  const { GET: startRoute } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  const { GET: callbackRoute } = await import("@/app/api/v1/auth/sso/callback/route");
  const { POST: createProvider, GET: listProviders } = await import("@/app/api/v1/security/sso/route");
  const { PATCH: patchProvider } = await import("@/app/api/v1/security/sso/[id]/route");
  return { startRoute, callbackRoute, createProvider, listProviders, patchProvider };
}

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
  const provider = await created.json();
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
