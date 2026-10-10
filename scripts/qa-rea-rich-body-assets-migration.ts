import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const suffix = randomUUID().replaceAll("-", "");
const freshSchema = `qa_rich_assets_fresh_${suffix}`, upgradeSchema = `qa_rich_assets_upgrade_${suffix}`;
const working = resolve(`.local/qa-rich-assets-${suffix}`);
const evidence = "docs/qa/R08-T02/body-images/rich-assets";
const prismaCli = resolve("node_modules/prisma/build/index.js");
const migration = "20261025019000_author_asset_rich_documents";
const logs: Record<string, string> = {};

async function migrate(schema: string, directory: string, label: string) {
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const result = await new Promise<{ code: number; output: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: directory, env: { ...process.env, DATABASE_URL: scoped.href },
    });
    let output = "";
    child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolvePromise({ code: code ?? 1, output }));
  });
  logs[label] = result.output.replaceAll(scoped.href, "[isolated test database URL]");
  assert.equal(result.code, 0, `${label} migration failed`);
}

async function schemaClient(schema: string) {
  const client = new Client({ connectionString: url.href });
  await client.connect(); await client.query(`SET search_path TO "${schema}"`); return client;
}
async function migrationCount(client: Client) {
  return (await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count as number;
}
async function project(directory: string, includeMigration: boolean) {
  await mkdir(directory, { recursive: true }); await cp("prisma", join(directory, "prisma"), { recursive: true });
  if (!includeMigration) await rm(join(directory, "prisma/migrations", migration), { recursive: true, force: true });
  await writeFile(join(directory, "prisma.config.ts"),
    'import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });\n');
}

const root = new Client({ connectionString: url.href });
try {
  await mkdir(evidence, { recursive: true }); await mkdir(working, { recursive: true }); await root.connect();
  await root.query(`CREATE SCHEMA "${freshSchema}"`); await root.query(`CREATE SCHEMA "${upgradeSchema}"`);

  const freshProject = join(working, "fresh"); await project(freshProject, true);
  await migrate(freshSchema, freshProject, "fresh");
  const fresh = await schemaClient(freshSchema);
  assert.equal(await migrationCount(fresh), 129);
  const freshColumns = (await fresh.query(`SELECT column_name,is_nullable FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='AuthorAssetReference' AND column_name=ANY($2) ORDER BY column_name`,
    [freshSchema, ["questionKey", "documentKey", "nodeKey"]])).rows;
  assert.deepEqual(freshColumns, [
    { column_name: "documentKey", is_nullable: "YES" }, { column_name: "nodeKey", is_nullable: "YES" },
    { column_name: "questionKey", is_nullable: "YES" },
  ]);
  const freshTriggers = Number((await fresh.query(`SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal
      AND t.tgname IN ('FormVersion_author_asset_lock','FormSection_author_asset_lock','FormSection_author_asset_consistency')`, [freshSchema])).rows[0].count);
  assert.equal(freshTriggers, 3);
  await fresh.end();

  const upgradeProject = join(working, "upgrade"); await project(upgradeProject, false);
  await migrate(upgradeSchema, upgradeProject, "upgrade-before");
  const upgrade = await schemaClient(upgradeSchema);
  assert.equal(await migrationCount(upgrade), 128);
  const ids = { tenant: randomUUID(), service: randomUUID(), user: randomUUID(), member: randomUUID(), form: randomUUID(),
    version: randomUUID(), question: randomUUID(), questionKey: randomUUID(), blob: randomUUID(), asset: randomUUID(), reference: randomUUID() };
  await upgrade.query("BEGIN");
  await upgrade.query(`INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Legacy owner',$2,true,now())`,
    [ids.user, `legacy-rich-${suffix}@example.test`]);
  await upgrade.query(`INSERT INTO "Company" (id,name,"publicName","updatedAt") VALUES ($1,'Legacy rich','Legacy rich',now())`, [ids.tenant]);
  await upgrade.query(`INSERT INTO "Membership" (id,"tenantId","userId",role,"updatedAt") VALUES ($1,$2,$3,'owner',now())`, [ids.member, ids.tenant, ids.user]);
  await upgrade.query(`INSERT INTO "Service" (id,"tenantId",name,"externalName","updatedAt") VALUES ($1,$2,'Legacy rich','Legacy rich',now())`, [ids.service, ids.tenant]);
  await upgrade.query(`INSERT INTO "Form" (id,"tenantId","serviceId","ownerId",title,"updatedAt") VALUES ($1,$2,$3,$4,'Legacy rich form',now())`, [ids.form, ids.tenant, ids.service, ids.user]);
  await upgrade.query(`INSERT INTO "FormVersion" (id,"tenantId","formId",number,title,body,"consentRequired","consentPurpose","retentionDays","maxResponses","updatedAt")
    VALUES ($1,$2,$3,1,'Legacy rich form','',false,'',30,100,now())`, [ids.version, ids.tenant, ids.form]);
  await upgrade.query(`INSERT INTO "AuthorAssetBlob" (id,"storageKey",mime,size,sha256,"updatedAt") VALUES ($1,$2,'application/pdf',4,$3,now())`, [ids.blob, randomUUID(), "a".repeat(64)]);
  await upgrade.query(`UPDATE "AuthorAssetBlob" SET status='uploaded',version=version+1,"updatedAt"=now() WHERE id=$1`, [ids.blob]);
  await upgrade.query(`UPDATE "AuthorAssetBlob" SET status='ready',"scanStatus"='clean',"scanEngine"='migration fixture',"scannedAt"=now(),"expiresAt"=NULL,version=version+1,"updatedAt"=now() WHERE id=$1`, [ids.blob]);
  await upgrade.query(`INSERT INTO "AuthorAsset" (id,"blobId","ownerKind","tenantId","serviceId","createdById",purpose,"nameCipher",size,status,"expiresAt","updatedAt")
    VALUES ($1,$2,'company',$3,$4,$5,'QUESTION_MATERIAL','fixture',4,'ready',(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '59 minutes',now())`,
    [ids.asset, ids.blob, ids.tenant, ids.service, ids.member]);
  const materials = [{ materialType: "FILE", orderNumber: 0, fileKey: ids.asset, linkLabel: null, linkUrl: null }];
  await upgrade.query(`INSERT INTO "Question" (id,"tenantId","formVersionId","stableKey",type,label,"materialList",required,"order")
    VALUES ($1,$2,$3,$4,'단문형 답변','Legacy material',$5::jsonb,false,0)`, [ids.question, ids.tenant, ids.version, ids.questionKey, JSON.stringify(materials)]);
  await upgrade.query(`INSERT INTO "AuthorAssetReference" (id,"assetId","tenantId","serviceId","formVersionId","questionId","questionKey",slot,"orderNumber")
    VALUES ($1,$2,$3,$4,$5,$6,$7,'material',0)`, [ids.reference, ids.asset, ids.tenant, ids.service, ids.version, ids.question, ids.questionKey]);
  await upgrade.query(`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1,"updatedAt"=now() WHERE id=$1`, [ids.asset]);
  await upgrade.query("COMMIT");
  const before = (await upgrade.query(`SELECT to_jsonb(r) AS snapshot FROM "AuthorAssetReference" r WHERE id=$1`, [ids.reference])).rows[0].snapshot;
  await upgrade.end();

  await cp(join("prisma/migrations", migration), join(upgradeProject, "prisma/migrations", migration), { recursive: true });
  await migrate(upgradeSchema, upgradeProject, "upgrade-after");
  const upgraded = await schemaClient(upgradeSchema);
  assert.equal(await migrationCount(upgraded), 129);
  const after = (await upgraded.query(`SELECT to_jsonb(r) - ARRAY['documentKey','nodeKey'] AS snapshot FROM "AuthorAssetReference" r WHERE id=$1`, [ids.reference])).rows[0].snapshot;
  assert.deepEqual(after, before);
  const newFields = (await upgraded.query(`SELECT "questionKey","documentKey","nodeKey" FROM "AuthorAssetReference" WHERE id=$1`, [ids.reference])).rows[0];
  assert.deepEqual(newFields, { questionKey: ids.questionKey, documentKey: null, nodeKey: null });
  await upgraded.end();

  for (const [name, output] of Object.entries(logs)) await writeFile(join(evidence, `migration-${name}.log`), output);
  const report = { result: "passed", checkedAt: new Date().toISOString(), migrations: 129,
    fresh: { schema: freshSchema, nullableReferenceKeys: freshColumns, newTriggers: freshTriggers },
    upgrade: { schema: upgradeSchema, beforeMigrations: 128, afterMigrations: 129, legacyReferenceUnchanged: true, newFields },
    scope: "Ephemeral schemas in catchsecu_test; migration-only fresh install and 128→129 upgrade; schemas removed after verification." };
  await writeFile(join(evidence, "migration-install-final.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if ((root as unknown as { _connected?: boolean })._connected !== false) {
    await root.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`).catch(() => undefined);
    await root.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`).catch(() => undefined);
  }
  await root.end().catch(() => undefined); await rm(working, { recursive: true, force: true });
}
