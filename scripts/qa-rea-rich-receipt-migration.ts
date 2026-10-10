import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { decrypt, encrypt } from "../src/server/crypto";

const databaseUrl = new URL(process.env.DATABASE_URL!);
assert.equal(databaseUrl.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
const suffix = randomUUID().replaceAll("-", "");
const freshSchema = `qa_receipt_v2_fresh_${suffix}`;
const upgradeSchema = `qa_receipt_v2_upgrade_${suffix}`;
const working = resolve(`.local/qa-receipt-v2-${suffix}`);
const evidenceDirectory = "docs/qa/R08-T02/body-images/receipt-v2";
const prismaCli = resolve("node_modules/prisma/build/index.js");
const migration = "20261025020900_rich_consent_evidence_v2";
const logs: Record<string, string> = {};

async function prepareProject(directory: string, includeMigration: boolean) {
  await mkdir(directory, { recursive: true });
  await cp("prisma", join(directory, "prisma"), { recursive: true });
  if (!includeMigration) await rm(join(directory, "prisma/migrations", migration), { recursive: true, force: true });
  await writeFile(join(directory, "prisma.config.ts"),
    'import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });\n');
}

async function migrate(schema: string, directory: string, label: string) {
  const scoped = new URL(databaseUrl); scoped.searchParams.set("schema", schema);
  const result = await new Promise<{ code: number; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: directory, env: { ...process.env, DATABASE_URL: scoped.href },
    });
    let output = "";
    child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => done({ code: code ?? 1, output }));
  });
  logs[label] = result.output.replaceAll(scoped.href, "[isolated test database URL]");
  assert.equal(result.code, 0, `${label} migration failed`);
}

async function schemaClient(schema: string) {
  const client = new Client({ connectionString: databaseUrl.href });
  await client.connect(); await client.query(`SET search_path TO "${schema}"`); return client;
}

