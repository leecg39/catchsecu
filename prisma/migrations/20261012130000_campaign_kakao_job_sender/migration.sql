-- 알림톡 캠페인은 발신자가 없다: 잡-캠페인 바인딩의 발신자 비교를 null-safe로 교체한다.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_campaign_job()'::regprocedure) INTO definition;
 IF position('c."senderId"=NEW."senderId"' IN definition)=0 THEN RAISE EXCEPTION 'campaign job sender binding missing'; END IF;
 EXECUTE replace(definition,'c."senderId"=NEW."senderId"','c."senderId" IS NOT DISTINCT FROM NEW."senderId"');
END $$;
