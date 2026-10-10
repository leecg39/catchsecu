import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const directory = ".local/rea-fullstack/sso/provider-context", file = directory + "/fixture.json", output = "docs/qa/R07-T04/provider-context";
const origin = new URL(env.BETTER_AUTH_URL).origin, mode = process.argv[2], database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["127.0.0.1", "localhost"].includes(database.hostname));
type Fixture = { a: string; b: string; userId: string; email: string; password: string; cookie: string; providerId: string; hash?: string };
let fixture: Fixture;
const checks: { action: string; status: number; code?: string }[] = [];
const save = () => writeFile(file, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
async function request(action: string, path: string, expected: number, input?: unknown, method = input === undefined ? "GET" : "POST") {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie: fixture.cookie,
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json().catch(() => null); checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + " " + (value?.error?.code ?? "")); return { response, value };
}
async function snapshot() {
  return db.$transaction(async tx => ({
    companies: await tx.company.findMany({ where: { id: { in: [fixture.a, fixture.b] } }, orderBy: { id: "asc" } }),
    providers: await tx.ssoProvider.findMany({ where: { tenantId: { in: [fixture.a, fixture.b] } }, orderBy: { id: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: { in: [fixture.a, fixture.b] } }, orderBy: { id: "asc" } }),
    members: await tx.membership.findMany({ where: { userId: fixture.userId }, orderBy: { id: "asc" } }),
    sessions: await tx.session.findMany({ where: { userId: fixture.userId }, orderBy: { id: "asc" }, select: { id: true, userId: true, activeCompanyId: true, activeServiceId: true, expiresAt: true } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true });
  if (mode === "prepare") {
    assert(!await access(file).then(() => true, () => false), "Fresh fixture only");
    fixture = { a: "", b: "", userId: "", email: "sso-context-" + randomUUID() + "@example.test", password: "Context-QA!" + randomUUID(), cookie: "", providerId: "" }; await save();
    await request("소유자 가입", "/auth/sign-up/email", 200, { email: fixture.email, password: fixture.password, name: "SSO 문맥 QA" });
    fixture.userId = (await db.user.update({ where: { email: fixture.email }, data: { emailVerified: true } })).id;
    for (const key of ["a", "b"] as const) fixture[key] = (await db.company.create({ data: { name: "SSO 문맥 시험 " + key.toUpperCase(), publicName: "SSO 문맥 " + key,
      policy: { create: { passwordMonths: 0, sessionMinutes: 240 } }, memberships: { create: { userId: fixture.userId, role: "owner" } } } })).id;
    await save(); const signed = await request("소유자 로그인", "/auth/sign-in/email", 200, { email: fixture.email, password: fixture.password });
    fixture.cookie = signed.response.headers.getSetCookie().map(v => v.split(";", 1)[0]).join("; "); await save();
    await request("A 회사 선택", "/context", 200, { companyId: fixture.a });
    const oidc = (await request("A OIDC 편집용 공급자 생성", "/security/sso", 201, { tenantId: fixture.a, name: "문맥 시험 OIDC", protocol: "oidc", issuer: "https://127.0.0.1:3444",
      clientId: "context-qa", authorizationUrl: "https://127.0.0.1:3444/authorize", tokenUrl: "https://127.0.0.1:3444/token", jwksUrl: "https://127.0.0.1:3444/jwks", scopes: "openid email" })).value;
    fixture.providerId = oidc.id; await save();
    for (let i = 1; i <= 11; i++) await request("A 목록 공급자 " + i, "/security/sso", 201, { tenantId: fixture.a, protocol: "gpki", name: "문맥 시험 기관 " + String(i).padStart(2, "0") });
    await request("다른 탭과 같은 공유 세션 B 전환", "/context", 200, { companyId: fixture.b });
    const before = await db.auditEvent.count({ where: { action: "sso.provider_created", tenantId: { in: [fixture.a, fixture.b] } } });
    await request("회사 누락 생성 거절", "/security/sso", 422, { protocol: "gpki", name: "회사 누락" });
    const rejected = (await request("A 입력을 B에서 생성 거절", "/security/sso", 403, { tenantId: fixture.a, protocol: "gpki", name: "잘못된 회사" })).value;
    assert.equal(rejected.error.code, "COMPANY_CHANGED");
    await request("A 입력을 B에서 수정 거절", "/security/sso/" + fixture.providerId, 403, { tenantId: fixture.a, version: oidc.version, name: "틀린 회사 수정" }, "PATCH");
    assert.equal(await db.ssoProvider.count({ where: { tenantId: fixture.b } }), 0);
    assert.equal(await db.auditEvent.count({ where: { action: "sso.provider_created", tenantId: { in: [fixture.a, fixture.b] } } }), before);
    const b = (await request("B 목록 회사 표시", "/security/sso", 200)).value; assert.equal(b.tenantId, fixture.b);
    await request("B 명시 생성", "/security/sso", 201, { tenantId: fixture.b, protocol: "gpki", name: "B 회사 공급자" });
    await request("A 회사 복귀", "/context", 200, { companyId: fixture.a });
    const a = (await request("A 목록 재조회", "/security/sso", 200)).value; assert.equal(a.tenantId, fixture.a); assert.equal(a.items.length, 12);
    await writeFile(output + "/http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, actualHttpChecks: checks.length,
      a: fixture.a, b: fixture.b, providerId: fixture.providerId, providersA: 12, providersB: 1,
      setup: "Fresh owner email verification and two companies explicitly inserted; provider operations use actual production HTTP." }, null, 2) + "\n");
    console.log(JSON.stringify({ actualHttpChecks: checks.length, passed: true, providersA: 12, providersB: 1 }));
  } else {
    fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
    assert(!fixture.hash || ["verify", "restart"].includes(mode), "Frozen fixture cannot be mutated");
    if (mode === "conflict") {
      const row = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
      const changed = (await request("별도 세션에서 공급자 수정", "/security/sso/" + row.id, 200, { tenantId: fixture.a, version: row.version, name: "서버에서 바꾼 OIDC 이름" }, "PATCH")).value;
      console.log(JSON.stringify({ version: changed.version }));
    } else if (mode === "hold") {
      await unlink(directory + "/release").catch(() => {});
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${fixture.a} FOR UPDATE`;
        console.log(JSON.stringify({ lockHeld: true, company: "QA A", deadlineSeconds: 25 }));
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline && !await access(directory + "/release").then(() => true, () => false)) await new Promise(done => setTimeout(done, 100));
      }, { timeout: 30000 });
      console.log(JSON.stringify({ released: true }));
    } else {
      assert(["freeze", "verify", "restart"].includes(mode));
      if (mode === "restart") await request("재시작 공급자 목록", "/security/sso", 200);
      const rows = await snapshot(), hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
      if (mode === "freeze") { fixture.hash = hash; await save(); }
      assert.equal(hash, fixture.hash);
      const report = { checkedAt: new Date().toISOString(), matched: true, hash, providers: rows.providers.length, audits: rows.audits.length, sessions: rows.sessions.length, checks };
      await writeFile(output + "/" + mode + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    }
  }
} catch (error) {
  await writeFile(output + "/failed-" + mode + ".json", JSON.stringify({ checks, message: error instanceof Error ? error.message : "failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
