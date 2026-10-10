import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const mode = process.argv[2], root = ".local/rea-fullstack/sso", privatePath = root + "/enforcement-http.json";
const output = "docs/qa/R07-T04/policy-enforcement", origin = new URL(env.BETTER_AUTH_URL).origin;
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local development DB required");
type Fixture = { userId: string; companyId: string; otherCompanyId: string; providerId: string; email: string; password: string; cookie: string; hash?: string };
const checks: { action: string; status: number; code?: string }[] = [];
function check(value: unknown, label: string): asserts value { if (!value) throw new Error("QA assertion failed: " + label); }
async function snapshot(f: Fixture) {
  const tenantIds = [f.companyId, f.otherCompanyId];
  return {
    policies: await db.ssoLoginPolicy.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { tenantId: "asc" } }),
    members: await db.membership.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true, tenantId: true, role: true, status: true, version: true }, orderBy: { id: "asc" } }),
    sessions: await db.session.findMany({ where: { userId: f.userId }, select: { id: true, activeCompanyId: true, activeServiceId: true, createdAt: true, expiresAt: true }, orderBy: { id: "asc" } }),
    proofCount: await db.ssoSessionProof.count({ where: { userId: f.userId } }),
    audit: await db.auditEvent.findMany({ where: { OR: [{ actorId: f.userId }, { tenantId: { in: tenantIds } }] }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } }),
  };
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  await mkdir(output, { recursive: true });
  if (mode === "verify") {
    const f = JSON.parse(await readFile(privatePath, "utf8")) as Fixture, state = await snapshot(f);
    check(f.hash === digest(state), "frozen fixture unchanged");
    const report = { checkedAt: new Date().toISOString(), stateHash: f.hash, matched: true, sessions: state.sessions.length,
      proofCount: state.proofCount, policies: state.policies.map(p => ({ mode: p.mode, version: p.version })), auditCount: state.audit.length };
    await writeFile(output + "/verified.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else if (mode === "http") {
    if (await access(privatePath).then(() => true, () => false)) throw new Error("Consumptive fixture already exists; use verify");
    check((await fetch(origin + "/login")).status === 200, "server readiness");
    await mkdir(root, { recursive: true });
    const f: Fixture = { userId: "", companyId: "", otherCompanyId: "", providerId: "", cookie: "",
      email: `rea-enforcement-${randomUUID()}@example.test`, password: "Rea-enforcement!" + randomUUID() };
    const save = () => writeFile(privatePath, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
    await save();
    async function request(action: string, path: string, status: number, input?: unknown) {
      const response = await fetch(origin + "/api/v1" + path, { method: input === undefined ? "GET" : "POST", redirect: "manual",
        headers: { origin, cookie: f.cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const value = await response.clone().json().catch(() => null);
      checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
      check(response.status === status, `${action}: expected ${status}, received ${response.status}`);
      return { response, value };
    }
    await request("실제 이메일 계정 생성", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "SSO 정책 검증" });
    const user = await db.user.update({ where: { email: f.email }, data: { emailVerified: true } }); f.userId = user.id;
    // Explicit synthetic setup: policy writer and official IdP preflight are NOT exercised here.
    const company = await db.company.create({ data: { name: "REA SSO 제한 회사", publicName: "QA 제한",
      policy: { create: { sessionMinutes: 240 } }, memberships: { create: { userId: user.id, role: "owner" } },
      services: { create: { name: "제한된 업무 서비스", externalName: "QA" } } } }); f.companyId = company.id;
    const other = await db.company.create({ data: { name: "REA SSO 복구 회사", publicName: "QA 복구",
      policy: { create: { sessionMinutes: 240 } }, memberships: { create: { userId: user.id, role: "owner" } },
      services: { create: { name: "허용된 업무 서비스", externalName: "QA" } } } }); f.otherCompanyId = other.id;
    const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "QA Google 설정 · 외부 인증 미검증", protocol: "oidc",
      issuer: "https://accounts.google.com", clientId: "synthetic-enforcement-client",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", enabled: true, preflightOk: true } }); f.providerId = provider.id;
    await save();
    const login = await request("비밀번호 로그인", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); await save();
    const initial = await request("NONE 회사 업무 문맥", "/context", 200); check(initial.value.services.length === 1, "initial service");
    await db.ssoLoginPolicy.create({ data: { tenantId: company.id, mode: "GOOGLE" } });
    await request("제한 후 회사 상세 차단", "/companies/" + company.id, 403);
    const restricted = await request("SSO 제한 복구 문맥", "/context", 200);
    check(restricted.value.ssoLogin.required && restricted.value.services.length === 0 && restricted.value.capabilities.length === 0, "empty business context");
    await request("내 계정 복구 접근", "/me", 200);
    const accounts = await request("복구용 SSO 목록", "/me/sso-accounts", 200);
    check(accounts.value.loginPolicy === "GOOGLE" && accounts.value.providers.length === 1 && accounts.value.providers[0].available, "allowed recovery provider");
    check(!JSON.stringify(accounts.value).includes("synthetic-enforcement-client"), "client configuration redacted");
    const companies = await request("회사 상세 목록의 제한 회사 제외", "/companies", 200);
    check(companies.value.items.length === 1 && companies.value.items[0].id === other.id && companies.value.blockedTotal === 1, "filtered sensitive company rows");
    const selected = await request("허용 회사 전환", "/context", 200, { companyId: other.id });
    check(selected.value.services.length === 1 && !selected.value.ssoLogin.required, "allowed company service");
    const returned = await request("제한 회사 복구 선택", "/context", 200, { companyId: company.id });
    check(returned.value.ssoLogin.required && returned.value.serviceId === null && returned.value.capabilities.length === 0, "restricted selection");
    await request("보안 관리 API 차단", "/security/sso", 403);
    const started = await request("허용된 SSO 연결 시작만 확인", "/auth/sso/" + provider.id + "?mode=link", 302);
    check(new URL(started.response.headers.get("location")!).origin === "https://accounts.google.com", "redirect target");
    // Never follow the synthetic client redirect to the real provider.
    const page = await fetch(origin + "/dashboard", { headers: { cookie: f.cookie }, redirect: "manual" });
    checks.push({ action: "업무 페이지의 복구 화면 이동", status: page.status });
    check(page.status === 307 && page.headers.get("location") === "/access-not-allow", "page recovery redirect");
    const state = await snapshot(f); f.hash = digest(state); await save();
    const report = { checkedAt: new Date().toISOString(), actualHttpChecks: checks.length, checks, stateHash: f.hash,
      policyWriteApiVerified: false, policySetup: "DB fixture", providerSetup: "synthetic official endpoint configuration; no preflight network or external login",
      externalIdpVerified: false, proofCount: state.proofCount, auditCount: state.audit.length };
    await writeFile(output + "/http.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ actualHttpChecks: checks.length, stateHash: f.hash, proofCount: state.proofCount }));
  } else throw new Error("Use http or verify");
} catch (error) {
  await writeFile(output + "/failed.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks,
    message: error instanceof Error ? error.message : "QA failed" }, null, 2) + "\n");
  throw error;
} finally { await db.$disconnect(); }
