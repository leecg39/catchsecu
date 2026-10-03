BEGIN;
-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "senderId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "senderId" TEXT;

-- CreateTable
CREATE TABLE "Sender" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "addressCipher" TEXT,
    "domain" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "environment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tokenHash" TEXT,
    "valueCipher" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "environment" TEXT NOT NULL,
    "resultCode" TEXT,
    "providerRefHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sender_tenantId_serviceId_channel_status_createdAt_id_idx" ON "Sender"("tenantId", "serviceId", "channel", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_tenantId_id_key" ON "Sender"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_tenantId_serviceId_id_key" ON "Sender"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE INDEX "SenderVerification_senderId_generation_method_createdAt_idx" ON "SenderVerification"("senderId", "generation", "method", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SenderVerification_tenantId_id_key" ON "SenderVerification"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SenderEvent_senderId_version_key" ON "SenderEvent"("senderId", "version");

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_serviceId_senderId_fkey" FOREIGN KEY ("tenantId", "serviceId", "senderId") REFERENCES "Sender"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_tenantId_creatorId_fkey" FOREIGN KEY ("tenantId", "creatorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_tenantId_senderId_fkey" FOREIGN KEY ("tenantId", "senderId") REFERENCES "Sender"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderEvent" ADD CONSTRAINT "SenderEvent_tenantId_senderId_fkey" FOREIGN KEY ("tenantId", "senderId") REFERENCES "Sender"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_senderId_fkey" FOREIGN KEY ("tenantId", "senderId") REFERENCES "Sender"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Sender_live_address" ON "Sender"("tenantId","serviceId",channel,"addressHash") WHERE status<>'deleted';
CREATE UNIQUE INDEX "Sender_default" ON "Sender"("tenantId","serviceId",channel) WHERE "isDefault";
CREATE INDEX "Job_sender" ON "Job"("senderId",status);
CREATE INDEX "FileObject_sender" ON "FileObject"("senderId",status);
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_shape" CHECK (
 channel IN ('email','sms') AND status IN ('pending','verified','expired','disabled','deleted') AND version>0 AND generation>0 AND
 "addressHash" ~ '^[a-f0-9]{64}$' AND (environment IS NULL OR environment IN ('live','local')) AND
 ((status='deleted' AND "addressCipher" IS NULL AND label='' AND description='' AND domain IS NULL) OR (status<>'deleted' AND "addressCipher" IS NOT NULL AND length(label) BETWEEN 1 AND 100)) AND
 (NOT "isDefault" OR status='verified') AND
 ((status IN ('verified','expired') AND "verifiedAt" IS NOT NULL AND "expiresAt">"verifiedAt" AND environment IS NOT NULL) OR
  (status NOT IN ('verified','expired') AND "verifiedAt" IS NULL AND "expiresAt" IS NULL AND environment IS NULL)));
ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_shape" CHECK (
 method IN ('email','dns','solapi') AND status IN ('pending','verified','failed','superseded') AND generation>0 AND attempts BETWEEN 0 AND 5 AND environment IN ('live','local') AND
 "expiresAt">"createdAt" AND (status<>'verified' OR ("verifiedAt" IS NOT NULL AND "verifiedAt"<="expiresAt" AND "validUntil">"verifiedAt")) AND
 (status<>'pending' OR method='solapi' OR "tokenHash" IS NOT NULL));

CREATE FUNCTION check_sender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sender tombstone required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW.version<>1 OR NEW.generation<>1 OR NEW."isDefault") THEN RAISE EXCEPTION 'sender starts pending' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='deleted' OR NEW.version<>OLD.version+1 OR (NEW."tenantId",NEW."serviceId",NEW.channel,NEW."creatorId",NEW."createdAt") IS DISTINCT FROM (OLD."tenantId",OLD."serviceId",OLD.channel,OLD."creatorId",OLD."createdAt") THEN RAISE EXCEPTION 'immutable sender scope or invalid version' USING ERRCODE='23514'; END IF;
  IF NEW.generation<>OLD.generation AND (NEW.generation<>OLD.generation+1 OR NEW.status NOT IN ('pending','disabled','deleted')) THEN RAISE EXCEPTION 'invalid sender generation' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'deleted' AND (NEW."addressHash",NEW."addressCipher",NEW.domain) IS DISTINCT FROM (OLD."addressHash",OLD."addressCipher",OLD.domain) AND (NEW.generation<>OLD.generation+1 OR NEW.status<>'pending') THEN RAISE EXCEPTION 'address change needs verification' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('disabled','deleted') AND OLD.status<>NEW.status AND NEW.generation<>OLD.generation+1 THEN RAISE EXCEPTION 'disable must revoke generation' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='verified' THEN
  IF (NEW.channel='email' AND (
   NOT EXISTS (SELECT 1 FROM "SenderVerification" WHERE "senderId"=NEW.id AND generation=NEW.generation AND method='email' AND status='verified' AND environment=NEW.environment AND "validUntil">=NEW."expiresAt") OR
   NOT EXISTS (SELECT 1 FROM "SenderVerification" WHERE "senderId"=NEW.id AND generation=NEW.generation AND method='dns' AND status='verified' AND environment=NEW.environment AND "validUntil">=NEW."expiresAt"))) OR
   (NEW.channel='sms' AND NOT EXISTS (SELECT 1 FROM "SenderVerification" WHERE "senderId"=NEW.id AND generation=NEW.generation AND method='solapi' AND status='verified' AND environment='live' AND "validUntil">=NEW."expiresAt")) THEN RAISE EXCEPTION 'sender proof required' USING ERRCODE='23514'; END IF;
  IF (TG_OP='INSERT' OR OLD.status<>'verified' OR (NEW."isDefault" AND NOT OLD."isDefault")) AND NEW."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'expired sender' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='deleted' AND (EXISTS(SELECT 1 FROM "Job" WHERE "senderId"=NEW.id AND status IN ('queued','leased','retry')) OR EXISTS(SELECT 1 FROM "FileObject" WHERE "senderId"=NEW.id AND status NOT IN ('deleting','deleted'))) THEN RAISE EXCEPTION 'sender is in use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Sender_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Sender" FOR EACH ROW EXECUTE FUNCTION check_sender();

