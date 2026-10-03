CREATE FUNCTION protect_last_mfa_owner_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_id TEXT;
BEGIN
  IF OLD."twoFactorEnabled" AND OLD.status='active' AND (NOT NEW."twoFactorEnabled" OR NEW.status<>'active') THEN
    FOR company_id IN SELECT m."tenantId" FROM "Membership" m JOIN "Company" c ON c.id=m."tenantId" JOIN "SecurityPolicy" p ON p."tenantId"=c.id
      WHERE m."userId"=OLD.id AND m.role='owner' AND m.status='active' AND m."accessKind"='direct' AND c.status='active' AND p."requireMfa" ORDER BY m."tenantId"
    LOOP
      PERFORM id FROM "Company" WHERE id=company_id FOR UPDATE;
      IF NOT EXISTS(SELECT 1 FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."tenantId"=company_id AND m."userId"<>OLD.id AND m.role='owner' AND m.status='active' AND m."accessKind"='direct' AND u.status='active' AND u."emailVerified" AND u."twoFactorEnabled")
      THEN RAISE EXCEPTION 'LAST_MFA_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_mfa_owner_guard" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_last_mfa_owner_account();
