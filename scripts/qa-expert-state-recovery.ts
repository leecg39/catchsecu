import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const origin = "http://127.0.0.1:3189", fixtureFile = ".local/p03-expert-state-fixture.json";
assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_mock_admin");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname));
assert.equal(env.MAIL_TRANSPORT, "local");
type Person = { id: string; email: string; password: string; cookie: string };
type Fixture = { admin: Person; expert: Person; tag: string; companies: { id: string; name: string; services: string[]; assignmentId: string }[] };
const cases: { name: string; status: number }[] = [];
async function request(path: string, method = "GET", cookie = "", body?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  cases.push({ name: method + " " + path, status: response.status });
  assert.equal(response.status, expected, method + " " + path);
  return response;
}
async function login(person: Person) {
  const response = await request("/auth/sign-in/email", "POST", "", { email: person.email, password: person.password });
  person.cookie = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  assert.ok(person.cookie);
}
async function register(name: string, tag: string): Promise<Person> {
  const person: Person = { id: "", email: `p03-state-${name}-${tag}@catchsecu.test`, password: randomBytes(24).toString("base64url") + "!1aA", cookie: "" };
  await request("/auth/sign-up/email", "POST", "", { name: `P03 ${name} ${tag}`, email: person.email, password: person.password, callbackURL: origin + "/login" });
  const user = await db.user.findUniqueOrThrow({ where: { email: person.email } });person.id = user.id;
  const jobs = await db.job.findMany({ where: { tenantId: null, type: "mail", status: "queued" }, orderBy: { createdAt: "desc" } });
  const job = jobs.find(j => decrypt<{ to: string }>(j.payloadCipher).to === person.email);assert.ok(job);
  assert.ok(await runOneJob("p03-state-verification", { tenantId: null, jobId: job.id }));
  assert.equal((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status, "done");
  const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8")) as { text: string };
  const link = mail.text.match(/https?:\/\/\S+/)?.[0];assert.ok(link);assert.equal(new URL(link).origin, origin);
  assert.equal((await fetch(link, { redirect: "manual" })).status, 302);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified);
  return person;
}
const command = process.argv[2] ?? "read";
try {
  assert.ok(["prepare", "read", "update", "revoke", "expire"].includes(command));
  if (command === "prepare") {
    const existing = await access(fixtureFile).then(() => true, () => false);
    assert.equal(existing, false, "A private fixture already exists; do not overwrite it.");
    await mkdir("docs/qa/P03-T02/expert-state-recovery", { recursive: true });
    const tag = randomUUID().slice(0, 8), admin = await register("admin", tag), expert = await register("expert", tag);
    await db.user.update({ where: { id: admin.id }, data: { platformAdmin: true } });
    await login(admin);
    const fixture: Fixture = { tag, admin, expert, companies: [] };
    for (const letter of ["A", "B"]) {
      const company = await db.company.create({ data: { name: `P03 상태복구 ${letter} ${tag}`, publicName: `P03 ${letter}`, policy: { create: {} },
        memberships: { create: { userId: admin.id, role: "owner" } }, services: { create: [{ name: `P03 ${letter} 서비스1`, externalName: `P03 ${letter} 서비스1` }, { name: `P03 ${letter} 서비스2`, externalName: `P03 ${letter} 서비스2` }] } }, include: { services: true } });
      const services = company.services.sort((a, b) => a.name.localeCompare(b.name)).map(s => s.id);
      const row = await (await request("/expert-assignments", "POST", admin.cookie, { companyId: company.id, expertEmail: expert.email, serviceIds: [services[0]], expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201)).json();
      fixture.companies.push({ id: company.id, name: company.name, services, assignmentId: row.id });
      await writeFile(fixtureFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    }
    const receipt = { checkedAt: new Date().toISOString(), cases, syntheticDatabase: "catchsecu_mock_admin", syntheticAdminSeeded: true, companiesSeeded: true,
      authenticatedEmailLinksVerified: 2, localVerificationJobs: 2, realProviderDelivery: false, companies: fixture.companies.map(c => ({ id: c.id, assignmentId: c.assignmentId })) };
    await writeFile("docs/qa/P03-T02/expert-state-recovery/fixture.json", JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify({ prepared: true, tag, companies: fixture.companies.length }));
  } else {
    const f: Fixture = JSON.parse(await readFile(fixtureFile, "utf8")), target = f.companies[Number(process.argv[3] ?? 0)];assert.ok(target);
    assert.equal(f.companies.length, 2);
    assert.ok(/^[0-9a-f]{8}$/.test(f.tag));
    for (const c of f.companies) {
      assert.ok(c.name.startsWith("P03 상태복구 ") && c.name.endsWith(f.tag));
      const assignment = await db.expertAssignment.findUniqueOrThrow({ where: { id: c.assignmentId }, include: { tenant: true } });
      assert.equal(assignment.tenantId, c.id);
      assert.equal(assignment.expertUserId, f.expert.id);
      assert.equal(assignment.tenant.name, c.name);
    }
    if (command === "update") {
      const row = await (await request("/expert-assignments/" + target.assignmentId, "GET", f.admin.cookie)).json();
      await request("/expert-assignments/" + target.assignmentId, "PATCH", f.admin.cookie, { version: row.version, serviceIds: [target.services[1]] });
    } else if (command === "revoke") {
      const row = await (await request("/expert-assignments/" + target.assignmentId, "GET", f.admin.cookie)).json();
      const response = await fetch(origin + "/api/v1/expert-assignments/" + target.assignmentId, { method: "DELETE", headers: { origin, cookie: f.admin.cookie, "if-match": String(row.version) } });assert.equal(response.status, 204);
    } else if (command === "expire") {
      await db.expertAssignment.update({ where: { id: target.assignmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    }
    const rows = await db.expertAssignment.findMany({ where: { id: { in: f.companies.map(c => c.assignmentId) } }, select: { id: true, tenantId: true, status: true, version: true, expiresAt: true, services: { select: { serviceId: true } }, membership: { select: { status: true, version: true } } }, orderBy: { tenantId: "asc" } });
    const events = await db.auditEvent.findMany({ where: { resourceId: { in: f.companies.map(c => c.assignmentId) } }, select: { action: true, tenantId: true, requestId: true }, orderBy: { createdAt: "asc" } });
    const grants = await db.serviceGrant.findMany({ where: { member: { userId: f.expert.id, tenantId: { in: f.companies.map(c => c.id) } } }, select: { tenantId: true, serviceId: true, capabilities: true }, orderBy: [{ tenantId: "asc" }, { serviceId: "asc" }] });
    const sessions = await db.session.findMany({ where: { userId: f.expert.id }, select: { id: true, activeCompanyId: true, activeServiceId: true }, orderBy: { id: "asc" } });
    console.log(JSON.stringify({ command, rows, grants, sessions, events, sha256: createHash("sha256").update(JSON.stringify({ rows, grants, sessions })).digest("hex") }));
  }
} catch { console.error("P03 fixture operation failed; secrets suppressed. Last step: " + (cases.at(-1)?.name ?? command)); process.exitCode = 1; }
finally { await db.$disconnect(); }
