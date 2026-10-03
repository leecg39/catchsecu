CREATE OR REPLACE FUNCTION invalidate_marketing_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; next_version integer; qkey text; action text; sid text;
BEGIN
 IF TG_TABLE_NAME='Submission' THEN
  IF NEW.status=OLD.status OR NEW.status NOT IN ('withdrawn','destroying','destroyed') THEN RETURN NEW; END IF;
  sid := NEW.id;
  action := CASE WHEN NEW.status='withdrawn' THEN 'source_withdrawn' ELSE 'source_unavailable' END;
 ELSE
  IF NEW."valueCipher"=OLD."valueCipher" THEN RETURN NEW; END IF;
  sid := NEW."submissionId";
  PERFORM id FROM "Submission" WHERE id=sid FOR UPDATE;
  SELECT "stableKey" INTO qkey FROM "Question" WHERE id=NEW."questionId";
  action := 'source_corrected';
 END IF;
 FOR p IN SELECT * FROM "MarketingPreference" WHERE "sourceSubmissionId"=sid
 AND status<>'erased' AND (qkey IS NULL OR "nameQuestionId"=qkey OR "contactQuestionId"=qkey) ORDER BY channel,"contactHash" LOOP
  PERFORM marketing_delivery_lock(p."tenantId",p."serviceId",p.channel,p."contactHash");
  IF action='source_corrected' THEN
   UPDATE "MarketingPreference" SET status='erased',"contactCipher"=NULL,"evidenceCipher"=NULL,"nameHash"=NULL,version=version+1,"updatedAt"=now()
    WHERE id=p.id AND status<>'erased' RETURNING version INTO next_version;
  ELSE
   UPDATE "MarketingPreference" SET status='withdrawn',"withdrawnAt"=now(),version=version+1,"updatedAt"=now()
    WHERE id=p.id AND status='granted' RETURNING version INTO next_version;
  END IF;
  IF next_version IS NOT NULL THEN INSERT INTO "MarketingEvent" (id,"tenantId","preferenceId",kind,version) VALUES (gen_random_uuid()::text,p."tenantId",p.id,action,next_version); END IF;
  next_version := NULL;
 END LOOP;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_marketing_preference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'erase marketing contact instead of deleting its denial marker' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.id,NEW."tenantId",NEW."serviceId",NEW.channel,NEW."contactHash",NEW."createdAt") IS DISTINCT FROM
 ROW(OLD.id,OLD."tenantId",OLD."serviceId",OLD.channel,OLD."contactHash",OLD."createdAt") OR NEW.version<>OLD.version+1)
 THEN RAISE EXCEPTION 'marketing scope immutable or invalid version' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
 WHERE s.id=NEW."sourceSubmissionId" AND s."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId"
 AND (NEW.status<>'granted' OR (s.status IN ('submitted','corrected') AND s."retentionUntil">now()))
 AND NEW."nameQuestionId"<>NEW."contactQuestionId"
 AND EXISTS (SELECT 1 FROM "Question" q WHERE q."formVersionId"=s."formVersionId" AND q."stableKey"=NEW."nameQuestionId" AND q.type IN ('단문형 답변','장문형 답변'))
 AND EXISTS (SELECT 1 FROM "Question" q WHERE q."formVersionId"=s."formVersionId" AND q."stableKey"=NEW."contactQuestionId" AND q.type IN ('단문형 답변','장문형 답변')))
 THEN RAISE EXCEPTION 'marketing source invalid' USING ERRCODE='23514'; END IF;
 IF NEW."grantedAt">clock_timestamp()+interval '1 second' OR NEW."grantedAt"<'2000-01-01'::timestamp
 THEN RAISE EXCEPTION 'invalid marketing consent time' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_marketing_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."grantedAt" IS DISTINCT FROM OLD."grantedAt" THEN
  IF NEW.status<>'granted' OR NEW."grantedAt"<=OLD."grantedAt" OR NEW."grantedAt"<=COALESCE(OLD."withdrawnAt",OLD."grantedAt") OR NEW."evidenceHash"=OLD."evidenceHash" OR NEW.excluded<>OLD.excluded
  THEN RAISE EXCEPTION 'renewal requires newer distinct consent; exclusion stays' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.status='granted' AND OLD.status<>'granted') OR ROW(NEW."sourceSubmissionId",NEW."nameQuestionId",NEW."contactQuestionId",NEW."sourceKind",NEW."evidenceHash") IS DISTINCT FROM ROW(OLD."sourceSubmissionId",OLD."nameQuestionId",OLD."contactQuestionId",OLD."sourceKind",OLD."evidenceHash")
   OR (NEW.status<>'erased' AND ROW(NEW."contactCipher",NEW."evidenceCipher",NEW."nameHash") IS DISTINCT FROM ROW(OLD."contactCipher",OLD."evidenceCipher",OLD."nameHash"))
  THEN RAISE EXCEPTION 'a fresh consent is required to change evidence or restore erased data' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER marketing_transition_guard BEFORE UPDATE ON "MarketingPreference" FOR EACH ROW EXECUTE FUNCTION guard_marketing_transition();
CREATE FUNCTION guard_marketing_erased_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."payloadErasedAt" IS NOT NULL AND (NEW."payloadErasedAt" IS DISTINCT FROM OLD."payloadErasedAt" OR NEW."payloadCipher"<>OLD."payloadCipher")
 THEN RAISE EXCEPTION 'erased job payload cannot be restored' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER marketing_erased_job_guard BEFORE UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION guard_marketing_erased_job();
