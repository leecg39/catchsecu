import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
const folder = ".local/rea-fullstack/sso/binding", file = folder + "/fixture.json", output = "docs/qa/R07-T04/browser-binding";
const mode = process.argv[2], origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local development DB required");
type Fixture = { ownerId: string; userId: string; companyId: string; providerId: string; memberId: string; browserMemberId: string; ownerEmail: string; email: string; browserEmail: string; password: string; orgCode: string; pin: string; ownerCookie: string; cookie: string; bindingCookie: string; hash?: string };
const checks: { action: string; status: number; code?: string }[] = [];
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error("QA assertion failed: " + reason); }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const binding = (response: Response) => response.headers.getSetCookie().find(c => /^catchsecu-sso-browser-local-[a-f0-9]{32}=/.test(c));
async function request(action: string, path: string, status: number, input?: unknown, cookie = "", method = input === undefined ? "GET" : "POST", accept = "application/json") {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, cookie, accept,
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json().catch(() => null);
  checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
  check(response.status === status, action + ": expected " + status + ", got " + response.status); return { response, value };
}
async function snapshot(f: Fixture) {
  return db.$transaction(async tx => {
    const memberships = await tx.membership.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } });
    const userIds = [...new Set([f.ownerId, ...memberships.map(m => m.userId)])];
    return {
      directory: await tx.virtualOrgMember.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      providers: await tx.ssoProvider.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      states: await tx.ssoState.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      challenges: await tx.orgEmailChallenge.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      accounts: await tx.account.findMany({ where: { userId: { in: userIds } }, orderBy: { id: "asc" } }),
      users: await tx.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: "asc" } }),
      memberships,
      proofs: await tx.ssoSessionProof.findMany({ where: { tenantId: f.companyId }, orderBy: { sessionId: "asc" } }),
      sessions: await tx.session.findMany({ where: { userId: { in: userIds } }, orderBy: { id: "asc" },
        select: { id: true, userId: true, expiresAt: true, activeCompanyId: true, activeServiceId: true } }),
      audit: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      jobs: await tx.job.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    };
  }, { isolationLevel: "RepeatableRead" });
}
async function deliver(f: Fixture, challengeId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:org-email:" + challengeId } });
  if (job.status !== "done") await runOneJob("rea-sso-binding", { tenantId: f.companyId, jobId: job.id });
  check((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status === "done", "scoped mail delivered");
  const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8"));
  const code = String(mail.text).match(/인증번호: (\d{6})/)?.[1]; check(code, "mail has code");
  return { code, jobId: job.id, to: mail.to };
}
async function verifyHttpSaml(f: Fixture) {
  const saml = await db.ssoProvider.create({ data: { tenantId: f.companyId, name: "QA HTTP 거절 SAML", protocol: "saml", issuer: "https://saml.binding.test",
    clientId: "binding-saml", authorizationUrl: "https://saml.binding.test/login", idpCert: await readFile(folder + "/saml-cert.pem", "utf8"), enabled: true, preflightOk: true } });
  const result = await request("HTTP SAML 시작 거절", "/api/v1/auth/sso/" + saml.id, 503, undefined, f.bindingCookie);
  check(result.value.error.code === "SSO_HTTPS_REQUIRED", "SAML requires HTTPS");
  check(await db.ssoState.count({ where: { tenantId: f.companyId } }) === 0, "HTTP SAML creates no state");
}
async function httpReport() {
  const report = { checkedAt: new Date().toISOString(), actualHttpChecks: checks.length, checks,
    setup: "Owner verification/company and cancel-only OIDC/SAML settings explicitly inserted in DB; virtual directory CRUD and OTP use actual HTTP and scoped local mail.",
    externalAuthentication: false, actualHttpsBrowser: false };
  await writeFile(output + "/http.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ actualHttpChecks: checks.length, passed: true }));
}
try {
  await mkdir(folder, { recursive: true }); await mkdir(output, { recursive: true });
  if (mode === "http") {
    check(!await access(file).then(() => true, () => false), "fixture must be fresh");
    const tag = randomUUID().slice(0, 8);
    const f: Fixture = { ownerId: "", userId: "", companyId: "", providerId: "", memberId: "", browserMemberId: "", ownerEmail: "binding-owner-" + tag + "@example.test",
      email: "binding-http-" + tag + "@example.test", browserEmail: "binding-ego-" + tag + "@example.test", password: "Binding-QA!" + randomUUID(),
      orgCode: "BIND-" + tag, pin: "741852", ownerCookie: "", cookie: "", bindingCookie: "" };
    const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await save();
    await request("소유자 HTTP 가입", "/api/v1/auth/sign-up/email", 200, { email: f.ownerEmail, password: f.password, name: "브라우저 결합 QA" });
    f.ownerId = (await db.user.update({ where: { email: f.ownerEmail }, data: { emailVerified: true } })).id;
    f.companyId = (await db.company.create({ data: { name: "REA 브라우저 결합 " + tag, publicName: "QA", policy: { create: { passwordMonths: 0, sessionMinutes: 240 } },
      memberships: { create: { userId: f.ownerId, role: "owner" } } } })).id; await save();
    const owner = await request("소유자 HTTP 로그인", "/api/v1/auth/sign-in/email", 200, { email: f.ownerEmail, password: f.password });
    f.ownerCookie = owner.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); await save();
    const provider = (await request("가상 조직 공급자 생성", "/api/v1/security/sso", 201, { tenantId: f.companyId, protocol: "gpki", name: "브라우저 결합 QA" }, f.ownerCookie)).value;
    f.providerId = provider.id; await save();
    await request("가상 공급자 활성화", "/api/v1/security/sso/" + provider.id, 200, { version: provider.version, enabled: true }, f.ownerCookie, "PATCH");
    for (const employeeNo of ["HTTP", "EGO"]) {
      const member = (await request(employeeNo + " 디렉터리 생성", "/api/v1/security/sso/" + provider.id + "/directory", 201,
        { orgCode: f.orgCode, employeeNo, pin: f.pin, name: "QA " + employeeNo }, f.ownerCookie)).value;
      if (employeeNo === "HTTP") f.memberId = member.id; else f.browserMemberId = member.id; await save();
    }
    const start = await request("공개 로그인 시작", "/api/v1/auth/sso/" + provider.id, 302);
    const setCookie = binding(start.response); check(setCookie, "binding cookie exists");
    check(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax") && !setCookie.includes("Secure"), "explicit local transport cookie");
    f.bindingCookie = setCookie.split(";")[0]; await save();
    const firstState = await db.ssoState.findFirstOrThrow({ where: { tenantId: f.companyId } });
    const state = new URL(start.response.headers.get("location")!, origin).searchParams.get("state");
    const credentials = { protocol: "gpki", orgCode: f.orgCode, employeeNo: "HTTP", pin: f.pin, state };
    const missing = await request("쿠키 없는 PIN 티켓 전환 거절", "/api/v1/auth/org/login", 401, credentials);
    check(missing.value.error.code === "SSO_BROWSER_MISMATCH", "missing binding rejected");
    const pending = await request("시작 브라우저 PIN 티켓 전환", "/api/v1/auth/org/login", 200, credentials, f.bindingCookie);
    check(Object.keys(pending.value).sort().join() === "expiresAt,protocol,status,ticket", "response allowlist");
    check((await db.ssoState.findFirstOrThrow({ where: { tenantId: f.companyId } })).browserHash === firstState.browserHash, "hash preserved through ticket conversion");
    const challengeBody = { ticket: pending.value.ticket, email: f.email };
    for (const [label, cookie] of [["누락", ""], ["변조", f.bindingCookie.split("=")[0] + "=" + "x".repeat(43)], ["중복", f.bindingCookie + "; " + f.bindingCookie]]) {
      const denied = await request(label + " 쿠키 메일 발급 거절", "/api/v1/auth/org/email-register/challenge", 401, challengeBody, cookie);
      check(denied.value.error.code === "SSO_BROWSER_MISMATCH", "challenge browser guard");
    }
    check(await db.orgEmailChallenge.count({ where: { tenantId: f.companyId } }) === 0, "rejected requests create no challenge");
    const challenge = (await request("시작 브라우저 메일 발급", "/api/v1/auth/org/email-register/challenge", 200, challengeBody, f.bindingCookie)).value;
    const mail = await deliver(f, challenge.challengeId); check(mail.to === f.email, "intended recipient");
    const registration = { ...challengeBody, challengeId: challenge.challengeId, code: mail.code };
    const wrongBrowser = await request("올바른 OTP라도 쿠키 누락 시 거절", "/api/v1/auth/org/email-register", 401, registration);
    check(wrongBrowser.value.error.code === "SSO_BROWSER_MISMATCH", "OTP cannot replace browser binding");
    check((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).attempts === 0, "foreign request does not consume attempts");
    const done = await request("시작 브라우저 OTP 완료", "/api/v1/auth/org/email-register", 200, registration, f.bindingCookie);
    f.cookie = done.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    f.userId = (await db.user.findUniqueOrThrow({ where: { email: f.email } })).id; await save();
    await request("등록 세션 조회", "/api/v1/me", 200, undefined, f.cookie);
    await request("소비한 티켓 재사용 거절", "/api/v1/auth/org/email-register", 401, registration, f.bindingCookie);
    const oidc = await db.ssoProvider.create({ data: { tenantId: f.companyId, name: "QA 취소 전용 OIDC", protocol: "oidc", issuer: "https://idp.binding.test",
      clientId: "binding-local", authorizationUrl: "https://idp.binding.test/authorize", tokenUrl: "https://idp.binding.test/token", jwksUrl: "https://idp.binding.test/jwks", enabled: true, preflightOk: true } });
    const oidcStart = await request("OIDC 취소 흐름 시작", "/api/v1/auth/sso/" + oidc.id, 302, undefined, f.bindingCookie);
    check(binding(oidcStart.response)?.split(";")[0] === f.bindingCookie, "existing binding reused");
    const oidcState = new URL(oidcStart.response.headers.get("location")!).searchParams.get("state")!;
    const callback = "/api/v1/auth/sso/callback?" + new URLSearchParams({ state: oidcState, error: "access_denied" });
    const foreignCancel = await request("다른 브라우저 취소는 state 보존", callback, 401);
    check(foreignCancel.value.error.code === "SSO_BROWSER_MISMATCH", "cancel bound before consume");
    check(await db.ssoState.count({ where: { tenantId: f.companyId } }) === 1, "state preserved");
    const recovery = await request("문서 콜백의 안전한 오류 복귀", callback, 303, undefined, "", "GET", "text/html");
    check(recovery.response.headers.get("location")?.includes("error=SSO_BROWSER_MISMATCH"), "recovery error allowlist");
    const cancel = await request("시작 브라우저 취소 처리", callback, 401, undefined, f.bindingCookie);
    check(cancel.value.error.code === "PROVIDER_DENIED", "legitimate cancellation");
    check(await db.ssoState.count({ where: { tenantId: f.companyId } }) === 0, "cancel consumes state");
    await verifyHttpSaml(f); await httpReport();
  } else {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture;
    check(!f.hash || ["verify", "restart"].includes(mode), "frozen fixture is read only");
    if (mode === "finish-http") {
      check(!await access(output + "/http.json").then(() => true, () => false), "completed HTTP fixture cannot be replayed");
      check(await db.ssoProvider.count({ where: { tenantId: f.companyId, protocol: "saml" } }) === 0, "failed SAML fixture created no provider");
      const prior = JSON.parse(await readFile(output + "/failed-http.json", "utf8"));
      check(prior.checks.at(-1)?.code === "PROVIDER_DENIED", "resume only after verified cancellation");
      checks.push(...prior.checks); await verifyHttpSaml(f); await httpReport();
    } else if (mode === "deliver-browser") {
      const challenge = await db.orgEmailChallenge.findFirstOrThrow({ where: { tenantId: f.companyId, state: { orgMemberId: f.browserMemberId }, revokedAt: null }, orderBy: { createdAt: "desc" } });
      const mail = await deliver(f, challenge.id);
      await writeFile(folder + "/code.json", JSON.stringify({ code: mail.code, challengeId: challenge.id, jobId: mail.jobId }), { mode: 0o600 });
      console.log(JSON.stringify({ delivered: true, jobId: mail.jobId }));
    } else if (["freeze", "verify", "restart"].includes(mode)) {
      if (mode === "restart") await request("재시작 뒤 HTTP 세션 유지", "/api/v1/me", 200, undefined, f.cookie);
      const state = await snapshot(f), hash = digest(state);
      if (mode === "freeze") { f.hash = hash; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); }
      check(hash === f.hash, "frozen relational rows unchanged");
      const report = { checkedAt: new Date().toISOString(), matched: true, stateHash: hash, registeredMembers: state.directory.filter(m => m.emailCipher).length,
        states: state.states.length, challenges: state.challenges.length, accounts: state.accounts.length, sessions: state.sessions.length,
        proofs: state.proofs.length, audits: state.audit.length, jobs: state.jobs.map(j => ({ status: j.status })), actualHttpChecks: checks.length,
        snapshot: "RepeatableRead, full scoped relational rows except session token/updatedAt; no external authentication asserted" };
      await writeFile(output + "/" + mode + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else throw new Error("Unknown mode");
  }
} catch (error) {
  await mkdir(output, { recursive: true });
  await writeFile(output + "/failed-" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, message: error instanceof Error ? error.message : "QA failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
