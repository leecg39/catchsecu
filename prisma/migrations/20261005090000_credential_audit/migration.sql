BEGIN;
SET LOCAL lock_timeout = '10s';

-- No historical rows are rewritten. An application request stamps a local
-- transaction setting; direct credential writes use one safe fallback UUID.
CREATE OR REPLACE FUNCTION record_credential_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 audit_request_id text;
BEGIN
 IF NEW."providerId" <> 'credential' OR NEW.password IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.password IS NOT DISTINCT FROM OLD.password THEN RETURN NEW; END IF;
 audit_request_id := current_setting('app.auth_request_id', true);
 IF audit_request_id IS NULL OR audit_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   audit_request_id := gen_random_uuid()::text;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.password IS NOT NULL THEN
   INSERT INTO "PasswordHistory" ("userId","passwordHash","changedAt") VALUES (NEW."userId",OLD.password,(clock_timestamp() AT TIME ZONE 'UTC'));
   DELETE FROM "PasswordHistory" WHERE "userId" = NEW."userId" AND id NOT IN
     (SELECT id FROM "PasswordHistory" WHERE "userId" = NEW."userId" ORDER BY id DESC LIMIT 9);
 END IF;
 UPDATE "User" SET "passwordChangedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE id = NEW."userId";
 DELETE FROM "PasswordDeferral" WHERE "userId" = NEW."userId";
 -- Audit the exact rows removed by this trigger, including sessions that the
 -- library's later adapter deletion can no longer see. Any insert failure
 -- aborts the credential update, proofs and every session removal together.
 WITH ended AS (
   DELETE FROM "Session" WHERE "userId" = NEW."userId" RETURNING id,"userId","activeCompanyId"
 )
 INSERT INTO "AuditEvent" (id,"actorId","tenantId",action,resource,"resourceId","requestId",detail,"createdAt")
 SELECT gen_random_uuid()::text,"userId","activeCompanyId",'session.ended','session',id,audit_request_id,
   '{"changedFields":[]}'::jsonb,(clock_timestamp() AT TIME ZONE 'UTC') FROM ended;
 DELETE FROM "Verification" WHERE value = NEW."userId";
 INSERT INTO "AuditEvent" (id,"actorId",action,resource,"resourceId","requestId",detail,"createdAt")
 VALUES (gen_random_uuid()::text,NEW."userId",CASE WHEN TG_OP = 'INSERT' THEN 'password.created' ELSE 'password.changed' END,
   'user',NEW."userId",audit_request_id,'{"changedFields":["password"]}'::jsonb,(clock_timestamp() AT TIME ZONE 'UTC'));
 RETURN NEW;
END $$;

COMMIT;
