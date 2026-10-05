-- 알림톡 실패 시 대체 문자 발송: 캠페인이 SMS 채널 발신자를 대체발신자로 보유한다.
ALTER TABLE "Campaign" ADD COLUMN "fallbackSenderId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "fallbackSenderVersion" INTEGER;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fallbackSenderId_fkey"
  FOREIGN KEY ("tenantId","fallbackSenderId") REFERENCES "Sender"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_fallback_kakao" CHECK ("fallbackSenderId" IS NULL OR channel='kakao');
ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_fallback_version_pair" CHECK (("fallbackSenderId" IS NULL)=("fallbackSenderVersion" IS NULL));
ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_fallback_version_positive" CHECK ("fallbackSenderVersion" IS NULL OR "fallbackSenderVersion">0);

-- 요청된 캠페인의 대체발신자 바인딩은 불변이고, 대체발신자는 SMS 채널 발신자여야 한다.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_campaign()'::regprocedure) INTO definition;
 IF position('OLD."kakaoTemplateVersion")' IN definition)=0 THEN RAISE EXCEPTION 'campaign immutability guard missing'; END IF;
 IF position('"senderVersion" IS NOT NULL' IN definition)=0 THEN RAISE EXCEPTION 'campaign insert guard missing'; END IF;
 EXECUTE replace(definition,'NEW."senderVersion" IS NOT NULL','NEW."senderVersion" IS NOT NULL OR NEW."fallbackSenderVersion" IS NOT NULL');
 EXECUTE replace(definition,
  'NEW."kakaoTemplateVersion") IS DISTINCT FROM (OLD.title,OLD."senderId",OLD."senderVersion",OLD."kakaoTemplateId",OLD."kakaoTemplateVersion")',
  'NEW."kakaoTemplateVersion",NEW."fallbackSenderId",NEW."fallbackSenderVersion") IS DISTINCT FROM (OLD.title,OLD."senderId",OLD."senderVersion",OLD."kakaoTemplateId",OLD."kakaoTemplateVersion",OLD."fallbackSenderId",OLD."fallbackSenderVersion")');
 SELECT pg_get_functiondef('check_campaign()'::regprocedure) INTO definition;
 EXECUTE replace(definition,' IF NEW."senderId" IS NOT NULL',
  ' IF NEW."fallbackSenderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."fallbackSenderId" AND channel=''sms'' AND "tenantId"=NEW."tenantId" AND "serviceId"=NEW."serviceId") THEN RAISE EXCEPTION ''invalid campaign fallback sender channel'' USING ERRCODE=''23514''; END IF;
  IF NEW."senderId" IS NOT NULL');
END $$;

-- 대체발송 잡은 캠페인 발신자가 아니라 대체발신자에 바인딩된다.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_campaign_job()'::regprocedure) INTO definition;
 IF position('c."senderId" IS NOT DISTINCT FROM NEW."senderId"' IN definition)=0 THEN RAISE EXCEPTION 'campaign job sender binding missing'; END IF;
 EXECUTE replace(definition,'c."senderId" IS NOT DISTINCT FROM NEW."senderId"',
  '(c."senderId" IS NOT DISTINCT FROM NEW."senderId" OR c."fallbackSenderId" IS NOT DISTINCT FROM NEW."senderId")');
END $$;
