BEGIN;
ALTER TABLE "ImportJob" ADD COLUMN "leaseGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_generation_check" CHECK ("leaseGeneration">=0);

CREATE FUNCTION guard_import_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."leaseGeneration"<>0 THEN RAISE EXCEPTION 'invalid initial import generation' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."leaseGeneration"<>OLD."leaseGeneration" THEN
   IF NEW."leaseGeneration"<>OLD."leaseGeneration"+1 OR NEW.status<>'committing' OR NEW."leaseOwner" IS NULL
     OR NEW."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')
     OR (OLD."leaseUntil" IS NOT NULL AND OLD."leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC'))
   THEN RAISE EXCEPTION 'invalid import generation claim' USING ERRCODE='23514'; END IF;
  ELSIF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner" IS DISTINCT FROM OLD."leaseOwner" OR OLD."leaseUntil" IS NULL OR NEW."leaseUntil">OLD."leaseUntil") THEN
   RAISE EXCEPTION 'import lease requires new generation' USING ERRCODE='23514';
  END IF;
  IF NEW."importedRows">OLD."importedRows" OR NEW.status IN ('completed','partialFailed') AND NEW.status<>OLD.status THEN
   IF OLD.status<>'committing' OR OLD."leaseOwner" IS NULL OR OLD."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')
   THEN RAISE EXCEPTION 'import completion requires live lease' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_generation_guard BEFORE INSERT OR UPDATE ON "ImportJob" FOR EACH ROW EXECUTE FUNCTION guard_import_generation();

CREATE FUNCTION require_import_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job "ImportJob";
BEGIN
 IF TG_TABLE_NAME='Submission' THEN
  IF NEW."importJobId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO job FROM "ImportJob" WHERE id=NEW."importJobId" AND "tenantId"=NEW."tenantId" FOR SHARE;
 ELSE
  IF (NEW.status,NEW."submissionId") IS NOT DISTINCT FROM (OLD.status,OLD."submissionId") THEN RETURN NEW; END IF;
  SELECT * INTO job FROM "ImportJob" WHERE id=NEW."jobId" AND "tenantId"=NEW."tenantId" FOR SHARE;
 END IF;
 IF job.id IS NULL OR job.status<>'committing' OR job."leaseOwner" IS NULL OR job."leaseGeneration"<1
   OR job."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC') OR job."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
 THEN RAISE EXCEPTION 'import write requires live execution' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_submission_execution BEFORE INSERT ON "Submission" FOR EACH ROW EXECUTE FUNCTION require_import_execution();
CREATE TRIGGER import_row_execution BEFORE UPDATE ON "ImportRow" FOR EACH ROW EXECUTE FUNCTION require_import_execution();
COMMIT;
