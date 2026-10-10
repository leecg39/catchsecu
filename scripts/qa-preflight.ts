import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { requireFileScanner } from "../src/server/file-scanner";
import { HttpError } from "../src/server/http";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || !/^\/catchsecu_(dev|test|shadow)/.test(database.pathname))
  throw new Error("로컬 전용 QA DB에서만 실행하세요.");
const checks: Array<{name: string; status: "passed" | "blocked"; detail: unknown}> = [];
const version = Number(process.versions.node.split(".")[0]);
checks.push({ name: "node", status: [22, 24].includes(version) ? "passed" : "blocked", detail: process.versions.node });
try {
  try { await db.$queryRaw`SELECT 1`; checks.push({ name: "database", status: "passed", detail: database.pathname.slice(1) }); }
  catch { checks.push({ name: "database", status: "blocked", detail: "QA DB 연결 실패" }); }
  try { checks.push({ name: "file-scanner", status: "passed", detail: await requireFileScanner() }); }
  catch (cause) { checks.push({ name: "file-scanner", status: "blocked", detail: cause instanceof HttpError ? { code: cause.code, message: cause.message } : "검사 서비스 연결 실패" }); }
  const migrations = await db.$queryRaw<Array<{migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null}>>`
    SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`;
  const source = new Map<string, string>();
  for (const entry of await readdir("prisma/migrations", { withFileTypes: true })) if (entry.isDirectory()) {
    const bytes = await readFile(join("prisma/migrations", entry.name, "migration.sql"));
    source.set(entry.name, createHash("sha256").update(bytes).digest("hex"));
  }
  const applied = migrations.filter(row => row.finished_at && !row.rolled_back_at);
  const mismatches = applied.filter(row => source.get(row.migration_name) !== row.checksum).map(row => ({name:row.migration_name, databaseChecksum:row.checksum, sourceChecksum:source.get(row.migration_name)??null}));
  const unapplied = [...source.keys()].filter(name => !applied.some(row => row.migration_name === name));
  const failed = migrations.filter(row => !row.finished_at && !row.rolled_back_at).map(row => row.migration_name);
  const ready = checks.every(check => check.status === "passed") && unapplied.length === 0 && failed.length === 0;
  const report = { checkedAt: new Date().toISOString(), runtimeReady: ready, externalAcceptance: false, checks,
    migrations: { source:source.size, applied:applied.length, mismatches, unapplied, failed, historicalSqlModified:false },
    note: mismatches.length
      ? "체크섬 차이는 적용 당시 원본 바이트를 확보하고 업그레이드를 검증하기 전까지 미해결이다. 런타임 준비 여부와 출시 승인은 별개다."
      : "적용된 migration checksum이 현재 source bytes와 모두 일치한다. 런타임 준비 여부와 출시 승인은 별개다." };
  const out = "docs/qa/R01-T05/preflight"; await mkdir(out, { recursive:true });
  await writeFile(join(out,database.pathname.slice(1)+".json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ runtimeReady:ready, checks:checks.map(item=>({name:item.name,status:item.status})), migrationChecksumMismatches:mismatches.length, unapplied:unapplied.length }));
  if (!ready) process.exitCode=1;
} finally { await db.$disconnect(); }
