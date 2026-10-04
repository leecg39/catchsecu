import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, beforeEach, afterEach, afterAll, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { runOneJob } from "@/server/jobs";
import { contactEmailHash } from "@/server/suppression";

const fault = vi.hoisted(() => ({ action: "", expireAction: "" }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (args[3] === fault.expireAction) vi.setSystemTime(Date.now() + 61000);
    if (fault.action === "all" || args[3] === fault.action) throw new Error("synthetic job audit failure");
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname) || env.MAIL_TRANSPORT !== "local") throw new Error("Isolated test DB and local mail required");
const tenantId = randomUUID(), serviceId = randomUUID(), address = "job-audit@example.test";
const create = (data: object = {}) => db.job.create({ data: { type: "mail", tenantId, dedupeKey: randomUUID(), payloadCipher: encrypt({ to: address, subject: "합성 처리 감사", text: "합성 메일" }), ...data } });
const work = (id: string) => runOneJob("job-audit-worker", { tenantId, jobId: id });
const events = (id: string) => db.auditEvent.findMany({ where: { resource: "job", resourceId: id } });
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord" CASCADE');
  await db.company.create({ data: { id: tenantId, name: "처리 감사", publicName: "합성 처리 감사" } });
  await db.service.create({ data: { id: serviceId, tenantId, name: "보관된 서비스", externalName: "합성", status: "archived" } });
});
beforeEach(() => { fault.action = ""; fault.expireAction = ""; }); afterEach(() => { fault.action = ""; fault.expireAction = ""; vi.useRealTimers(); }); afterAll(async () => { await db.$disconnect(); });
test("local delivery commits the job, attempt and safe event under one attempt correlation ID", async () => {
  const job = await create(); expect(await work(job.id)).toBe(true);
  const attempt = await db.jobAttempt.findFirstOrThrow({ where: { jobId: job.id } }), rows = await events(job.id);
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "done" }); expect(attempt.outcome).toBe("delivered");
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ requestId: attempt.id, actorId: null, tenantId, action: "email.local_delivered" });
  expect(JSON.stringify(rows).includes(address)).toBe(false);
  expect((await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")).includes(address)).toBe(true);
  expect(await work(job.id)).toBe(false); expect(await events(job.id)).toHaveLength(1);
});
test("a suppressed service send commits a suppression event and no successful delivery event", async () => {
  const job = await create({ payloadCipher: encrypt({ to: address, subject: "차단", text: "합성", deliveryScope: { tenantId, serviceId, emailHash: contactEmailHash(address) } }) });
  expect(await work(job.id)).toBe(true); expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "cancelled" });
  expect((await events(job.id)).map(e => e.action)).toEqual(["email.suppressed"]);
});
test.each([5, 1])("delivery failure with maxAttempts %s records a safe retry/dead outcome atomically", async maxAttempts => {
  const job = await create({ maxAttempts, payloadCipher: encrypt({ invalid: address }) }); expect(await work(job.id)).toBe(true);
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: maxAttempts === 1 ? "dead" : "retry", lastError: "DELIVERY_FAILED" });
  const rows = await events(job.id); expect(rows).toHaveLength(1); expect(rows[0].action).toBe("email.failed"); expect(JSON.stringify(rows).includes(address)).toBe(false);
});
test("a completion audit failure leaves no done outcome and distinguishes receipt persistence from dispatch failure", async () => {
  const job = await create(); fault.action = "email.local_delivered"; expect(await work(job.id)).toBe(true); fault.action = "";
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "retry", lastError: "RECEIPT_PERSISTENCE_FAILED" });
  expect((await events(job.id)).map(e => e.action)).toEqual(["email.receipt_retry"]);
  await db.job.update({ where: { id: job.id }, data: { dueAt: new Date() } }); expect(await work(job.id)).toBe(true);
  expect((await events(job.id)).filter(e => e.action === "email.local_delivered")).toHaveLength(1);
});
test("failure of both outcome audits preserves the leased row and unfinished attempt for lease recovery", async () => {
  const job = await create(); fault.action = "all"; await expect(work(job.id)).rejects.toThrow(); fault.action = "";
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "leased" });
  expect(await db.jobAttempt.findFirst({ where: { jobId: job.id } })).toMatchObject({ outcome: "leased" }); expect(await events(job.id)).toHaveLength(0);
});
test("lease expiry during receipt audit rolls back the job and attempt receipt", async () => {
  const job = await create();
  vi.useFakeTimers({ toFake: ["Date"] });
  fault.action = "email.local_delivered"; fault.expireAction = "email.receipt_retry";
  await expect(work(job.id)).rejects.toThrow("LEASE_EXPIRED");
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "leased" });
  expect(await db.jobAttempt.findFirst({ where: { jobId: job.id } })).toMatchObject({ outcome: "leased" });
  expect(await events(job.id)).toHaveLength(0);
});
test("an exhausted lease and attempt are recorded together without dispatching again", async () => {
  const job = await create({ status: "leased", attempts: 1, maxAttempts: 1, leaseOwner: "lost-worker", leaseUntil: new Date(Date.now() - 1000) });
  await db.jobAttempt.create({ data: { jobId: job.id, workerId: "lost-worker", attempt: 1, outcome: "leased" } });
  expect(await work(job.id)).toBe(false); expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "dead", lastError: "LEASE_EXHAUSTED" });
  expect(await db.jobAttempt.findFirst({ where: { jobId: job.id } })).toMatchObject({ outcome: "lease_exhausted" });
  expect((await events(job.id)).map(e => e.action)).toEqual(["email.lease_exhausted"]);
});
test("an exhausted-lease audit failure rolls back both the terminal job and attempt", async () => {
  const job = await create({ status: "leased", attempts: 1, maxAttempts: 1, leaseOwner: "lost-worker", leaseUntil: new Date(Date.now() - 1000) });
  await db.jobAttempt.create({ data: { jobId: job.id, workerId: "lost-worker", attempt: 1, outcome: "leased" } });
  fault.action = "email.lease_exhausted"; await expect(work(job.id)).rejects.toThrow(); fault.action = "";
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "leased" });
  expect(await db.jobAttempt.findFirst({ where: { jobId: job.id } })).toMatchObject({ outcome: "leased" }); expect(await events(job.id)).toHaveLength(0);
});
test("a null-tenant job scope processes only its exact authentication mail without claiming a neighbor", async () => {
  const neighbor = await create(), job = await create({ tenantId: null });
  expect(await runOneJob("auth-job-only", { tenantId: null, jobId: job.id })).toBe(true);
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "done" });
  expect(await db.job.findUnique({ where: { id: neighbor.id } })).toMatchObject({ status: "queued", attempts: 0 });
  expect((await events(job.id))[0]).toMatchObject({ tenantId: null, actorId: null });
});
