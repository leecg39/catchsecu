BEGIN;
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_campaign_file()'::regprocedure) INTO definition;
 definition:=replace(definition,'SELECT * INTO c FROM "Campaign" WHERE id=NEW."campaignId";','IF TG_OP=''INSERT'' THEN SELECT * INTO c FROM "Campaign" WHERE id=NEW."campaignId" FOR UPDATE; ELSE SELECT * INTO c FROM "Campaign" WHERE id=NEW."campaignId"; END IF;');
 EXECUTE definition;
END $$;
CREATE FUNCTION retain_campaign_file_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."campaignId" IS NOT NULL THEN RAISE EXCEPTION 'campaign file tombstone required' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "FileObject_campaign_tombstone" BEFORE DELETE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION retain_campaign_file_tombstone();
COMMIT;
