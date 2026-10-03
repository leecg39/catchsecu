-- Additive verification foundation. Preserve all existing custom constraints and defaults.
BEGIN;

CREATE TABLE "VerificationIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "identityProvider" TEXT,
    "signatureProvider" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationIntegrationRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "identityProvider" TEXT,
    "signatureProvider" TEXT,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationIntegrationRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "integrationVersion" INTEGER NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "browserNonceHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "providerRequestHash" TEXT,
    "providerRequestCipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "providerEventHash" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "submissionId" TEXT,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerificationIntegration_tenantId_serviceId_key" ON "VerificationIntegration"("tenantId", "serviceId");

CREATE UNIQUE INDEX "VerificationIntegration_tenantId_serviceId_id_key" ON "VerificationIntegration"("tenantId", "serviceId", "id");

CREATE UNIQUE INDEX "VerificationIntegrationRevision_tenantId_serviceId_integrat_key" ON "VerificationIntegrationRevision"("tenantId", "serviceId", "integrationId", "version");

CREATE INDEX "VerificationAttempt_tenantId_serviceId_status_expiresAt_idx" ON "VerificationAttempt"("tenantId", "serviceId", "status", "expiresAt");

CREATE UNIQUE INDEX "VerificationAttempt_tenantId_serviceId_id_key" ON "VerificationAttempt"("tenantId", "serviceId", "id");

CREATE UNIQUE INDEX "VerificationEvent_tenantId_serviceId_attemptId_id_key" ON "VerificationEvent"("tenantId", "serviceId", "attemptId", "id");

CREATE UNIQUE INDEX "VerificationEvent_attemptId_providerEventHash_key" ON "VerificationEvent"("attemptId", "providerEventHash");

CREATE UNIQUE INDEX "VerificationReceipt_attemptId_key" ON "VerificationReceipt"("attemptId");

CREATE UNIQUE INDEX "VerificationReceipt_submissionId_key" ON "VerificationReceipt"("submissionId");

CREATE UNIQUE INDEX "VerificationReceipt_tenantId_id_key" ON "VerificationReceipt"("tenantId", "id");

CREATE UNIQUE INDEX "VerificationReceipt_tenantId_serviceId_attemptId_key" ON "VerificationReceipt"("tenantId", "serviceId", "attemptId");

CREATE UNIQUE INDEX "Publication_tenantId_formId_id_formVersionId_key" ON "Publication"("tenantId", "formId", "id", "formVersionId");

