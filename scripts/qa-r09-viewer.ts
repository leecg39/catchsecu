import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3121");
const file = ".local/rea-fullstack/r09-viewer-fixture.json";
const approval = JSON.parse(await readFile(".local/rea-fullstack/r09-approval-list.json", "utf8")) as {
  tenantId: string; serviceId: string;
};

const existing = await readFile(file, "utf8").catch(() => null);
if (existing) {
  console.log({ result: "reused", ...JSON.parse(existing) });
} else {
  const email = "r09-viewer-" + randomUUID() + "@example.test";
  const password = "R09-Viewer!" + randomUUID();
  const signup = await fetch(origin + "/api/v1/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password, name: "R09 수용 조회자" }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(signup.status, 200, "sign-up");
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({
    data: { tenantId: approval.tenantId, userId: user.id, role: "viewer" },
  });
  const grants = await db.serviceGrant.createMany({
    data: [{ tenantId: approval.tenantId, memberId: member.id, serviceId: approval.serviceId }],
  });
  const fixture = { email, password, userId: user.id, memberId: member.id, tenantId: approval.tenantId, serviceId: approval.serviceId };
  await mkdir(".local/rea-fullstack", { recursive: true });
  await writeFile(file, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  console.log({ result: "created", grants: grants.count, ...fixture });
}
await db.$disconnect();
