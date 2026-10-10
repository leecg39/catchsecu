import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const folder = ".local/rea-fullstack/sso/outbound", file = folder + "/http-fixture.json", output = "docs/qa/R07-T02/outbound";
const mode = process.argv[2], origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local development DB only");
type Fixture = { companyId: string; userId: string; email: string; password: string; cookie: string; hash?: string };
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const checks: { action: string; status: number; code?: string }[] = [];
function check(v: unknown, why: string): asserts v { if (!v) throw new Error("QA assertion: " + why); }
async function request(action: string, path: string, status: number, input?: unknown, cookie = "", method = input === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json().catch(() => null);
  checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
  check(response.status === status, action + " expected " + status + " got " + response.status); return { response, value };
}
async function snapshot(f: Fixture) {
  return db.$transaction(async tx => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: f.companyId } }),
    providers: await tx.ssoProvider.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    states: await tx.ssoState.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    audit: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    members: await tx.membership.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    sessions: await tx.session.findMany({ where: { userId: f.userId }, orderBy: { id: "asc" }, select: { id: true, userId: true, activeCompanyId: true, activeServiceId: true, expiresAt: true } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(folder, { recursive: true }); await mkdir(output, { recursive: true });
  if (mode === "http") {
    check(!await access(file).then(() => true, () => false), "fresh fixture required");
    const f: Fixture = { companyId: "", userId: "", email: "outbound-" + randomUUID() + "@example.test", password: "Outbound-QA!" + randomUUID(), cookie: "" };
    const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await save();
    await request("시험 소유자 가입", "/api/v1/auth/sign-up/email", 200, { name: "SSO 통신 QA", email: f.email, password: f.password });
    f.userId = (await db.user.update({ where: { email: f.email }, data: { emailVerified: true } })).id;
    f.companyId = (await db.company.create({ data: { name: "REA SSO 통신 검증", publicName: "QA 통신", policy: { create: { passwordMonths: 0, sessionMinutes: 240 } },
      memberships: { create: { userId: f.userId, role: "owner" } } } })).id; await save();
    const login = await request("시험 소유자 로그인", "/api/v1/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); await save();
    const tls = JSON.parse(await readFile(folder + "/latest.json", "utf8"));
    let tcpConnections = 0, idpRequests = 0;
    const idp = createServer({ key: await readFile(tls.directory + "/server-key.pem"), cert: await readFile(tls.directory + "/server.pem") },
      (_request, response) => { idpRequests++; response.setHeader("content-type", "application/json"); response.end('{"keys":[{"kid":"should-not-be-fetched"}]}'); });
    idp.on("connection", () => tcpConnections++);
    await new Promise<void>(done => idp.listen(0, "127.0.0.1", done));
    const port = (idp.address() as { port: number }).port;
    try {
      for (const host of ["127.0.0.1", "localhost"]) {
        const address = "https://" + host + ":" + port, name = "차단된 시험 IdP " + host;
        const created = (await request(host + " 공급자 생성/안전한 사전검사", "/api/v1/security/sso", 201,
          { tenantId: f.companyId, name, protocol: "oidc", issuer: address, clientId: "qa-outbound", authorizationUrl: address + "/authorize", tokenUrl: address + "/token", jwksUrl: address + "/jwks", scopes: "openid email" }, f.cookie)).value;
        check(!created.enabled && !created.preflightOk && created.preflightDetail.includes("공개 인터넷"), "private target rejected safely");
        await request(host + " 검사 실패 공급자 활성화 거절", "/api/v1/security/sso/" + created.id, 409, { version: created.version, enabled: true }, f.cookie, "PATCH");
        const checked = (await request(host + " 재검사도 연결 전 거절", "/api/v1/security/sso/" + created.id + "/preflight", 200, {}, f.cookie)).value;
        check(!checked.preflightOk && !checked.enabled && checked.preflightDetail.includes("공개 인터넷"), "recheck still denied");
      }
      const listed = (await request("검사 결과 목록 조회", "/api/v1/security/sso", 200, undefined, f.cookie)).value;
      check(listed.items.length === 2 && listed.items.every((p: { enabled: boolean; preflightOk: boolean }) => !p.enabled && !p.preflightOk), "safe management state");
      check(tcpConnections === 0 && idpRequests === 0, "blocked before any connection to controlled target");
      const report = { checkedAt: new Date().toISOString(), actualHttpChecks: checks.length, checks, controlledTargetTcpConnections: tcpConnections,
        controlledTargetHttpRequests: idpRequests, productionBuild: true, providers: listed.items.map((p: { id: string; version: number; preflightDetail: string }) => ({ id: p.id, version: p.version, detail: p.preflightDetail })),
        fixtureSetup: "Owner verification and company explicitly inserted; provider operations use actual application HTTP; target is our isolated local TLS server.", externalIdpVerified: false };
      await writeFile(output + "/http.json", JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ passed: true, actualHttpChecks: checks.length, controlledTargetTcpConnections: tcpConnections }));
    } finally { idp.closeAllConnections(); await new Promise<void>(done => idp.close(() => done())); }
  } else {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture;
    check(!f.hash || ["verify", "restart"].includes(mode), "frozen fixture is read only");
    if (mode === "restart") await request("서버 재시작 뒤 공급자 조회", "/api/v1/security/sso", 200, undefined, f.cookie);
    check(["freeze", "verify", "restart"].includes(mode), "unknown mode");
    const rows = await snapshot(f), hash = digest(rows);
    if (mode === "freeze") { f.hash = hash; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); }
    check(f.hash === hash, "frozen relational rows unchanged");
    const report = { checkedAt: new Date().toISOString(), matched: true, stateHash: hash, providers: rows.providers.length,
      states: rows.states.length, audits: rows.audit.length, sessions: rows.sessions.length, actualHttpChecks: checks.length, snapshot: "RepeatableRead; session token/updatedAt omitted" };
    await writeFile(output + "/" + mode + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  }
} catch (error) {
  await writeFile(output + "/http-failed-" + mode + ".json", JSON.stringify({ checks, message: error instanceof Error ? error.message : "failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
