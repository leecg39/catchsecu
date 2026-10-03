/** Read-only verification of browser-created synthetic notification fixtures. */
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin.origin, "http://localhost:3100"); assert.equal(env.NOTIFICATION_TRANSPORT, "local");
const tenantId = "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId = "08e5858c-6d69-451d-b509-7facf4e1867f";
const directory = resolve("docs/qa/notifications"), path = resolve(directory, "browser-fixture.json"), mode = process.argv[2];
const fixture: Record<string, string> = JSON.parse(await readFile(path, "utf8").catch(() => "{}"));
async function save(file: string, value: object) { await writeFile(resolve(directory, file + ".json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), ...value }, null, 2) + "\n"); }
const name = "알림 QA 연결 2026-10-03", service = await db.service.findUniqueOrThrow({ where: { id: serviceId } }); assert.equal(service.tenantId, tenantId);
if (mode === "created") {
  const rows = await db.notificationIntegration.findMany({ where: { tenantId, serviceId, name, deletedAt: null } }); assert.equal(rows.length, 1);
  const row = rows[0]; assert.equal(row.enabled, true); assert.equal(row.transport, "local"); assert.equal(row.provider, "slack"); assert.ok(row.endpointCipher); assert.equal(row.endpointHost, "hooks.slack.com");
  assert.ok(decrypt<string>(row.endpointCipher!).startsWith("https://hooks.slack.com/services/"));
  const subscriptions = await db.notificationSubscription.findMany({ where: { integrationId: row.id } }); assert.ok(subscriptions.some(s => s.kind === "submission.created"));
  fixture.integrationId = row.id; await save("created", { id: row.id, version: row.version, provider: row.provider, environment: row.transport, encryptedEndpoint: true, endpointHostOnly: row.endpointHost, subscriptions: subscriptions.map(s => ({ kind: s.kind, targetId: s.targetId })) });
} else if (mode === "test-requested") {
  const row = await db.notificationIntegration.findUniqueOrThrow({ where: { id: fixture.integrationId } }); assert.equal(row.tenantId, tenantId); assert.equal(row.serviceId, serviceId);
  const tests = await db.notificationDelivery.findMany({ where: { integrationId: row.id, event: { kind: "test" } }, orderBy: { createdAt: "desc" } }); assert.ok(tests.length >= 1);
  fixture.testDeliveryId = tests[0].id; await save("test-requested", { integrationId: row.id, id: tests[0].id, status: tests[0].status });
} else if (mode === "test-delivered") {
  const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: fixture.testDeliveryId } }); assert.equal(row.integrationId, fixture.integrationId); assert.equal(row.status, "succeeded"); assert.equal(row.outcome, "local_delivered");
  const file = JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, row.id + ".json"), "utf8"));
  assert.equal(file.id, row.id); assert.equal(file.provider, "slack"); assert.ok(file.payload.text.includes("알림 연결을 확인하는 테스트")); assert.ok(!JSON.stringify(file).includes("hooks.slack.com"));
  assert.equal(await db.notificationAttempt.count({ where: { deliveryId: row.id } }), 1);
  await save("test-delivered", { integrationId: row.integrationId, deliveryId: row.id, status: row.status, outcome: row.outcome, oneAttempt: true, actualLocalFile: true, endpointSecretAbsent: true });
} else if (mode === "pending") {
  const row = await db.notificationIntegration.findUniqueOrThrow({ where: { id: fixture.integrationId } }); assert.equal(row.enabled, true);
  const tests = await db.notificationDelivery.findMany({ where: { integrationId: row.id, event: { kind: "test" } }, orderBy: { createdAt: "desc" } }); const current = tests.find(t => t.id !== fixture.testDeliveryId); assert.ok(current); assert.equal(current.status, "queued");
  fixture.pendingDeliveryId = current.id; await save("pending-before-disable", { integrationId: row.id, deliveryId: current.id, queued: true });
} else if (mode === "disabled") {
  const row = await db.notificationIntegration.findUniqueOrThrow({ where: { id: fixture.integrationId } }); assert.equal(row.enabled, false);
  const pending = await db.notificationDelivery.findUniqueOrThrow({ where: { id: fixture.pendingDeliveryId } }); assert.equal(pending.status, "cancelled"); assert.equal(pending.lastError, "CONFIG_CHANGED"); await assert.rejects(access(resolve(env.LOCAL_NOTIFICATION_DIR, pending.id + ".json")));
  await save("disabled-effect", { integrationId: row.id, version: row.version, deliveryId: pending.id, workerCancelled: true, actualLocalFileAbsent: true });
} else if (mode === "form-event") {
  const form = await db.form.findFirstOrThrow({ where: { tenantId, serviceId, title: "알림 QA 폼 2026-10-03" } });
  const event = await db.notificationEvent.findFirstOrThrow({ where: { tenantId, serviceId, kind: "submission.created", targetId: form.id }, orderBy: { occurredAt: "desc" } });
  assert.equal(event.sourceVersion, 1); assert.equal(event.importedRows, 0);
  const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { integrationId: fixture.integrationId, eventId: event.id } }); assert.equal(delivery.status, "succeeded"); assert.equal(delivery.outcome, "local_delivered");
  const file = JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, delivery.id + ".json"), "utf8")); assert.ok(file.payload.text.includes("새 응답")); assert.ok(!JSON.stringify(file).includes("합성 응답 비밀값"));
  await save("form-event", { formId: form.id, eventId: event.id, deliveryId: delivery.id, actualFile: true, sourceBound: true, personalAnswersAbsent: true });
} else if (mode === "csv-event") {
  const job = await db.importJob.findFirstOrThrow({ where: { tenantId, serviceId, title: "알림 QA CSV 2026-10-03", status: { in: ["completed", "partialFailed"] } } });
  const event = await db.notificationEvent.findFirstOrThrow({ where: { tenantId, serviceId, kind: "import.completed", sourceId: job.id } });
  const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { integrationId: fixture.integrationId, eventId: event.id } }); assert.equal(delivery.status, "succeeded");
  const file = JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, delivery.id + ".json"), "utf8")); assert.equal(file.provider, "slack"); assert.ok(file.payload.text.includes("반영 " + job.importedRows + "건"));
  await save("csv-event", { importJobId: job.id, eventId: event.id, deliveryId: delivery.id, importedRows: job.importedRows, failedRows: event.failedRows, actualFile: true });
} else if (mode === "deleted") {
  const row = await db.notificationIntegration.findFirstOrThrow({ where: { tenantId, serviceId, creatorId: { not: "" }, deletedAt: { not: null }, provider: "teams" }, orderBy: { deletedAt: "desc" } });
  assert.equal(row.name, ""); assert.equal(row.enabled, false); assert.equal(row.endpointCipher, null); assert.equal(row.endpointHost, null);
  await save("deleted", { integrationId: row.id, tombstone: true, endpointCipherRemoved: true, nameRemoved: true });
} else if (mode === "restart") {
  const row = await db.notificationIntegration.findUniqueOrThrow({ where: { id: fixture.integrationId } }); assert.equal(row.tenantId, tenantId); assert.equal(row.serviceId, serviceId); assert.equal(row.deletedAt, null);
  const test = await db.notificationDelivery.findUniqueOrThrow({ where: { id: fixture.testDeliveryId } }); assert.equal(test.status, "succeeded");
  const pending = await db.notificationDelivery.findUniqueOrThrow({ where: { id: fixture.pendingDeliveryId } }); assert.equal(pending.status, "cancelled"); await assert.rejects(access(resolve(env.LOCAL_NOTIFICATION_DIR, pending.id + ".json")));
  await save("restart-persistence", { integrationId: row.id, enabled: row.enabled, testDeliveryId: test.id, pendingCancelled: true, pendingFileAbsent: true, version: row.version });
} else throw new Error("Unknown QA mode");
await writeFile(path, JSON.stringify(fixture, null, 2) + "\n"); await db.$disconnect(); console.info("합성 알림 검증 완료:", mode);
