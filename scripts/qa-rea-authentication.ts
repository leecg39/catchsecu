import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const privateDirectory = ".local/rea-fullstack/authentication", privateFile = privateDirectory + "/fixture.json";
const directory = "docs/qa/R02-T04/authentication";
type Fixture = { email: string; password: string; newPassword: string; finalPassword: string; preparedAt: string; userId?: string; companyId?: string; serviceId?: string; secret?: string; backupCodes?: string[]; otp?: string; verificationLink?: string; resetLink?: string; expiredResetLink?: string; secondSessionCookie?: string; secondSessionId?: string; challengeCookie?: string };
async function save(value: Fixture) { await writeFile(privateFile, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); }
const command = process.argv[2];
try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await mkdir(directory, { recursive: true });
  if (command === "prepare") {
    try { await readFile(privateFile); throw new Error("Existing fixture must not be replaced"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const fixture: Fixture = { email: "rea-auth-" + randomUUID() + "@catchsecu.test", password: randomBytes(24).toString("hex") + "!Aa1", newPassword: randomBytes(24).toString("hex") + "!Aa2", finalPassword: randomBytes(24).toString("hex") + "!Aa3", preparedAt: new Date().toISOString() };
    await save(fixture); console.log(JSON.stringify({ prepared: true }));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8"));
    assert.ok(fixture.email.startsWith("rea-auth-"));
    const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email } }); fixture.userId = user.id;
    if (command === "mail") {
      const kind = process.argv[3] ?? "verification", subject = kind === "otp" ? "로그인 인증코드" : kind === "reset" ? "비밀번호 재설정" : "이메일 인증";
      const jobs = await db.job.findMany({ where: { type: "mail", createdAt: { gte: new Date(fixture.preparedAt) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
      const job = jobs.find(row => { const mail = decrypt<{ to: string; subject: string }>(row.payloadCipher); return mail.to === fixture.email && mail.subject === subject; });
      assert.ok(job, "Requested synthetic mail must exist");
      if (job.status !== "done") assert.equal(await runOneJob("rea-auth-browser", { tenantId: job.tenantId, jobId: job.id }), true);
      const stored = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { attemptsLog: true } });
      assert.equal(stored.status, "done");
      const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")), mail = JSON.parse(bytes.toString());
      assert.equal(mail.to, fixture.email); assert.equal(mail.subject, subject);
      if (kind === "otp") { fixture.otp = mail.text.match(/인증코드: ([0-9]{6})/)?.[1]; assert.ok(fixture.otp); }
      else {
        const link = mail.text.match(/https?:\/\/\S+/)?.[0]; assert.ok(link); assert.equal(new URL(link).origin, origin);
        if (kind === "reset") fixture.resetLink = link; else fixture.verificationLink = link;
      }
      await save(fixture);
      const report = { deliveredLocally: true, externalProviderVerified: false, jobId: job.id, status: stored.status, attempts: stored.attempts, subject, fileHash: createHash("sha256").update(bytes).digest("hex"), receiptCount: stored.attemptsLog.length };
      await writeFile(directory + "/mail-" + kind + "-" + job.id + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "otp") {
      assert.ok(fixture.secret); const secret = new TextDecoder().decode(base32.decode(fixture.secret));
      fixture.otp = await createOTP(secret, { digits: 6, period: 30 }).totp(); await save(fixture); console.log(JSON.stringify({ generated: true }));
    } else if (command === "expire-reset") {
      assert.ok(fixture.resetLink); fixture.expiredResetLink = fixture.resetLink;
      // Only this fresh synthetic user's reset proofs are moved into the past.
      const changed = await db.verification.updateMany({ where: { value: user.id, createdAt: { gte: new Date(fixture.preparedAt) } }, data: { expiresAt: new Date(Date.now() - 60000) } });
      assert.ok(changed.count > 0); await save(fixture); console.log(JSON.stringify({ expiredSyntheticResetProofs: changed.count }));
    } else if (command === "expire-otp") {
      assert.ok(fixture.challengeCookie);
      const value = decodeURIComponent(fixture.challengeCookie), key = value.slice(0, value.lastIndexOf(".")), context = await auth.$context;
      assert.ok(key);
      const challenge = await context.internalAdapter.findVerificationValue(key);
      assert.ok(challenge && challenge.value === user.id, "Challenge must belong to the fresh synthetic user");
      const proof = await context.internalAdapter.findVerificationValue("2fa-otp-" + key); assert.ok(proof);
      assert.ok(new Date(proof.createdAt).getTime() >= new Date(fixture.preparedAt).getTime());
      await db.verification.update({ where: { id: proof.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
      console.log(JSON.stringify({ expiredSyntheticOtp: true }));
    } else if (command === "second-session") {
      assert.equal(user.twoFactorEnabled, false, "Create the second synthetic device before MFA setup");
      const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: fixture.email, password: fixture.password }) });
      assert.equal(response.status, 200);
      const cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).filter(item => item.startsWith("better-auth.session_token=")).join("; ");
      assert.ok(cookie); fixture.secondSessionCookie = cookie;
      const check = await fetch(origin + "/api/v1/auth/get-session", { headers: { cookie } });
      const body = await check.json(); assert.equal(body.user.id, user.id); fixture.secondSessionId = body.session.id;
      await save(fixture); console.log(JSON.stringify({ secondSyntheticSession: body.session.id }));
    } else if (command === "check-revoked-session") {
      assert.ok(fixture.secondSessionCookie && fixture.secondSessionId);
      const response = await fetch(origin + "/api/v1/auth/get-session", { headers: { cookie: fixture.secondSessionCookie } });
      assert.equal(response.status, 200); assert.ok(await response.json() === null, "The second session must no longer authenticate");
      assert.equal(await db.session.count({ where: { id: fixture.secondSessionId } }), 0);
      const events = await db.auditEvent.count({ where: { resourceId: fixture.secondSessionId, action: "session.ended" } }); assert.equal(events, 1);
      const report = { sessionId: fixture.secondSessionId, revokedInDatabase: true, signedCookieRejected: true, auditedOnce: true };
      await writeFile(directory + "/revoked-second-session.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "state" || command === "verify") {
      const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } }), context = await auth.$context;
      const sessions = await db.session.findMany({ where: { userId: user.id }, select: { id: true, activeCompanyId: true, activeServiceId: true, expiresAt: true }, orderBy: { id: "asc" } });
      const audits = await db.auditEvent.findMany({ where: { OR: [{ actorId: user.id }, { resourceId: user.id }, { resourceId: { in: sessions.map(row => row.id) } }] }, select: { id: true, action: true, requestId: true, resource: true, resourceId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const report = { userId: user.id, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled, status: user.status,
        initialPasswordValid: await context.password.verify({ hash: account.password!, password: fixture.password }),
        resetPasswordValid: await context.password.verify({ hash: account.password!, password: fixture.newPassword }),
        finalPasswordValid: await context.password.verify({ hash: account.password!, password: fixture.finalPassword }),
        sessions, factorCount: await db.twoFactor.count({ where: { userId: user.id } }), passwordHistoryCount: await db.passwordHistory.count({ where: { userId: user.id } }), audits };
      const tag = process.argv[3] ?? (command === "verify" ? "verified" : "state"); assert.match(tag, /^[a-z0-9-]+$/);
      if (command === "verify") {
        assert.equal(report.emailVerified, true); assert.equal(report.status, "active"); assert.equal(report.twoFactorEnabled, false); assert.equal(report.factorCount, 0);
        assert.equal(report.initialPasswordValid, false); assert.equal(report.resetPasswordValid, false); assert.equal(report.finalPasswordValid, true);
        assert.equal(report.passwordHistoryCount, 2); assert.equal(report.sessions.length, 1);
        for (const [action, count] of [["auth.email_verified", 1], ["auth.factor_setup", 1], ["auth.mfa_enabled", 1], ["auth.mfa_disabled", 1], ["password.created", 1], ["password.changed", 2]] as const)
          assert.equal(audits.filter(event => event.action === action).length, count, action);
        const fingerprint = createHash("sha256").update(JSON.stringify(report)).digest("hex");
        if (tag === "verified-after-restart") {
          const before = JSON.parse(await readFile(directory + "/verified.json", "utf8")); assert.equal(fingerprint, before.stateHash);
        }
        Object.assign(report, { result: "passed", stateHash: fingerprint, externalProviderVerified: false });
      }
      await save(fixture); await writeFile(directory + "/" + tag + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ userId: user.id, emailVerified: report.emailVerified, twoFactorEnabled: report.twoFactorEnabled, sessions: sessions.length, audits: audits.length }));
    } else throw new Error("Unknown command");
  }
} finally { await db.$disconnect(); }
