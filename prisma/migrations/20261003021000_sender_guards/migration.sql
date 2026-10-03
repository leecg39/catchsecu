BEGIN;
CREATE OR REPLACE FUNCTION check_sender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sender tombstone required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW.version<>1 OR NEW.generation<>1 OR NEW."isDefault") THEN RAISE EXCEPTION 'sender starts pending' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='deleted' OR NEW.version<>OLD.version+1 OR (NEW."tenantId",NEW."serviceId",NEW.channel,NEW."creatorId",NEW."createdAt") IS DISTINCT FROM (OLD."tenantId",OLD."serviceId",OLD.channel,OLD."creatorId",OLD."createdAt") THEN RAISE EXCEPTION 'immutable sender scope or invalid version' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'deleted' AND NEW."addressHash"<>OLD."addressHash" AND EXISTS(SELECT 1 FROM "FileObject" WHERE "senderId"=NEW.id AND status<>'deleted') THEN RAISE EXCEPTION 'remove old sender evidence before changing number' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION check_sender_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'verification evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW."tenantId",NEW."senderId",NEW.generation,NEW.method,NEW.environment,NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM (OLD."tenantId",OLD."senderId",OLD.generation,OLD.method,OLD.environment,OLD."createdAt",OLD."expiresAt") OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR (OLD.status<>'pending' AND NEW.status NOT IN (OLD.status,'superseded')) OR (OLD.status='superseded' AND NEW.status<>'superseded')) THEN RAISE EXCEPTION 'invalid verification transition' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'pending' AND (NEW."verifiedAt",NEW."validUntil",NEW."providerRefHash",NEW."resultCode",NEW.attempts) IS DISTINCT FROM (OLD."verifiedAt",OLD."validUntil",OLD."providerRefHash",OLD."resultCode",OLD.attempts) THEN RAISE EXCEPTION 'immutable consumed verification' USING ERRCODE='23514'; END IF;
  IF (NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash" AND NEW."tokenHash" IS NOT NULL) OR (NEW."valueCipher" IS DISTINCT FROM OLD."valueCipher" AND NEW."valueCipher" IS NOT NULL) THEN RAISE EXCEPTION 'immutable verification secret' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status<>'superseded' AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND generation=NEW.generation AND status IN ('pending','verified','expired') AND ((channel='email' AND NEW.method IN ('email','dns')) OR (channel='sms' AND NEW.method='solapi'))) THEN RAISE EXCEPTION 'invalid sender verification binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_sender_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender job' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."senderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND (NEW.type<>'mail' OR channel='email') AND (NEW."marketingPreferenceId" IS NULL OR "serviceId"=(SELECT "serviceId" FROM "MarketingPreference" WHERE id=NEW."marketingPreferenceId")) AND status='verified' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'unverified sender job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
