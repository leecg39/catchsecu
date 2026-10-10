import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { roleCapabilities } from "../src/server/permissions";
import type { AccessRequestList } from "../src/contracts/access-requests";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const privateFile = ".local/rea-fullstack/access-fixture.json", evidence = "docs/qa/R03-T04/access-flow";
type Actor = { email: string; password: string; userId: string; memberId: string };
type Fixture = { origin: string; tenantId: string; serviceId: string; owner: Actor; requester: Actor };
async function request(path: string, method = "GET", value?: unknown, cookie = "", headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function account(label: string) {
  const email = "rea-access-" + label + "-" + randomUUID() + "@catchsecu.test", password = randomBytes(24).toString("hex") + "Aa!";
  assert.equal((await request("/auth/sign-up/email", "POST", { email, password, name: "REA 접근 " + label })).status, 200);
  // Only a fresh local synthetic identity is verified directly; no live account is altered.
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  return { email, password, userId: user.id, memberId: "" };
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes("--prepare")) {
    let fixture: Fixture;
    try { fixture = JSON.parse(await readFile(privateFile, "utf8")); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      const owner = await account("owner"), requester = await account("requester");
      const response = await request("/auth/sign-in/email", "POST", { email: owner.email, password: owner.password }); assert.equal(response.status, 200);
      const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      const company = await request("/companies", "POST", { name: "REA 접근 요청 시험 1010", publicName: "REA 합성 접근 회사" }, cookie); assert.equal(company.status, 201);
      const tenantId = (await company.json()).id as string;
      const service = await db.service.findFirstOrThrow({ where: { tenantId } });
      owner.memberId = (await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: owner.userId } } })).id;
      requester.memberId = (await db.membership.create({ data: { tenantId, userId: requester.userId, role: "viewer" } })).id;
      fixture = { origin, tenantId, serviceId: service.id, owner, requester };
      await writeFile(privateFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    }
    assert.equal(fixture.origin, origin);
    const proof = { fixtureSetupOnly: true, tenantId: fixture.tenantId, serviceId: fixture.serviceId,
      ownerId: fixture.owner.userId, requesterId: fixture.requester.userId, requesterMemberId: fixture.requester.memberId,
      grants: await db.serviceGrant.count({ where: { tenantId: fixture.tenantId, memberId: fixture.requester.memberId } }) };
    await writeFile(evidence + "/prepared.json", JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8"));
    assert.equal(fixture.origin, origin);
    const prior = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
    const actors = { owner: fixture.owner, requester: fixture.requester, other: prior.other }, cookies: Record<string, string> = {};
    for (const [name, actor] of Object.entries(actors)) {
      assert.ok(actor.email.startsWith("rea-"));
      const response = await request("/auth/sign-in/email", "POST", { email: actor.email, password: actor.password });
      assert.equal(response.status, 200, "fresh login " + name);
      cookies[name] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    }
    const checks: { name: string; status: number }[] = [];
    async function check(name: string, path: string, status: number, actor = "", method = "GET", value?: unknown, headers?: Record<string, string>) {
      const response = await request(path, method, value, cookies[actor] ?? "", headers), text = await response.text();
      checks.push({ name, status: response.status }); assert.equal(response.status, status, name + ": " + text);
      return text ? JSON.parse(text) : null;
    }
    const expected: AccessRequestList = JSON.parse(await readFile("docs/qa/R03-T03/access-flow/final.json", "utf8"));
    const review: AccessRequestList = await check("owner review after fresh login", "/access-requests?scope=review&status=all", 200, "owner");
    assert.deepEqual(review, expected); assert.equal(review.total, 4);
    const mine: AccessRequestList = await check("requester full history", "/access-requests?scope=mine", 200, "requester");
    assert.deepEqual(mine.items, review.items); assert.deepEqual(mine.availableServices, []); assert.equal(mine.pendingCount, 0);
    const statuses = ["approved", "cancelled", "rejected", "cancelled"]; assert.deepEqual(review.items.map(item => item.status), statuses);
    const approved = review.items[0], cancelled = review.items[1];
    const context = await check("approved service appears in fresh context", "/context", 200, "requester");
    assert.ok(context.services.some((item: { id: string }) => item.id === fixture.serviceId));
    const page = await check("review page clamps after pending requests resolve", "/access-requests?scope=review&status=pending&page=999&pageSize=1", 200, "owner");
    assert.equal(page.total, 0); assert.equal(page.page, 1); assert.deepEqual(page.items, []);
    for (const [status, count] of [["approved", 1], ["rejected", 1], ["cancelled", 2]] as const) {
      const filtered: AccessRequestList = await check("review filter " + status, "/access-requests?scope=review&status=" + status, 200, "owner");
      assert.equal(filtered.total, count); assert.ok(filtered.items.every(item => item.status === status));
    }
    await check("anonymous history denied", "/access-requests", 401);
    await check("requester review denied", "/access-requests?scope=review", 403, "requester");
    await check("requester decision denied", "/access-requests/" + approved.id, 403, "requester", "PATCH", { version: 2, decision: "reject" });
    await check("other company decision denied", "/access-requests/" + approved.id, 404, "other", "PATCH", { version: 2, decision: "reject" });
    await check("other company cancel denied", "/access-requests/" + cancelled.id, 404, "other", "DELETE", undefined, { "If-Match": "2" });
    await check("owner cannot cancel requester item", "/access-requests/" + cancelled.id, 404, "owner", "DELETE", undefined, { "If-Match": "2" });
    await check("stale decision denied", "/access-requests/" + approved.id, 409, "owner", "PATCH", { version: 1, decision: "approve" });
    await check("resolved request cancel denied", "/access-requests/" + cancelled.id, 409, "requester", "DELETE", undefined, { "If-Match": "2" });
    await check("already granted request denied", "/access-requests", 409, "requester", "POST", { serviceId: fixture.serviceId });
    await check("foreign service request denied", "/access-requests", 404, "requester", "POST", { serviceId: prior.other.serviceId });
    await check("invalid request denied", "/access-requests", 422, "requester", "POST", { serviceId: "bad" });
    await check("invalid decision denied", "/access-requests/" + approved.id, 422, "owner", "PATCH", { version: 2, decision: "delete" });
    const requests = await db.accessRequest.findMany({ where: { tenantId: fixture.tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.equal(requests.length, 4);
    assert.deepEqual(requests.map(item => item.status), [...statuses].reverse());
    assert.ok(requests.every(item => item.version === 2 && item.resolvedAt && item.serviceId === fixture.serviceId && item.requesterId === fixture.requester.memberId));
    assert.deepEqual(requests.map(item => item.reason), ["REA 접근 요청 취소 시험", "REA 접근 요청 거절 시험", "REA 접근 요청 충돌 시험", "REA 접근 요청 최종 승인 시험"]);
    assert.deepEqual(requests.map(item => item.decisionNote), ["", "담당 업무 확인 후 다시 요청해주세요", "", "담당 서비스 조회 권한을 승인합니다"]);
    const grants = await db.serviceGrant.findMany({ where: { tenantId: fixture.tenantId, memberId: fixture.requester.memberId } });
    assert.equal(grants.length, 1); assert.equal(grants[0].serviceId, fixture.serviceId); assert.deepEqual(grants[0].capabilities, [...roleCapabilities("viewer")]);
    const member = await db.membership.findUniqueOrThrow({ where: { id: fixture.requester.memberId } });
    assert.equal(member.version, 2); assert.equal(member.status, "active"); assert.equal(member.role, "viewer");
    const audit = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId, resource: "access_request" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.equal(audit.length, 8);
    for (const item of requests) assert.deepEqual(audit.filter(event => event.resourceId === item.id).map(event => event.action), ["access_request.created", "access_request." + item.status]);
    const stateHash = createHash("sha256").update(JSON.stringify({ requests, grants, member, audit })).digest("hex");
    const after = process.argv.includes("--after-restart");
    if (after) assert.equal(stateHash, JSON.parse(await readFile(evidence + "/verified.json", "utf8")).stateHash);
    const report = { result: "passed", checkedAt: new Date().toISOString(), afterRestart: after, tenantId: fixture.tenantId,
      serviceId: fixture.serviceId, requestCount: 4, states: requests.map(item => ({ id: item.id, status: item.status, version: item.version })),
      requesterVersion: member.version, grantCount: grants.length, auditCount: audit.length, checks, stateHash };
    await writeFile(evidence + (after ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
