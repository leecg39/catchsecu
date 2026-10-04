import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Credential-audit!123456", replacement = "Credential-next!123456";
let email: string, userId: string, cookie: string;
const call = (path: string, input: unknown, session = "") => auth.handler(new Request(origin + "/api/v1/auth" + path,
  { method: "POST", headers: { origin, cookie: session, "content-type": "application/json" }, body: JSON.stringify(input) }));
const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const events = (r: Response) => db.auditEvent.findMany({ where: { requestId: r.headers.get("x-request-id") ?? "missing" } });
async function login() { const r = await call("/sign-in/email", { email, password }); expect(r.status).toBe(200); return cookies(r); }
async function proof() {
  expect((await call("/request-password-reset", { email, redirectTo: "/passwordChange" })).status).toBe(200);
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
  const m = jobs.map(j => decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher)).find(m => m.to === email && m.subject === "비밀번호 재설정")!;
  const r = await auth.handler(new Request(m.text.match(/https?:\/\/\S+/)![0]));
  return new URL(r.headers.get("location")!, origin).searchParams.get("token")!;
}
const account = () => db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } });
async function sessionIds() { return (await db.session.findMany({ where: { userId }, select: { id: true } })).map(r => r.id).sort(); }
function safe(rows: unknown, extra: string[] = []) { for (const secret of [email, password, replacement, cookie, ...extra]) expect(JSON.stringify(rows).includes(secret)).toBe(false); }
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord" CASCADE');
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_credential_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action = (SELECT split_part(name, 'fail:', 2) FROM "User" WHERE id=NEW."actorId") THEN RAISE EXCEPTION 'synthetic credential audit failure'; END IF;
    RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_credential_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_credential_audit_failure()');
});
beforeEach(async () => {
  await db.rateLimit.deleteMany(); email = randomUUID() + "@credential-audit.example.test";
  expect((await call("/sign-up/email", { email, password, name: "자격 증명 감사" })).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } }); userId = user.id; cookie = await login();
});
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER qa_credential_audit_failure ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION qa_credential_audit_failure()'); await db.$disconnect();
});

test("signup password.created shares the registration HTTP request ID", async () => {
  const r = await call("/sign-up/email", { email: randomUUID() + "@credential-audit.example.test", password, name: "가입 상관" });
  expect(r.status).toBe(200); expect((await events(r)).filter(e => e.action === "password.created")).toHaveLength(1);
});
test("reset records every revoked session and password change under its HTTP request ID", async () => {
  await login(); const before = await sessionIds(), token = await proof();
  const r = await call("/reset-password", { token, newPassword: replacement }); expect(r.status).toBe(200);
  const rows = await events(r); expect(rows.filter(e => e.action === "password.changed")).toHaveLength(1);
  expect(rows.filter(e => e.action === "session.ended").map(e => e.resourceId).sort()).toEqual(before);
  expect(await sessionIds()).toEqual([]); safe(rows, [token]);
});
test("change correlates ended sessions and the rotated session without duplicating termination", async () => {
  await login(); const before = await sessionIds();
  const r = await call("/change-password", { currentPassword: password, newPassword: replacement }, cookie); expect(r.status).toBe(200);
  const rows = await events(r); expect(rows.filter(e => e.action === "password.changed")).toHaveLength(1);
  expect(rows.filter(e => e.action === "session.ended").map(e => e.resourceId).sort()).toEqual(before);
  expect(rows.filter(e => e.action === "session.created")).toHaveLength(1); safe(rows);
});
test.each(["password.changed", "session.ended"])("%s trigger failure rolls back credentials, proofs and all session deletion", async action => {
  await login(); const token = await proof(), before = await sessionIds(), prior = await account();
  await db.user.update({ where: { id: userId }, data: { name: "fail:" + action } });
  const r = await call("/reset-password", { token, newPassword: replacement }); expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0);
  expect((await account()).password === prior.password).toBe(true); expect(await sessionIds()).toEqual(before);
  expect(await db.verification.count({ where: { value: userId } })).toBe(1); expect(await events(r)).toHaveLength(0);
  await db.user.update({ where: { id: userId }, data: { name: "자격 증명 감사" } });
  const retry = await call("/reset-password", { token, newPassword: replacement }); expect(retry.status).toBe(200);
  expect((await events(retry)).filter(e => e.action === "session.ended")).toHaveLength(before.length);
});
test("direct credential writes use one fallback UUID for the credential event and session termination", async () => {
  const before = await sessionIds(), ctx = await auth.$context;
  await db.account.update({ where: { id: (await account()).id }, data: { password: await ctx.password.hash(replacement) } });
  const changed = await db.auditEvent.findFirstOrThrow({ where: { actorId: userId, action: "password.changed" } });
  const rows = await db.auditEvent.findMany({ where: { requestId: changed.requestId } });
  expect(changed.requestId).toMatch(/^[0-9a-f-]{36}$/); expect(rows.filter(e => e.action === "session.ended").map(e => e.resourceId).sort()).toEqual(before); safe(rows);
});
test("replaying a consumed reset proof creates no second change or termination event", async () => {
  const token = await proof(); expect((await call("/reset-password", { token, newPassword: replacement })).status).toBe(200);
  const r = await call("/reset-password", { token, newPassword: replacement }); expect(r.status).toBe(400); expect(await events(r)).toHaveLength(0);
  expect(await db.auditEvent.count({ where: { actorId: userId, action: "password.changed" } })).toBe(1);
});
