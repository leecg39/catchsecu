import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/catchsecu_dev")
  throw new Error("Only local catchsecu_dev configuration is allowed");
const target = resolve("docs/qa/P11-T03/invitations");
mkdirSync(target, { recursive: true });
const schema = "qa_sso_" + randomBytes(8).toString("hex");
const testUrl = new URL(source.href);
testUrl.pathname = "/catchsecu_test";
testUrl.searchParams.set("schema", schema);
const test = new Client({ connectionString: testUrl.href }), dev = new Client({ connectionString: source.href });
const migrationName = "20261014120000_sso_invitation_binding";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function deploy(url: URL) {
  const output = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url.href }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.split(url.href).join("[redacted]").split(source.href).join("[redacted]");
}
async function fingerprint() {
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const table of ["Company", "User", "Membership", "Session", "SsoProvider", "SsoState"]) {
    const columns = table === "SsoState"
      ? '"id","tenantId","providerId","stateHash","nonceHash","verifierCipher","mode","providerVersion","sessionId","userId","invitationId","expiresAt","createdAt"' : "*";
    const rows = (await dev.query('SELECT ' + columns + ' FROM "' + table + '" ORDER BY id')).rows;
    result[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
async function checksums(client: Client) {
  const rows = (await client.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  const mismatches = rows.flatMap(row => {
    const sourceChecksum = hash(readFileSync("prisma/migrations/" + row.migration_name + "/migration.sql", "utf8"));
    return sourceChecksum === row.checksum ? [] : [{ migration: row.migration_name, sourceChecksum, appliedChecksum: row.checksum }];
  });
  return { count: rows.length, mismatches };
}
await test.connect(); await dev.connect();
try {
  await test.query('CREATE SCHEMA "' + schema + '"');
  const fresh = deploy(testUrl);
  await test.query('SET search_path TO "' + schema + '"');
  const installed = await checksums(test);
  const expected = readdirSync("prisma/migrations").filter(name => /^\d/.test(name)).length;
  assert.equal(installed.count, expected);
  assert.deepEqual(installed.mismatches, []);
  const constraints = (await test.query("SELECT conname FROM pg_constraint WHERE connamespace = $1::regnamespace AND conname LIKE 'SsoState_%' ORDER BY conname", [schema])).rows;
  assert.ok(constraints.some(row => row.conname === "SsoState_invitation_binding_check"));
  const before = await fingerprint();
  writeFileSync(resolve(target, "migration-before.json"), JSON.stringify(before, null, 2));
  writeFileSync(resolve(target, "fresh-install.log"), fresh);
  const upgraded = deploy(source);
  writeFileSync(resolve(target, "dev-upgrade.log"), upgraded);
  const after = await fingerprint();
  assert.deepEqual(after, before);
  const devMigrations = await checksums(dev);
  assert.ok(!devMigrations.mismatches.some(row => row.migration === migrationName));
  const result = { at: new Date().toISOString(), migrationName, freshSchema: schema, freshInstall: { applied: installed, constraints },
    devUpgrade: { applied: devMigrations, existingRowsPreserved: true, fingerprints: after },
    schemaOnly: true, legacyStatesRequireRestart: true, allChecksumsMatch: devMigrations.mismatches.length === 0 };
  writeFileSync(resolve(target, "migration-verification.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(resolve(target, "fresh-install.log"), fresh);
  writeFileSync(resolve(target, "dev-upgrade.log"), upgraded);
  console.log(JSON.stringify({ freshInstall: installed.count, devMigrations: devMigrations.count,
    checksumMismatches: devMigrations.mismatches.length, existingRowsPreserved: true }));
  if (devMigrations.mismatches.length) process.exitCode = 1;
} finally {
  await test.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await test.end(); await dev.end();
}
