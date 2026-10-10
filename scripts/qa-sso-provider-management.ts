import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/server/db";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3156";
const target = new URL(base), database = new URL(process.env.DATABASE_URL ?? "");
if (target.hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["127.0.0.1", "localhost"].includes(database.hostname)) throw new Error("Local dedicated QA server and dev DB required");
const root = resolve("docs/qa/P11-T03/revalidation"), fixturePath = resolve(".local/qa-sso-provider-management.json");
type Fixture = { email: string; password: string; userId: string; tenantId: string; providerId?: string; expectedHash?: string };
let fixture: Fixture;
let cookie = "";
const results: { action: string; status: number }[] = [];
async function request(path: string, method = "GET", input?: unknown, expected = 200) {
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual",
    headers: { origin: base, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const parsed = await response.json().catch(() => null);
  assert.equal(response.status, expected, method + " " + path + ": " + (parsed?.error?.code ?? "unexpected status"));
  results.push({ action: method + " " + path, status: response.status });
  return { response, parsed };
}
async function login() {
  const { response } = await request("/auth/sign-in/email", "POST", { email: fixture.email, password: fixture.password });
  cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
  assert.ok(cookie);
}
function saveFixture() { writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 }); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function providerSnapshot(id: string) {
  const row = await db.ssoProvider.findUniqueOrThrow({ where: { id } });
  assert.equal(row.tenantId, fixture.tenantId);
  return { id: row.id, tenantId: row.tenantId, name: row.name, enabled: row.enabled, preflightOk: row.preflightOk,
    version: row.version, issuer: row.issuer, certificateHash: digest(row.idpCert), secretCipherHash: digest(row.clientSecretCipher) };
}
try {
  mkdirSync(root, { recursive: true });
  if (process.argv.includes("--verify-restart")) {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    await login();
    const list = (await request("/security/sso")).parsed;
    assert.ok(list.items.some((item: { id: string }) => item.id === fixture.providerId));
    const snapshot = await providerSnapshot(fixture.providerId!);
    assert.equal(digest(snapshot), fixture.expectedHash);
    await request("/auth/sign-out", "POST", {});
    writeFileSync(resolve(root, "http-restart.json"), JSON.stringify({ base, at: new Date().toISOString(), results,
      independentDatabaseSnapshot: snapshot, hashMatches: true, existingSessionContinuityTested: false }, null, 2));
    console.log(JSON.stringify({ phase: "restart", checks: results.length, hashMatches: true }));
  } else {
    if (existsSync(fixturePath)) throw new Error("QA fixture already exists; use --verify-restart or a reviewed new fixture path");
    const suffix = randomUUID();
    fixture = { email: "sso-management-" + suffix + "@example.test", password: randomBytes(24).toString("base64url") + "!aA1", userId: "", tenantId: "" };
    await request("/auth/sign-up/email", "POST", { email: fixture.email, password: fixture.password, name: "SSO 설정 검증 관리자" });
    const user = await db.user.update({ where: { email: fixture.email }, data: { emailVerified: true } });
    const company = await db.company.create({ data: { name: "SSO 설정 QA " + suffix, publicName: "SSO 설정 QA",
      policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: user.id, role: "owner" } } } });
    fixture.userId = user.id; fixture.tenantId = company.id; saveFixture();
    await login();
    const certPath = resolve(".local/qa-sso-provider-cert.pem"), keyPath = resolve(".local/qa-sso-provider-key.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
      "-days", "2", "-nodes", "-subj", "/CN=catchsecu-local-management-qa"], { stdio: "pipe" });
    const certificate = readFileSync(certPath, "utf8");
    const input = { tenantId: fixture.tenantId, protocol: "saml", name: "사전검사 QA", issuer: "https://qa-idp.example.test",
      clientId: "qa-sp", authorizationUrl: "https://qa-idp.example.test/sso", idpCert: certificate };
    const invalidCertificate = "-----BEGIN CERTIFICATE-----\n" + "QUJD".repeat(40) + "\n-----END CERTIFICATE-----";
    const invalid = (await request("/security/sso", "POST", { ...input, name: "미통과 QA", idpCert: invalidCertificate }, 201)).parsed;
    assert.equal(invalid.preflightOk, false);
    for (const extra of [{ name: "우회 이름" }, { clientSecret: "qa-only-replacement" }, { scopes: "openid email" }]) {
      const result = await request("/security/sso/" + invalid.id, "PATCH", { version: 1, enabled: true, ...extra }, 409);
      assert.equal(result.parsed.error.code, "PREFLIGHT_REQUIRED");
    }
    await request("/security/sso/" + invalid.id, "DELETE", { version: 1 });
    assert.equal(await db.ssoProvider.count({ where: { id: invalid.id } }), 0);
    const created = (await request("/security/sso", "POST", input, 201)).parsed;
    assert.equal(created.preflightOk, true);
    const id = created.id;
    await request("/security/sso/" + id, "PATCH", { version: 1, enabled: true });
    const rotated = (await request("/security/sso/" + id, "PATCH", { version: 2, clientSecret: "qa-secret-rotated" })).parsed;
    assert.equal(rotated.enabled, false); assert.equal(rotated.preflightOk, false);
    await request("/security/sso/" + id, "PATCH", { version: 3, enabled: true, name: "우회" }, 409);
    const checked = (await request("/security/sso/" + id + "/preflight", "POST")).parsed;
    assert.equal(checked.preflightOk, true); assert.equal(checked.enabled, false);
    await request("/security/sso/" + id, "PATCH", { version: 4, enabled: true });
    await request("/security/sso/" + id, "PATCH", { version: 4, name: "이전 버전" }, 409);
    await request("/security/sso/" + id, "PATCH", { version: 5, name: "SSO 재시작 확인" });
    const list = (await request("/security/sso")).parsed;
    assert.equal(list.items.length, 1);
    assert.equal(JSON.stringify(list).includes("qa-secret-rotated"), false);
    const snapshot = await providerSnapshot(id);
    assert.equal(snapshot.version, 6); assert.equal(snapshot.enabled, true);
    fixture.providerId = id; fixture.expectedHash = digest(snapshot); saveFixture();
    const audit = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId, resourceId: id }, select: { action: true, detail: true } });
    assert.equal(audit.length, 6);
    await request("/auth/sign-out", "POST", {});
    await request("/security/sso", "GET", undefined, 401);
    writeFileSync(resolve(root, "http.json"), JSON.stringify({ base, at: new Date().toISOString(), results,
      independentDatabaseSnapshot: snapshot, audit, externalIdpTested: false, browserTested: false }, null, 2));
    console.log(JSON.stringify({ phase: "management", checks: results.length, auditEvents: audit.length, externalIdpTested: false }));
  }
} finally { await db.$disconnect(); }
