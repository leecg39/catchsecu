import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { GET as authRouteGet, POST as authRoutePost } from "@/app/api/v1/auth/[...all]/route";

const fault = vi.hoisted(() => ({ action: "", expire: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (fault.action && args[3] === fault.action) {
      if (fault.expire) vi.setSystemTime(Date.now() + 7200000);
      else throw new Error("synthetic public auth audit failure");
    }
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const password = "Public-auth!123456", callback = "/login?returnTo=%2Fmy-page%2Finfo";
let email: string;
const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
function req(path: string, input?: unknown, cookie = "", requestOrigin = origin) {
  return new Request(origin + "/api/v1/auth" + path, { method: input ? "POST" : "GET", headers: { origin: requestOrigin, cookie, ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
const authRoute = (request: Request) => request.method === "GET" ? authRouteGet(request) : authRoutePost(request);
const signup = () => authRoute(req("/sign-up/email", { email, password, name: "가입 감사", callbackURL: callback }));
const reset = (address = email, cookie = "") => authRoute(req("/request-password-reset", { email: address, redirectTo: "/passwordChange" }, cookie));
async function user(verified = false) {
  expect((await signup()).status).toBe(200);
  return db.user.update({ where: { email }, data: { emailVerified: verified } });
}
async function mail(subject: string) {
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
  const row = jobs.map(job => ({ job, payload: decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher) })).find(row => row.payload.to === email && row.payload.subject === subject)!;
  expect(row).toBeDefined(); return { id: row.job.id, url: row.payload.text.match(/https?:\/\/\S+/)![0] };
}
async function proof() { const m = await mail("이메일 인증"); return new Request(m.url); }
async function requestEvents(r: Response) { return db.auditEvent.findMany({ where: { requestId: r.headers.get("x-request-id") ?? "missing" } }); }
async function counts() { return { users: await db.user.count(), accounts: await db.account.count(), jobs: await db.job.count(), proofs: await db.verification.count(), sessions: await db.session.count() }; }
async function pendingMfa() {
  const u = await user(true), login = await authRoute(req("/sign-in/email", { email, password })), cookie = cookies(login);
  const enable = await authRoute(req("/two-factor/enable", { password }, cookie)), data = await enable.json();
  const secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  expect((await authRoute(req("/two-factor/verify-totp", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }, cookie))).status).toBe(200);
  const pending = await authRoute(req("/sign-in/email", { email, password })); expect(pending.status).toBe(200);
  // Factor behavior is separate from the already tested three-request throttle.
  await db.rateLimit.deleteMany(); return { userId: u.id, cookie: cookies(pending) };
}
function safe(events: unknown[], secrets: string[]) { const text = JSON.stringify(events); for (const value of secrets) expect(text).not.toContain(value); }
beforeAll(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
beforeEach(async () => { fault.action = ""; fault.expire = false; vi.useRealTimers(); email = randomUUID() + "@public-auth.example.test"; await db.rateLimit.deleteMany(); });
afterEach(() => { fault.action = ""; fault.expire = false; vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); });

test("signup commits the account, encrypted verification job and request-linked safe audits together", async () => {
  const r = await signup(); expect(r.status).toBe(200); expect(r.headers.getSetCookie()).toHaveLength(0);
  const u = await db.user.findUniqueOrThrow({ where: { email } }), events = await requestEvents(r);
  expect(await db.account.count({ where: { userId: u.id } })).toBe(1);
  expect(events.map(e => e.action)).toEqual(expect.arrayContaining(["auth.account_registered", "auth.verification_queued"]));
  expect(events.find(e => e.action === "auth.account_registered")).toMatchObject({ actorId: u.id, tenantId: null, resourceId: u.id, detail: { changedFields: ["name", "email"] } });
  safe(events, [email, password, (await mail("이메일 인증")).url]);
});
test("authenticated session is returned through the public auth route", async () => {
  await user(true);
  const login = await authRoute(req("/sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  const session = await authRoute(req("/get-session", undefined, cookies(login)));
  expect(session.status).toBe(200);
  expect(await session.json()).toMatchObject({ user: { email } });
});
test.each(["auth.account_registered", "auth.verification_queued"])("%s failure rolls back signup even when the library catches it", async action => {
  const before = await counts(); fault.action = action; const r = await signup(); fault.action = "";
  expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
});
test("duplicate signup preserves the generic response without another account or registration success event", async () => {
  await user(); const before = await counts(); const r = await signup(); expect(r.status).toBe(200); expect(await counts()).toEqual(before);
  expect((await requestEvents(r)).filter(e => e.action === "auth.account_registered")).toHaveLength(0);
});
test("signed email confirmation commits its flag and safe event despite the successful 302 callback", async () => {
  const u = await user(); const r = await authRoute(await proof()); expect(r.status).toBe(302);
  expect(new URL(r.headers.get("location")!, origin).searchParams.get("returnTo")).toBe("/my-page/info");
  expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ emailVerified: true });
  const events = await requestEvents(r); expect(events.find(e => e.action === "auth.email_verified")).toMatchObject({ actorId: u.id, resourceId: u.id, detail: { changedFields: ["emailVerified"] } }); safe(events, [email, (await mail("이메일 인증")).url]);
});
test("email confirmation audit failure rolls back its flag and a retry of the same signed link succeeds", async () => {
  const u = await user(), link = (await proof()).url; fault.action = "auth.email_verified";
  const r = await authRoute(new Request(link)); fault.action = ""; expect(r.status).toBe(500); expect(r.headers.get("location")).toBeNull();
  expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ emailVerified: false }); expect(await requestEvents(r)).toHaveLength(0);
  expect((await authRoute(new Request(link))).status).toBe(302);
});
test("concurrent email confirmation records one actual flag transition", async () => {
  const u = await user(), link = (await proof()).url;
  const results = await Promise.all([authRoute(new Request(link)), authRoute(new Request(link))]); expect(results.map(r => r.status)).toEqual([302, 302]);
  expect(results.map(r => new URL(r.headers.get("location")!, origin).searchParams.get("error")).sort()).toEqual(["EMAIL_ALREADY_VERIFIED", null].sort());
  expect(await db.auditEvent.count({ where: { action: "auth.email_verified", resourceId: u.id } })).toBe(1);
});
test("a used signed verification link rejects replay while retaining the safe return page", async () => {
  const u = await user(), link = (await proof()).url;
  const first = await authRoute(new Request(link)); expect(first.status).toBe(302);
  expect(new URL(first.headers.get("location")!, origin).searchParams.has("error")).toBe(false);
  const replay = await authRoute(new Request(link)); expect(replay.status).toBe(302);
  const location = new URL(replay.headers.get("location")!, origin);
  expect(location.pathname).toBe("/login"); expect(location.searchParams.get("returnTo")).toBe("/my-page/info");
  expect(location.searchParams.get("error")).toBe("EMAIL_ALREADY_VERIFIED");
  expect(await db.auditEvent.count({ where: { action: "auth.email_verified", resourceId: u.id } })).toBe(1);
  expect((await requestEvents(replay)).map(row => row.action)).toContain("auth.email_verification_rejected");
  expect(replay.headers.getSetCookie()).toHaveLength(0);
});
test("verification replay without callback returns an error and cannot mint a session", async () => {
  await user(); const link = new URL((await proof()).url); link.searchParams.delete("callbackURL");
  expect((await authRoute(new Request(link))).status).toBe(200);
  const replay = await authRoute(new Request(link)); expect(replay.status).toBe(400);
  expect(await replay.json()).toMatchObject({ code: "EMAIL_ALREADY_VERIFIED" });
  expect(replay.headers.getSetCookie()).toHaveLength(0);
});
test("used verification proofs still reject unsafe callbacks before redirecting", async () => {
  await user(); const link = new URL((await proof()).url);
  expect((await authRoute(new Request(link))).status).toBe(302);
  link.searchParams.set("callbackURL", "https://evil.example/");
  const replay = await authRoute(new Request(link)); expect(replay.status).toBeGreaterThanOrEqual(400);
  expect(replay.headers.get("location")).toBeNull();
});
test("a signed email proof expiring after its audit cannot publish confirmation", async () => {
  const u = await user(), link = (await proof()).url; fault.action = "auth.email_verified"; fault.expire = true;
  const r = await authRoute(new Request(link)); fault.action = ""; fault.expire = false; vi.useRealTimers();
  expect(r.status).toBe(401); expect(r.headers.get("location")).toBeNull(); expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ emailVerified: false }); expect(await requestEvents(r)).toHaveLength(0);
});
test("invalid signed email links keep the callback error and cannot produce a verified event", async () => {
  const r = await authRoute(req("/verify-email?" + new URLSearchParams({ token: "invalid", callbackURL: callback })));
  expect(r.status).toBe(302); expect(new URL(r.headers.get("location")!, origin).searchParams.get("error")).toBe("INVALID_TOKEN");
  expect((await requestEvents(r)).filter(e => e.action === "auth.email_verified")).toHaveLength(0);
});
test("password reset proof, encrypted queued mail and audit share the request transaction", async () => {
  const u = await user(true), r = await reset(); expect(r.status).toBe(200); const events = await requestEvents(r);
  expect(await db.verification.count({ where: { value: u.id } })).toBe(1);
  const queued = events.find(e => e.action === "auth.password_reset_queued"); expect(queued).toMatchObject({ actorId: null, tenantId: null, resource: "job", resourceId: (await mail("비밀번호 재설정")).id });
  expect(events.some(e => e.action === "auth.password_reset_requested")).toBe(true); safe(events, [email, password, (await mail("비밀번호 재설정")).url]);
});
test.each(["auth.password_reset_queued", "auth.password_reset_requested"])("%s failure restores reset proof/job counts and withholds success", async action => {
  await user(true); const before = await counts(); fault.action = action; const r = await reset(); fault.action = "";
  expect(r.status).toBe(500); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
});
test("unknown and inactive reset requests retain the generic reply and create no usable proof or mail", async () => {
  const u = await user(true); await db.user.update({ where: { id: u.id }, data: { status: "closed" } });
  const before = await counts(), missing = await reset("unknown-" + email), closed = await reset(); expect(missing.status).toBe(200); expect(closed.status).toBe(200);
  expect(await missing.json()).toEqual(await closed.json()); expect(await counts()).toEqual(before);
  for (const r of [missing, closed]) expect(await requestEvents(r)).toHaveLength(1);
});
test("verification resend and its audit roll back on storage failure", async () => {
  await user(); const before = await counts(); fault.action = "auth.verification_queued";
  const r = await authRoute(req("/send-verification-email", { email, callbackURL: callback })); fault.action = "";
  expect(r.status).toBe(500); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
});
test("an unverified sign-in retains its intended verification mail alongside the rejected-login audit", async () => {
  await user(); const before = await db.job.count(); const r = await authRoute(req("/sign-in/email", { email, password })); expect(r.status).toBe(403);
  expect(await db.job.count()).toBe(before + 1); const events = await requestEvents(r); expect(events.map(e => e.action)).toEqual(expect.arrayContaining(["auth.verification_queued", "auth.login_rejected"])); expect(events.every(e => e.actorId === null)).toBe(true);
});
test("wrong passwords produce only an anonymous rejected-login event without credentials or a successful session", async () => {
  await user(true); const r = await authRoute(req("/sign-in/email", { email, password: "incorrect" })); expect(r.status).toBe(401);
  const events = await requestEvents(r); expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ actorId: null, tenantId: null, action: "auth.login_rejected", resource: "authentication", resourceId: null }); safe(events, [email, password, "incorrect"]);
});
test("signup failures remain rate limited outside the rolled-back account transaction", async () => {
  fault.action = "auth.account_registered"; const results: number[] = [];
  for (let i = 0; i < 6; i++) results.push((await signup()).status); fault.action = "";
  expect(results).toEqual([500, 500, 500, 500, 500, 429]); expect(await db.user.count({ where: { email } })).toBe(0);
});
test("MFA challenge audit failure rolls back the transient session and challenge cookie/proof", async () => {
  const u = await user(true);
  const login = await authRoute(req("/sign-in/email", { email, password })); expect(login.status).toBe(200); let cookie = cookies(login);
  const enable = await authRoute(req("/two-factor/enable", { password }, cookie)), data = await enable.json();
  const secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  const confirm = await authRoute(req("/two-factor/verify-totp", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }, cookie)); expect(confirm.status).toBe(200); cookie = cookies(confirm);
  const before = await counts(); fault.action = "auth.factor_challenged";
  const r = await authRoute(req("/sign-in/email", { email, password })); fault.action = ""; expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } })).toMatchObject({ user: { id: u.id } });
});
test("a pending MFA proof expiring after backup-code audit restores the code and withholds the new session", async () => {
  const u = await user(true);
  const login = await authRoute(req("/sign-in/email", { email, password })); const cookie = cookies(login);
  const enable = await authRoute(req("/two-factor/enable", { password }, cookie)), data = await enable.json();
  const secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  expect((await authRoute(req("/two-factor/verify-totp", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }, cookie))).status).toBe(200);
  const pending = await authRoute(req("/sign-in/email", { email, password })); expect(pending.status).toBe(200);
  const factor = await db.twoFactor.findFirstOrThrow({ where: { userId: u.id } }), before = await counts();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  fault.action = "auth.backup_code_verified"; fault.expire = true;
  const r = await authRoute(req("/two-factor/verify-backup-code", { code: data.backupCodes[0] }, cookies(pending)));
  fault.action = ""; fault.expire = false; vi.useRealTimers(); expect(r.status).toBe(401); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await counts()).toEqual(before);
  expect(hash((await db.twoFactor.findUniqueOrThrow({ where: { id: factor.id } })).backupCodes)).toBe(hash(factor.backupCodes));
});
test("a closed account cannot confirm a formerly valid signed email link", async () => {
  const u = await user(), link = (await proof()).url; await db.user.update({ where: { id: u.id }, data: { status: "closed" } });
  const r = await authRoute(new Request(link)); expect(r.status).toBe(401);
  expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ emailVerified: false }); expect((await requestEvents(r)).some(e => e.action === "auth.email_verified")).toBe(false);
});
test("an unsafe callback cannot turn a valid signed email link into a committed confirmation", async () => {
  const u = await user(), link = new URL((await proof()).url); link.searchParams.set("callbackURL", "https://untrusted.example");
  const r = await authRoute(new Request(link)); expect(r.status).toBe(400); expect(r.headers.get("location")).toBeNull();
  expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ emailVerified: false });
});
test("signup ignores an unrelated valid session cookie when binding its registration actor", async () => {
  const other = await user(true), login = await authRoute(req("/sign-in/email", { email, password })); expect(login.status).toBe(200);
  email = randomUUID() + "@public-auth.example.test";
  const r = await authRoute(req("/sign-up/email", { email, password, name: "별도 가입" }, cookies(login))); expect(r.status).toBe(200);
  const target = await db.user.findUniqueOrThrow({ where: { email } }), events = await requestEvents(r);
  expect(events.find(e => e.action === "auth.account_registered")).toMatchObject({ actorId: target.id }); expect(events.every(e => e.actorId !== other.id)).toBe(true);
});
test("password recovery remains available with an expired browser session cookie", async () => {
  const u = await user(true), login = await authRoute(req("/sign-in/email", { email, password })); expect(login.status).toBe(200);
  await db.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
  const r = await reset(email, cookies(login)); expect(r.status).toBe(200); expect(await db.verification.count({ where: { value: u.id } })).toBe(1);
  expect((await requestEvents(r)).every(e => e.actorId === null && e.tenantId === null)).toBe(true);
});
test("pending MFA email-code queue and confirmation record the signed challenge actor without the code", async () => {
  const p = await pendingMfa(), sent = await authRoute(req("/two-factor/send-otp", {}, p.cookie)); expect(sent.status).toBe(200);
  const events = await requestEvents(sent); expect(events.map(e => e.action)).toEqual(expect.arrayContaining(["auth.factor_code_requested", "auth.factor_code_queued"])); expect(events.every(e => e.actorId === p.userId)).toBe(true);
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
  const payload = jobs.map(job => decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher)).find(row => row.to === email && row.subject === "로그인 인증코드")!;
  const code = payload.text.match(/인증코드: ([0-9]{6})/)![1]; safe(events.map(e => e.detail), [code]);
  const confirmed = await authRoute(req("/two-factor/verify-otp", { code }, p.cookie)); expect(confirmed.status).toBe(200);
  expect((await requestEvents(confirmed)).some(e => e.action === "auth.factor_verified" && e.actorId === p.userId)).toBe(true);
});
test("email-code queue audit failure restores the OTP proof and job even when sendOTP catches it", async () => {
  const p = await pendingMfa(), before = await counts(); fault.action = "auth.factor_code_queued";
  const r = await authRoute(req("/two-factor/send-otp", {}, p.cookie)); fault.action = "";
  expect(r.status).toBe(500); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
});
test("cross-origin signup produces no registration, mail or success audit", async () => {
  const before = await counts(); const r = await authRoute(req("/sign-up/email", { email, password, name: "차단" }, "", "https://untrusted.example")); expect(r.status).toBe(403); expect(await counts()).toEqual(before); expect(await requestEvents(r)).toHaveLength(0);
});
