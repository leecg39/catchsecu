import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3121");
const file = ".local/rea-fullstack/r06-list-fixture.json", evidence = "docs/qa/R06-T03/current";
type Fixture = { rules: string[]; members: string[]; users: string[] };
try {
  const base = JSON.parse(await readFile(".local/rea-fullstack/r05-self-approval.json", "utf8"));
  let fixture: Fixture;
  try { fixture = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; fixture = { rules: [], members: [], users: [] }; }
  const login: Response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: base.people.owner.email, password: base.people.owner.password }) });
  assert.equal(login.status, 200); const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  for (let index = fixture.rules.length; index < 21; index++) {
    const response: Response = await fetch(origin + "/api/v1/security/ip-rules", { method: "POST", headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ tenantId: base.companyId, cidr: `198.18.0.${index + 1}/32`, description: "R06 목록 검증 " + String(index + 1).padStart(2, "0"), enabled: false }) });
    assert.equal(response.status, 201); fixture.rules.push((await response.json()).id);
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  for (let index = fixture.members.length; index < 21; index++) {
    // Synthetic identities have no login credentials. Only the company MFA list uses them.
    const { user, member } = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `r06-list-${randomUUID()}@example.test`, name: "R06 목록 구성원 " + String(index + 1).padStart(2, "0"), emailVerified: true } });
      const member = await tx.membership.create({ data: { tenantId: base.companyId, userId: user.id, role: "viewer" } });
      return { user, member };
    });
    fixture.users.push(user.id); fixture.members.push(member.id);
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  const rules = await db.ipRule.findMany({ where: { id: { in: fixture.rules } }, orderBy: [{ cidr: "asc" }, { id: "asc" }], select: { id: true, enabled: true } });
  const members = await db.membership.findMany({ where: { id: { in: fixture.members } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  assert.equal(rules.length, 21); assert.equal(members.length, 21); assert.ok(rules.every(row => !row.enabled));
  const pages = [];
  for (const [kind, path, ids] of [["ip", "/security/ip-rules?search=R06%20목록%20검증&status=disabled&sort=cidr&direction=asc", rules],
    ["mfa", "/security/mfa-policy?search=R06%20목록%20구성원&status=required", members]] as const) {
    for (const page of [1, 2]) {
      const response: Response = await fetch(origin + "/api/v1" + path + "&page=" + page + "&pageSize=20", { headers: { cookie } });
      assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.total, 21); assert.equal(body.page, page);
      assert.deepEqual(body.items.map((row: { id: string }) => row.id), ids.slice((page - 1) * 20, page * 20).map(row => row.id));
      pages.push({ kind, page, rows: body.items.length, ids: body.items.map((row: { id: string }) => row.id) });
    }
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(evidence + "/pagination-fixture.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", setup: "21 disabled IP rules via real HTTP; 21 credential-free synthetic users/members via DB", pages }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", rules: rules.length, members: members.length, pages: pages.map(({ kind, page, rows }) => ({ kind, page, rows })) }));
} finally { await db.$disconnect(); }
