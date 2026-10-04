import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { POST as migrate } from "@/app/api/v1/migration/legacy/route";
const database = new URL(env.DATABASE_URL);
if (!/^\/catchsecu_test/.test(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Legacy-migration fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Legacy-import-test-only-password!123";
const tenantA = randomUUID(), tenantB = randomUUID();
const cookies: Record<string, string> = {}, users: Record<string, string> = {};
async function join(name: string, tenantId: string, role: "owner" | "viewer") {
  const email = name + "@legacy-import.local.test";
  expect((await auth.handler(new Request(origin + "/api/v1/auth/sign-up/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name, email, password }) }))).status).toBe(200);
  const row = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId, userId: row.id, role } });
  const login = await auth.handler(new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  expect(login.status).toBe(200);
  cookies[name] = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  users[name] = row.id;
}
async function selectCompany(name: string, tenantId: string) {
  const me = await db.user.findUniqueOrThrow({ where: { id: users[name] } });
  const session = await db.session.findFirstOrThrow({ where: { userId: me.id }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: tenantId } });
}
function call(name: string, payload: unknown) {
  return migrate(new Request(origin + "/api/v1/migration/legacy", { method: "POST",
    headers: { origin, "content-type": "application/json", cookie: cookies[name] }, body: JSON.stringify(payload) }));
}
const sections = (profile?: Record<string, unknown>, company?: Record<string, unknown>, extra?: Record<string, Record<string, unknown>>) =>
  ({ ...(profile ? { profile } : {}), ...(company ? { company } : {}), ...(extra ?? {}) });
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: tenantA, name: "이관 회사 A", publicName: "A", policy: { create: {} } } });
  await db.company.create({ data: { id: tenantB, name: "이관 회사 B", publicName: "B", policy: { create: {} } } });
  await join("owner", tenantA, "owner");
  await join("viewer", tenantA, "viewer");
  await selectCompany("owner", tenantA); await selectCompany("viewer", tenantA);
});
afterAll(async () => { await db.$disconnect(); });
describe("legacy localStorage migration", () => {
  test("dry-run plans changes without writing or auditing", async () => {
    const res = await call("owner", { dryRun: true, sections: sections({ name: "이관 이름", department: "보안팀" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true); expect(body.applied).toBe(false);
    expect(body.profile.changes.map((c: { field: string }) => c.field).sort()).toEqual(["department", "name"]);
    const user = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    expect(user.name).not.toBe("이관 이름");
    expect(await db.auditEvent.count({ where: { action: "migration.legacy_imported" } })).toBe(0);
  });
  test("commit applies profile+company fields in one transaction with audit", async () => {
    const res = await call("owner", { dryRun: false, sections: sections(
      { name: "이관 이름", department: "보안팀" },
      { address: "서울시 테스트로 1", billingEmail: "tax@example.com" }) });
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(body.profile.changes.length).toBe(2); expect(body.company.changes.length).toBe(2);
    const user = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    expect(user.name).toBe("이관 이름"); expect(user.department).toBe("보안팀");
    const company = await db.company.findUniqueOrThrow({ where: { id: tenantA } });
    expect(company.address).toBe("서울시 테스트로 1"); expect(company.billingEmail).toBe("tax@example.com");
    expect(await db.auditEvent.count({ where: { action: "migration.legacy_imported", tenantId: tenantA } })).toBe(1);
    const other = await db.company.findUniqueOrThrow({ where: { id: tenantB } });
    expect(other.address).toBe("");
  });
  test("identical re-import reports unchanged and does not bump versions", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    const res = await call("owner", { dryRun: false, sections: sections({ name: "이관 이름" }) });
    const body = await res.json();
    expect(body.profile.unchanged).toEqual(["name"]); expect(body.profile.changes).toEqual([]);
    const after = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    expect(after.version).toBe(before.version);
  });
  test("invalid values are quarantined while valid siblings still import", async () => {
    const res = await call("owner", { dryRun: false, sections: sections(
      { jobTitle: "이관 직책", name: "x".repeat(200) },
      { businessNo: "12-34", billingContactName: "세금 담당" }) });
    const body = await res.json();
    expect(body.profile.quarantined[0].field).toBe("name");
    expect(body.company.quarantined[0].field).toBe("businessNo");
    const user = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    expect(user.jobTitle).toBe("이관 직책");
    const company = await db.company.findUniqueOrThrow({ where: { id: tenantA } });
    expect(company.billingContactName).toBe("세금 담당"); expect(company.businessNo).toBe("");
  });
  test("secret-like keys are rejected and never persisted", async () => {
    const res = await call("owner", { dryRun: false, sections: sections(
      { password: "leaked-password", token: "abc", phone: "010-0000-0000" }) });
    const body = await res.json();
    expect(body.rejectedSecrets.map((r: { field: string }) => r.field).sort()).toEqual(["password", "token"]);
    const user = await db.user.findUniqueOrThrow({ where: { id: users.owner } });
    expect(user.phone).toBe("010-0000-0000");
  });
  test("unknown fields and sections are reported, not stored", async () => {
    const res = await call("owner", { dryRun: true, sections: sections({ nickname: "x" }, undefined, { "mg-mail-draft": { title: "t" } }) });
    const body = await res.json();
    expect(body.profile.quarantined[0].field).toBe("nickname");
    expect(body.unknownSections).toEqual(["mg-mail-draft"]);
  });
  test("viewer without company.manage gets company section skipped, profile still applies", async () => {
    const res = await call("viewer", { dryRun: false, sections: sections({ name: "뷰어 이름" }, { address: "침입 주소" }) });
    const body = await res.json();
    expect(body.company.status).toBe("skipped");
    const user = await db.user.findUniqueOrThrow({ where: { id: users.viewer } });
    expect(user.name).toBe("뷰어 이름");
    const company = await db.company.findUniqueOrThrow({ where: { id: tenantA } });
    expect(company.address).toBe("서울시 테스트로 1");
  });
  test("unauthenticated request is rejected", async () => {
    const res = await migrate(new Request(origin + "/api/v1/migration/legacy", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ dryRun: true, sections: {} }) }));
    expect(res.status).toBe(401);
  });
});
