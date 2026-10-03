import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
import type { MemberRecord } from "../src/contracts/members";
import type { AccountClosureStatus } from "../src/contracts/account-closure";
import type { Prisma } from "../src/generated/prisma/client";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100"); assert.equal(env.MAIL_TRANSPORT, "local");
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as {
  people: { id: string; email: string; password: string }[]; companyId: string; memberId: string;
};
const owner = source.people[0], successor = source.people[1];
assert(owner.email.startsWith("p03-owner-") && owner.email.endsWith("@catchsecu.local.test"));
assert(successor.email.startsWith("p03-member-") && successor.email.endsWith("@catchsecu.local.test"));
type Profile = { version: number; name: string; department: string; phone: string; locale: string };
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const sessions: string[] = [], cases: { label: string; status: number }[] = [];
async function call<T>(label: string, path: string, method = "GET", cookie = "", value?: unknown, expected = 200): Promise<T> {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: {
    cookie, ...(method !== "GET" ? { origin } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }),
  }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label); cases.push({ label, status: response.status });
  if (path === "/api/v1/auth/sign-in/email" && expected === 200) {
    const session = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert(session); sessions.push(session); return session as T;
  }
  if (response.headers.get("content-type")?.includes("json")) return await response.json() as T;
  return await response.text() as T;
}
async function login(person: typeof owner) { return call<string>("합성 계정 로그인", "/api/v1/auth/sign-in/email", "POST", "", { email: person.email, password: person.password }); }
async function main() {
  const cookie = await login(owner);
  if (phase === "prepare") {
    assert.equal(await db.membership.count({ where: { tenantId: source.companyId, userId: owner.id, role: "owner", status: "active" } }), 1);
    for (const path of ["/my-page/info", "/my-page/info/edit", "/my-page/delete", "/my-page/activity-log"])
      await call("본인 화면 HTTP", path, "GET", cookie);
    const initial = await call<Profile>("프로필 조회", "/api/v1/me", "GET", cookie);
    const name = "서버 재시작 확인 " + randomUUID().slice(0, 8);
    const updated = await call<Profile>("프로필 실제 저장", "/api/v1/me", "PATCH", cookie, {
      version: initial.version, name, department: "재시작 시험", phone: "010-1111-2222", locale: "en",
    });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).name, name);
    await writeFile(".local/p03-closure-fixture.json", JSON.stringify({ userId: owner.id, expected: {
      version: updated.version, name, department: "재시작 시험", phone: "010-1111-2222", locale: "en",
    }, preparedAt: new Date().toISOString(), serverPid: null }, null, 2), { mode: 0o600 });
    await writeFile("docs/qa/P03-T03/http-prepare.json", JSON.stringify({ phase, result: "passed", cases, browserVerified: false }, null, 2) + "\n");
    return;
  }
  const prepared = JSON.parse(await readFile(".local/p03-closure-fixture.json", "utf8")) as { userId: string; expected: Profile };
  assert.equal(prepared.userId, owner.id);
  assert.deepEqual(await call<Profile>("재시작 후 프로필 유지", "/api/v1/me", "GET", cookie).then(profile => ({ version: profile.version,
    name: profile.name, department: profile.department, phone: profile.phone, locale: profile.locale })), prepared.expected);
  const condition = await call<AccountClosureStatus>("소유권 인계 전 조건", "/api/v1/me/closure", "GET", cookie);
  assert.deepEqual(condition.ownedCompanies.map(row => row.id), [source.companyId]);
  const input = { version: prepared.expected.version, confirmation: owner.email, password: owner.password, reason: "합성 계정 폐쇄 검증" };
  await call("소유권 인계 전 차단", "/api/v1/me/closure", "POST", cookie, input, 409);
  const member = await call<MemberRecord>("인계 대상 조회", "/api/v1/members/" + source.memberId, "GET", cookie);
  await call("실제 소유권 인계", "/api/v1/members/" + source.memberId + "/transfer", "POST", cookie, { version: member.version, password: owner.password });
  assert.equal((await call<AccountClosureStatus>("인계 후 조건", "/api/v1/me/closure", "GET", cookie)).ownedCompanies.length, 0);
  await call("잘못된 암호 차단", "/api/v1/me/closure", "POST", cookie, { ...input, password: "Incorrect-password!123" }, 401);
  const second = await login(owner);
  const own = await call<{ items: { resourceId: string | null }[]; total: number }>("본인 활동 조회", "/api/v1/me/audit-events?search=profile.updated", "GET", cookie);
  assert(own.total > 0 && own.items.every(row => row.resourceId === null));
  const csv = await call<string>("본인 활동 CSV", "/api/v1/me/audit-events/export?search=profile.updated", "GET", cookie);
  assert.equal(csv.split("\r\n").filter(Boolean).length, own.total + 1);
  const eligible = (): Prisma.JobWhereInput => ({ OR: [{ status: { in: ["queued", "retry"] }, dueAt: { lte: new Date() } },
    { status: "leased", leaseUntil: { lt: new Date() } }] });
  assert.equal(await db.job.count({ where: eligible() }), 0, "다른 사용자의 대기 작업을 처리하지 않습니다.");
  await call("암호 재설정 메일 생성", "/api/v1/auth/request-password-reset", "POST", "", { email: owner.email, redirectTo: origin + "/reset" });
  const jobs = await db.job.findMany({ where: eligible() });
  assert.equal(jobs.length, 1); assert.equal(jobs[0].type, "mail");
  assert.equal(decrypt<{ to: string }>(jobs[0].payloadCipher).to, owner.email);
  assert(await runOneJob("p03-closure-http"));
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, jobs[0].id + ".json"), "utf8")) as { text: string };
  const reset = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(reset.origin, origin);
  const token = reset.pathname.split("/").pop(); assert(token);
  await call("계정 폐쇄", "/api/v1/me/closure", "POST", cookie, input);
  for (const session of [cookie, second]) await call("폐쇄 후 세션 재사용 차단", "/api/v1/me", "GET", session, undefined, 401);
  await call("폐쇄 후 로그인 차단", "/api/v1/auth/sign-in/email", "POST", "", { email: owner.email, password: owner.password }, 401);
  await call("폐쇄 후 재설정 링크 차단", "/api/v1/auth/reset-password", "POST", "", { token, newPassword: "Fresh-closure-password!456" }, 400);
  const databaseProof = { account: (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).status,
    sessions: await db.session.count({ where: { userId: owner.id } }), credentials: await db.account.count({ where: { userId: owner.id } }),
    activeMemberships: await db.membership.count({ where: { userId: owner.id, status: "active" } }),
    grants: await db.serviceGrant.count({ where: { member: { userId: owner.id } } }),
    closures: await db.accountClosure.count({ where: { userId: owner.id } }),
    successorOwners: await db.membership.count({ where: { tenantId: source.companyId, userId: successor.id, role: "owner", status: "active" } }),
    companyStatus: (await db.company.findUniqueOrThrow({ where: { id: source.companyId } })).status,
    preservedServices: await db.service.count({ where: { tenantId: source.companyId } }),
    auditEvents: await db.auditEvent.count({ where: { actorId: owner.id, action: "account.closed" } }) };
  assert.equal(databaseProof.account, "closed"); assert.equal(databaseProof.sessions, 0); assert.equal(databaseProof.credentials, 0);
  assert.equal(databaseProof.activeMemberships, 0); assert.equal(databaseProof.grants, 0); assert.equal(databaseProof.closures, 1);
  assert.equal(databaseProof.successorOwners, 1); assert.equal(databaseProof.companyStatus, "active"); assert(databaseProof.preservedServices > 0);
  await writeFile("docs/qa/P03-T03/http-finish.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases,
    browserVerified: false, mailTransport: "local", database: databaseProof }, null, 2) + "\n");
}
try { await main(); console.log(JSON.stringify({ result: "passed", phase, httpCases: cases.length })); }
catch { console.error("계정 폐쇄 HTTP 검증 실패. 마지막 완료 단계: " + (cases.at(-1)?.label ?? "준비")); process.exitCode = 1; }
finally {
  for (const cookie of sessions) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie } }).catch(() => {});
  await db.$disconnect();
}