ALTER TABLE "VerificationIntegration" ADD CONSTRAINT "VerificationIntegration_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationIntegrationRevision" ADD CONSTRAINT "VerificationIntegrationRevision_tenantId_serviceId_integra_fkey" FOREIGN KEY ("tenantId", "serviceId", "integrationId") REFERENCES "VerificationIntegration"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_tenantId_serviceId_integrationId_integ_fkey" FOREIGN KEY ("tenantId", "serviceId", "integrationId", "integrationVersion") REFERENCES "VerificationIntegrationRevision"("tenantId", "serviceId", "integrationId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_tenantId_serviceId_formId_fkey" FOREIGN KEY ("tenantId", "serviceId", "formId") REFERENCES "Form"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_tenantId_formId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formId", "formVersionId") REFERENCES "FormVersion"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_tenantId_formId_publicationId_formVers_fkey" FOREIGN KEY ("tenantId", "formId", "publicationId", "formVersionId") REFERENCES "Publication"("tenantId", "formId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_tenantId_serviceId_attemptId_fkey" FOREIGN KEY ("tenantId", "serviceId", "attemptId") REFERENCES "VerificationAttempt"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationReceipt" ADD CONSTRAINT "VerificationReceipt_tenantId_serviceId_attemptId_fkey" FOREIGN KEY ("tenantId", "serviceId", "attemptId") REFERENCES "VerificationAttempt"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationReceipt" ADD CONSTRAINT "VerificationReceipt_tenantId_serviceId_attemptId_eventId_fkey" FOREIGN KEY ("tenantId", "serviceId", "attemptId", "eventId") REFERENCES "VerificationEvent"("tenantId", "serviceId", "attemptId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationReceipt" ADD CONSTRAINT "VerificationReceipt_tenantId_submissionId_formVersionId_fkey" FOREIGN KEY ("tenantId", "submissionId", "formVersionId") REFERENCES "Submission"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationIntegration" ADD CONSTRAINT "VerificationIntegration_configuration_check" CHECK (
  version > 0 AND environment IN ('sandbox','production') AND status IN ('pending','disabled','deleted')
  AND ("identityProvider" IS NULL OR "identityProvider" ~ '^[a-z][a-z0-9_-]{1,63}$')
  AND ("signatureProvider" IS NULL OR "signatureProvider" ~ '^[a-z][a-z0-9_-]{1,63}$')
  AND CASE WHEN status='deleted' THEN "identityProvider" IS NULL AND "signatureProvider" IS NULL
    ELSE "identityProvider" IS NOT NULL OR "signatureProvider" IS NOT NULL END
);
ALTER TABLE "VerificationIntegrationRevision" ADD CONSTRAINT "VerificationIntegrationRevision_configuration_check" CHECK (
  version > 0 AND environment IN ('sandbox','production') AND status IN ('pending','disabled','deleted')
);
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_evidence_check" CHECK (
  version > 0 AND kind IN ('identity','signature') AND environment IN ('sandbox','production')
  AND status IN ('pending','verified','failed','cancelled','expired','consumed')
  AND "browserNonceHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$' AND "documentHash" ~ '^[0-9a-f]{64}$'
  AND ("providerRequestHash" IS NULL OR "providerRequestHash" ~ '^[0-9a-f]{64}$')
  AND "expiresAt" > "createdAt"
  AND (status NOT IN ('verified','consumed') OR ("verifiedAt" IS NOT NULL AND "providerRequestHash" IS NOT NULL AND "providerRequestCipher" IS NOT NULL))
);
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_evidence_check" CHECK (
  "providerEventHash" ~ '^[0-9a-f]{64}$' AND "bodyHash" ~ '^[0-9a-f]{64}$'
  AND "verificationStatus" IN ('verified','rejected','ignored')
  AND ("verificationStatus" <> 'verified' OR "signatureValid")
);
ALTER TABLE "VerificationReceipt" ADD CONSTRAINT "VerificationReceipt_evidence_check" CHECK (
  kind IN ('identity','signature') AND environment='production'
  AND "documentHash" ~ '^[0-9a-f]{64}$' AND "proofHash" ~ '^[0-9a-f]{64}$'
  AND "retentionUntil" > "verifiedAt"
);

CREATE FUNCTION verification_integration_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW."tenantId",NEW."serviceId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."serviceId",OLD."createdAt")
    OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'immutable configuration scope or stale version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_integration_scope_guard BEFORE UPDATE ON "VerificationIntegration" FOR EACH ROW EXECUTE FUNCTION verification_integration_scope_guard();

CREATE FUNCTION verification_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration "VerificationIntegration";
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'immutable verification revision' USING ERRCODE='23514'; END IF;
  SELECT * INTO configuration FROM "VerificationIntegration" WHERE id=NEW."integrationId" FOR SHARE;
  IF NOT FOUND OR ROW(NEW."tenantId",NEW."serviceId",NEW.version,NEW."identityProvider",NEW."signatureProvider",NEW.environment,NEW.status)
    IS DISTINCT FROM ROW(configuration."tenantId",configuration."serviceId",configuration.version,configuration."identityProvider",configuration."signatureProvider",configuration.environment,configuration.status)
    THEN RAISE EXCEPTION 'revision mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON "VerificationIntegrationRevision" FOR EACH ROW EXECUTE FUNCTION verification_revision_guard();

