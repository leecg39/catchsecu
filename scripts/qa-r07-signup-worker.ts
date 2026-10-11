/** Isolated test DB only. Exercise the actual worker twice without a dev-DB sweep. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { encrypt, opaqueToken, tokenHash } from "../src/server/crypto";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
async function runWorker(expiredIds: string[]) {
  const child = spawn(process.execPath, ["--env-file=.env.test.local", "--import", "tsx", "scripts/worker.ts"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", exited = false;
  child.stdout.on("data", value => { output += String(value); }); child.stderr.on("data", value => { output += String(value); });
  const closed = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("exit", code => { exited = true; resolve(code); }); });
  try {
    const deadline = Date.now() + 20000;
    while ((!output.includes("작업 처리기 시작") || await db.ssoSignupIntent.count({ where: { id: { in: expiredIds } } })) && Date.now() < deadline && !exited)
      await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(exited, false, "worker exited before cleanup");
    assert.equal(await db.ssoSignupIntent.count({ where: { id: { in: expiredIds } } }), 0);
    // Let the cleanup pass finish before its ordinary signal-driven shutdown.
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    try { assert.equal(await closed, 0, output); } finally { clearTimeout(timeout); }
    return { pid: child.pid, exitCode: 0, cleanupObserved: true };
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
      try { await closed; } finally { clearTimeout(timeout); }
    }
  }
}
try {
  assert.equal(env.MAIL_TRANSPORT, "local", "Test mail must stay local");
  const pendingJobs = await db.job.findMany({ where: { status: { in: ["queued", "leased", "retry"] } }, select: { type: true, status: true } });
  assert.ok(pendingJobs.every(job => job.type === "mail" && job.status === "queued"), "Only local test authentication mail may remain");
  const company = await db.company.create({ data: { name: "R07 worker expiry fixture", publicName: "QA" } });
  const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "Worker fixture", issuer: "https://idp.example.test", clientId: "worker",
    authorizationUrl: "https://idp.example.test/authorize", tokenUrl: "https://idp.example.test/token", jwksUrl: "https://idp.example.test/jwks" } });
  const expiredIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const row = await db.ssoSignupIntent.create({ data: { tenantId: company.id, providerId: provider.id, providerVersion: 1, stateId: randomUUID(),
      tokenHash: tokenHash(opaqueToken()), browserHash: "a".repeat(64), mode: "login", payloadCipher: encrypt({ syntheticCleanupFixture: true }),
      createdAt: new Date(Date.now() - 240000), expiresAt: new Date(Date.now() - 60000) } }); expiredIds.push(row.id);
  }
  const active = await db.ssoSignupIntent.create({ data: { tenantId: company.id, providerId: provider.id, providerVersion: 1, stateId: randomUUID(),
    tokenHash: tokenHash(opaqueToken()), browserHash: "b".repeat(64), mode: "login", payloadCipher: encrypt({ syntheticCleanupFixture: true }),
    createdAt: new Date(), expiresAt: new Date(Date.now() + 240000) } });
  const first = await runWorker(expiredIds);
  assert.equal(await db.ssoSignupIntent.count({ where: { id: active.id } }), 1);
  const nextExpired = await db.ssoSignupIntent.create({ data: { tenantId: company.id, providerId: provider.id, providerVersion: 1, stateId: randomUUID(),
    tokenHash: tokenHash(opaqueToken()), browserHash: "c".repeat(64), mode: "login", payloadCipher: encrypt({ syntheticCleanupFixture: true }),
    createdAt: new Date(Date.now() - 240000), expiresAt: new Date(Date.now() - 60000) } });
  const second = await runWorker([...expiredIds, nextExpired.id]);
  assert.equal(await db.ssoSignupIntent.count({ where: { id: active.id } }), 1);
  await mkdir("docs/qa/R07-T04/signup", { recursive: true });
  const report = { at: new Date().toISOString(), result: "passed", database: "catchsecu_test", first, second, expiredRemoved: 3,
    activePreserved: true, fixture: "Explicit synthetic pending rows; actual scripts/worker.ts process, no dev DB sweep" };
  await writeFile("docs/qa/R07-T04/signup/worker-restart.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
