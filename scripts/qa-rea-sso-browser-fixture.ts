import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { encrypt, tokenHash } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
import { recordSsoSessionProof } from "../src/server/sso-session-proof";
const folder = ".local/rea-fullstack/sso/browser", file = folder + "/fixture.json", mode = process.argv[2], caseName = process.argv[3];
const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Development DB required");
type Fixture = { userId: string; companyId: string; providerId: string; googleId: string; accountId: string; email: string; password: string; orgCode: string; pin: string; members: Record<string, { id: string; employeeNo: string; email: string }>; hash?: string };
try {
  await mkdir(folder, { recursive: true });
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) throw new Error("Fixture already exists");
    const tag = randomUUID().slice(0, 8), email = `rea-browser-${tag}@example.test`, password = "Rea-browser!" + randomUUID();
    const response = await fetch(origin + "/api/v1/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "REA 브라우저 검증" }) });
    if (response.status !== 200) throw new Error("Signup fixture failed");
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const company = await db.company.create({ data: { name: "REA 브라우저 인증 " + tag, publicName: "QA 인증", policy: { create: { sessionMinutes: 240, passwordMonths: 0 } },
      memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "QA 서비스", externalName: "QA" } } } });
    const plan = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100, cycle: "trial", priceKrw: 0,
      features: [], capabilities: ["security.sso_login_policy"] } });
    const now = new Date();
    await db.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: plan.id, status: "trialing", activationSource: "trial", priceKrw: 0,
      periodStart: now, periodEnd: new Date(now.getTime() + 7 * 86400000) } });
    const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "QA 가상 GPKI", protocol: "gpki", issuer: "urn:virtual:gpki", clientId: "virtual",
      authorizationUrl: "http://localhost:3100/login/gpki", enabled: true, preflightOk: true, preflightDetail: "명시적 가상 디렉터리 fixture" } });
    const google = await db.ssoProvider.create({ data: { tenantId: company.id, name: "QA 합성 Google 설정", protocol: "oidc", issuer: "https://accounts.google.com",
      clientId: "synthetic-browser-policy", authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", enabled: true, preflightOk: true } });
    const account = await db.account.create({ data: { providerId: "sso:" + google.id, accountId: google.issuer + "|" + user.id, userId: user.id } });
    const f: Fixture = { userId: user.id, companyId: company.id, providerId: provider.id, googleId: google.id, accountId: account.id,
      email, password, orgCode: "BROWSER-" + tag, pin: "753159", members: {} };
    for (const name of ["success", "storage", "attempts", "expired", "edited"]) {
      const member = await db.virtualOrgMember.create({ data: { tenantId: company.id, providerId: provider.id, orgCode: f.orgCode, employeeNo: name,
        nameCipher: encrypt("QA " + name), pinHash: tokenHash(`orgpin:${f.orgCode}:${name}:${f.pin}`) } });
      f.members[name] = { id: member.id, employeeNo: name, email: `rea-${name}-${tag}@example.test` };
    }
    await writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify({ prepared: true, companyId: company.id, members: Object.keys(f.members) }));
  } else {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture;
    if (f.hash && mode !== "verify") throw new Error("Frozen fixture; verify only");
    if (mode === "proof") {
      const session = await db.session.findFirstOrThrow({ where: { userId: f.userId }, orderBy: { createdAt: "desc" } });
      const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: f.googleId } });
      await recordSsoSessionProof(db, session.id, f.userId, provider, f.accountId);
      console.log(JSON.stringify({ syntheticProof: true, identity: "GOOGLE", externalLogin: false }));
    } else if (mode === "deliver-org" || mode === "deliver-policy") {
      const challenge = mode === "deliver-org"
        ? await db.orgEmailChallenge.findFirstOrThrow({ where: { tenantId: f.companyId, state: { orgMemberId: f.members[caseName].id }, revokedAt: null }, orderBy: { createdAt: "desc" } })
        : await db.ssoPolicyChallenge.findFirstOrThrow({ where: { tenantId: f.companyId, consumedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } });
      const prefix = mode === "deliver-org" ? "mail:org-email:" : "mail:sso-policy:";
      const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: prefix + challenge.id } });
      if (job.status !== "done") await runOneJob("rea-browser-mail", { tenantId: f.companyId, jobId: job.id });
      if ((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status !== "done") throw new Error("Mail not delivered");
      const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8"));
      const code = mail.text.match(/인증번호: (\d{6})/)?.[1]; if (!code) throw new Error("No code in mail");
      await writeFile(folder + "/current-code.json", JSON.stringify({ code, challengeId: challenge.id, jobId: job.id, mode, caseName }), { mode: 0o600 });
      console.log(JSON.stringify({ delivered: true, mode, caseName, jobId: job.id }));
    } else if (mode === "expire-ticket") {
      if (!f.members[caseName]) throw new Error("Unknown member");
      const result = await db.ssoState.updateMany({ where: { tenantId: f.companyId, orgMemberId: f.members[caseName].id }, data: { expiresAt: new Date(Date.now() - 1) } });
      console.log(JSON.stringify({ expiredFixtureTickets: result.count }));
    } else if (mode === "freeze" || mode === "verify") {
      // Hash relational rows from one stable DB snapshot; no rows or credentials are published.
      const state = await db.$transaction(async tx => {
        const memberships = await tx.membership.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } });
        const userIds = [...new Set([f.userId, ...memberships.map(m => m.userId)])];
        return {
          members: await tx.virtualOrgMember.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          policy: await tx.ssoLoginPolicy.findUnique({ where: { tenantId: f.companyId } }),
          challenges: await tx.ssoPolicyChallenge.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          emailChallenges: await tx.orgEmailChallenge.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          states: await tx.ssoState.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          providers: await tx.ssoProvider.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          proofs: await tx.ssoSessionProof.findMany({ where: { tenantId: f.companyId }, orderBy: { sessionId: "asc" } }),
          memberships,
          users: await tx.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: "asc" } }),
          accounts: await tx.account.findMany({ where: { userId: { in: userIds } }, orderBy: { id: "asc" } }),
          sessions: await tx.session.findMany({ where: { userId: { in: userIds } }, orderBy: { id: "asc" },
            select: { id: true, userId: true, createdAt: true, expiresAt: true, activeCompanyId: true, activeServiceId: true } }),
          subscriptions: await tx.billingSubscription.findMany({ where: { tenantId: f.companyId }, include: { planVersion: true }, orderBy: { id: "asc" } }),
          audit: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
          jobs: await tx.job.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
        };
      }, { isolationLevel: "RepeatableRead" });
      const mailFiles = await Promise.all(state.jobs.filter(j => j.status === "done" && j.dedupeKey?.startsWith("mail:"))
        .map(async j => ({ jobId: j.id, sha256: createHash("sha256").update(await readFile(env.LOCAL_MAIL_DIR + "/" + j.id + ".json")).digest("hex") })));
      // This exact baseline was frozen before migration109. Verify the added column
      // is still null, then compare the original serialization without rebaselining.
      const legacySchema108 = f.hash === "b891f5e8b670f8f76ab9f6cfe22f26a933d61f15155e86bacb138c6ec66eb9ff";
      const hashState = legacySchema108 ? { ...state, states: state.states.map(({ browserHash, ...row }) => {
        if (browserHash !== null) throw new Error("Historical unbound SSO state changed");
        return row;
      }) } : state;
      const hash = createHash("sha256").update(JSON.stringify({ state: hashState, mailFiles })).digest("hex");
      if (mode === "freeze") { f.hash = hash; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); }
      if (hash !== f.hash) throw new Error("Frozen state changed");
      const report = { checkedAt: new Date().toISOString(), stateHash: hash, matched: true, legacySchema108, additiveBrowserHashVerifiedNull: legacySchema108 ? state.states.length : null, policy: state.policy ? { mode: state.policy.mode, version: state.policy.version } : null,
        registeredMembers: state.members.filter(m => m.emailCipher).length, providers: state.providers.length, states: state.states.length, accounts: state.accounts.length, sessions: state.sessions.length, proofs: state.proofs.length, mailFiles: mailFiles.length, audits: state.audit.length, jobs: state.jobs.map(j => ({ status: j.status })), snapshot: "RepeatableRead DB snapshot plus delivered local-mail file hashes; session token/updatedAt omitted; hash freeze is verification baseline, not a DB write lock", setup: "Explicit synthetic provider/proof/company/directory fixtures; real browser actions and scoped local mail follow." };
      await mkdir("docs/qa/R07-T04/browser-followup", { recursive: true });
      await writeFile(`docs/qa/R07-T04/browser-followup/${mode}.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else throw new Error("Unknown fixture mode");
  }
} finally { await db.$disconnect(); }
