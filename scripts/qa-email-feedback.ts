/** Local synthetic QA only. Database reads; relay mutation is signed HTTP to the guarded localhost campaign. */
import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { unsubscribeToken, unsubscribeUrl } from "../src/server/email-policy";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local"); assert.equal(origin.origin, "http://localhost:3100");
const scope = { tenantId: "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f" }, directory = resolve("docs/qa/email-feedback"), path = resolve(directory, "browser-fixture.json");
const fixture: Record<string, string> = JSON.parse(await readFile(path, "utf8").catch(() => "{}")), mode = process.argv[2];
async function save(name: string, result: object) { await writeFile(resolve(directory, name + ".json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), ...result }, null, 2)); }
async function find(part: string) {
  const rows = await db.campaign.findMany({ where: { ...scope, title: "이메일 결과 QA " + part + " 2026-10-03" } }); assert.equal(rows.length, 1);
  const campaign = rows[0], delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const job = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: delivery.id } }); return { campaign, delivery, job };
}
async function main() {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } }); assert.equal(campaign.tenantId, scope.tenantId); assert.equal(campaign.serviceId, scope.serviceId);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: campaign.id } }); const job = await db.job.findUniqueOrThrow({ where: { id: fixture.jobId } }); assert.equal(job.campaignDeliveryId, delivery.id);
  return { campaign, delivery, job };
}
if (mode === "sent") {
  const { campaign, delivery, job } = await find("발송"); assert.equal(campaign.status, "completed"); assert.equal(delivery.status, "local_delivered"); assert.equal(job.status, "done"); assert.equal(job.type, "mail.campaign.v3");
  fixture.campaignId = campaign.id; fixture.jobId = job.id;
  const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")), mail = JSON.parse(bytes.toString("utf8"));
  assert.equal(mail.to, "subject-csv-qa-20261003@catchsecu.local.test"); assert.ok(mail.text.includes(unsubscribeUrl(job.id))); assert.equal(mail.headers["List-Unsubscribe"], "<" + unsubscribeUrl(job.id) + ">"); assert.equal(mail.headers["List-Unsubscribe-Post"], undefined);
  await writeFile(".local/email-feedback-unsubscribe.json", JSON.stringify({ url: unsubscribeUrl(job.id) }), { mode: 0o600 });
  await save("actual-mail", { campaignId: campaign.id, jobId: job.id, protocol: job.type, status: delivery.status, mailSha256: createHash("sha256").update(bytes).digest("hex"), bodyAndHeaderBoundToJob: true, oneClickHeaderDisabledForLocalHttp: true });
} else if (mode === "relay" || mode === "hard-bounce") {
  const { job, delivery } = await main(); assert.ok(env.EMAIL_FEEDBACK_SECRET);
  const body = JSON.stringify({ eventId: "ego-" + randomUUID(), jobId: job.id, type: mode === "relay" ? "delivered" : "hard_bounce", occurredAt: new Date().toISOString() }), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = "v1=" + createHmac("sha256", env.EMAIL_FEEDBACK_SECRET).update(timestamp + "." + body).digest("hex");
  async function post(sig: string) { return fetch(origin.origin + "/api/v1/email-feedback", { method: "POST", headers: { "content-type": "application/json", "x-email-timestamp": timestamp, "x-email-signature": sig }, body }); }
  const first = await post(signature); assert.equal(first.status, 202); assert.equal((await first.json()).duplicate, false);
  const duplicate = await post(signature); assert.equal(duplicate.status, 202); assert.equal((await duplicate.json()).duplicate, true);
  const forged = await post("v1=" + "0".repeat(64)); assert.equal(forged.status, 401);
  const event = await db.emailFeedback.findUniqueOrThrow({ where: { eventKey: "relay:" + JSON.parse(body).eventId } }); assert.equal(event.contactHash, delivery.contactHash);
  await save(mode === "relay" ? "relay-http" : "hard-bounce-http", { jobId: job.id, type: event.kind, realHttpStatuses: [first.status, duplicate.status, forged.status], scopeFromJob: true, eventId: event.id, externalProvider: false });
} else if (mode === "queued") {
  const { campaign, delivery, job } = await find("대기"); assert.equal(campaign.status, "scheduled"); assert.equal(delivery.status, "queued"); assert.equal(job.status, "queued"); fixture.queuedId = campaign.id; fixture.queuedJobId = job.id;
  await save("queued-before-unsubscribe", { campaignId: campaign.id, jobId: job.id, status: job.status });
} else if (mode === "before") {
  const { delivery } = await main(); assert.equal(await db.emailSuppression.count({ where: { ...scope, contactHash: delivery.contactHash } }), 0);
  await save("get-no-mutation", { campaignId: fixture.campaignId, suppressions: 0, feedback: await db.emailFeedback.count({ where: { jobId: fixture.jobId } }) });
} else if (mode === "subscribed") {
  const { delivery, job } = await main(); const rows = await db.emailSuppression.findMany({ where: { ...scope, contactHash: delivery.contactHash } });
  assert.equal(rows.length, 1); assert.equal(rows[0].reason, "unsubscribed"); assert.equal(await db.emailFeedback.count({ where: { jobId: job.id, kind: "unsubscribed" } }), 1);
  const audits = await db.auditEvent.findMany({ where: { resource: "email_feedback", resourceId: rows[0].sourceEventId } }); assert.equal(audits.length, 1); assert.ok(!JSON.stringify(audits).includes(unsubscribeToken(job.id)));
  await save("unsubscribe-effect", { campaignId: fixture.campaignId, oneFeedback: true, oneSuppression: true, onePrivateAudit: true, reasons: rows.map(r => r.reason) });
} else if (mode === "one-click") {
  const { job } = await main(), before = await db.emailFeedback.count({ where: { jobId: job.id, kind: "unsubscribed" } });
  const url = origin.origin + "/api/v1/email-unsubscribe/" + unsubscribeToken(job.id) + "?confirmPage=1";
  const landing = await fetch(url, { redirect: "manual" }); assert.equal(landing.status, 302); assert.ok(landing.headers.get("location") === unsubscribeUrl(job.id));
  const confirmed = await fetch(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.headers.get("location"), null); assert.equal((await confirmed.json()).unsubscribed, true);
  assert.equal(await db.emailFeedback.count({ where: { jobId: job.id, kind: "unsubscribed" } }), before);
  await save("one-click-http", { jobId: job.id, getStatus: landing.status, postStatus: confirmed.status, postRedirected: false, cookieHeaderAbsent: !confirmed.headers.has("set-cookie"), referrerPolicy: landing.headers.get("referrer-policy"), duplicateHasNoNewEffect: true, localHttpOnly: true });
} else if (mode === "blocked" || mode === "restart") {
  const { delivery } = await main(), queued = await db.job.findUniqueOrThrow({ where: { id: fixture.queuedJobId } }); assert.equal(queued.status, "cancelled"); assert.equal(queued.lastError, "EMAIL_SUPPRESSED");
  await assert.rejects(access(resolve(env.LOCAL_MAIL_DIR, queued.id + ".json")));
  const row = await db.campaignDelivery.findUniqueOrThrow({ where: { id: queued.campaignDeliveryId! } }); assert.equal(row.status, "cancelled"); assert.equal(row.reason, "EMAIL_SUPPRESSED");
  const blocks = await db.emailSuppression.findMany({ where: { ...scope, contactHash: delivery.contactHash } }); assert.ok(blocks.some(r => r.reason === "unsubscribed"));
  await save(mode === "restart" ? "restart-persistence" : "queued-blocked", { campaignId: fixture.queuedId, jobId: queued.id, workerCancelled: true, localMailAbsent: true, blockReasons: blocks.map(r => r.reason), originalStatus: delivery.status });
} else throw new Error("Unknown QA mode");
await writeFile(path, JSON.stringify(fixture, null, 2)); await db.$disconnect(); console.info("합성 이메일 결과 검증 완료:", mode);
