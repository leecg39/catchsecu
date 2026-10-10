import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const client = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/participation-access";
try {
  await client.connect(); await mkdir(directory, { recursive: true });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const migrations = (await client.query(`SELECT migration_name,finished_at IS NOT NULL AS applied FROM "_prisma_migrations"
    WHERE migration_name IN ('20261025024000_form_participation_access','20261025025000_form_participant_identity',
      '20261025026000_form_participation_constraint_names') ORDER BY migration_name`)).rows;
  assert.equal(migrations.length, 3); assert(migrations.every(row => row.applied));
  const legacyVersions = (await client.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE "participationAccessSchemaVersion"=0 AND "useParticipationAccess"=false
      AND "participationAccessMethod"='EMAIL' AND "participationTargetScope"='ALL' AND "participationUseOtp"=false
      AND "participationSocialProvider"='KAKAO' AND "restrictDuplicateReplies"=false)::int AS preserved
    FROM "FormVersion"`)).rows[0] as { total: number; preserved: number };
  assert.equal(legacyVersions.preserved, legacyVersions.total);
  const newRows = {
    targetBatches: Number((await client.query(`SELECT count(*) FROM "FormAccessTargetBatch"`)).rows[0].count),
    targets: Number((await client.query(`SELECT count(*) FROM "FormAccessTarget"`)).rows[0].count),
    challenges: Number((await client.query(`SELECT count(*) FROM "ParticipationChallenge"`)).rows[0].count),
    participants: Number((await client.query(`SELECT count(*) FROM "PublicationParticipant"`)).rows[0].count),
    sessions: Number((await client.query(`SELECT count(*) FROM "ParticipationSession"`)).rows[0].count),
    linkedSubmissions: Number((await client.query(`SELECT count(*) FROM "Submission" WHERE "participantId" IS NOT NULL`)).rows[0].count),
  };
  assert(Object.values(newRows).every(count => count === 0));
  const report = { checkedAt: new Date().toISOString(), result: "passed", migrations, legacyVersions, newRows,
    limitation: "No pre-migration row hash was captured for this checkpoint; this proves current legacy defaults and empty additive tables, not byte-for-byte pre/post identity.",
    scope: "Read-only development PostgreSQL inspection after the additive participation-access migrations." };
  await writeFile(directory + "/existing-data-compatibility.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", legacyVersions, newRows }));
} finally {
  await client.query("ROLLBACK").catch(() => undefined); await client.end();
}
