import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3121");
const privateFile = ".local/rea-fullstack/r05-self-approval.json";
const evidence = "docs/qa/R05-T02/current";
type Person = { id: string; email: string; password: string; cookie: string };
type Fixture = { companyId: string; serviceId: string; people: Record<"owner" | "recipient", Person>; reviews: string[] };
async function request(person: Person, path: string, method = "GET", body?: unknown) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: {
    origin, cookie: person.cookie, "content-type": "application/json", "idempotency-key": randomUUID(),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(person: Person) {
  const response = await request(person, "/auth/sign-in/email", "POST", { email: person.email, password: person.password });
  assert.equal(response.status, 200);
  person.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(person.cookie);
}
async function state(fixture: Fixture) {
  return {
    reviews: await db.activityReview.findMany({ where: { id: { in: fixture.reviews } }, orderBy: { id: "asc" } }),
    messages: await db.activityReviewMessage.findMany({ where: { reviewId: { in: fixture.reviews } }, orderBy: { id: "asc" }, select: { id: true, reviewId: true, bodyCipher: true } }),
    audits: await db.auditEvent.findMany({ where: { tenantId: fixture.companyId, resourceId: { in: fixture.reviews } }, orderBy: { id: "asc" }, select: { id: true, action: true, resourceId: true } }),
  };
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  await mkdir(".local/rea-fullstack", { recursive: true });
  await mkdir(evidence, { recursive: true });
  const mode = process.argv[2];
  assert.ok(["prepare", "verify", "verify-session"].includes(mode ?? ""));
  if (mode === "prepare") {
    await assert.rejects(readFile(privateFile), { code: "ENOENT" });
    const tag = randomUUID();
    const password = randomBytes(24).toString("hex") + "Aa!1";
    const passwordHash = await (await auth.$context).password.hash(password);
    const fixture = await db.$transaction(async tx => {
      const people = {} as Fixture["people"];
      for (const label of ["owner", "recipient"] as const) {
        const user = await tx.user.create({ data: { name: "R05 권한 검증 " + label, email: `r05-${label}-${tag}@example.test`, emailVerified: true } });
        await tx.account.create({ data: { userId: user.id, providerId: "credential", accountId: user.id, password: passwordHash } });
        people[label] = { id: user.id, email: user.email, password, cookie: "" };
      }
      const company = await tx.company.create({ data: { name: "R05 본인 승인 차단 " + tag.slice(0, 8), publicName: "R05 합성 회사",
        policy: { create: { activityReviewRetentionDays: 30 } },
        memberships: { create: [{ userId: people.owner.id, role: "owner" }, { userId: people.recipient.id, role: "admin" }] },
        services: { create: { name: "R05 합성 서비스", externalName: "R05 합성 서비스" } },
      }, include: { services: true } });
      await tx.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: "trial-v1", status: "trialing", priceKrw: 0,
        currency: "KRW", activationSource: "trial", periodStart: new Date(), periodEnd: new Date(Date.now() + 7 * 86400000) } });
      return { companyId: company.id, serviceId: company.services[0].id, people, reviews: [] } as Fixture;
    });
    await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    for (const person of Object.values(fixture.people)) await login(person);
    for (const action of ["destroy", "keep"]) {
      const event = await db.auditEvent.create({ data: { tenantId: fixture.companyId, serviceId: fixture.serviceId, actorId: fixture.people.recipient.id,
        action: "submission.read", resource: "submission", resourceId: randomUUID(), requestId: randomUUID(), detail: { syntheticQA: true } } });
      const created = await request(fixture.people.owner, "/activity-reviews", "POST", { auditEventId: event.id, title: "본인 승인 차단 " + action, message: "합성 검토 요청" });
      assert.equal(created.status, 201);
      const { id } = await created.json(); fixture.reviews.push(id);
      assert.equal((await request(fixture.people.recipient, `/activity-reviews/${id}/actions`, "POST", { version: 1, action: "response", message: "합성 답변" })).status, 200);
      assert.equal((await request(fixture.people.owner, `/activity-reviews/${id}/actions`, "POST", { version: 2, action: "resolve", message: "합성 종결" })).status, 200);
      // Fixture clock only: never run the global retention worker on the shared dev DB.
      await db.activityReview.update({ where: { id }, data: { retentionUntil: new Date(Date.now() - 1000), destructionStatus: "awaiting", version: 4 } });
    }
    await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    const report = { checkedAt: new Date().toISOString(), fixtureSetupOnly: ["users and credentials", "company, memberships and trial", "source audit events", "retention clock"],
      httpTransitionsPerReview: ["requested", "responded", "resolved"], companyId: fixture.companyId, reviewIds: fixture.reviews, externalProviderVerified: false };
    await writeFile(evidence + "/self-approval-fixture.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8"));
    assert.equal(fixture.reviews.length, 2);
    const tag = process.argv[3] ?? "current";
    assert.match(tag, /^[a-z0-9-]+$/);
    if (mode === "verify") {
      for (const person of Object.values(fixture.people)) await login(person);
      await writeFile(privateFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    }
    const before = await state(fixture), checks: unknown[] = [];
    for (const id of fixture.reviews) {
      const detail = await (await request(fixture.people.recipient, `/activity-reviews/${id}`)).json();
      assert.equal(detail.canDecideDestruction, false);
      for (const action of ["destroy", "keep"]) {
        const response = await request(fixture.people.recipient, `/activity-reviews/${id}/destruction`, "POST", { version: detail.version, action });
        assert.equal(response.status, 403); checks.push({ id, action, status: response.status });
      }
      const managerDetail = await (await request(fixture.people.owner, `/activity-reviews/${id}`)).json();
      assert.equal(managerDetail.canDecideDestruction, detail.destructionStatus === "awaiting");
    }
    const after = await state(fixture);
    assert.equal(hash(before), hash(after));
    const report = { checkedAt: new Date().toISOString(), result: "passed", checks, stateHash: hash(after), deniedWritesUnchanged: true,
      states: after.reviews.map(row => ({ id: row.id, status: row.status, destructionStatus: row.destructionStatus, version: row.version, messages: after.messages.filter(message => message.reviewId === row.id).length })),
      audits: after.audits.length, freshLogins: mode === "verify" ? 2 : 0, preservedSessions: mode === "verify-session", externalProviderVerified: false };
    await writeFile(evidence + "/self-approval-http-" + tag + ".json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
