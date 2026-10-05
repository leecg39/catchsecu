-- 개인정보 활동 검토 이력의 회사별 보유 기한과 승인된 파기.
-- 종결된 검토는 회사 정책 기한 경과 후 파기 승인 대기가 되고, 관리자 승인 트랜잭션에서만 메시지 원문을 제거한다.
ALTER TABLE "SecurityPolicy" ADD COLUMN "activityReviewRetentionDays" INTEGER;
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_activityReviewRetentionDays" CHECK ("activityReviewRetentionDays" IS NULL OR "activityReviewRetentionDays" BETWEEN 1 AND 36500);
ALTER TABLE "ActivityReview" ADD COLUMN "retentionUntil" TIMESTAMP(3), ADD COLUMN "destructionStatus" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "destroyedAt" TIMESTAMP(3), ADD COLUMN "destroyApproverId" TEXT;
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_destroyApprover_fkey" FOREIGN KEY ("tenantId","destroyApproverId") REFERENCES "Membership"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_destruction" CHECK (
  "destructionStatus" IN ('none','awaiting','kept','destroyed')
  AND (("destructionStatus"='destroyed') = ("destroyedAt" IS NOT NULL AND "destroyApproverId" IS NOT NULL))
  AND (("status" IN ('resolved','cancelled')) OR ("retentionUntil" IS NULL AND "destructionStatus"='none' AND "destroyedAt" IS NULL AND "destroyApproverId" IS NULL))
);
CREATE INDEX "ActivityReview_destructionStatus_retentionUntil_idx" ON "ActivityReview"("destructionStatus","retentionUntil");

CREATE OR REPLACE FUNCTION protect_activity_review_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('app.activity_review_destroy', true)='on'
   AND EXISTS (SELECT 1 FROM "ActivityReview" r WHERE r."tenantId"=OLD."tenantId" AND r.id=OLD."reviewId" AND r."destructionStatus"='awaiting')
 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'activity review messages are immutable' USING ERRCODE='23514';
END; $$;

CREATE OR REPLACE FUNCTION protect_activity_review_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."tenantId",NEW."serviceId",NEW."auditEventId",NEW."recipientUserId",NEW."requesterId",NEW."recipientId",NEW."title",NEW."createdAt") IS DISTINCT FROM ROW(OLD."tenantId",OLD."serviceId",OLD."auditEventId",OLD."recipientUserId",OLD."requesterId",OLD."recipientId",OLD."title",OLD."createdAt") OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'immutable review scope or invalid version' USING ERRCODE='23514'; END IF;
 IF OLD."destructionStatus" IN ('destroyed','kept') THEN RAISE EXCEPTION 'terminal review destruction state' USING ERRCODE='23514'; END IF;
 IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT ((OLD."status"='requested' AND NEW."status" IN ('responded','cancelled')) OR (OLD."status"='responded' AND NEW."status" IN ('resolved','cancelled'))) THEN RAISE EXCEPTION 'invalid review transition' USING ERRCODE='23514'; END IF;
 IF NEW."destructionStatus" IS DISTINCT FROM OLD."destructionStatus" AND NOT ((OLD."destructionStatus"='none' AND NEW."destructionStatus"='awaiting') OR (OLD."destructionStatus"='awaiting' AND NEW."destructionStatus" IN ('destroyed','kept','none'))) THEN RAISE EXCEPTION 'invalid review destruction transition' USING ERRCODE='23514'; END IF;
 IF NEW."status" NOT IN ('resolved','cancelled') AND (NEW."retentionUntil" IS NOT NULL OR NEW."destructionStatus"<>'none' OR NEW."destroyedAt" IS NOT NULL OR NEW."destroyApproverId" IS NOT NULL) THEN RAISE EXCEPTION 'destruction requires closed review' USING ERRCODE='23514'; END IF;
 IF NEW."destructionStatus"='destroyed' AND (NEW."destroyedAt" IS NULL OR NEW."destroyApproverId" IS NULL) THEN RAISE EXCEPTION 'destroyed review requires evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