CREATE FUNCTION verification_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration "VerificationIntegration"; revision "VerificationIntegrationRevision";
BEGIN
  SELECT * INTO configuration FROM "VerificationIntegration" WHERE id=NEW."integrationId" FOR SHARE;
  SELECT * INTO revision FROM "VerificationIntegrationRevision" WHERE "integrationId"=NEW."integrationId" AND version=NEW."integrationVersion";
  IF NOT FOUND OR NEW.environment <> revision.environment THEN RAISE EXCEPTION 'attempt environment mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.status <> 'pending' OR NEW.version <> 1 OR NEW."verifiedAt" IS NOT NULL) THEN RAISE EXCEPTION 'attempt must start pending' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW."tenantId",NEW."serviceId",NEW."integrationId",NEW."integrationVersion",NEW."formId",NEW."formVersionId",NEW."publicationId",NEW.kind,NEW.environment,NEW."browserNonceHash",NEW."requestHash",NEW."documentHash",NEW."createdAt",NEW."expiresAt")
      IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."serviceId",OLD."integrationId",OLD."integrationVersion",OLD."formId",OLD."formVersionId",OLD."publicationId",OLD.kind,OLD.environment,OLD."browserNonceHash",OLD."requestHash",OLD."documentHash",OLD."createdAt",OLD."expiresAt")
      OR NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'immutable verification scope or stale version' USING ERRCODE='23514'; END IF;
    IF NOT ((OLD.status='pending' AND NEW.status IN ('pending','verified','failed','cancelled','expired')) OR (OLD.status='verified' AND NEW.status IN ('consumed','cancelled','expired')))
      THEN RAISE EXCEPTION 'invalid verification transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF (TG_OP='INSERT' OR NEW.status IN ('verified','consumed')) AND (configuration.status <> 'pending' OR configuration.version <> NEW."integrationVersion" OR NEW."expiresAt" <= clock_timestamp())
    THEN RAISE EXCEPTION 'verification configuration unavailable or expired' USING ERRCODE='23514'; END IF;
  IF NEW.kind='identity' AND revision."identityProvider" IS NULL OR NEW.kind='signature' AND revision."signatureProvider" IS NULL
    THEN RAISE EXCEPTION 'verification provider missing' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_attempt_guard BEFORE INSERT OR UPDATE ON "VerificationAttempt" FOR EACH ROW EXECUTE FUNCTION verification_attempt_guard();

CREATE FUNCTION verification_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable verification event' USING ERRCODE='23514';
END $$;
CREATE TRIGGER verification_event_guard BEFORE UPDATE ON "VerificationEvent" FOR EACH ROW EXECUTE FUNCTION verification_event_guard();

CREATE FUNCTION verification_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt "VerificationAttempt"; event "VerificationEvent"; revision "VerificationIntegrationRevision"; submission "Submission";
BEGIN
  IF TG_OP='UPDATE' AND (OLD."submissionId" IS NOT NULL OR NEW."submissionId" IS NULL OR
    (to_jsonb(NEW)-'submissionId') IS DISTINCT FROM (to_jsonb(OLD)-'submissionId')) THEN
      RAISE EXCEPTION 'immutable verification receipt' USING ERRCODE='23514'; END IF;
  SELECT * INTO attempt FROM "VerificationAttempt" WHERE id=NEW."attemptId" FOR SHARE;
  SELECT * INTO event FROM "VerificationEvent" WHERE id=NEW."eventId" FOR SHARE;
  SELECT * INTO revision FROM "VerificationIntegrationRevision" WHERE "integrationId"=attempt."integrationId" AND version=attempt."integrationVersion";
  IF attempt.status <> 'verified' OR attempt."expiresAt" <= clock_timestamp() OR
    ROW(NEW."tenantId",NEW."serviceId",NEW."formVersionId",NEW."publicationId",NEW.kind,NEW.environment,NEW."documentHash",NEW."verifiedAt")
    IS DISTINCT FROM ROW(attempt."tenantId",attempt."serviceId",attempt."formVersionId",attempt."publicationId",attempt.kind,attempt.environment,attempt."documentHash",attempt."verifiedAt")
    OR NEW.provider IS DISTINCT FROM (CASE WHEN attempt.kind='identity' THEN revision."identityProvider" ELSE revision."signatureProvider" END)
    OR NOT event."signatureValid" OR event."verificationStatus" <> 'verified' OR NEW."proofHash" IS DISTINCT FROM event."bodyHash"
    THEN RAISE EXCEPTION 'receipt evidence mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."submissionId" IS NOT NULL THEN
    SELECT * INTO submission FROM "Submission" WHERE id=NEW."submissionId" FOR SHARE;
    IF NOT FOUND OR submission."tenantId" <> NEW."tenantId" OR submission."publicationId" IS DISTINCT FROM NEW."publicationId" OR submission."formVersionId" <> NEW."formVersionId"
      THEN RAISE EXCEPTION 'receipt submission mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_receipt_guard BEFORE INSERT OR UPDATE ON "VerificationReceipt" FOR EACH ROW EXECUTE FUNCTION verification_receipt_guard();

COMMIT;
