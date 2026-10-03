import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { auth } from "../src/server/auth";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL);
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
const path = ".local/password-policy-qa.json", mode = process.argv[2];
type Fixture = { email: string; initialPassword: string; newPassword: string; finalPassword?: string; userId: string; tenantId: string };
if (mode === "prepare") {
  try { await readFile(path); throw new Error("QA fixture already exists; reuse it."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const email = "password-policy-qa-20261002@catchsecu.local.test", initialPassword = randomBytes(24).toString("base64url"), newPassword = randomBytes(24).toString("base64url");
  await auth.api.signUpEmail({ body: { name: "비밀번호 정책 QA", email, password: initialPassword } });
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "비밀번호 정책 QA 회사", publicName: "비밀번호 정책 QA", policy: { create: {} } } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  await db.service.create({ data: { tenantId: company.id, name: "비밀번호 검증 서비스", externalName: "검증 서비스" } });
  await writeFile(path, JSON.stringify({ email, initialPassword, newPassword, userId: user.id, tenantId: company.id }), { mode: 0o600 });
  console.log("Dedicated local QA account and company created. Credentials remain in the private fixture.");
} else {
  const fixture: Fixture = JSON.parse(await readFile(path, "utf8"));
  if (mode === "expire") {
    // Controlled local test clock fixture: do not change the credential or hash.
    await db.user.update({ where: { id: fixture.userId }, data: { passwordChangedAt: new Date("2026-01-31T15:30:00Z") } });
    console.log("Dedicated QA user's password age set to the documented expired fixture.");
  } else if (mode === "evidence") {
    const timezone = (await db.$queryRaw<{ timezone: string }[]>`SELECT current_setting('TimeZone') AS timezone`)[0].timezone;
    assert.equal(timezone, "UTC");
    const user = await db.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    const context = await auth.$context;
    assert(await context.password.verify({ hash: account.password!, password: fixture.finalPassword ?? fixture.newPassword }));
    assert(!await context.password.verify({ hash: account.password!, password: fixture.initialPassword }));
    const history = await db.passwordHistory.findMany({ where: { userId: user.id } });
    assert.equal(history.length, fixture.finalPassword ? 2 : 1);
    assert((await Promise.all(history.map(row => context.password.verify({ hash: row.passwordHash, password: fixture.initialPassword })))).some(Boolean));
    assert(history.every(row => row.changedAt.getTime() <= Date.now()));
    const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } });
    assert.equal(policy.passwordReuse, 10); assert.equal(policy.passwordMonths, 1); assert.equal(policy.minPassword, 16);
    const events = await db.auditEvent.findMany({ where: { actorId: user.id, action: { in: ["policy.updated", "password.deferred", "password.changed"] } },
      select: { id: true, action: true, resource: true, createdAt: true, detail: true }, orderBy: { createdAt: "asc" } });
    assert(events.some(row => row.action === "password.changed")); assert(events.some(row => row.action === "password.deferred"));
    assert(events.every(row => row.createdAt.getTime() <= Date.now()));
    const timestampRepairs = await db.auditEvent.findMany({ where: { action: "system.timestamp_corrected", resourceId: { in: events.map(row => row.id) } },
      select: { resourceId: true, detail: true, createdAt: true } });
    const deferrals = await db.passwordDeferral.findMany({ where: { userId: user.id }, select: { mode: true, passwordRevision: true, expiresAt: true } });
    if (fixture.finalPassword) {
      assert.equal(deferrals.length, 0); assert(user.passwordChangedAt && Math.abs(account.updatedAt.getTime() - user.passwordChangedAt.getTime()) < 1000);
      assert(!await context.password.verify({ hash: account.password!, password: fixture.newPassword }));
      assert((await Promise.all(history.map(row => context.password.verify({ hash: row.passwordHash, password: fixture.newPassword })))).some(Boolean));
    }
    await writeFile("docs/qa/password-policy/database-evidence.json", JSON.stringify({ checkedAt: new Date(), timezone, userId: user.id, tenantId: fixture.tenantId,
      passwordChangedAt: user.passwordChangedAt, newPasswordMatches: true, oldPasswordRejected: true, historyCount: history.length, historyMatchesOldPassword: true,
      policy: { minPassword: policy.minPassword, passwordMonths: policy.passwordMonths, passwordReuse: policy.passwordReuse, passwordDeferral: policy.passwordDeferral,
        passwordRevision: policy.passwordRevision, version: policy.version }, deferrals, events, timestampRepairs }, null, 2));
    console.log("Password, retained hash, policy, deferrals and audit evidence verified in PostgreSQL.");
  } else throw new Error("Use prepare, expire or evidence.");
}
await db.$disconnect();
