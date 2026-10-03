

-- AlterTable
ALTER TABLE "FormVersion" ADD COLUMN     "marketing" JSONB;

-- CreateTable
CREATE TABLE "MarketingPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sourceSubmissionId" TEXT NOT NULL,
    "nameQuestionId" TEXT NOT NULL,
    "contactQuestionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contactHash" TEXT NOT NULL,
    "nameHash" TEXT,
    "contactCipher" TEXT,
    "evidenceCipher" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'granted',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "version" INTEGER NOT NULL,
    "evidenceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingPreference_tenantId_serviceId_status_createdAt_id_idx" ON "MarketingPreference"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MarketingPreference_sourceSubmissionId_idx" ON "MarketingPreference"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "MarketingPreference_tenantId_serviceId_nameHash_idx" ON "MarketingPreference"("tenantId", "serviceId", "nameHash");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPreference_tenantId_id_key" ON "MarketingPreference"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPreference_tenantId_serviceId_channel_contactHash_key" ON "MarketingPreference"("tenantId", "serviceId", "channel", "contactHash");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEvent_preferenceId_version_key" ON "MarketingEvent"("preferenceId", "version");

-- AddForeignKey
ALTER TABLE "MarketingPreference" ADD CONSTRAINT "MarketingPreference_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPreference" ADD CONSTRAINT "MarketingPreference_tenantId_sourceSubmissionId_fkey" FOREIGN KEY ("tenantId", "sourceSubmissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_tenantId_preferenceId_fkey" FOREIGN KEY ("tenantId", "preferenceId") REFERENCES "MarketingPreference"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingPreference" ADD CONSTRAINT "marketing_values" CHECK (
 channel IN ('email','sms') AND status IN ('granted','withdrawn','erased') AND "sourceKind" IN ('form','manual') AND version>0
 AND "contactHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'
 AND ("nameHash" IS NULL OR "nameHash" ~ '^[a-f0-9]{64}$')
 AND ((status='erased' AND "contactCipher" IS NULL AND "evidenceCipher" IS NULL AND "nameHash" IS NULL)
 OR (status<>'erased' AND "contactCipher" IS NOT NULL AND "evidenceCipher" IS NOT NULL AND "contactCipher" LIKE 'v1.%' AND "evidenceCipher" LIKE 'v1.%' AND "nameHash" IS NOT NULL))
 AND (status<>'withdrawn' OR "withdrawnAt" IS NOT NULL));
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "marketing_event_values" CHECK (
 kind IN ('granted','reconsented','excluded','included','withdrawn','erased','source_withdrawn','source_unavailable','source_corrected')
 AND version>0 AND ("evidenceHash" IS NULL OR "evidenceHash" ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION marketing_delivery_lock(t text,s text,c text,h text) RETURNS void LANGUAGE sql AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('delivery:'||t||':'||s||':'||CASE WHEN c='email' THEN h ELSE c||':'||h END,0));
$$;
CREATE FUNCTION guard_marketing_preference() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NEW."grantedAt">now()+interval '1 second' OR NEW."grantedAt"<'2000-01-01'::timestamp
 THEN RAISE EXCEPTION 'invalid marketing consent time' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketing_preference_guard BEFORE INSERT OR UPDATE OR DELETE ON "MarketingPreference" FOR EACH ROW EXECUTE FUNCTION guard_marketing_preference();
CREATE FUNCTION validate_marketing_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "MarketingPreference" WHERE id=NEW."preferenceId" AND "tenantId"=NEW."tenantId" AND version=NEW.version)
 THEN RAISE EXCEPTION 'marketing event must match current version' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER marketing_event_guard BEFORE INSERT ON "MarketingEvent" FOR EACH ROW EXECUTE FUNCTION validate_marketing_event();
CREATE TRIGGER marketing_event_immutable BEFORE UPDATE OR DELETE ON "MarketingEvent" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE FUNCTION require_marketing_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "MarketingEvent" WHERE "preferenceId"=NEW.id AND version=NEW.version)
 THEN RAISE EXCEPTION 'marketing changes require an event' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketing_event_required AFTER INSERT OR UPDATE ON "MarketingPreference" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_marketing_event();
CREATE FUNCTION invalidate_marketing_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; next_version integer; qkey text; action text; sid text;
BEGIN
 IF TG_TABLE_NAME='Submission' THEN
  IF NEW.status=OLD.status OR NEW.status NOT IN ('withdrawn','pendingDestruction','destroying','destroyed') THEN RETURN NEW; END IF;
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
CREATE TRIGGER marketing_source_status AFTER UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION invalidate_marketing_source();
CREATE TRIGGER marketing_source_correction AFTER UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION invalidate_marketing_source();

-- Grant only the corresponding existing service permissions to the intended roles.
UPDATE "ServiceGrant" g SET capabilities=ARRAY(SELECT DISTINCT unnest(g.capabilities||ARRAY['marketing.read','marketing.write']))
 FROM "Membership" m WHERE m.id=g."memberId" AND m.role IN ('owner','admin','privacy') AND 'submission.write'=ANY(g.capabilities);
UPDATE "ServiceGrant" g SET capabilities=ARRAY(SELECT DISTINCT unnest(g.capabilities||ARRAY['marketing.read']))
 FROM "Membership" m WHERE m.id=g."memberId" AND m.role='sender' AND 'message.read'=ANY(g.capabilities);

CREATE OR REPLACE FUNCTION validate_destruction_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND s.status='destroying' AND NOT s."legalHold" AND d.id=NEW."requestId" AND d.status='running')
   OR EXISTS (SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "subjectId" IS NOT NULL)
   OR EXISTS (SELECT 1 FROM "MarketingPreference" WHERE "sourceSubmissionId"=NEW."submissionId" AND ("contactCipher" IS NOT NULL OR "evidenceCipher" IS NOT NULL OR "nameHash" IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportEvidence" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportRow" WHERE "submissionId"=NEW."submissionId" AND ("payloadCipher" IS NOT NULL OR digest IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW."submissionId" AND status<>'deleted')
 THEN RAISE EXCEPTION 'certificate requires completed erasure' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.counts)<>'object' OR EXISTS (SELECT 1 FROM jsonb_each(NEW.counts) e
   WHERE e.key NOT IN ('answers','notes','correctionPayloads','corrections','consentEvents','receipts','files','importEvidence','importRows','subjectBindings','dataSubjects','marketingPreferences')
   OR e.value::text !~ '^[0-9]+$')
 THEN RAISE EXCEPTION 'certificate contains invalid counts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
