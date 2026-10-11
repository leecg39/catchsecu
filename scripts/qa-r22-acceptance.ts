import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const fixture = JSON.parse(await readFile(".local/qa-r22-ui.json", "utf8"));
const origin = process.env.QA_BASE_URL ?? fixture.origin;
const restart = process.argv.includes("--restart"), directory = "docs/qa/R22-T04/current";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test");
assert.equal(new URL(origin).origin, "http://127.0.0.1:3199");
type Check = { label: string; status: number; count?: number };
const checks: Check[] = [];

async function call(actor: string | null, path: string, expected: number, method = "GET", body?: unknown) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual",
    headers: { origin, ...(actor ? { cookie: fixture.actors[actor].cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${method} ${path}`);
  checks.push({ label: `${actor ?? "anonymous"} ${method} ${path}`, status: response.status });
  return response;
}
async function freshLogin(actor: string) {
  const value = fixture.actors[actor];
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: value.email, password: value.password }) });
  assert.equal(response.status, 200, `${actor} login`);
  value.cookie = response.headers.getSetCookie().map((item: string) => item.split(";")[0]).join("; ");
  checks.push({ label: `${actor} fresh login`, status: response.status });
}
async function state() {
  const ids = Object.values(fixture.eventIds) as string[];
  const [events, review, messages, memberships, services] = await Promise.all([
    db.auditEvent.findMany({ where: { id: { in: ids } }, select: { id: true, tenantId: true, serviceId: true, actorId: true,
      action: true, resource: true, resourceId: true, requestId: true, detail: true, createdAt: true }, orderBy: { id: "asc" } }),
    db.activityReview.findUniqueOrThrow({ where: { id: fixture.reviewId }, select: { id: true, tenantId: true, serviceId: true,
      auditEventId: true, recipientUserId: true, requesterId: true, recipientId: true, title: true, status: true, version: true,
      retentionUntil: true, destructionStatus: true, destroyedAt: true, destroyApproverId: true, respondedAt: true, closedAt: true } }),
    db.activityReviewMessage.findMany({ where: { reviewId: fixture.reviewId }, select: { id: true, tenantId: true, reviewId: true,
      authorId: true, kind: true, bodyCipher: true, createdAt: true }, orderBy: { id: "asc" } }),
    db.membership.findMany({ where: { id: { in: Object.values(fixture.memberIds) as string[] } },
      select: { id: true, tenantId: true, userId: true, role: true, status: true, version: true }, orderBy: { id: "asc" } }),
    db.service.findMany({ where: { id: { in: [fixture.serviceId, fixture.foreignServiceId] } },
      select: { id: true, tenantId: true, name: true, status: true, version: true }, orderBy: { id: "asc" } }),
  ]);
  assert.equal(events.length, 9);
  const value = { events, review, messages, memberships, services };
  return { value, sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}

try {
  await freshLogin("owner");
  if (!restart) {
    for (const [kind, id] of Object.entries(fixture.eventIds) as [string, string][]) {
      const action = kind === "service" ? "service.r22_ui" : kind === "info" ? "submission.r22_ui" :
        kind === "marketing" ? "marketing.r22_ui" : kind === "customer" ? "subject.r22_ui" :
        kind === "member" ? "invitation.r22_ui" : kind === "authority" ? "policy.r22_ui" :
        kind === "external" ? "share.r22_ui" : kind === "access" ? "session.r22_ui" : "campaign.r22_ui";
      const query = `?kind=${kind}&serviceId=${fixture.serviceId}&search=${encodeURIComponent(action)}&pageSize=100`;
      const listed = await call("owner", "/audit-events" + query, 200);
      const listBody = await listed.json();
      assert.deepEqual(listBody.items.map((row: { id: string }) => row.id), [id]);
      const exported = await call("owner", "/audit-events/export" + query, 200);
      const rows = parse(await exported.text(), { bom: true }) as string[][];
      assert.deepEqual(rows.slice(1).map(row => row[0]), [id]);
    }
    const sameTime: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await call("owner", `/audit-events?kind=info&search=submission.r22_same_time&page=${page}&pageSize=10`, 200);
      sameTime.push(...(await response.json()).items.map((row: { id: string }) => row.id));
    }
    assert.equal(sameTime.length, 21); assert.equal(new Set(sameTime).size, 21);
    const kst = await call("owner", "/audit-events?kind=info&search=submission.r22_kst_boundary&from=2026-10-10T15%3A00%3A00.000Z&to=2026-10-11T15%3A00%3A00.000Z", 200);
    const kstBody = await kst.json(); assert.deepEqual(kstBody.items.map((row: { id: string }) => row.id), [fixture.kstRows.find((row: { label: string }) => row.label === "start").id]);
    const limited = await call("recipient", `/audit-events?kind=info&serviceId=${fixture.serviceId}&search=submission.r22_ui`, 200);
    const limitedItem = (await limited.json()).items[0]; assert.equal(limitedItem.actorName, null); assert.equal(limitedItem.resourceId, null);
    await call("viewer", "/audit-events", 403);
    const foreign = await call("foreign", "/audit-events?search=r22_ui", 200); assert.equal((await foreign.json()).total, 0);
    await call("owner", "/audit-events?serviceId=" + fixture.foreignServiceId, 404);
    await call(null, "/audit-events", 401);
    await call("owner", "/audit-events", 405, "PATCH", {});
    await call("owner", "/audit-events", 405, "DELETE");
    await call("owner", "/activity-reviews/" + fixture.reviewId, 200);
    await call("foreign", "/activity-reviews/" + fixture.reviewId, 404);
    await call("viewer", "/activity-reviews/" + fixture.reviewId, 404);
    await call("owner", "/activity-reviews/" + fixture.reviewId, 405, "PATCH", {});
    await call("owner", "/activity-reviews/" + fixture.reviewId, 405, "DELETE");
  } else {
    await call("owner", "/audit-events?kind=info&search=submission.r22_ui", 200);
    await call("owner", "/activity-reviews/" + fixture.reviewId, 200);
  }
  const fingerprint = await state();
  await mkdir(directory, { recursive: true });
  const beforePath = directory + "/api-before-restart.json";
  if (restart) assert.equal(fingerprint.sha256, JSON.parse(await readFile(beforePath, "utf8")).fingerprint.sha256);
  const report = { result: "passed", checkedAt: new Date().toISOString(), restart, checks,
    fingerprint: { sha256: fingerprint.sha256, counts: { events: fingerprint.value.events.length,
      messages: fingerprint.value.messages.length, memberships: fingerprint.value.memberships.length, services: fingerprint.value.services.length } } };
  await writeFile(restart ? directory + "/api-after-restart.json" : beforePath, JSON.stringify(report, null, 2) + "\n");
  await writeFile(".local/qa-r22-ui.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: "passed", restart, checks: checks.length, fingerprint: fingerprint.sha256 }));
} finally { await db.$disconnect(); }
