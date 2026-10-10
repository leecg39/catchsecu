import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const mode = process.argv[2]; assert.ok(mode === "before" || mode === "after");
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
const directory = "docs/qa/R16-T04/route-connection";
await mkdir(directory, { recursive: true });
try {
  const rule = await db.retentionRule.findUniqueOrThrow({ where: { id: fixture.ruleId } });
  assert.equal(rule.tenantId, fixture.owner.companyId);
  assert.equal(rule.retentionDays, 120); assert.equal(rule.status, "archived");
  const closes = await db.complianceClose.findMany({ where: { tenantId: fixture.owner.companyId, month: "2026-10" } });
  assert.equal(closes.length, 1); assert.equal(closes[0].serviceKey, "");
  const snapshotHash = createHash("sha256").update(JSON.stringify(closes[0].snapshot)).digest("hex");
  assert.equal(await db.kakaoChannel.count({ where: { tenantId: fixture.owner.companyId, searchId: "@rea_crud_1010" } }), 0);
  const audit = await db.auditEvent.findMany({ where: { tenantId: fixture.owner.companyId, action: { in: ["retention_rule.created", "retention_rule.updated", "retention_rule.archived", "kakao_channel.created", "kakao_channel.updated", "kakao_channel.deleted"] } },
    select: { action: true, resourceId: true }, orderBy: { createdAt: "asc" } });
  const state = { rule: { id: rule.id, retentionDays: rule.retentionDays, status: rule.status, version: rule.version }, close: { id: closes[0].id, snapshotHash }, channelDeleted: true, audit };
  if (mode === "after") {
    const previous = JSON.parse(await readFile(directory + "/db-before.json", "utf8"));
    assert.deepEqual(state, previous.state, "DB business state must survive a fresh server process");
  }
  await writeFile(directory + "/db-" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", processId: process.pid, state }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, closeId: closes[0].id, auditCount: audit.length }));
} finally { await db.$disconnect(); }
