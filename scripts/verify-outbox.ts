import { readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { claimJob, deliverMail, enqueueMail, runOneJob } from "../src/server/jobs";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_shadow")
  throw new Error("outbox 검증은 catchsecu_shadow에서만 실행합니다.");
const prefix = "mail:p01-outbox:";
const failures: string[] = [];
async function mailCount(id: string) {
  const names = await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[]);
  return names.filter(name => name === id + ".json").length;
}
async function clean() {
  const jobs = await db.job.findMany({ where: { dedupeKey: { startsWith: prefix } }, select: { id: true } });
  for (const job of jobs) await unlink(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")).catch(() => undefined);
  await db.job.deleteMany({ where: { dedupeKey: { startsWith: prefix } } });
}
async function main() {
  const occupied = await db.job.count({ where: { dedupeKey: { not: { startsWith: prefix } }, status: { in: ["queued", "retry", "leased"] }, dueAt: { lte: new Date() } } });
  if (occupied) throw new Error("shadow에 다른 대기 작업이 있어 outbox 검증을 중단합니다.");
  await clean();
  const raced = await enqueueMail({ to: "p01-race@catchsecu.local.test", subject: "race", text: "one" }, "p01-outbox:race");
  const claims = await Promise.all([claimJob("worker-a"), claimJob("worker-b")]);
  const winners = claims.filter(Boolean);
  if (winners.length !== 1 || winners[0]?.id !== raced.id) failures.push("동시 claim 결과가 하나가 아닙니다.");
  await db.job.update({ where: { id: raced.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  if (!await runOneJob("worker-c")) failures.push("중단된 lease를 재시작에서 복구하지 못했습니다.");
  if (await mailCount(raced.id) !== 1) failures.push("재시작 후 메일 파일이 하나가 아닙니다.");
  const raceAttempts = await db.jobAttempt.findMany({ where: { jobId: raced.id }, orderBy: { attempt: "asc" } });
  if (raceAttempts.length < 2 || raceAttempts.some(row => JSON.stringify(row).includes("p01-race@"))) failures.push("재처리 이력이 없거나 수신자가 기록되었습니다.");

  const crashed = await enqueueMail({ to: "p01-crash@catchsecu.local.test", subject: "crash", text: "once" }, "p01-outbox:crash");
  const first = await claimJob("worker-d");
  if (!first) failures.push("중단 시험을 시작하지 못했습니다.");
  else {
    await deliverMail(first, { to: "p01-crash@catchsecu.local.test", subject: "crash", text: "once" });
    await db.job.update({ where: { id: first.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    if (!await runOneJob("worker-e") || await mailCount(first.id) !== 1) failures.push("전송 직후 중단이 메일을 한 번 더 만들었습니다.");
  }
  const doomed = await db.job.create({ data: { type: "mail", dedupeKey: prefix + "dead", payloadCipher: "not-encrypted", maxAttempts: 1 } });
  if (!await runOneJob("worker-f")) failures.push("실패 작업을 처리하지 못했습니다.");
  const dead = await db.job.findUniqueOrThrow({ where: { id: doomed.id } });
  const deadAttempt = await db.jobAttempt.findFirstOrThrow({ where: { jobId: doomed.id } });
  if (dead.status !== "dead" || dead.lastError !== "DELIVERY_FAILED" || deadAttempt.errorCode !== "DELIVERY_FAILED") failures.push("재시도 한도를 넘긴 작업이 dead가 아닙니다.");
  const cancelled = await enqueueMail({ to: "p01-cancel@catchsecu.local.test", subject: "cancel", text: "no" }, "p01-outbox:cancel");
  await db.job.update({ where: { id: cancelled.id }, data: { status: "cancelled", completedAt: new Date() } });
  const stolen = await claimJob("worker-g");
  if (stolen?.id === cancelled.id) failures.push("취소된 작업을 다시 집었습니다.");
  const report = { checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed", raceAttempts: raceAttempts.map(row => row.outcome), dead: dead.status, failures };
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("docs/qa/P01-T04", { recursive: true });
  await writeFile("docs/qa/P01-T04/outbox.json", JSON.stringify(report, null, 2) + "\n");
  await clean();
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(JSON.stringify({ result: report.result, raceAttempts: report.raceAttempts, dead: report.dead }));
}
main().catch(async error => { console.error(error instanceof Error ? error.message : error); await db.$disconnect(); process.exitCode = 1; })
  .then(() => db.$disconnect());
