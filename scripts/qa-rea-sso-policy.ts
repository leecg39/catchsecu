import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
import { recordSsoSessionProof } from "../src/server/sso-session-proof";

const root = ".local/rea-fullstack/sso", file = root + "/policy-writer-bound-http.json", output = "docs/qa/R07-T04/policy-writer";
const mode = process.argv[2], origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local development DB required");
type Fixture = { userId: string; companyId: string; providerId: string; email: string; password: string; cookie: string; hash?: string };
const checks: { action: string; status: number; code?: string }[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw new Error("QA assertion failed: " + message); }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot(f: Fixture) {
  return {
    policy: await db.ssoLoginPolicy.findUnique({ where: { tenantId: f.companyId } }),
    challenges: await db.ssoPolicyChallenge.findMany({ where: { tenantId: f.companyId }, select: { id: true, sessionId: true, mode: true, policyVersion: true, attempts: true, consumedAt: true, revokedAt: true, expiresAt: true }, orderBy: { id: "asc" } }),
    proofs: await db.ssoSessionProof.findMany({ where: { tenantId: f.companyId }, orderBy: { sessionId: "asc" } }),
    sessions: await db.session.findMany({ where: { userId: f.userId }, select: { id: true, activeCompanyId: true, activeServiceId: true, createdAt: true, expiresAt: true }, orderBy: { id: "asc" } }),
    jobs: await db.job.findMany({ where: { tenantId: f.companyId }, select: { id: true, status: true, attempts: true }, orderBy: { id: "asc" } }),
    audit: await db.auditEvent.findMany({ where: { OR: [{ actorId: f.userId }, { tenantId: f.companyId }] }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } }),
  };
}
try {
  await mkdir(output, { recursive: true });
  if (mode === "verify") {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture, state = await snapshot(f);
    check(f.hash === digest(state), "frozen fixture unchanged");
    const report = { checkedAt: new Date().toISOString(), matched: true, stateHash: f.hash, policy: { mode: state.policy?.mode, version: state.policy?.version },
      challenges: state.challenges.length, attempts: state.challenges[0]?.attempts, consumed: !!state.challenges[0]?.consumedAt, proofCount: state.proofs.length, auditCount: state.audit.length };
    await writeFile(output + "/verified.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else if (mode === "http") {
    if (await access(file).then(() => true, () => false)) throw new Error("Consumptive fixture exists; use verify");
    check((await fetch(origin + "/login")).status === 200, "server readiness");
    await mkdir(root, { recursive: true });
    const f: Fixture = { userId: "", companyId: "", providerId: "", email: "rea-policy-" + randomUUID() + "@example.test", password: "Rea-policy!" + randomUUID(), cookie: "" };
    const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await save();
    async function request(action: string, path: string, status: number, input?: unknown, method = input === undefined ? "GET" : "POST") {
      const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, cookie: f.cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const value = await response.clone().json().catch(() => null);
      checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
      check(response.status === status, action + ": expected " + status + ", received " + response.status);
      return { response, value };
    }
    await request("실제 HTTP 계정 생성", "/api/v1/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "SSO 정책 저장 검증" });
    const user = await db.user.update({ where: { email: f.email }, data: { emailVerified: true } }); f.userId = user.id;
    const company = await db.company.create({ data: { name: "REA SSO 정책 저장", publicName: "QA 정책", policy: { create: { sessionMinutes: 240, passwordMonths: 0 } },
      memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "QA 서비스", externalName: "QA" } } } }); f.companyId = company.id;
    const plan = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100, cycle: "trial", priceKrw: 0, features: [],
      capabilities: ["security.sso_login_policy"] } });
    const start = new Date();
    await db.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: plan.id, status: "trialing", activationSource: "trial", priceKrw: 0,
      periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000) } });
    const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "QA 합성 Google 설정", protocol: "oidc", issuer: "https://accounts.google.com",
      clientId: "synthetic-policy-writer", authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", enabled: true, preflightOk: true } }); f.providerId = provider.id; await save();
    const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: provider.issuer + "|" + user.id } });
    const login = await request("실제 HTTP 비밀번호 로그인", "/api/v1/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); await save();
    const selected = { tenantId: company.id, mode: "GOOGLE", version: 0 };
    await request("연결 계정만 있는 비밀번호 세션 거절", "/api/v1/security/sso-policy/challenge", 403, selected);
    // Explicit synthetic provenance fixture. This does not claim a Google login or preflight succeeded.
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    await recordSsoSessionProof(db, session.id, user.id, provider, account.id);
    const view = await request("정책·기능·인증·연결 영향 조회", "/api/v1/security/sso-policy", 200);
    check(view.value.mode === "NONE" && view.value.entitlement.available, "initial policy");
    const issued = (await request("이메일 인증 요청", "/api/v1/security/sso-policy/challenge", 201, selected)).value;
    check(Object.keys(issued).sort().join() === "challengeId,expiresAt,retryAt", "no secret in response");
    await request("중복 발급 간격 제한", "/api/v1/security/sso-policy/challenge", 429, selected);
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sso-policy:" + issued.challengeId } });
    check(await runOneJob("rea-policy-writer", { tenantId: company.id, jobId: job.id }), "scoped delivery");
    check((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status === "done", "local mail completed");
    const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8"));
    const code = String(mail.text).match(/인증번호: (\d{6})/)![1];
    const body = { ...selected, challengeId: issued.challengeId, code };
    await request("오답 거절·실패 횟수 커밋", "/api/v1/security/sso-policy", 422, { ...body, code: code === "000000" ? "000001" : "000000" }, "PUT");
    const saved = (await request("정답 코드 소비와 GOOGLE 정책 저장", "/api/v1/security/sso-policy", 200, body, "PUT")).value;
    check(saved.mode === "GOOGLE" && saved.version === 1, "saved version");
    await request("동일 코드 재전송 버전 충돌", "/api/v1/security/sso-policy", 409, body, "PUT");
    const final = (await request("저장된 정책 다시 조회", "/api/v1/security/sso-policy", 200)).value;
    check(final.mode === "GOOGLE" && final.version === 1, "persisted");
    await request("원본 SSO 현황 경로", "/security/sso", 200);
    await request("원본 SSO 설정 경로", "/security/sso/setting", 200);
    await request("분리된 공급자 관리 경로", "/security/sso/providers", 200);
    const state = await snapshot(f); f.hash = digest(state); await save();
    check(state.challenges[0].attempts === 1 && !!state.challenges[0].consumedAt, "challenge state");
    const report = { checkedAt: new Date().toISOString(), actualHttpChecks: checks.length, checks, stateHash: f.hash, policyWriteApiVerified: true,
      emailTransport: "actual scoped local outbox; SMTP not tested", proofSetup: "explicit synthetic DB provenance; not acquired from Google",
      externalIdpVerified: false, browserVerified: false, policy: { mode: state.policy?.mode, version: state.policy?.version }, proofCount: state.proofs.length, auditCount: state.audit.length };
    await writeFile(output + "/http.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ actualHttpChecks: checks.length, stateHash: f.hash, auditCount: state.audit.length }));
  } else throw new Error("Use http or verify");
} catch (error) {
  await writeFile(output + "/failed.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, message: error instanceof Error ? error.message : "QA failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
