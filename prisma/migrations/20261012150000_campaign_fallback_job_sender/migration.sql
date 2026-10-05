-- 발신자 잡 보호: SMS 발신자 잡은 SMS 캠페인 외에 카카오 캠페인의 등록된 대체발신자로도 허용한다.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_sender_job()'::regprocedure) INTO definition;
 IF position('c."fallbackSenderId"=NEW."senderId"' IN definition)>0 THEN RETURN; END IF;
 IF position('AND c.channel=''sms''' IN definition)=0 THEN RAISE EXCEPTION 'sender job sms binding missing'; END IF;
 EXECUTE replace(definition,'AND c.channel=''sms''','AND (c.channel=''sms'' OR c."fallbackSenderId"=NEW."senderId")');
END $$;
