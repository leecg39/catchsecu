import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/catchsecu_dev")
  throw new Error("이 검증은 로컬 catchsecu_dev 설정을 읽어 catchsecu_shadow에서만 실행합니다.");
const shadow = new URL(source.href);
shadow.pathname = "/catchsecu_shadow";
const shadowUrl = shadow.href;
const redact = (value: string) => value.split(shadowUrl).join("postgresql://[redacted]@localhost/catchsecu_shadow")
  .split(source.href).join("postgresql://[redacted]@localhost/catchsecu_dev");

function prisma(args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--env-file=.env.local", "node_modules/prisma/build/index.js", ...args], {
      env: { ...process.env, DATABASE_URL: shadowUrl },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, output: redact(output) }));
  });
}
async function migrationDirs() {
  return (await readdir("prisma/migrations")).filter(name => /^\d/.test(name)).sort();
}
async function reset(client: Client) {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO catchsecu_app');
}
async function expectSqlState(client: Client, sql: string, state: string) {
  try {
    await client.query("BEGIN");
    await client.query(sql);
    throw new Error("거부되어야 할 SQL이 성공했습니다.");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== state) throw error;
    return code;
  } finally { await client.query("ROLLBACK"); }
}

async function main() {
  const names = await migrationDirs();
  const client = new Client({ connectionString: shadowUrl });
  await client.connect();
  const before = await client.query("SELECT current_database() AS database").catch(() => { throw new Error("catchsecu_shadow에 연결할 수 없습니다."); });
  if (before.rows[0].database !== "catchsecu_shadow") throw new Error("대상 데이터베이스가 shadow가 아닙니다.");
  const evidence: Record<string, unknown> = { database: "catchsecu_shadow", migrations: names.length };
  try {
    await reset(client);
    const installed = await prisma(["migrate", "deploy"]);
    if (installed.code !== 0) throw new Error("빈 DB 설치 실패\n" + installed.output);
    const installedCount = await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    evidence.emptyInstall = { exitCode: installed.code, applied: installedCount.rows[0].count };
    if (installedCount.rows[0].count !== names.length) throw new Error("빈 DB에 적용된 migration 수가 다릅니다.");

    await reset(client);
    const prior = names.slice(0, -1);
    for (const name of prior) {
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
      const marked = await prisma(["migrate", "resolve", "--applied", name]);
      if (marked.code !== 0) throw new Error(name + " 적용 기록 실패\n" + marked.output);
    }
    const upgraded = await prisma(["migrate", "deploy"]);
    if (upgraded.code !== 0) throw new Error("기존 버전 업그레이드 실패\n" + upgraded.output);
    const upgradeCount = await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const latestTable = await client.query(`SELECT to_regclass('"LedgerEntry"') IS NOT NULL AS present`);
    evidence.upgrade = { from: prior.length, applied: upgradeCount.rows[0].count, latestTable: latestTable.rows[0].present, outputTail: upgraded.output.trim().split("\n").slice(-4) };
    if (upgradeCount.rows[0].count !== names.length || latestTable.rows[0].present !== true)
      throw new Error("업그레이드 후 최신 migration 또는 테이블이 없습니다. applied=" + upgradeCount.rows[0].count + " expected=" + names.length);

    const probe = "20990101000000_p01_probe_fail";
    const probeDir = "prisma/migrations/" + probe;
    await mkdir(probeDir, { recursive: true });
    try {
      await writeFile(probeDir + "/migration.sql", 'CREATE TABLE "P01FailProbe"(id integer PRIMARY KEY);\nDO $$ BEGIN RAISE EXCEPTION \'intentional p01 failure\'; END $$;\n');
      const failed = await prisma(["migrate", "deploy"]);
      const probeTable = await client.query(`SELECT to_regclass('"P01FailProbe"') IS NOT NULL AS present`);
      const failedRow = await client.query('SELECT finished_at IS NOT NULL AS finished FROM "_prisma_migrations" WHERE migration_name = $1', [probe]);
      evidence.failedMigration = { exitCode: failed.code, table: probeTable.rows[0].present, recordedFinished: failedRow.rows[0]?.finished ?? null };
      if (failed.code === 0 || probeTable.rows[0].present || failedRow.rows[0]?.finished) throw new Error("실패한 migration이 반영되었습니다.");
      const rolled = await prisma(["migrate", "resolve", "--rolled-back", probe]);
      if (rolled.code !== 0) throw new Error("실패 migration 롤백 기록에 실패했습니다.\n" + rolled.output);
      evidence.rolledBack = true;
    } finally { await rm(probeDir, { recursive: true, force: true }); }
    const recovered = await prisma(["migrate", "deploy"]);
    if (recovered.code !== 0) throw new Error("실패 후 재실행 복구에 실패했습니다.\n" + recovered.output);
    evidence.recovery = { exitCode: recovered.code, pending: recovered.output.includes("No pending migrations") };

    const crossCompany = await expectSqlState(client, `
      INSERT INTO "Company" (id, name, "publicName", "updatedAt") VALUES
        ('10000000-0000-4000-8000-0000000000a1', 'A', 'A', now()),
        ('10000000-0000-4000-8000-0000000000a2', 'B', 'B', now());
      INSERT INTO "User" (id, name, email, "updatedAt") VALUES
        ('30000000-0000-4000-8000-0000000000a1', 'owner', 'p01-cross@catchsecu.local.test', now());
      INSERT INTO "Membership" (id, "tenantId", "userId", role, "updatedAt") VALUES
        ('31000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a1', 'owner', now());
      INSERT INTO "Service" (id, "tenantId", name, "externalName", "updatedAt") VALUES
        ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'service-a', 'service-a', now());
      INSERT INTO "Form" (id, "tenantId", "serviceId", "ownerId", title, "updatedAt") VALUES
        ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', 'cross', now());
    `, "23503");
    const duplicate = await expectSqlState(client, `
      INSERT INTO "User" (id, name, email, "updatedAt") VALUES
        ('30000000-0000-4000-8000-0000000000b1', 'one', 'p01-dup@catchsecu.local.test', now()),
        ('30000000-0000-4000-8000-0000000000b2', 'two', 'p01-dup@catchsecu.local.test', now());
    `, "23505");
    evidence.constraints = { crossCompany, duplicateEmail: duplicate };

    const seeded = await new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--env-file=.env.local", "node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
        env: { ...process.env, DATABASE_URL: shadowUrl },
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.on("error", reject);
      child.on("close", code => resolve({ code: code ?? 1, output: redact(output) }));
    });
    if (seeded.code !== 0) throw new Error("shadow seed 실패\n" + seeded.output);
    const companies = await client.query('SELECT count(*)::int AS count FROM "Company"');
    const roles = await client.query('SELECT count(*)::int AS count FROM "User" WHERE email LIKE \'%@catchsecu.local.test\'');
    evidence.seed = { companies: companies.rows[0].count, fixtureUsers: roles.rows[0].count };
    if (companies.rows[0].count < 2 || roles.rows[0].count < 10) throw new Error("seed 결과가 기대보다 적습니다.");
    evidence.checksumSample = createHash("sha256").update(names.join("\n")).digest("hex");
    evidence.result = "passed";
  } finally { await client.end(); }
  const legacyDirectory = "docs/qa/P01-T01";
  const activeDirectory = "docs/qa/R01-T01/current";
  await Promise.all([mkdir(legacyDirectory, { recursive: true }), mkdir(activeDirectory, { recursive: true })]);
  const report = JSON.stringify(evidence, null, 2) + "\n";
  await Promise.all([
    writeFile(legacyDirectory + "/db-rehearsal.json", report),
    writeFile(activeDirectory + "/db-rehearsal.json", report),
  ]);
  const readme = `# R01-T01 DB 마이그레이션·seed

${new Date().toISOString()}. 프로젝트 shadow 데이터베이스에서 빈 설치, 직전 migration에서의 업그레이드, 실패한 migration의 롤백과 재실행, 회사 교차 참조 거부, 이메일 중복 거부, seed를 확인했다. dev/test 데이터는 변경하지 않았다.

## 결과

- 빈 스키마에 migration ${names.length}개를 설치했다.
- 마지막 migration을 제외하고 적용한 뒤 \`migrate deploy\`로 나머지를 올렸다.
- 의도적으로 실패한 migration은 테이블과 완료 기록을 남기지 않았다. \`migrate resolve --rolled-back\`으로 실패 기록을 닫고 파일을 제거한 뒤 재실행은 대기 migration 없음으로 끝났다.
- 회사 B가 회사 A의 서비스를 참조하는 폼 삽입은 SQLSTATE 23503이다.
- 같은 이메일 사용자 두 명은 SQLSTATE 23505이다.
- shadow seed 후 회사 2개와 fixture 계정이 있다.

실행: \`npm run verify:p01-db\`. 결과: \`db-rehearsal.json\`.
이 검증은 전체 페이지 CRUD 완료가 아니다.
`;
  await Promise.all([
    writeFile(legacyDirectory + "/README.md", readme.replace("R01-T01", "P01-T01")),
    writeFile(activeDirectory + "/db-rehearsal-README.md", readme),
  ]);
  console.log(JSON.stringify({ result: evidence.result, migrations: names.length, constraints: evidence.constraints, seed: evidence.seed }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
