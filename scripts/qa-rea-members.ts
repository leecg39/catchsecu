import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100"); assert.equal(env.MAIL_TRANSPORT, "local");
const privateDirectory = ".local/rea-fullstack/members", privateFile = privateDirectory + "/fixture.json", directory = "docs/qa/R04-T04/members-flow";
type Person = { email: string; password: string; userId: string; cookie: string };
type Fixture = { tag: string; preparedAt: string; ready: boolean; people: Record<string, Person>; tenantId: string; otherTenantId: string; serviceIds: string[]; invitationLinks: Record<string, string>; currentInvitationId?: string; assignmentId?: string; reinvitationId?: string; cancelInvitationId?: string };
async function save(fixture: Fixture) { await writeFile(privateFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); }
async function request(path: string, method = "GET", body?: unknown, cookie = "", headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { cookie } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function api(path: string, method: string, body: unknown, actor: Person, expected = 200) {
  const response = await request(path, method, body, actor.cookie); assert.equal(response.status, expected, method + " " + path);
  return response.json();
}
async function login(actor: Person) {
  const response = await request("/auth/sign-in/email", "POST", { email: actor.email, password: actor.password }); assert.equal(response.status, 200);
  actor.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => value.startsWith("better-auth.session_token=")).join("; "); assert.ok(actor.cookie);
}
try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await mkdir(directory, { recursive: true });
  if (process.argv[2] === "prepare") {
    try { await readFile(privateFile); throw new Error("Existing fixture must not be replaced or repeated"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
    const fixture: Fixture = { tag: randomUUID(), preparedAt: new Date().toISOString(), ready: false, people: {}, tenantId: "", otherTenantId: "", serviceIds: [], invitationLinks: {} };
    for (const label of ["owner", "member", "foreign", "expert", "operator"]) fixture.people[label] = { email: "rea-members-" + label + "-" + fixture.tag + "@catchsecu.test", password: randomBytes(24).toString("hex") + "Aa!1", userId: "", cookie: "" };
    await save(fixture);
    for (const [label, actor] of Object.entries(fixture.people)) {
      const response = await request("/auth/sign-up/email", "POST", { email: actor.email, password: actor.password, name: "REA 구성원 " + label }); assert.equal(response.status, 200, "Fixture registration " + label);
      // Fixture identity setup only. Email authentication acceptance is separately verified in R02.
      const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } }); assert.ok(user.createdAt.getTime() >= new Date(fixture.preparedAt).getTime());
      actor.userId = user.id;
      await db.user.update({ where: { id: user.id }, data: { emailVerified: true, ...(label === "operator" ? { platformAdmin: true } : {}) } });
      await login(actor); await save(fixture);
    }
    const company = await api("/companies", "POST", { name: "REA 구성원 검증 " + fixture.tag.slice(0, 8), publicName: "REA 합성 구성원 회사" }, fixture.people.owner, 201);
    fixture.tenantId = company.id; await save(fixture);
    const first = await db.service.findFirstOrThrow({ where: { tenantId: fixture.tenantId } }); fixture.serviceIds.push(first.id);
    const second = await api("/services", "POST", { name: "REA 두 번째 권한 서비스", externalName: "REA 합성 서비스 B" }, fixture.people.owner, 201);
    fixture.serviceIds.push(second.id); await save(fixture);
    const foreign = await api("/companies", "POST", { name: "REA 격리 구성원 " + fixture.tag.slice(0, 8), publicName: "REA 합성 격리 회사" }, fixture.people.foreign, 201);
    fixture.otherTenantId = foreign.id; fixture.ready = true; await save(fixture);
    const report = { fixtureSetupOnly: true, identitiesVerifiedDirectlyForFixture: true, dedicatedOperatorCreated: true, tenantId: fixture.tenantId, otherTenantId: fixture.otherTenantId, serviceIds: fixture.serviceIds,
      people: Object.fromEntries(Object.entries(fixture.people).map(([name, person]) => [name, person.userId])) };
    await writeFile(directory + "/prepared.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8")); assert.equal(fixture.ready, true);
    if (process.argv[2] === "mail") {
      const id = process.argv[3]; assert.ok(id);
      const invitation = await db.invitation.findFirstOrThrow({ where: { id, tenantId: fixture.tenantId } });
      assert.ok(Object.values(fixture.people).some(person => person.email === invitation.email), "Only synthetic fixture recipients are allowed");
      const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + id + ":" + invitation.version } }); assert.equal(job.tenantId, fixture.tenantId);
      const payload = decrypt<{ to: string }>(job.payloadCipher); assert.equal(payload.to, invitation.email);
      if (job.status !== "done") assert.equal(await runOneJob("rea-members-browser", { tenantId: fixture.tenantId, jobId: job.id }), true);
      const delivered = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { attemptsLog: true } }); assert.equal(delivered.status, "done");
      const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")), mail = JSON.parse(bytes.toString()); assert.equal(mail.to, invitation.email);
      const link = mail.text.match(/https?:\/\/\S+/)?.[0]; assert.ok(link && new URL(link).origin === origin && new URL(link).pathname === "/oauth2/invite/signup");
      fixture.invitationLinks[id + ":" + invitation.version] = link; await save(fixture);
      const report = { invitationId: id, version: invitation.version, jobId: job.id, status: delivered.status, attempts: delivered.attempts, receiptCount: delivered.attemptsLog.length, fileHash: createHash("sha256").update(bytes).digest("hex"), externalProviderVerified: false };
      await writeFile(directory + "/mail-" + id + "-" + invitation.version + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (process.argv[2] === "boundaries") {
      const member = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: fixture.tenantId, userId: fixture.people.member.userId } } });
      const owner = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: fixture.tenantId, userId: fixture.people.owner.userId } } });
      assert.equal(member.status, "active"); assert.equal(member.role, "viewer"); assert.equal(owner.role, "owner");
      await login(fixture.people.member); await save(fixture);
      const cases: { label: string; status: number; code?: string }[] = [];
      async function check(label: string, path: string, method: string, body: unknown, actor: string, expected: number, headers: Record<string, string> = {}) {
        const response = await request(path, method, body, fixture.people[actor].cookie, headers);
        assert.equal(response.status, expected, label);
        const result = await response.json().catch(() => ({})); cases.push({ label, status: response.status, code: result.error?.code });
      }
      await check("restored member can read granted service", "/services/" + fixture.serviceIds[0], "GET", undefined, "member", 200);
      await check("other service is denied", "/services/" + fixture.serviceIds[1], "GET", undefined, "member", 403);
      await check("viewer cannot list members", "/members", "GET", undefined, "member", 403);
      await check("viewer cannot create form", "/forms", "POST", { serviceId: fixture.serviceIds[0], title: "Denied synthetic form" }, "member", 403);
      await check("foreign tenant cannot read member", "/members/" + member.id, "GET", undefined, "foreign", 404);
      await check("foreign tenant cannot change member", "/members/" + member.id, "PATCH", { version: member.version, role: "admin" }, "foreign", 404);
      await check("owner cannot remove self", "/members/" + owner.id, "DELETE", undefined, "owner", 409, { "If-Match": String(owner.version) });
      await check("owner cannot change self role", "/members/" + owner.id, "PATCH", { version: owner.version, role: "viewer" }, "owner", 409);
      await check("ownership requires current password", "/members/" + member.id + "/transfer", "POST", { version: member.version, password: "Deliberately-wrong-synthetic-password!1" }, "owner", 401);
      await check("company owner is not platform admin", "/expert-assignments?scope=admin", "GET", undefined, "owner", 403);
      await check("company owner cannot list expert options", "/expert-assignments/options", "GET", undefined, "owner", 403);
      assert.equal(await db.membership.count({ where: { tenantId: fixture.tenantId, role: "owner", status: "active" } }), 1);
      assert.equal((await db.membership.findUniqueOrThrow({ where: { id: member.id } })).version, member.version);
      await writeFile(directory + "/boundaries.json", JSON.stringify({ result: "passed", cases, memberVersionUnchanged: member.version, activeOwners: 1, independentHttpSession: true }, null, 2) + "\n");
      console.log(JSON.stringify({ result: "passed", cases: cases.length }));
    } else if (process.argv[2] === "expire-invitation") {
      assert.ok(fixture.cancelInvitationId);
      const invitation = await db.invitation.findFirstOrThrow({ where: { id: fixture.cancelInvitationId, tenantId: fixture.tenantId, email: fixture.people.foreign.email, status: "pending" } });
      assert.ok(invitation.createdAt.getTime() >= new Date(fixture.preparedAt).getTime());
      await db.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
      const token = new URL(fixture.invitationLinks[invitation.id + ":" + invitation.version]).searchParams.get("token"); assert.ok(token);
      const response = await request("/invitations/preview", "POST", { token }, fixture.people.foreign.cookie); assert.equal(response.status, 410);
      const report = { fixtureClockSetupOnly: true, invitationId: invitation.id, unchangedVersion: invitation.version, expiredLinkStatus: response.status };
      await writeFile(directory + "/invitation-expiry-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (process.argv[2] === "expire-assignment") {
      assert.ok(fixture.assignmentId);
      const assignment = await db.expertAssignment.findFirstOrThrow({ where: { id: fixture.assignmentId, tenantId: fixture.tenantId, expertUserId: fixture.people.expert.userId, status: "active" } });
      assert.ok(assignment.createdAt.getTime() >= new Date(fixture.preparedAt).getTime());
      await db.expertAssignment.update({ where: { id: assignment.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
      const report = { fixtureClockSetupOnly: true, assignmentId: assignment.id, unchangedVersion: assignment.version, purpose: "Test expiry enforcement without running a global worker" };
      await writeFile(directory + "/expiry-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (["state", "verify"].includes(process.argv[2])) {
      const verifying = process.argv[2] === "verify", tag = process.argv[3] ?? (verifying ? "verified" : "state"); assert.match(tag, /^[a-z0-9-]+$/);
      const report = { tenantId: fixture.tenantId,
        memberships: await db.membership.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, userId: true, role: true, status: true, version: true, accessKind: true, expertAssignmentId: true, grants: { select: { serviceId: true, capabilities: true }, orderBy: { serviceId: "asc" } } }, orderBy: { id: "asc" } }),
        invitations: await db.invitation.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, email: true, role: true, serviceIds: true, status: true, version: true, expiresAt: true }, orderBy: { id: "asc" } }),
        assignments: await db.expertAssignment.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, expertUserId: true, status: true, version: true, expiresAt: true, services: { select: { serviceId: true }, orderBy: { serviceId: "asc" } } }, orderBy: { id: "asc" } }),
        outbox: await db.job.findMany({ where: { tenantId: fixture.tenantId, dedupeKey: { startsWith: "mail:invitation:" } }, select: { id: true, dedupeKey: true, status: true, attempts: true, attemptsLog: { select: { id: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
        audits: await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, actorId: true, action: true, resource: true, resourceId: true, requestId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) };
      if (!verifying) {
        await writeFile(directory + "/" + tag + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ memberships: report.memberships.length, invitations: report.invitations.length, audits: report.audits.length }));
      } else {
        const owner = report.memberships.find(row => row.userId === fixture.people.owner.userId), member = report.memberships.find(row => row.userId === fixture.people.member.userId), expert = report.memberships.find(row => row.userId === fixture.people.expert.userId);
        assert.ok(owner && member && expert); assert.equal(report.memberships.length, 3);
        assert.deepEqual([owner.role, owner.status, owner.version], ["owner", "active", 3]);
        assert.deepEqual([member.role, member.status, member.version], ["admin", "active", 12]);
        assert.deepEqual(member.grants.map(row => row.serviceId), [fixture.serviceIds[0]]);
        assert.deepEqual([expert.accessKind, expert.status, expert.version, expert.grants.length], ["expert", "revoked", 8, 0]);
        assert.equal(report.memberships.filter(row => row.role === "owner" && row.status === "active").length, 1);
        assert.equal(report.invitations.length, 3);
        for (const [id, status, version] of [[fixture.currentInvitationId, "accepted", 3], [fixture.reinvitationId, "accepted", 2], [fixture.cancelInvitationId, "revoked", 3]]) {
          const invitation = report.invitations.find(row => row.id === id); assert.ok(invitation); assert.deepEqual([invitation.status, invitation.version], [status, version]);
        }
        assert.equal(report.assignments.length, 1); assert.equal(report.assignments[0].id, fixture.assignmentId);
        assert.deepEqual([report.assignments[0].status, report.assignments[0].version], ["revoked", 9]);
        assert.equal(report.audits.length, 45);
        const actionCounts = report.audits.reduce<Record<string, number>>((all, row) => { all[row.action] = (all[row.action] ?? 0) + 1; return all; }, {});
        for (const [action, count] of Object.entries({ "member.updated": 7, "member.removed": 1, "company.ownership_transferred": 2, "invitation.created": 3, "invitation.resent": 2, "invitation.accepted": 2, "invitation.revoked": 1, "expert.assigned": 1, "expert.updated": 4, "expert.reassigned": 2, "expert.revoked": 2 })) assert.equal(actionCounts[action], count, action);
        assert.equal(report.outbox.length, 5); assert.equal(report.outbox.filter(job => job.status === "done").length, 4);
        const cancelledJob = report.outbox.find(job => job.dedupeKey === "mail:invitation:" + fixture.cancelInvitationId + ":1"); assert.ok(cancelledJob); assert.deepEqual([cancelledJob.status, cancelledJob.attempts], ["cancelled", 0]);
        for (const job of report.outbox.filter(row => row.status === "done")) {
          assert.deepEqual([job.attempts, job.attemptsLog.length], [1, 1]);
          const match = job.dedupeKey.match(/^mail:invitation:(.+):(\d+)$/); assert.ok(match);
          const delivery = JSON.parse(await readFile(directory + "/mail-" + match[1] + "-" + match[2] + ".json", "utf8"));
          assert.equal(createHash("sha256").update(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).digest("hex"), delivery.fileHash);
        }
        const cases: { label: string; status: number }[] = [];
        async function check(label: string, path: string, actor: string, expected: number, method = "GET", body?: unknown) {
          const response = await request(path, method, body, fixture.people[actor].cookie); assert.equal(response.status, expected, label); cases.push({ label, status: response.status }); return response.json();
        }
        assert.equal((await check("members persisted including revoked", "/members?status=all", "owner", 200)).total, 3);
        assert.equal((await check("member version persisted", "/members/" + member.id, "owner", 200)).version, 12);
        assert.equal((await check("owner version persisted", "/members/" + owner.id, "owner", 200)).version, 3);
        assert.equal((await check("invitations persisted", "/invitations?status=all", "owner", 200)).total, 3);
        assert.equal((await check("expert assignment persisted", "/expert-assignments/" + fixture.assignmentId, "operator", 200)).version, 9);
        assert.equal((await check("expert sees revoked assignment", "/expert-assignments/" + fixture.assignmentId, "expert", 200)).canSelect, false);
        await check("expert service A denied", "/services/" + fixture.serviceIds[0], "expert", 403);
        await check("expert service B denied", "/services/" + fixture.serviceIds[1], "expert", 403);
        await check("foreign tenant member hidden", "/members/" + member.id, "foreign", 404);
        await check("removed old member session remains invalid", "/context", "member", 401);
        const token = new URL(fixture.invitationLinks[fixture.cancelInvitationId + ":2"]).searchParams.get("token"); assert.ok(token);
        await check("revoked invitation remains invalid", "/invitations/preview", "foreign", 410, "POST", { token });
        const stateHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
        if (tag !== "verified") assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
        const result = { result: "passed", checkedAt: new Date().toISOString(), stateHash, actionCounts, httpCases: cases, data: report, externalProviderVerified: false };
        await writeFile(directory + "/" + tag + ".json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify({ result: "passed", stateHash, httpCases: cases.length, audits: report.audits.length, deliveries: 4 }));
      }
    } else throw new Error("Unknown command");
  }
} finally { await db.$disconnect(); }
