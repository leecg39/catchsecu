import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3121");
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = "docs/qa/R05-T04/current", privateFile = ".local/rea-fullstack/profile/fixture.json";
type Person = { userId: string; email: string; password: string; cookie: string };
type Fixture = { people: Record<"owner" | "member" | "foreign", Person>; tenantId: string; memberId: string; serviceId: string; reviewId: string; secondReviewId: string; thirdReviewId: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const tag = process.argv[2]; assert.ok(tag === "baseline" || tag === "after-restart");
  const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8"));
  const checks: { label: string; status: number }[] = [];
  async function request(actor: Person, path: string, method = "GET", body?: unknown): Promise<Response> {
    return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie: actor.cookie, origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  // Fresh HTTP logins do not enter the business-state fingerprint below.
  for (const label of ["owner", "foreign"] as const) {
    const actor = fixture.people[label], response = await request(actor, "/auth/sign-in/email", "POST", { email: actor.email, password: actor.password });
    assert.equal(response.status, 200); actor.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(actor.cookie);
    checks.push({ label: label + " fresh login", status: response.status });
  }
  await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  async function check(actor: Person, path: string, expected: number, label: string) {
    const response = await request(actor, path); assert.equal(response.status, expected, label); checks.push({ label, status: response.status }); return response.json();
  }
  for (const label of ["owner", "foreign"] as const) assert.equal((await check(fixture.people[label], "/me", 200, label + " own profile")).id, fixture.people[label].userId);
  await check(fixture.people.member, "/me", 401, "closed account old session");
  const closedLogin = await request(fixture.people.member, "/auth/sign-in/email", "POST", { email: fixture.people.member.email, password: fixture.people.member.password });
  assert.equal(closedLogin.status, 401); checks.push({ label: "closed account fresh login denied", status: closedLogin.status });

  const closed = await db.user.findUniqueOrThrow({ where: { id: fixture.people.member.userId }, select: { id: true, name: true, department: true, jobTitle: true, phone: true, locale: true, status: true, version: true } });
  assert.deepEqual(closed, { id: fixture.people.member.userId, name: "REA 검증된 프로필", department: "REA 제품 검증", jobTitle: "QA 담당", phone: "010-0000-0000", locale: "ja", status: "closed", version: 6 });
  const closure = await db.accountClosure.findUniqueOrThrow({ where: { userId: closed.id } });
  assert.equal(decrypt<string>(closure.reasonCipher!), "REA 합성 계정 폐쇄 최종 검증");
  const cleared = { sessions: await db.session.count({ where: { userId: closed.id } }), accounts: await db.account.count({ where: { userId: closed.id } }),
    factors: await db.twoFactor.count({ where: { userId: closed.id } }), passwordHistory: await db.passwordHistory.count({ where: { userId: closed.id } }),
    deferrals: await db.passwordDeferral.count({ where: { userId: closed.id } }), proofs: await db.verification.count({ where: { value: closed.id } }), grants: await db.serviceGrant.count({ where: { memberId: fixture.memberId } }) };
  assert.ok(Object.values(cleared).every(count => count === 0));
  const membership = await db.membership.findUniqueOrThrow({ where: { id: fixture.memberId }, select: { id: true, status: true, version: true } });
  assert.equal(membership.status, "revoked"); assert.equal(membership.version, 2);
  const company = await db.company.findUniqueOrThrow({ where: { id: fixture.tenantId }, select: { id: true, status: true, version: true } });
  const service = await db.service.findUniqueOrThrow({ where: { id: fixture.serviceId }, select: { id: true, status: true, version: true } });
  assert.equal(company.status, "active"); assert.equal(service.status, "active");
  const expected = new Map([[fixture.reviewId, ["resolved", "destroyed", 5, 0]], [fixture.secondReviewId, ["resolved", "kept", 5, 3]], [fixture.thirdReviewId, ["cancelled", "none", 2, 2]]]);
  const rows = await db.activityReview.findMany({ where: { tenantId: fixture.tenantId }, include: { messages: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual([row.status, row.destructionStatus, row.version, row.messages.length], expected.get(row.id));
    const actual = await check(fixture.people.owner, "/activity-reviews/" + row.id, 200, "preserved review " + row.id);
    assert.equal(actual.version, row.version); assert.equal(actual.messages.length, row.messages.length);
    for (const message of row.messages) assert.ok(decrypt<string>(message.bodyCipher).startsWith("REA"));
  }
  await check(fixture.people.foreign, "/activity-reviews/" + fixture.secondReviewId, 404, "foreign company denied");
  await check(fixture.people.member, "/activity-reviews/" + fixture.secondReviewId, 401, "closed recipient denied");
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "activity-review:" + fixture.secondReviewId + ":1" }, include: { attemptsLog: { orderBy: { id: "asc" } } } });
  assert.equal(job.status, "done"); assert.equal(job.attempts, 1); assert.equal(job.attemptsLog.length, 1);
  const mailHash = createHash("sha256").update(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).digest("hex");
  assert.equal(mailHash, JSON.parse(await readFile("docs/qa/R05-T04/profile-flow/review-mail.json", "utf8")).fileHash);
  const audits = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId, NOT: { OR: [{ action: { startsWith: "session." } }, { action: { startsWith: "analytics." } }] } },
    select: { id: true, action: true, resourceId: true, requestId: true }, orderBy: { id: "asc" } });
  const state = { closed, closure: { id: closure.id, reasonHash: hash(closure.reasonCipher), completedAt: closure.completedAt }, cleared, membership, company, service,
    reviews: rows.map(row => ({ id: row.id, status: row.status, destructionStatus: row.destructionStatus, version: row.version, messages: row.messages.map(message => ({ id: message.id, kind: message.kind, cipherHash: hash(message.bodyCipher) })) })),
    audits, mail: { id: job.id, status: job.status, attempts: job.attempts, receipts: job.attemptsLog.length, mailHash } };
  const stateHash = hash(state);
  await mkdir(directory, { recursive: true });
  if (tag === "after-restart") assert.equal(stateHash, JSON.parse(await readFile(directory + "/baseline.json", "utf8")).stateHash);
  await writeFile(directory + "/" + tag + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", checks, stateHash, state,
    fingerprintScope: "R05 business data, domain audit and local mail receipt; session and analytics events excluded", externalProviderVerified: false }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length, stateHash, cleared, reviews: rows.length, domainAudits: audits.length }));
} finally { await db.$disconnect(); }
