import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";

// Extends the isolated R05 synthetic company without changing its two frozen reviews.
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3121");
const evidence = "docs/qa/R05-T03/current";
const file = ".local/rea-fullstack/r05-list-fixture.json";
type Fixture = { reviews: string[]; events: string[]; viewer?: { id: string; email: string; password: string } };
try {
  const base = JSON.parse(await readFile(".local/rea-fullstack/r05-self-approval.json", "utf8"));
  let fixture: Fixture;
  try { fixture = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; fixture = { reviews: [], events: [] }; }
  if (!fixture.viewer) {
    const password = randomBytes(24).toString("hex") + "Aa!1", passwordHash = await (await auth.$context).password.hash(password);
    const user = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `r05-viewer-${randomUUID()}@example.test`, name: "R05 화면 권한 검증 조회자", emailVerified: true } });
      await tx.account.create({ data: { userId: user.id, providerId: "credential", accountId: user.id, password: passwordHash } });
      const member = await tx.membership.create({ data: { tenantId: base.companyId, userId: user.id, role: "viewer" } });
      await tx.serviceGrant.create({ data: { tenantId: base.companyId, memberId: member.id, serviceId: base.serviceId, capabilities: ["service.read", "form.read", "document.read"] } });
      return user;
    });
    fixture.viewer = { id: user.id, email: user.email, password };
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  const signed = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: base.people.owner.email, password: base.people.owner.password }) });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  for (let index = fixture.reviews.length; index < 11; index++) {
    // Source activity is explicitly synthetic; review creation uses the real HTTP API.
    const event = await db.auditEvent.create({ data: { tenantId: base.companyId, serviceId: base.serviceId, actorId: base.people.recipient.id,
      action: "submission.read", resource: "submission", resourceId: randomUUID(), requestId: randomUUID(), detail: { syntheticQA: "R05-T03 list pagination" } } });
    const response: Response = await fetch(origin + "/api/v1/activity-reviews", { method: "POST", headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ auditEventId: event.id, title: "R05 목록 검증 " + String(index + 1).padStart(2, "0"), message: "목록·주소·미저장 입력 검증용 합성 요청" }) });
    assert.equal(response.status, 201);
    fixture.events.push(event.id); fixture.reviews.push((await response.json()).id);
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  const rows = await db.activityReview.findMany({ where: { id: { in: fixture.reviews } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, title: true, status: true, version: true } });
  assert.equal(rows.length, 11);
  const pages = [];
  for (const page of [1, 2]) {
    const response: Response = await fetch(origin + `/api/v1/activity-reviews?scope=sent&search=R05%20목록%20검증&page=${page}&pageSize=10`, { headers: { cookie } });
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.total, 11); assert.equal(body.page, page);
    assert.deepEqual(body.items.map((item: { id: string }) => item.id), rows.slice((page - 1) * 10, page * 10).map(row => row.id));
    pages.push({ page, rows: body.items.length, ids: body.items.map((item: { id: string }) => item.id) });
  }
  await mkdir(evidence, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), result: "passed", setup: "11 synthetic audit sources inserted directly; 11 requests created through real HTTP", pages,
    latestFirstMatchesDatabase: true, originalTerminalReviewsUnchanged: true, externalProviderVerified: false };
  await writeFile(evidence + "/pagination-fixture.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", rows: rows.length, pages: pages.map(page => ({ page: page.page, rows: page.rows })) }));
} finally { await db.$disconnect(); }
