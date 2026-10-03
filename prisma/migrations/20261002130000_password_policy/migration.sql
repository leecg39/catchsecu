-- AlterTable
ALTER TABLE "SecurityPolicy" ADD COLUMN     "passwordDeferral" TEXT NOT NULL DEFAULT 'never',
ADD COLUMN     "passwordMonths" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "passwordReuse" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "passwordRevision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PasswordHistory" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordDeferral" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL,
    "passwordRevision" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "sessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordDeferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordHistory_userId_id_idx" ON "PasswordHistory"("userId", "id");

-- CreateIndex
CREATE INDEX "PasswordDeferral_userId_idx" ON "PasswordDeferral"("userId");

-- CreateIndex
CREATE INDEX "PasswordDeferral_expiresAt_idx" ON "PasswordDeferral"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordDeferral_tenantId_memberId_key" ON "PasswordDeferral"("tenantId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_id_userId_key" ON "Membership"("tenantId", "id", "userId");

-- AddForeignKey
ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordDeferral" ADD CONSTRAINT "PasswordDeferral_tenantId_memberId_userId_fkey" FOREIGN KEY ("tenantId", "memberId", "userId") REFERENCES "Membership"("tenantId", "id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "Account_one_credential_per_user" ON "Account" ("userId") WHERE "providerId" = 'credential';
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_password_rules"
 CHECK ("minPassword" BETWEEN 12 AND 128 AND "passwordMonths" BETWEEN 0 AND 12 AND "passwordReuse" IN (0,1,10)
   AND "passwordDeferral" IN ('never','session','period') AND "passwordRevision" > 0);
ALTER TABLE "PasswordDeferral" ADD CONSTRAINT "PasswordDeferral_mode"
 CHECK ((mode = 'session' AND "sessionId" IS NOT NULL) OR (mode = 'period' AND "sessionId" IS NULL));
ALTER TABLE "PasswordDeferral" ADD CONSTRAINT "PasswordDeferral_version"
 CHECK (version > 0 AND "passwordRevision" > 0);

UPDATE "User" u SET "passwordChangedAt" = a."updatedAt"
 FROM "Account" a WHERE a."userId" = u.id AND a."providerId" = 'credential' AND a.password IS NOT NULL;

CREATE FUNCTION record_credential_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."providerId" <> 'credential' OR NEW.password IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.password IS NOT DISTINCT FROM OLD.password THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND OLD.password IS NOT NULL THEN
   INSERT INTO "PasswordHistory" ("userId","passwordHash","changedAt") VALUES (NEW."userId",OLD.password,clock_timestamp());
   DELETE FROM "PasswordHistory" WHERE "userId" = NEW."userId" AND id NOT IN
     (SELECT id FROM "PasswordHistory" WHERE "userId" = NEW."userId" ORDER BY id DESC LIMIT 9);
 END IF;
 UPDATE "User" SET "passwordChangedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE id = NEW."userId";
 DELETE FROM "PasswordDeferral" WHERE "userId" = NEW."userId";
 DELETE FROM "Session" WHERE "userId" = NEW."userId";
 -- Reset and account-deletion proofs use the exact user ID as the value. Clear
 -- outstanding proofs on a credential change; never log their tokens or hashes.
 DELETE FROM "Verification" WHERE value = NEW."userId";
 INSERT INTO "AuditEvent" (id,"actorId",action,resource,"resourceId","requestId",detail,"createdAt")
 VALUES (gen_random_uuid()::text,NEW."userId",CASE WHEN TG_OP = 'INSERT' THEN 'password.created' ELSE 'password.changed' END,
   'user',NEW."userId",gen_random_uuid()::text,'{"changedFields":["password"]}'::jsonb,clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER "Account_password_history" AFTER INSERT OR UPDATE OF password ON "Account"
 FOR EACH ROW EXECUTE FUNCTION record_credential_change();
