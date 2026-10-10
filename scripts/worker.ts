import { runOneNotification } from "../src/server/notification-worker";
import { cleanupMarketingJobs } from "../src/server/marketing-jobs";
import { cleanupSenderVerificationMail } from "../src/server/senders";
import { cleanupCampaigns } from "../src/server/campaign-worker";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { runOneJob } from "../src/server/jobs";
import { cleanupAuthorAssets } from "../src/server/author-asset-uploads";
import { cleanupExpiredFiles } from "../src/server/files";
import { cleanupNoticeAttachments } from "../src/server/notice-attachments";
import { cleanupBusinessFiles } from "../src/server/company-management";
import { enqueueExpiredSubmissions, runOneDestruction } from "../src/server/destruction-worker";
import { sweepActivityReviewRetention } from "../src/server/activity-reviews";
import { expireIdempotencyResponses } from "../src/server/idempotency";

import { cleanupExpiredImports, runOneImport } from "../src/server/import-worker";

import { cleanupSubjectAccess } from "../src/server/subjects";
import { expireSubscriptions } from "../src/server/subscription-worker";
import { expireExpertAssignments } from "../src/server/expert-assignments";
import { cleanupExpiredExports, runOneExport } from "../src/server/exports";
import { cleanupVerification } from "../src/server/verification-flow";

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
      await cleanupExpiredExports();
      const authorCleanup = await cleanupAuthorAssets();
      if (authorCleanup.deleted || authorCleanup.retry) console.info("문항 첨부 자료 정리", authorCleanup);
      const cleanup = await cleanupExpiredFiles();
      if (cleanup.deleted || cleanup.retry) console.info("임시 파일 정리", cleanup);
      const noticeCleanup = await cleanupNoticeAttachments();
      if (noticeCleanup.deleted || noticeCleanup.retry) console.info("공지 첨부 정리", noticeCleanup);
      const businessCleanup = await cleanupBusinessFiles();
      if (businessCleanup.deleted || businessCleanup.retry) console.info("사업자등록증 정리", businessCleanup);
      const expired = await expireIdempotencyResponses();
      const verification = await cleanupVerification();
      if (verification.expired) console.info("인증 요청 정리", verification);
      const expiredSubscriptions = await expireSubscriptions();
      const expiredExperts = await expireExpertAssignments();
      const destruction = await enqueueExpiredSubmissions();
      const reviewRetention = await sweepActivityReviewRetention();
      if (expired.count || destruction.created || expiredSubscriptions || expiredExperts || reviewRetention.pending) console.info("보유 기한 처리", { expiredCaches: expired.count, requests: destruction.created, expiredSubscriptions, expiredExperts, reviewPending: reviewRetention.pending });
      cleanedAt = Date.now();
    }
    const destroyed = await runOneDestruction(workerId);
    const imported = await runOneImport(workerId);
    const notified = await runOneNotification(workerId);
    const exported = await runOneExport(workerId);
    const worked = (await runOneJob(workerId)) || destroyed || imported || notified || exported;
    if (process.argv.includes("--once") || (!worked && process.argv.includes("--drain"))) break;
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await db.$disconnect();
}
main().catch(() => { console.error("작업 처리기가 중단되었습니다. DB 연결과 환경 설정을 확인하세요."); process.exitCode = 1; });
