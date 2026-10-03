CREATE TABLE "MfaException" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "reasonCipher" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("tenantId","memberId") REFERENCES "Membership"("tenantId",id) ON DELETE CASCADE,
  FOREIGN KEY ("tenantId","createdById") REFERENCES "Membership"("tenantId",id) ON DELETE RESTRICT,
  CONSTRAINT "MfaException_lifetime" CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+INTERVAL '24 hours'),
  CONSTRAINT "MfaException_reason_encrypted" CHECK ("reasonCipher" LIKE 'v1.%'),
  CONSTRAINT "MfaException_other_owner" CHECK ("memberId"<>"createdById")
);
CREATE UNIQUE INDEX "MfaException_tenantId_memberId_key" ON "MfaException"("tenantId","memberId");
CREATE INDEX "MfaException_tenantId_expiresAt_idx" ON "MfaException"("tenantId","expiresAt");
CREATE FUNCTION guard_mfa_exception() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Company" WHERE id=NEW."tenantId" FOR UPDATE;
  IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'MFA exception initial version' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."tenantId"<>OLD."tenantId" OR NEW."memberId"<>OLD."memberId" OR NEW."createdById"<>OLD."createdById" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1) THEN
    RAISE EXCEPTION 'MFA exception scope or version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MfaException_guard" BEFORE INSERT OR UPDATE ON "MfaException" FOR EACH ROW EXECUTE FUNCTION guard_mfa_exception();
CREATE FUNCTION protect_last_mfa_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role='owner' AND OLD.status='active' AND OLD."accessKind"='direct'
    AND (TG_OP='DELETE' OR NEW.role<>'owner' OR NEW.status<>'active' OR NEW."tenantId"<>OLD."tenantId" OR NEW."accessKind"<>'direct') THEN
    PERFORM id FROM "Company" WHERE id=OLD."tenantId" FOR UPDATE;
    IF EXISTS(SELECT 1 FROM "Company" c JOIN "SecurityPolicy" p ON p."tenantId"=c.id WHERE c.id=OLD."tenantId" AND c.status='active' AND p."requireMfa")
      AND EXISTS(SELECT 1 FROM "User" WHERE id=OLD."userId" AND "twoFactorEnabled" AND status='active')
      AND NOT EXISTS(SELECT 1 FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."tenantId"=OLD."tenantId" AND m.id<>OLD.id AND m.role='owner' AND m.status='active' AND m."accessKind"='direct' AND u."twoFactorEnabled" AND u.status='active' AND u."emailVerified")
    THEN RAISE EXCEPTION 'LAST_MFA_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "Membership_mfa_owner_guard" BEFORE UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION protect_last_mfa_owner();
