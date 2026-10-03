import { runOneNotification } from "../src/server/notification-worker";
import { cleanupMarketingJobs } from "../src/server/marketing-jobs";
import { cleanupSenderVerificationMail } from "../src/server/senders";
import { cleanupCampaigns } from "../src/server/campaign-worker";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { runOneJob } from "../src/server/jobs";
import { cleanupExpiredFiles } from "../src/server/files";
import { cleanupNoticeAttachments } from "../src/server/notice-attachments";
import { enqueueExpiredSubmissions, runOneDestruction } from "../src/server/destruction-worker";
import { expireIdempotencyResponses } from "../src/server/idempotency";

import { cleanupExpiredImports, runOneImport } from "../src/server/import-worker";

import { cleanupSubjectAccess } from "../src/server/subjects";
import { expireTrials } from "../src/server/subscription-worker";
import { expireExpertAssignments } from "../src/server/expert-assignments";

const workerId = randomUUID();
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
async function main() {
  console.info("작업 처리기 시작", { workerId });
  let cleanedAt = 0;
  while (!stopped) {
    if (Date.now() - cleanedAt > 60000) {
      await cleanupSenderVerificationMail();
      await cleanupMarketingJobs();
      await cleanupCampaigns();
      await cleanupSubjectAccess();
      await cleanupExpiredImports();
      const cleanup = await cleanupExpiredFiles();
      if (cleanup.deleted || cleanup.retry) console.info("임시 파일 정리", cleanup);
      const noticeCleanup = await cleanupNoticeAttachments();
      if (noticeCleanup.deleted || noticeCleanup.retry) console.info("공지 첨부 정리", noticeCleanup);
      const expired = await expireIdempotencyResponses();
      const expiredTrials = await expireTrials();
      const expiredExperts = await expireExpertAssignments();
      const destruction = await enqueueExpiredSubmissions();
      if (expired.count || destruction.created || expiredTrials || expiredExperts) console.info("보유 기한 처리", { expiredCaches: expired.count, requests: destruction.created, expiredTrials, expiredExperts });
      cleanedAt = Date.now();
    }
    const destroyed = await runOneDestruction(workerId);
    const imported = await runOneImport(workerId);
    const notified = await runOneNotification(workerId);
    const worked = (await runOneJob(workerId)) || destroyed || imported || notified;
    if (process.argv.includes("--once") || (!worked && process.argv.includes("--drain"))) break;
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await db.$disconnect();
}
main().catch(() => { console.error("작업 처리기가 중단되었습니다. DB 연결과 환경 설정을 확인하세요."); process.exitCode = 1; });
