import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const fixturePath = ".local/qa-r23-ui.json";
const jobPath = ".local/qa-r23-worker-job.json";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const origin = process.env.QA_BASE_URL ?? fixture.origin;
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test");
assert.equal(new URL(origin).origin, "http://127.0.0.1:3199");

async function login() {
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({
      email: fixture.actors.owner.email, password: fixture.actors.owner.password,
    }) });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

try {
  if (process.argv.includes("prepare")) {
    const cookie = await login();
    const response = await fetch(origin + "/api/v1/analytics/exports", { method: "POST", redirect: "manual",
      headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ closeId: fixture.closeId, format: "pdf" }) });
    assert.equal(response.status, 202);
    const job = await response.json();
    assert.equal(job.status, "queued");
    await writeFile(jobPath, JSON.stringify({ id: job.id }, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ result: "prepared", id: job.id, status: job.status }));
  } else if (process.argv.includes("verify")) {
    const marker = JSON.parse(await readFile(jobPath, "utf8"));
    const job = await db.complianceExportJob.findUniqueOrThrow({ where: { id: marker.id } });
    assert.equal(job.status, "ready");
    assert.ok(job.resultCipher); assert.match(job.resultHash ?? "", /^[a-f0-9]{64}$/); assert.ok((job.byteLength ?? 0) > 0);
    assert.ok((job.pageCount ?? 0) > 0); assert.ok(job.completedAt);
    assert.equal(await db.auditEvent.count({ where: { resourceId: job.id, action: "compliance.export_completed" } }), 1);
    const exportTotal = await db.complianceExportJob.count({ where: { closeId: fixture.closeId,
      memberId: fixture.actors.owner.memberId, requesterId: fixture.actors.owner.userId, status: { not: "deleted" } } });
    fixture.exportTotal = exportTotal;
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ result: "passed", id: job.id, status: job.status,
      byteLength: job.byteLength, pageCount: job.pageCount, exportTotal }));
  } else throw new Error("prepare 또는 verify 인수가 필요합니다.");
} finally { await db.$disconnect(); }
