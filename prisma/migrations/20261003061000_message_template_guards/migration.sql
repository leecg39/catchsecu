BEGIN;
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_template_shape";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_template_shape" CHECK (("messageTemplateId" IS NULL AND "messageTemplateVersion" IS NULL) OR ("messageTemplateId" IS NOT NULL AND "messageTemplateVersion" IS NOT NULL AND "messageTemplateVersion">0));
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_hash_required" CHECK (status='deleted' OR "contentHash" IS NOT NULL);
CREATE FUNCTION check_message_revision_kind() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "MessageTemplate";
BEGIN
 SELECT * INTO t FROM "MessageTemplate" WHERE id=NEW."templateId";
 IF (NEW.kind='created' AND NEW.version<>1) OR (NEW.kind<>'created' AND NEW.version=1)
 OR (NEW.kind='archived' AND t.status<>'archived') OR (NEW.kind='deleted' AND t.status<>'deleted')
 OR (NEW.kind IN ('created','updated','restored') AND t.status<>'active')
 THEN RAISE EXCEPTION 'template revision kind mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "MessageTemplateRevision_kind" BEFORE INSERT ON "MessageTemplateRevision" FOR EACH ROW EXECUTE FUNCTION check_message_revision_kind();
COMMIT;
