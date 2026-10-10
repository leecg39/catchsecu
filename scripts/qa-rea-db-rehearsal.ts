import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";
import { decryptStoredObject } from "../src/server/file-storage";

const source = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(source.hostname) && source.pathname === "/catchsecu_dev");
const repo = process.cwd(), runId = randomUUID();
const work = resolve(".local/rea-fullstack/pg-" + runId);
const output = resolve("docs/qa/R01-T01/db-rehearsal");
const bin = process.env.REA_POSTGRES_BIN ?? "/Users/user01/homebrew/bin";
const password = randomBytes(32).toString("base64url");
await mkdir(work, { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true });
const passwordFile = join(work, "password");
await writeFile(passwordFile, password, { mode: 0o600 });
const server = createServer();
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address(); assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
assert.notEqual(String(port), source.port || "5432");
const databaseUrl = (database: string) => `postgresql://rea_owner:${password}@127.0.0.1:${port}/${database}`;
const redact = (text: string) => text.replaceAll(password, "[redacted]").replaceAll(source.href, "[source database]");
async function command(executable: string, args: string[], name: string, extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  const result = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repo, env: { ...process.env, ...extraEnv } });
    let output = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output: redact(output) }));
  });
  await writeFile(join(output, name + ".log"), result.output);
  assert.equal(result.code, 0, name + ": see redacted log");
  console.log(JSON.stringify({ step: name, result: "passed" }));
}
async function client(database: string) {
  const connection = new Client({ connectionString: databaseUrl(database) });
  await connection.connect();
  assert.equal((await connection.query("SELECT inet_server_port() AS port")).rows[0].port, port);
  return connection;
}
const migrations = (await readdir("prisma/migrations")).filter(name => /^\d/.test(name)).sort();
const checksums = new Map(await Promise.all(migrations.map(async name => [name, createHash("sha256").update(await readFile(`prisma/migrations/${name}/migration.sql`)).digest("hex")] as const)));
async function migrationConfig(name: string, included: string[]) {
  const dir = join(work, name); await mkdir(dir, { recursive: true });
  for (const item of included) await cp(resolve("prisma/migrations", item), join(dir, "migrations", item), { recursive: true });
  await cp(resolve("prisma/migrations/migration_lock.toml"), join(dir, "migrations/migration_lock.toml"));
  const file = join(dir, "prisma.config.ts");
  await writeFile(file, `import {defineConfig,env} from "prisma/config"; export default defineConfig({schema:${JSON.stringify(resolve("prisma/schema.prisma"))},migrations:{path:${JSON.stringify(join(dir, "migrations"))}},datasource:{url:env("DATABASE_URL")}});\n`);
  return file;
}
async function deploy(config: string, database: string, name: string) {
  await command(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", config], name, { DATABASE_URL: databaseUrl(database) });
}
async function verifyHistory(connection: Client, expected: number) {
  const rows = (await connection.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  assert.equal(rows.length, expected);
  for (const row of rows) assert.equal(row.checksum, checksums.get(row.migration_name), row.migration_name);
  assert.equal((await connection.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rows[0].count, 0);
  return { applied: rows.length, checksumMismatches: 0, unfinished: 0 };
}
async function tableDigests(connection: Client) {
  const tables = (await connection.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result: Record<string, { count: number; hash: string | null }> = {};
  for (const { tablename } of tables) {
    const quoted = '"' + String(tablename).replaceAll('"', '""') + '"';
    const row = (await connection.query(`SELECT count(*)::int AS count, md5(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text)) AS hash FROM public.${quoted} t`)).rows[0];
    result[tablename] = row;
  }
  return result;
}
async function rejected(connection: Client, sql: string, expected: string) {
  await connection.query("BEGIN");
  try { await connection.query(sql); throw new Error("Expected database constraint rejection"); }
  catch (error) { assert.equal((error as { code?: string }).code, expected); }
  finally { await connection.query("ROLLBACK"); }
  return expected;
}
const data = join(work, "data"); let started = false;
const evidence: Record<string, unknown> = { runId, checkedAt: new Date().toISOString(), isolatedCluster: true,
  port, sourceDatabaseModified: false, originalMigrationFilesModified: false, result: "running" };
try {
  await command(join(bin, "initdb"), ["-D", data, "-U", "rea_owner", "--encoding=UTF8", "--auth-host=scram-sha-256", "--auth-local=trust", "--pwfile", passwordFile], "01-initdb");
  await writeFile(join(data, "postgresql.auto.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\n`);
  await command(join(bin, "pg_ctl"), ["-D", data, "-l", join(work, "postgres.log"), "-w", "start"], "02-start"); started = true;
  const admin = await client("postgres");
  try {
    for (const name of ["catchsecu_dev", "catchsecu_test", "catchsecu_restore"]) await admin.query('CREATE DATABASE "' + name + '"');
    evidence.postgresVersion = (await admin.query("SELECT version()")).rows[0].version;
  } finally { await admin.end(); }
  const fullConfig = await migrationConfig("full", migrations);
  const upgradeConfig = await migrationConfig("upgrade", migrations.slice(0, -1));
  await deploy(fullConfig, "catchsecu_dev", "03-empty-install");
  const fresh = await client("catchsecu_dev");
  try { evidence.emptyInstall = await verifyHistory(fresh, migrations.length); } finally { await fresh.end(); }
  const seedEnv = { DATABASE_URL: databaseUrl("catchsecu_dev"), SEED_OUTPUT_DIR: join(work, "accounts"), FILE_STORAGE: "local", PRIVATE_STORAGE_DIR: join(work, "storage") };
  await command(process.execPath, ["--import", "tsx", "scripts/seed.ts"], "04-seed", seedEnv);
  const seeded = await client("catchsecu_dev");
  try {
    const first = await tableDigests(seeded);
    assert.equal(first.Company.count, 2); assert.equal(first.User.count, 10);
    const fixtureFile = join(work, "storage/objects/45000000-0000-4000-8000-000000000001.enc");
    const encryptedBefore = await readFile(fixtureFile);
    await command(process.execPath, ["--import", "tsx", "scripts/seed.ts"], "05-seed-repeat", seedEnv);
    assert.deepEqual(await tableDigests(seeded), first);
    assert.deepEqual(await readFile(fixtureFile), encryptedBefore);
    await seeded.query('UPDATE "Form" SET status=$1 WHERE id=$2', ["archived", "40000000-0000-4000-8000-000000000001"]);
    const edited = await tableDigests(seeded);
    await command(process.execPath, ["--import", "tsx", "scripts/seed.ts"], "05b-seed-preserve-edit", seedEnv);
    assert.deepEqual(await tableDigests(seeded), edited);
    evidence.seed = { companies: first.Company.count, users: first.User.count, repeatUnchanged: true,
      archivedFormPreserved: true, encryptedFileUnchanged: true, credentialOutputIsolated: true };
    evidence.constraints = {
      duplicateEmail: await rejected(seeded, `INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('${randomUUID()}','duplicate','owner@catchsecu.local.test',now())`, "23505"),
      crossCompanyForm: await rejected(seeded, `INSERT INTO "Form" (id,"tenantId","serviceId","ownerId",title,"updatedAt") VALUES ('${randomUUID()}','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000010','cross company',now())`, "23503"),
    };
  } finally { await seeded.end(); }
  await deploy(upgradeConfig, "catchsecu_test", "06-prior-install");
  const prior = await client("catchsecu_test"); const probeId = randomUUID();
  try {
    await verifyHistory(prior, migrations.length - 1);
    await prior.query('INSERT INTO "Company" (id,name,"publicName","updatedAt") VALUES ($1,$2,$2,now())', [probeId, "REA upgrade probe"]);
  } finally { await prior.end(); }
  await cp(resolve("prisma/migrations", migrations.at(-1)!), join(work, "upgrade/migrations", migrations.at(-1)!), { recursive: true });
  await deploy(upgradeConfig, "catchsecu_test", "07-upgrade");
  const upgraded = await client("catchsecu_test");
  try {
    assert.equal((await upgraded.query('SELECT name FROM "Company" WHERE id=$1', [probeId])).rows[0].name, "REA upgrade probe");
    evidence.upgrade = { from: migrations.length - 1, ...await verifyHistory(upgraded, migrations.length), existingRowPreserved: true };
  } finally { await upgraded.end(); }
  await deploy(upgradeConfig, "catchsecu_test", "08-deploy-repeat");
  const dump = join(work, "fixture-backup.dump");
  await command(join(bin, "pg_dump"), ["-h", "127.0.0.1", "-p", String(port), "-U", "rea_owner", "-Fc", "-f", dump, "catchsecu_dev"], "09-backup", { PGPASSWORD: password });
  await command(join(bin, "pg_restore"), ["-h", "127.0.0.1", "-p", String(port), "-U", "rea_owner", "--exit-on-error", "-d", "catchsecu_restore", dump], "10-restore", { PGPASSWORD: password });
  const original = await client("catchsecu_dev"), restored = await client("catchsecu_restore");
  try {
    const expected = await tableDigests(original), actual = await tableDigests(restored); assert.deepEqual(actual, expected);
    await cp(join(work, "storage"), join(work, "restored-storage"), { recursive: true });
    const files = (await restored.query('SELECT id,"storageKey",sha256 FROM "FileObject"')).rows;
    for (const file of files) {
      const encrypted = await readFile(join(work, "restored-storage/objects", file.storageKey + ".enc"));
      assert.equal(createHash("sha256").update(decryptStoredObject(file.storageKey, encrypted)).digest("hex"), file.sha256);
    }
    evidence.restore = { tables: Object.keys(actual).length, allCountsAndHashesMatch: true, encryptedFilesVerified: files.length,
      encryptionKey: "existing local QA key; no key exported", dumpSha256: createHash("sha256").update(await readFile(dump)).digest("hex") };
    await writeFile(join(output, "restored-table-digests.json"), JSON.stringify(actual, null, 2) + "\n");
  } finally { await original.end(); await restored.end(); }
  for (const [name, hash] of checksums) assert.equal(createHash("sha256").update(await readFile(`prisma/migrations/${name}/migration.sql`)).digest("hex"), hash);
  evidence.result = "passed";
} catch (error) {
  evidence.result = "failed"; evidence.error = redact(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  if (started) await command(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], "11-stop");
  evidence.clusterStopped = started;
  await writeFile(join(output, "result.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
}
