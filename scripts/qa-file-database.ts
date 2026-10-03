import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { privateFiles } from "../src/server/file-storage";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.FILE_STORAGE, "local");
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex"), checkpoint = ".local/p06-file-access-checkpoint.json";
try {
  assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600);
  const state = JSON.parse(await readFile(checkpoint, "utf8")) as { companyId: string; userId: string; formId: string; submissionId: string };
  const company = await db.company.findUniqueOrThrow({ where: { id: state.companyId } }), user = await db.user.findUniqueOrThrow({ where: { id: state.userId } });
  assert(/^P06 첨부 검증 [0-9a-f-]{36}$/.test(company.name)); assert(/^p06-file-owner-[0-9a-f-]{36}@catchsecu\.local\.test$/.test(user.email)); assert(!user.platformAdmin);
  const counts = (await db.$queryRaw<{ submissions: bigint; receipts: bigint; attached: bigint; deleted: bigint; sessions: bigint }[]>`
    SELECT (SELECT count(*) FROM "Submission" WHERE "tenantId"=${state.companyId}) AS submissions,
      (SELECT count(*) FROM "ConsentReceipt" WHERE "tenantId"=${state.companyId}) AS receipts,
      (SELECT count(*) FROM "FileObject" WHERE "tenantId"=${state.companyId} AND status='attached') AS attached,
      (SELECT count(*) FROM "FileObject" WHERE "tenantId"=${state.companyId} AND status='deleted') AS deleted,
      (SELECT count(*) FROM "Session" WHERE "userId"=${state.userId}) AS sessions`)[0];
  assert.equal(Number(counts.submissions), 1); assert.equal(Number(counts.receipts), 1); assert.equal(Number(counts.attached), 2); assert.equal(Number(counts.deleted), 1); assert.equal(Number(counts.sessions), 0);
  const rows = await db.fileObject.findMany({ where: { tenantId: state.companyId }, orderBy: { id: "asc" } }), files = [];
  for (const row of rows) {
    if (row.status === "deleted") { assert.equal(row.nameCipher, null); assert.equal(row.sha256, null); assert.equal(row.size, 0); await assert.rejects(privateFiles.read(row.storageKey)); continue; }
    assert.equal(row.submissionId, state.submissionId); assert.equal(row.scanStatus, "clean"); assert.equal(row.uploadTokenHash, null); assert.equal(row.expiresAt, null); assert.match(row.scanEngine!, /^ClamAV /);
    const bytes = await privateFiles.read(row.storageKey), encryptedPath = resolve(env.PRIVATE_STORAGE_DIR, "objects", row.storageKey + ".enc"), encrypted = await readFile(encryptedPath);
    assert.equal(hash(bytes), row.sha256); assert.equal(bytes.length, row.size); assert.equal(encrypted.subarray(0, 4).toString(), "CSF1"); assert(!encrypted.includes(bytes));
    assert.equal((await lstat(encryptedPath)).mode & 0o777, 0o600); assert.equal((await lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects"))).mode & 0o777, 0o700);
    files.push({ id: row.id, sha256: hash(bytes), bytes: bytes.length, encryptedAtRest: true, scanEngine: row.scanEngine });
  }
  const migrations = await db.$queryRaw<{ migration_name: string; checksum: string }[]>`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY migration_name`;
  const folders = (await readdir("prisma/migrations", { withFileTypes: true })).filter(f => f.isDirectory()).map(f => f.name).sort(); assert.equal(folders.length, 59); assert.equal(migrations.length, 59);
  const checksumDifferences = [];
  for (const row of migrations) {
    const source = hash(await readFile("prisma/migrations/" + row.migration_name + "/migration.sql"));
    if (source !== row.checksum) checksumDifferences.push({ migration: row.migration_name, source, installed: row.checksum });
  }
  assert.equal(checksumDifferences.length, 0, "Installed migration checksums must match source bytes.");
  const events = await db.$queryRaw<{ action: string; count: bigint }[]>`SELECT action,count(*) AS count FROM "AuditEvent" WHERE "tenantId"=${state.companyId} GROUP BY action ORDER BY action`;
  await writeFile("docs/qa/P06-T03/database-current.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: true,
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])), files, filePermissions: "0600", directoryPermissions: "0700", deletedObjectAbsent: true,
    sessionsClosed: true, checkpointPermissions: "0600", migrations: migrations.length, migrationChecksumsMatch: checksumDifferences.length === 0, checksumDifferences,
    auditCounts: events.map(e => ({ action: e.action, count: Number(e.count) })) }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, attached: files.length, deleted: Number(counts.deleted), sessions: Number(counts.sessions), migrations: migrations.length }));
} catch (error) { console.error(JSON.stringify({ passed: false, kind: error instanceof Error ? error.name : "Unknown", message: error instanceof assert.AssertionError ? error.message : "합성 데이터 대조 실패" })); process.exitCode = 1; }
finally { await db.$disconnect(); }
