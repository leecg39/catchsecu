-- 캠페인 알림톡 채널: Campaign.kakaoTemplateId/Version 바인딩과 kakao 동의 채널을 확장한다.
-- 발신자(Sender) 대신 승인된 KakaoTemplate+확인된 KakaoChannel이 발송 경로다.

ALTER TABLE "Campaign" ADD COLUMN "kakaoTemplateId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "kakaoTemplateVersion" INTEGER;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_kakaoTemplateId_fkey"
  FOREIGN KEY ("tenantId", "kakaoTemplateId") REFERENCES "KakaoTemplate"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_shape";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_shape" CHECK (
 channel IN ('email','sms','kakao') AND source IN ('direct','form') AND version>0
 AND status IN ('draft','scheduled','dispatching','completed','partial_failed','failed','cancelled','deleted','expired')
 AND "expiresAt">"createdAt" AND (status NOT IN ('deleted','expired') OR "contentCipher" IS NULL)
 AND (("kakaoTemplateId" IS NULL) = ("kakaoTemplateVersion" IS NULL))
 AND (channel<>'kakao' OR ("senderId" IS NULL AND "senderVersion" IS NULL))
 AND (channel='kakao' OR ("kakaoTemplateId" IS NULL AND "kakaoTemplateVersion" IS NULL))
 AND (status IN ('draft','deleted','expired')
   OR (channel<>'kakao' AND "senderId" IS NOT NULL AND "senderVersion">0 AND "requestedAt" IS NOT NULL AND "scheduledAt" IS NOT NULL)
   OR (channel='kakao' AND "kakaoTemplateId" IS NOT NULL AND "kakaoTemplateVersion">0 AND "requestedAt" IS NOT NULL AND "scheduledAt" IS NOT NULL)));

ALTER TABLE "MarketingPreference" DROP CONSTRAINT "marketing_values";
ALTER TABLE "MarketingPreference" ADD CONSTRAINT "marketing_values" CHECK (
 channel IN ('email','sms','kakao') AND status IN ('granted','withdrawn','erased') AND "sourceKind" IN ('form','manual') AND version>0
 AND "contactHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'
 AND ("nameHash" IS NULL OR "nameHash" ~ '^[a-f0-9]{64}$')
 AND ((status='erased' AND "contactCipher" IS NULL AND "evidenceCipher" IS NULL AND "nameHash" IS NULL)
 OR (status<>'erased' AND "contactCipher" IS NOT NULL AND "evidenceCipher" IS NOT NULL AND "contactCipher" LIKE 'v1.%' AND "evidenceCipher" LIKE 'v1.%' AND "nameHash" IS NOT NULL))
 AND (status<>'withdrawn' OR "withdrawnAt" IS NOT NULL));

-- 요청(스케줄) 이후 캠페인 본문·발신 경로는 불변이다 — kakao 템플릿 바인딩도 같은 규칙에 포함한다.
CREATE OR REPLACE FUNCTION check_campaign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign tombstones are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.version<>1 OR NEW."senderVersion" IS NOT NULL OR NEW."requestedAt" IS NOT NULL THEN RAISE EXCEPTION 'new campaign must be draft' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."creatorId",NEW.channel,NEW.source,NEW."createdAt",NEW."expiresAt")
    IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."serviceId",OLD."creatorId",OLD.channel,OLD.source,OLD."createdAt",OLD."expiresAt")
    OR NEW.version<>OLD.version+1 OR OLD.status IN ('deleted','expired')
  THEN RAISE EXCEPTION 'immutable campaign binding or version' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'draft' AND ((NEW.title,NEW."senderId",NEW."senderVersion",NEW."kakaoTemplateId",NEW."kakaoTemplateVersion") IS DISTINCT FROM (OLD.title,OLD."senderId",OLD."senderVersion",OLD."kakaoTemplateId",OLD."kakaoTemplateVersion")
    OR (NEW."contentCipher" IS DISTINCT FROM OLD."contentCipher" AND NEW."contentCipher" IS NOT NULL))
  THEN RAISE EXCEPTION 'requested campaign content is immutable' USING ERRCODE='23514'; END IF;
  IF (OLD.status='draft' AND NEW.status NOT IN ('draft','scheduled','deleted','expired'))
    OR (OLD.status='scheduled' AND NEW.status NOT IN ('scheduled','dispatching','completed','partial_failed','failed','cancelled','expired'))
    OR (OLD.status='dispatching' AND NEW.status NOT IN ('dispatching','completed','partial_failed','failed','cancelled','expired'))
    OR (OLD.status IN ('completed','partial_failed','failed','cancelled') AND NEW.status NOT IN (OLD.status,'scheduled','expired'))
  THEN RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."senderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND channel=NEW.channel AND "tenantId"=NEW."tenantId" AND "serviceId"=NEW."serviceId")
 THEN RAISE EXCEPTION 'invalid campaign sender channel' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
