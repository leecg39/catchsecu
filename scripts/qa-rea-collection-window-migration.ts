import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const mode = process.argv[2];
assert(["capture", "verify"].includes(mode), "Use capture before migration and verify after migration");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = "docs/qa/R08-T02/collection-window", beforePath = directory + "/pre-upgrade.json";
const client = new Client({ connectionString: url.href });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  await client.connect(); await mkdir(directory, { recursive: true });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND ((table_name='FormVersion' AND column_name IN
      ('collectionWindowSchemaVersion','collectionOpenAt','collectionCloseAt')) OR
      (table_name='Publication' AND column_name='opensAt')) ORDER BY table_name,column_name`)).rows;
  const versionRows = (await client.query(mode === "capture"
    ? `SELECT to_jsonb(v) AS row FROM "FormVersion" v ORDER BY id`
    : `SELECT to_jsonb(v)-'collectionWindowSchemaVersion'-'collectionOpenAt'-'collectionCloseAt' AS row
       FROM "FormVersion" v ORDER BY id`)).rows.map(row => row.row);
  const publicationRows = (await client.query(mode === "capture"
    ? `SELECT to_jsonb(p) AS row FROM "Publication" p ORDER BY id`
    : `SELECT to_jsonb(p)-'opensAt' AS row FROM "Publication" p ORDER BY id`)).rows.map(row => row.row);
  const base = { formVersions: versionRows.length, publications: publicationRows.length,
    formVersionsSha256: digest(versionRows), publicationsSha256: digest(publicationRows) };
  if (mode === "capture") {
    assert.equal(columns.length, 0, "Collection window migration was already applied");
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, ...base,
      scope: "Development PostgreSQL snapshot before additive collection-window migration; all pre-existing columns are hashed in stable id order." };
    await writeFile(beforePath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else {
    assert.equal(columns.length, 4);
    const before = JSON.parse(await readFile(beforePath, "utf8")) as typeof base;
    assert.equal(base.formVersions, before.formVersions); assert.equal(base.publications, before.publications);
    assert.equal(base.formVersionsSha256, before.formVersionsSha256); assert.equal(base.publicationsSha256, before.publicationsSha256);
    const migration = (await client.query(`SELECT finished_at IS NOT NULL AS applied FROM "_prisma_migrations"
      WHERE migration_name='20261025023000_form_collection_window'`)).rows[0];
    assert.equal(migration?.applied, true);
    const legacy = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "collectionWindowSchemaVersion"=0 AND "collectionOpenAt" IS NULL AND "collectionCloseAt" IS NULL)::int AS preserved
      FROM "FormVersion"`)).rows[0] as { total: number; preserved: number };
    const publications = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "opensAt" IS NULL)::int AS preserved FROM "Publication"`)).rows[0] as { total: number; preserved: number };
    assert.equal(legacy.preserved, legacy.total); assert.equal(publications.preserved, publications.total);
    const constraints = (await client.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN ('FormVersion_collection_window_check','Publication_collection_window_check') ORDER BY conname`)).rows;
    assert.equal(constraints.length, 2);
    await client.query("COMMIT");
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, ...base, columns, constraints,
      legacyFormVersions: legacy, legacyPublications: publications,
      scope: "Development PostgreSQL after migration; hashes exclude only the four additive columns. Every existing version remains schema 0/null and every existing publication has a null open time." };
    await writeFile(directory + "/upgrade-preservation.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", formVersions: legacy.total, publications: publications.total }));
  }
} finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