CREATE FUNCTION check_sender_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND version=NEW.version) THEN RAISE EXCEPTION 'immutable sender event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SenderEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SenderEvent" FOR EACH ROW EXECUTE FUNCTION check_sender_event();
CREATE FUNCTION require_sender_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "SenderEvent" WHERE "senderId"=NEW.id AND version=NEW.version) THEN RAISE EXCEPTION 'sender event required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Sender_event_required" AFTER INSERT OR UPDATE ON "Sender" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_sender_event();

CREATE FUNCTION check_sender_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'verification evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW."tenantId",NEW."senderId",NEW.generation,NEW.method,NEW.environment,NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM (OLD."tenantId",OLD."senderId",OLD.generation,OLD.method,OLD.environment,OLD."createdAt",OLD."expiresAt") OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR (OLD.status<>'pending' AND NEW.status NOT IN (OLD.status,'superseded')) OR (OLD.status='superseded' AND NEW.status<>'superseded')) THEN RAISE EXCEPTION 'invalid verification transition' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'superseded' AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND generation=NEW.generation AND status IN ('pending','verified','expired') AND ((channel='email' AND NEW.method IN ('email','dns')) OR (channel='sms' AND NEW.method='solapi'))) THEN RAISE EXCEPTION 'invalid sender verification binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SenderVerification_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SenderVerification" FOR EACH ROW EXECUTE FUNCTION check_sender_verification();

ALTER TABLE "FileObject" DROP CONSTRAINT "FileObject_owner_check", DROP CONSTRAINT "FileObject_attached_check";
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_owner_check" CHECK (
 ("ownerKind" IN ('member','import','sender') AND "ownerId" IS NOT NULL AND "uploadTokenHash" IS NULL) OR
 ("ownerKind"='public' AND "ownerId" IS NULL AND "publicationId" IS NOT NULL AND ((status IN ('pending','uploaded','ready','rejected') AND "uploadTokenHash" IS NOT NULL) OR (status IN ('attached','deleting','deleted') AND "uploadTokenHash" IS NULL)))),
 ADD CONSTRAINT "FileObject_attached_check" CHECK (status<>'attached' OR (("submissionId" IS NOT NULL OR "senderId" IS NOT NULL) AND "expiresAt" IS NULL AND "uploadTokenHash" IS NULL)),
 ADD CONSTRAINT "FileObject_sender_check" CHECK (("ownerKind"='sender' AND "senderId" IS NOT NULL AND "submissionId" IS NULL AND "questionId" IS NULL AND "formVersionId" IS NULL AND "publicationId" IS NULL AND mime IN ('application/pdf','image/png','image/jpeg')) OR ("ownerKind"<>'sender' AND "senderId" IS NULL));
CREATE FUNCTION check_sender_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender file' USING ERRCODE='23514'; END IF;
 IF NEW."senderId" IS NOT NULL AND NEW.status NOT IN ('deleting','deleted') AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND "serviceId"=NEW."serviceId" AND channel='sms' AND status<>'deleted') THEN RAISE EXCEPTION 'sender file unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FileObject_sender_guard" BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION check_sender_file();
CREATE FUNCTION check_sender_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender job' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."senderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND status='verified' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'unverified sender job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Job_sender_guard" BEFORE INSERT OR UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION check_sender_job();
UPDATE "ServiceGrant" g SET capabilities=(SELECT array_agg(DISTINCT x) FROM unnest(g.capabilities || ARRAY['sender.read','sender.manage']) AS x)
 FROM "Membership" m WHERE m.id=g."memberId" AND m.role IN ('owner','admin','sender') AND 'message.manage'=ANY(g.capabilities);
COMMIT;