async function migrationCount(client: Client) {
  return Number((await client.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count);
}

type Fixture = ReturnType<typeof fixtureIds> & { pdfBytes: Buffer; evidenceCipher: string; pdfCipher: string; documentHash: string; pdfHash: string };
function fixtureIds() {
  return { tenant: randomUUID(), service: randomUUID(), user: randomUUID(), member: randomUUID(), form: randomUUID(),
    version: randomUUID(), publication: randomUUID(), submission: randomUUID(), receipt: randomUUID() };
}

async function insertFixture(client: Client, evidenceVersion: 1 | 2): Promise<Fixture> {
  const ids = fixtureIds();
  const pdfBytes = Buffer.from(`%PDF-1.4\nreceipt-${evidenceVersion}-${suffix}\n%%EOF\n`);
  const pdfHash = createHash("sha256").update(pdfBytes).digest("hex");
  const documentHash = createHash("sha256").update(`evidence-${evidenceVersion}-${suffix}`).digest("hex");
  const evidenceCipher = encrypt({ schemaVersion: evidenceVersion, fixture: suffix });
  const pdfCipher = encrypt(pdfBytes.toString("base64"));
  const email = `receipt-v${evidenceVersion}-${suffix}@example.test`;
  await client.query("BEGIN");
  await client.query(`INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Receipt owner',$2,true,now())`, [ids.user, email]);
  await client.query(`INSERT INTO "Company" (id,name,"publicName","updatedAt") VALUES ($1,'Receipt migration','Receipt migration',now())`, [ids.tenant]);
  await client.query(`INSERT INTO "Membership" (id,"tenantId","userId",role,"updatedAt") VALUES ($1,$2,$3,'owner',now())`, [ids.member, ids.tenant, ids.user]);
  await client.query(`INSERT INTO "Service" (id,"tenantId",name,"externalName","updatedAt") VALUES ($1,$2,'Receipt service','Receipt service',now())`, [ids.service, ids.tenant]);
  await client.query(`INSERT INTO "Form" (id,"tenantId","serviceId","ownerId",title,"updatedAt") VALUES ($1,$2,$3,$4,'Receipt form',now())`, [ids.form, ids.tenant, ids.service, ids.user]);
  await client.query(`INSERT INTO "FormVersion" (id,"tenantId","formId",number,title,body,"consentRequired","consentPurpose","consentDisplay","receiptEvidenceVersion","retentionDays","maxResponses","updatedAt")
    VALUES ($1,$2,$3,1,'Receipt form','',true,'migration proof','{}'::jsonb,$4,30,100,now())`, [ids.version, ids.tenant, ids.form, evidenceVersion]);
  await client.query(`INSERT INTO "Publication" (id,"tenantId","formId","formVersionId","tokenHash","tokenCipher","maxResponses","updatedAt")
    VALUES ($1,$2,$3,$4,$5,'fixture',100,now())`, [ids.publication, ids.tenant, ids.form, ids.version, createHash("sha256").update(ids.publication).digest("hex")]);
  await client.query(`INSERT INTO "Submission" (id,"tenantId","formVersionId","publicationId","retentionUntil","originalRetentionUntil","updatedAt")
    VALUES ($1,$2,$3,$4,now()+interval '30 days',now()+interval '30 days',now())`, [ids.submission, ids.tenant, ids.version, ids.publication]);
  await client.query(`INSERT INTO "ConsentReceipt" (id,"tenantId","submissionId",purpose,"documentHash","retentionDays","evidenceVersion","evidenceCipher","pdfCipher","pdfHash","grantedAt")
    VALUES ($1,$2,$3,'migration proof',$4,30,$5,$6,$7,$8,'2026-01-01T00:00:00.000Z')`,
  [ids.receipt, ids.tenant, ids.submission, documentHash, evidenceVersion, evidenceCipher, pdfCipher, pdfHash]);
  await client.query("COMMIT");
  return { ...ids, pdfBytes, evidenceCipher, pdfCipher, documentHash, pdfHash };
}

async function assertIncompleteV2Rejected(client: Client, fixture: Fixture) {
  await client.query("BEGIN");
  let code: string | undefined;
  try {
    await client.query(`INSERT INTO "ConsentReceipt" (id,"tenantId","submissionId",purpose,"documentHash","retentionDays","evidenceVersion","evidenceCipher","pdfCipher","pdfHash")
      VALUES ($1,$2,$3,'incomplete v2',$4,30,2,$5,NULL,$6)`,
    [randomUUID(), fixture.tenant, fixture.submission, fixture.documentHash, fixture.evidenceCipher, fixture.pdfHash]);
  }
  catch (error) { code = (error as { code?: string }).code; }
  await client.query("ROLLBACK");
  assert.equal(code, "23514");
}

const root = new Client({ connectionString: databaseUrl.href });
try {
  await mkdir(evidenceDirectory, { recursive: true }); await mkdir(working, { recursive: true }); await root.connect();
  await root.query(`CREATE SCHEMA "${freshSchema}"`); await root.query(`CREATE SCHEMA "${upgradeSchema}"`);

  const freshProject = join(working, "fresh"); await prepareProject(freshProject, true); await migrate(freshSchema, freshProject, "fresh");
  const fresh = await schemaClient(freshSchema); assert.equal(await migrationCount(fresh), 139);
  const freshV2 = await insertFixture(fresh, 2); await assertIncompleteV2Rejected(fresh, freshV2);
  const constraintDefinitions = (await fresh.query(`SELECT c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1
      AND c.conname IN ('FormVersion_consent_evidence','ConsentReceipt_evidence') ORDER BY c.conname`, [freshSchema])).rows;
  assert.equal(constraintDefinitions.length, 2);
  const bindingGuard = String((await fresh.query(`SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='guard_form_document_binding'`, [freshSchema])).rows[0].definition);
  assert.match(bindingGuard, /evidence_version NOT IN \(1,2\)/);
  await fresh.end();

  const upgradeProject = join(working, "upgrade"); await prepareProject(upgradeProject, false); await migrate(upgradeSchema, upgradeProject, "upgrade-before");
  const before = await schemaClient(upgradeSchema); assert.equal(await migrationCount(before), 138);
  const legacy = await insertFixture(before, 1);
  const beforeSnapshot = (await before.query(`SELECT "evidenceVersion","evidenceCipher","pdfCipher","documentHash","pdfHash","grantedAt" FROM "ConsentReceipt" WHERE id=$1`, [legacy.receipt])).rows[0];
  assert.deepEqual(Buffer.from(decrypt<string>(beforeSnapshot.pdfCipher), "base64"), legacy.pdfBytes); await before.end();

  await cp(join("prisma/migrations", migration), join(upgradeProject, "prisma/migrations", migration), { recursive: true });
  await migrate(upgradeSchema, upgradeProject, "upgrade-after");
  const upgraded = await schemaClient(upgradeSchema); assert.equal(await migrationCount(upgraded), 139);
  const afterSnapshot = (await upgraded.query(`SELECT "evidenceVersion","evidenceCipher","pdfCipher","documentHash","pdfHash","grantedAt" FROM "ConsentReceipt" WHERE id=$1`, [legacy.receipt])).rows[0];
  assert.deepEqual(afterSnapshot, beforeSnapshot);
  assert.deepEqual(Buffer.from(decrypt<string>(afterSnapshot.pdfCipher), "base64"), legacy.pdfBytes);
  assert.equal(createHash("sha256").update(legacy.pdfBytes).digest("hex"), afterSnapshot.pdfHash);
  const upgradedV2 = await insertFixture(upgraded, 2);
  await assertIncompleteV2Rejected(upgraded, upgradedV2); await upgraded.end();

  for (const [name, output] of Object.entries(logs)) await writeFile(join(evidenceDirectory, `migration-${name}.log`), output);
  const report = {
    result: "passed", checkedAt: new Date().toISOString(), migrations: 139,
    fresh: { schema: freshSchema, v2CompleteReceiptAccepted: true, v2IncompleteReceiptRejected: true,
      constraints: constraintDefinitions, formDocumentBindingAllowsEvidenceV2: true },
    upgrade: { schema: upgradeSchema, beforeMigrations: 138, afterMigrations: 139,
      legacyEvidenceCipherUnchanged: afterSnapshot.evidenceCipher === legacy.evidenceCipher,
      legacyPdfCipherUnchanged: afterSnapshot.pdfCipher === legacy.pdfCipher,
      legacyPdfBytesUnchanged: true, legacyDocumentHashUnchanged: afterSnapshot.documentHash === legacy.documentHash,
      legacyPdfHashUnchanged: afterSnapshot.pdfHash === legacy.pdfHash, v2AcceptedAfterUpgrade: true, v2IncompleteReceiptRejected: true },
    scope: "Ephemeral schemas in catchsecu_test; fresh install and 138→139 upgrade; schemas removed after verification.",
  };
  await writeFile(join(evidenceDirectory, "migration-install-final.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if ((root as unknown as { _connected?: boolean })._connected !== false) {
    await root.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`).catch(() => undefined);
    await root.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`).catch(() => undefined);
  }
  await root.end().catch(() => undefined); await rm(working, { recursive: true, force: true });
}
