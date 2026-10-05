// P14-T04: process-level worker crash/restart rehearsal.
// 1) Queue N real mail jobs. 2) Mark one job leased by a dead worker with a fresh
//    lease. 3) Run the real worker and SIGKILL it mid-flight. 4) Restart with
//    --drain and prove the still-valid lease is respected. 5) Expire the orphan
//    lease and prove it is re-claimed, expired-attempt recorded, delivered once.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { enqueueMail } from "../src/server/jobs";
import { env } from "../src/server/env";

const N = 60;
const runId = randomUUID().slice(0, 8);
const keyPrefix = `qa-restart-${runId}`;
const mailDir = resolve(env.LOCAL_MAIL_DIR);
const results: { check: string; ok: boolean; detail?: string }[] = [];
const record = (check: string, ok: boolean, detail?: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${check}${detail ? ` — ${detail}` : ""}`);
};

function spawnWorker(drain: boolean): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [
    "--env-file=.env.local", "node_modules/tsx/dist/cli.mjs", "scripts/worker.ts", ...(drain ? ["--drain"] : []),
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", () => {});
  const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
  return { child, exited };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const jobCounts = () => db.$queryRaw<{ status: string; n: bigint }[]>`
  SELECT status, count(*)::bigint AS n FROM "Job" WHERE "dedupeKey" LIKE ${"mail:" + keyPrefix + ":%"} GROUP BY status`;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return true; await sleep(200); }
  console.error(`timeout waiting: ${label}`);
  return false;
}

const jobIds: string[] = [];
await mkdir(mailDir, { recursive: true });
for (let i = 0; i < N; i++) {
  const job = await enqueueMail(
    { to: `qa-restart-${runId}-${i}@localhost.test`, subject: `[qa] restart rehearsal ${runId}`, text: `job ${i}` },
    `${keyPrefix}:${i}`,
  );
  jobIds.push(job.id);
}
record("enqueued", jobIds.length === N, `${jobIds.length} jobs`);

// Job 0 is orphaned by a "dead" worker before any real worker starts.
const deadWorker = `dead-worker-${runId}`;
const deadAttempt = randomUUID();
await db.$transaction(async tx => {
  await tx.$executeRaw`UPDATE "Job" SET status='leased', "leaseOwner"=${deadWorker},
    "leaseUntil" = now() + interval '5 minutes', attempts = 1, "updatedAt" = now()
    WHERE id = ${jobIds[0]} AND status = 'queued'`;
  await tx.$executeRaw`INSERT INTO "JobAttempt" (id, "jobId", "workerId", attempt, outcome, "createdAt")
    VALUES (${deadAttempt}, ${jobIds[0]}, ${deadWorker}, 1, 'leased', now())`;
});
record("orphan-lease-created", true, `job ${jobIds[0]} leased by ${deadWorker} for 5min`);

// Real worker run #1 — SIGKILL mid-flight.
const run1 = spawnWorker(false);
await waitFor(async () => {
  const counts = await jobCounts();
  return (counts.find(c => c.status === "done")?.n ?? BigInt(0)) >= BigInt(Math.floor(N / 2));
}, 30000, "half of jobs done");
run1.child.kill("SIGKILL");
const code1 = await run1.exited;
record("sigkill-mid-flight", code1 !== 0, `exit=${code1}`);
const afterKill = await jobCounts();
console.log("  after kill:", JSON.stringify(Object.fromEntries(afterKill.map(c => [c.status, Number(c.n)]))));

// Orphan lease still valid → restarted worker must NOT steal job 0, must drain the rest.
const run2 = spawnWorker(true);
const exited2 = await Promise.race([run2.exited, sleep(60000).then(() => "timeout")]);
if (exited2 === "timeout") { run2.child.kill("SIGKILL"); await run2.exited; console.log("  drain run busy on unrelated jobs — killed, checking DB state"); }
const orphanNow = await db.job.findUnique({ where: { id: jobIds[0] } });
record("live-lease-respected", orphanNow?.status === "leased" && orphanNow.leaseOwner === deadWorker, `status=${orphanNow?.status} owner=${orphanNow?.leaseOwner}`);
const othersDone = await db.job.count({ where: { id: { in: jobIds.slice(1) }, status: "done" } });
record("remaining-jobs-drained", othersDone === N - 1, `${othersDone}/${N - 1} done`);
// Nothing from the killed run stays in a broken state other than the deliberate orphan
const stuck2 = await db.job.count({ where: { id: { in: jobIds.slice(1) }, status: { in: ["leased", "queued", "retry"] } } });
record("no-stuck-after-restart", stuck2 === 0, `stuck=${stuck2}`);

// Expire the orphan lease → a fresh worker re-claims and completes it.
await db.$executeRaw`UPDATE "Job" SET "leaseUntil" = now() - interval '1 second' WHERE id = ${jobIds[0]} AND status='leased' AND "leaseOwner"=${deadWorker}`;
const run3 = spawnWorker(true);
const exited3 = await Promise.race([run3.exited, sleep(30000).then(() => "timeout")]);
if (exited3 === "timeout") { run3.child.kill("SIGKILL"); await run3.exited; console.log("  drain run busy — killed, checking DB state"); }
const orphanFinal = await db.job.findUnique({ where: { id: jobIds[0] } });
record("orphan-reclaimed", orphanFinal?.status === "done", `status=${orphanFinal?.status}`);
const attempts = await db.jobAttempt.findMany({ where: { jobId: jobIds[0] }, orderBy: { createdAt: "asc" } });
const outcomes = attempts.map(a => `${a.attempt}:${a.outcome}`).join(",");
record("attempts-expired-then-delivered",
  attempts.length === 2 && attempts[0].workerId === deadWorker && attempts[0].outcome === "expired" && attempts[1].outcome === "delivered",
  outcomes);

// Exactly-once delivery: one mail file per job, no leftovers counted as sent.
const files = (await readdir(mailDir)).filter(name => jobIds.some(id => name === id + ".json"));
const tempLeft = (await readdir(mailDir)).filter(name => jobIds.some(id => name.startsWith(id + ".") && name.endsWith(".tmp")));
record("mail-file-once", files.length === N, `${files.length}/${N} files, tmp leftovers=${tempLeft.length}`);
const allDone = await db.job.count({ where: { id: { in: jobIds }, status: "done" } });
record("all-done", allDone === N, `${allDone}/${N}`);

for (const name of [...files, ...tempLeft]) await unlink(resolve(mailDir, name)).catch(() => {});
await db.$disconnect();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ runId, checks: results.length, failed: failed.length, jobs: N, killedExit: code1 }));
process.exit(failed.length ? 1 : 0);
