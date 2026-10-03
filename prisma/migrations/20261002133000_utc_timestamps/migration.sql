BEGIN;
SET LOCAL lock_timeout = '10s';

-- One-time repair for the local Asia/Seoul records written before the UTC
-- connection fix. Only impossible future credential timestamps are selected.
CREATE TEMP TABLE password_time_repairs ON COMMIT DROP AS
SELECT id, "actorId", "createdAt" AS old_at,
       ("createdAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC' AS corrected_at
FROM "AuditEvent"
WHERE action IN ('password.created', 'password.changed')
  AND "createdAt" > (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes';

UPDATE "PasswordDeferral" d SET
 "passwordChangedAt" = (d."passwordChangedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE EXISTS (SELECT 1 FROM password_time_repairs r WHERE r."actorId" = d."userId"
 AND abs(extract(epoch FROM d."passwordChangedAt" - r.old_at)) < 1);

UPDATE "User" u SET
 "passwordChangedAt" = (u."passwordChangedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE EXISTS (SELECT 1 FROM password_time_repairs r WHERE r."actorId" = u.id
 AND abs(extract(epoch FROM u."passwordChangedAt" - r.old_at)) < 1);

UPDATE "User" u SET "updatedAt" = (u."updatedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE EXISTS (SELECT 1 FROM password_time_repairs r WHERE r."actorId" = u.id
 AND abs(extract(epoch FROM u."updatedAt" - r.old_at)) < 1);

UPDATE "PasswordHistory" SET "changedAt" = ("changedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE "changedAt" > (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes';

-- Preserve the original recorded time in an appended repair event. Only this
-- migration may correct these timestamps; ordinary audit immutability remains.
INSERT INTO "AuditEvent" (id,action,resource,"resourceId","requestId",detail,"createdAt")
SELECT gen_random_uuid()::text, 'system.timestamp_corrected', 'auditEvent', id,
 gen_random_uuid()::text,
 jsonb_build_object('reason','legacy_password_trigger_timezone','previousRecordedAt',old_at,'correctedRecordedAt',corrected_at),
 clock_timestamp() AT TIME ZONE 'UTC'
FROM password_time_repairs;
ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_immutable;
UPDATE "AuditEvent" a SET "createdAt" = r.corrected_at FROM password_time_repairs r WHERE a.id = r.id;
ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_immutable;

-- Existing application limits and worker leases last at most 60 seconds.
UPDATE "ApiRateLimit" SET "resetAt" = ("resetAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE "resetAt" > (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes';
UPDATE "Job" SET
 "leaseUntil" = ("leaseUntil" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC',
 "updatedAt" = ("updatedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
WHERE status = 'leased' AND "leaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes';

CREATE OR REPLACE FUNCTION record_credential_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."providerId" <> 'credential' OR NEW.password IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.password IS NOT DISTINCT FROM OLD.password THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND OLD.password IS NOT NULL THEN
   INSERT INTO "PasswordHistory" ("userId","passwordHash","changedAt") VALUES (NEW."userId",OLD.password,(clock_timestamp() AT TIME ZONE 'UTC'));
   DELETE FROM "PasswordHistory" WHERE "userId" = NEW."userId" AND id NOT IN
     (SELECT id FROM "PasswordHistory" WHERE "userId" = NEW."userId" ORDER BY id DESC LIMIT 9);
 END IF;
 UPDATE "User" SET "passwordChangedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE id = NEW."userId";
 DELETE FROM "PasswordDeferral" WHERE "userId" = NEW."userId";
 DELETE FROM "Session" WHERE "userId" = NEW."userId";
 -- Reset and account-deletion proofs use the exact user ID as the value. Clear
 -- outstanding proofs on a credential change; never log their tokens or hashes.
 DELETE FROM "Verification" WHERE value = NEW."userId";
 INSERT INTO "AuditEvent" (id,"actorId",action,resource,"resourceId","requestId",detail,"createdAt")
 VALUES (gen_random_uuid()::text,NEW."userId",CASE WHEN TG_OP = 'INSERT' THEN 'password.created' ELSE 'password.changed' END,
   'user',NEW."userId",gen_random_uuid()::text,'{"changedFields":["password"]}'::jsonb,(clock_timestamp() AT TIME ZONE 'UTC'));
 RETURN NEW;
END $$;

COMMIT;
