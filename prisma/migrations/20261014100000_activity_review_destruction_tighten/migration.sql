-- destroyed 상태와 파기 증거 컬럼을 쌍으로 묶어 절반만 채워진 파기 행을 차단한다.
ALTER TABLE "ActivityReview" DROP CONSTRAINT "ActivityReview_destruction";
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_destruction" CHECK (
  "destructionStatus" IN ('none','awaiting','kept','destroyed')
  AND (("destructionStatus"='destroyed') = ("destroyedAt" IS NOT NULL))
  AND (("destructionStatus"='destroyed') = ("destroyApproverId" IS NOT NULL))
  AND (("status" IN ('resolved','cancelled')) OR ("retentionUntil" IS NULL AND "destructionStatus"='none'))
);
