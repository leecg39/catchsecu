-- P11-T01: 회사 기본 보유 기간 집행과 미지정 폼 허용.
-- FormVersion.retentionDays는 미지정(NULL)을 허용하고 제출 시점에 회사 정책 기본값으로 해석한다.
ALTER TABLE "FormVersion" ALTER COLUMN "retentionDays" DROP NOT NULL;
ALTER TABLE "FormVersion" ALTER COLUMN "retentionDays" DROP DEFAULT;
ALTER TABLE "FormVersion" DROP CONSTRAINT "FormVersion_ranges";
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_ranges" CHECK (number > 0 AND ("retentionDays" IS NULL OR "retentionDays" BETWEEN 1 AND 36500) AND "maxResponses" BETWEEN 1 AND 1000000);
-- SecurityPolicy.ipRestriction은 P11-T02의 IpAccessPolicy.enabled가 대체했고 읽는 경로가 없어 제거한다.
ALTER TABLE "SecurityPolicy" DROP COLUMN "ipRestriction";
