import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
const base = ".local/rea-fullstack/sso", file = base + "/org-email-http.json", output = "docs/qa/R07-T04/org-email";
const mode = process.argv[2], origin = new URL(env.BETTER_AUTH_URL).origin, url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local development database required");
type Fixture = { ownerId: string; userId: string; companyId: string; providerId: string; memberId: string; ownerEmail: string; email: string; password: string; cookie: string; ownerCookie: string; stateHash?: string };
const checks: { action: string; status: number; code?: string }[] = [];
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error("QA assertion failed: " + reason); }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot(f: Fixture) {
  return {
    directory: await db.virtualOrgMember.findMany({ where: { tenantId: f.companyId }, select: { id: true, version: true, emailCipher: true }, orderBy: { id: "asc" } }),
    states: await db.ssoState.count({ where: { tenantId: f.companyId } }), challenges: await db.orgEmailChallenge.count({ where: { tenantId: f.companyId } }),
    accounts: await db.account.findMany({ where: { providerId: "sso:" + f.providerId }, select: { id: true, userId: true }, orderBy: { id: "asc" } }),
    proofs: await db.ssoSessionProof.findMany({ where: { tenantId: f.companyId }, orderBy: { sessionId: "asc" } }),
    users: await db.user.findMany({ where: { id: { in: [f.userId, f.ownerId] } }, select: { id: true, emailVerified: true, status: true }, orderBy: { id: "asc" } }),
    sessions: await db.session.findMany({ where: { userId: { in: [f.userId, f.ownerId] } }, select: { id: true, userId: true, activeCompanyId: true, expiresAt: true }, orderBy: { id: "asc" } }),
    jobs: await db.job.findMany({ where: { tenantId: f.companyId }, select: { id: true, status: true, attempts: true }, orderBy: { id: "asc" } }),
    audit: await db.auditEvent.findMany({ where: { tenantId: f.companyId }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } }),
  };
}
try {
  await mkdir(output, { recursive: true });
  if (mode === "verify" || mode === "restart") {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture;
    if (mode === "restart") {
      const response = await fetch(origin + "/api/v1/me", { headers: { cookie: f.cookie, origin } });
      check(response.status === 200, "registered session works after server restart");
    }
    const current = await snapshot(f); check(digest(current) === f.stateHash, "frozen rows unchanged");
    const report = { checkedAt: new Date().toISOString(), matched: true, stateHash: f.stateHash, actualHttpChecks: mode === "restart" ? 1 : 0,
      directoryVersion: current.directory[0].version, states: current.states, challenges: current.challenges, accounts: current.accounts.length,
      proofs: current.proofs.length, auditCount: current.audit.length, mailStatus: current.jobs[0]?.status };
    await writeFile(`${output}/${mode}.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else if (mode === "http") {
    if (await access(file).then(() => true, () => false)) throw new Error("Consumptive fixture already exists; use verify");
    check((await fetch(origin + "/login")).status === 200, "server readiness");
    await mkdir(base, { recursive: true });
    const f: Fixture = { ownerId: "", userId: "", companyId: "", providerId: "", memberId: "", ownerEmail: "rea-org-owner-" + randomUUID() + "@example.test",
      email: "rea-org-member-" + randomUUID() + "@example.test", password: "Rea-org!" + randomUUID(), cookie: "", ownerCookie: "" };
    const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await save();
    async function request(action: string, path: string, status: number, input?: unknown, method = input === undefined ? "GET" : "POST", cookie = "") {
      const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, cookie,
        ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const value = await response.clone().json().catch(() => null);
      checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
      check(response.status === status, action + ": expected " + status + ", received " + response.status); return { response, value };
    }
    await request("소유자 계정 HTTP 생성", "/api/v1/auth/sign-up/email", 200, { email: f.ownerEmail, password: f.password, name: "조직 이메일 QA" });
    const owner = await db.user.update({ where: { email: f.ownerEmail }, data: { emailVerified: true } }); f.ownerId = owner.id;
    const company = await db.company.create({ data: { name: "REA 조직 이메일 등록", publicName: "QA 조직", policy: { create: { passwordMonths: 0, sessionMinutes: 240 } },
      memberships: { create: { userId: owner.id, role: "owner" } } } }); f.companyId = company.id; await save();
    const login = await request("소유자 HTTP 로그인", "/api/v1/auth/sign-in/email", 200, { email: f.ownerEmail, password: f.password });
    f.ownerCookie = login.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); await save();
    const provider = (await request("가상 조직 공급자 생성", "/api/v1/security/sso", 201, { tenantId: f.companyId, protocol: "gpki", name: "REA 이메일 소유 확인" }, "POST", f.ownerCookie)).value;
    f.providerId = provider.id; await save();
    await request("공급자 활성화", `/api/v1/security/sso/${provider.id}`, 200, { version: provider.version, enabled: true }, "PATCH", f.ownerCookie);
    const credentials = { protocol: "gpki", orgCode: "QA-" + randomUUID().slice(0, 8), employeeNo: "EMP-1", pin: "741852" };
    const member = (await request("이메일 없는 디렉터리 생성", `/api/v1/security/sso/${provider.id}/directory`, 201,
      { orgCode: credentials.orgCode, employeeNo: credentials.employeeNo, pin: credentials.pin, name: "QA 신규 구성원" }, "POST", f.ownerCookie)).value;
    f.memberId = member.id; await save();
    const start = await request("공급자 링크에서 로그인 시작", `/api/v1/auth/sso/${provider.id}`, 302);
    const state = new URL(start.response.headers.get("location")!, origin).searchParams.get("state")!;
    const pending = (await request("PIN 검증 후 이메일 단계 전환", "/api/v1/auth/org/login", 200, { ...credentials, state })).value;
    check(pending.status === "email-register" && pending.protocol === "gpki", "ticket metadata");
    await request("번호 없는 선점 거절", "/api/v1/auth/org/email-register", 422, { ticket: pending.ticket, email: f.email });
    check(!await db.user.findUnique({ where: { email: f.email } }), "no unverified user created");
    const challenge = (await request("이메일 인증번호 요청", "/api/v1/auth/org/email-register/challenge", 200, { ticket: pending.ticket, email: f.email })).value;
    check(Object.keys(challenge).sort().join() === "challengeId,expiresAt,retryAt", "no code returned");
    await request("재발급 간격 제한", "/api/v1/auth/org/email-register/challenge", 429, { ticket: pending.ticket, email: f.email });
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:org-email:" + challenge.challengeId } });
    check(await runOneJob("rea-org-email", { tenantId: company.id, jobId: job.id }), "scoped mail delivery");
    check((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status === "done", "mail done");
    const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8")); check(mail.to === f.email, "mail recipient");
    const code = String(mail.text).match(/인증번호: (\d{6})/)![1], body = { ticket: pending.ticket, email: f.email, challengeId: challenge.challengeId, code };
    await request("다른 이메일에 번호 재사용 거절", "/api/v1/auth/org/email-register", 404, { ...body, email: "other@example.test" });
    await request("잘못된 번호 거절", "/api/v1/auth/org/email-register", 422, { ...body, code: code === "000000" ? "111111" : "000000" });
    check((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).attempts === 1, "wrong attempt committed");
    const registered = await request("번호 확인·디렉터리·계정·세션 생성", "/api/v1/auth/org/email-register", 200, body);
    check(registered.value.status === "verified", "verified response");
    f.cookie = registered.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    f.userId = (await db.user.findUniqueOrThrow({ where: { email: f.email } })).id; await save();
    await request("등록 티켓 재사용 거절", "/api/v1/auth/org/email-register", 401, body);
    await request("발급된 세션으로 본인 조회", "/api/v1/me", 200, undefined, "GET", f.cookie);
    await request("이메일 등록 전용 페이지", "/gpki/email-register", 200);
    const final = await snapshot(f); check(decrypt(final.directory[0].emailCipher!) === f.email, "verified directory email");
    check(final.directory[0].version === 2 && final.states === 0 && final.challenges === 0 && final.accounts.length === 1 && final.proofs[0].identityProvider === "OTHER", "atomic result");
    f.stateHash = digest(final); await save();
    const report = { checkedAt: new Date().toISOString(), actualHttpChecks: checks.length, checks, stateHash: f.stateHash, directoryVersion: final.directory[0].version,
      states: final.states, challenges: final.challenges, accounts: final.accounts.length, proofs: final.proofs.length, auditCount: final.audit.length,
      emailTransport: "actual scoped local outbox; SMTP not tested", fixtureSetup: "explicit DB owner verification/company bootstrap; member ownership acquired by delivered email OTP",
      externalGpkiVerified: false, browserVerified: false };
    await writeFile(output + "/http.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ actualHttpChecks: checks.length, stateHash: f.stateHash, auditCount: final.audit.length }));
  } else throw new Error("Use http, restart, or verify");
} catch (error) {
  await writeFile(output + "/failed.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, message: error instanceof Error ? error.message : "QA failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
