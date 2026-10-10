import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
const privateDir = ".local/rea-fullstack/sso", fixturePath = privateDir + "/fixture.json", out = "docs/qa/R07-T04/management-flow";
type Person = { userId: string; email: string; password: string; cookie: string };
type Fixture = { tag: string; owner: Person; admin: Person; other: Person; companyId: string; otherCompanyId: string; httpStarted?: boolean; httpComplete?: boolean; providerIds: string[]; memberIds: string[] };
const save = (f: Fixture) => writeFile(fixturePath, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
async function request(actor: Person, path: string, method = "GET", body?: unknown, key?: string) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie: actor.cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function answer(response: Response, expected = 200) { const value = await response.json(); assert.equal(response.status, expected, value.error?.code); return value; }
async function select(actor: Person, companyId: string) { await answer(await request(actor, "/context", "POST", { companyId })); }
try {
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await mkdir(out, { recursive: true });
  const command = process.argv[2];
  if (command === "prepare") {
    try { await readFile(fixturePath); throw Error("Existing SSO fixture must not be replaced"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const person = (): Person => ({ userId: "", email: "", password: randomBytes(24).toString("hex") + "Aa!1", cookie: "" });
    const f: Fixture = { tag: randomUUID(), owner: person(), admin: person(), other: person(), companyId: "", otherCompanyId: "", providerIds: [], memberIds: [] };
    await save(f);
    for (const kind of ["owner", "admin", "other"] as const) {
      const p = f[kind]; p.email = `rea-sso-${kind}-${f.tag}@catchsecu.test`; await save(f);
      await answer(await request(p, "/auth/sign-up/email", "POST", { name: "REA SSO " + kind, email: p.email, password: p.password }));
      p.userId = (await db.user.update({ where: { email: p.email }, data: { emailVerified: true } })).id;
      const signed = await request(p, "/auth/sign-in/email", "POST", { email: p.email, password: p.password }); await answer(signed);
      p.cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); await save(f);
    }
    const a = await db.company.create({ data: { name: "REA SSO A " + f.tag.slice(0, 8), publicName: "REA SSO A", policy: { create: { passwordMonths: 0 } },
      services: { create: { name: "기관 인증 시험", externalName: "기관 인증 시험" } }, memberships: { create: [{ userId: f.owner.userId, role: "owner" }, { userId: f.admin.userId, role: "admin" }] } } });
    f.companyId = a.id; await save(f);
    const b = await db.company.create({ data: { name: "REA SSO B " + f.tag.slice(0, 8), publicName: "REA SSO B", policy: { create: { passwordMonths: 0 } },
      memberships: { create: [{ userId: f.other.userId, role: "owner" }, { userId: f.owner.userId, role: "owner" }] } } });
    f.otherCompanyId = b.id; await save(f);
    await select(f.owner, a.id); await select(f.admin, a.id); await select(f.other, b.id);
    const report = { fixtureSetupOnly: true, syntheticAccounts: true, emailVerifiedByFixture: true, signInViaActualHttp: true, companyId: a.id, otherCompanyId: b.id };
    await writeFile(out + "/prepared.json", JSON.stringify(report, null, 2) + "\n"); console.log(report);
  } else {
    const f: Fixture = JSON.parse(await readFile(fixturePath, "utf8")); assert.ok(f.companyId && f.otherCompanyId);
    if (command === "http") {
      assert.equal(f.httpStarted, undefined, "This mutating matrix must not replay over existing proof"); f.httpStarted = true; await save(f);
      const checks: { name: string; status: number; code?: string }[] = [];
      async function check(name: string, response: Response, status = 200) {
        const value = await answer(response, status); checks.push({ name, status, ...(value.error ? { code: value.error.code } : {}) }); return value;
      }
      for (const protocol of ["gpki", "saeol", "groupware"]) {
        const body = { tenantId: f.companyId, name: "HTTP " + protocol + " 디렉터리", protocol }, key = randomUUID();
        const pair = await Promise.all([0, 1].map(() => request(f.owner, "/security/sso", "POST", body, key)));
        const first = await check(protocol + " create", pair[0], 201), replay = await check(protocol + " concurrent replay", pair[1], 201);
        assert.equal(first.id, replay.id); f.providerIds.push(first.id); await save(f);
        await check(protocol + " changed payload", await request(f.owner, "/security/sso", "POST", { ...body, name: "충돌" }, key), 409);
      }
      const providerId = f.providerIds[0], path = `/security/sso/${providerId}/directory`;
      const payload = { orgCode: "REA-" + f.tag.slice(0, 8), employeeNo: "HTTP-001", name: "HTTP 초기 이름", pin: randomBytes(12).toString("hex") };
      const key = randomUUID(), pair = await Promise.all([0, 1].map(() => request(f.owner, path, "POST", payload, key)));
      const member = await check("directory create", pair[0], 201), replay = await check("directory concurrent replay", pair[1], 201);
      assert.equal(member.id, replay.id); f.memberIds.push(member.id); await save(f);
      const updated = await check("directory update", await request(f.owner, `${path}/${member.id}`, "PATCH", { version: 1, name: "HTTP 수정 이름", email: "http-sso@catchsecu.test" }));
      assert.equal(updated.version, 2);
      const current = await check("directory replay current DTO", await request(f.owner, path, "POST", payload, key), 201); assert.equal(current.name, "HTTP 수정 이름");
      await check("directory stale update", await request(f.owner, `${path}/${member.id}`, "PATCH", { version: 1, name: "거부" }), 409);
      await check("immutable employee number", await request(f.owner, `${path}/${member.id}`, "PATCH", { version: 2, employeeNo: "OTHER" }), 422);
      const adminList = await check("admin directory read", await request(f.admin, path)); assert.equal(adminList.canManage, false);
      await check("admin directory update denied", await request(f.admin, `${path}/${member.id}`, "PATCH", { version: 2, name: "거부" }), 403);
      await check("admin create denied", await request(f.admin, path, "POST", { ...payload, employeeNo: "ADMIN" }, randomUUID()), 403);
      await check("other tenant read denied", await request(f.other, path), 404);
      await check("other tenant update denied", await request(f.other, `${path}/${member.id}`, "PATCH", { version: 2, name: "거부" }), 404);
      await check("directory delete", await request(f.owner, `${path}/${member.id}`, "DELETE", { version: 2 }));
      await check("deleted create key expired", await request(f.owner, path, "POST", payload, key), 410);
      for (let i = 1; i <= 12; i++) {
        const added = await check("paging member " + i, await request(f.owner, path, "POST", { ...payload, employeeNo: `PAGE-${String(i).padStart(3, "0")}`, name: `페이지 구성원 ${String(i).padStart(2, "0")}` }, randomUUID()), 201);
        f.memberIds.push(added.id); await save(f);
      }
      const final = await check("directory requery", await request(f.owner, path)); assert.equal(final.items.length, 12); assert.equal(final.canManage, true);
      f.httpComplete = true; await save(f);
      await writeFile(out + "/http.json", JSON.stringify({ actualHttp: true, count: checks.length, checks, externalInstitutionVerified: false }, null, 2) + "\n"); console.log({ count: checks.length });
    } else if (command === "verify") {
      const label = process.argv[3] ?? "verified";
      const providers = await db.ssoProvider.findMany({ where: { tenantId: f.companyId }, select: { id: true, name: true, protocol: true, enabled: true, preflightOk: true, version: true }, orderBy: { id: "asc" } });
      const members = await db.virtualOrgMember.findMany({ where: { tenantId: f.companyId }, select: { id: true, providerId: true, orgCode: true, employeeNo: true, version: true, updatedAt: true }, orderBy: { id: "asc" } });
      const audits = await db.auditEvent.findMany({ where: { tenantId: { in: [f.companyId, f.otherCompanyId] } }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } });
      const state = { providers, members, audits }, hash = createHash("sha256").update(JSON.stringify(state)).digest("hex");
      if (label !== "verified") assert.equal(hash, JSON.parse(await readFile(out + "/verified.json", "utf8")).stateHash);
      const response = await answer(await request(f.owner, "/security/sso")); assert.equal(response.canManage, true); assert.equal(response.items.length, providers.length);
      const report = { verifiedAt: new Date().toISOString(), stateHash: hash, state, externalInstitutionVerified: false, originalLoginPolicyImplemented: false };
      await writeFile(out + "/" + label + ".json", JSON.stringify(report, null, 2) + "\n"); console.log({ stateHash: hash, providers: providers.length, members: members.length, audits: audits.length });
    } else throw Error("Unknown command");
  }
} finally { await db.$disconnect(); }
