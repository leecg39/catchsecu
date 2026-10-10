BEGIN;
CREATE TABLE "SsoLoginPolicy" (
  "tenantId" TEXT NOT NULL PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'NONE',
  version INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoLoginPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SsoLoginPolicy_mode_check" CHECK (mode IN ('NONE', 'AZURE', 'GOOGLE')),
  CONSTRAINT "SsoLoginPolicy_version_check" CHECK (version > 0)
);
CREATE UNIQUE INDEX "Account_ssoProviderId_id_userId_key" ON "Account"("ssoProviderId", id, "userId");
CREATE TABLE "SsoSessionProof" (
  "sessionId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "identityProvider" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoSessionProof_userId_sessionId_fkey" FOREIGN KEY ("userId", "sessionId") REFERENCES "Session"("userId", id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoSessionProof_tenantId_providerId_fkey" FOREIGN KEY ("tenantId", "providerId") REFERENCES "SsoProvider"("tenantId", id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoSessionProof_providerId_accountId_userId_fkey" FOREIGN KEY ("providerId", "accountId", "userId") REFERENCES "Account"("ssoProviderId", id, "userId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoSessionProof_identityProvider_check" CHECK ("identityProvider" IN ('OTHER', 'GOOGLE', 'AZURE'))
);
CREATE UNIQUE INDEX "SsoSessionProof_userId_sessionId_key" ON "SsoSessionProof"("userId", "sessionId");
CREATE INDEX "SsoSessionProof_tenantId_userId_idx" ON "SsoSessionProof"("tenantId", "userId");
CREATE FUNCTION sso_session_proof_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SSO session authentication evidence cannot be rewritten' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER sso_session_proof_immutable BEFORE UPDATE ON "SsoSessionProof"
  FOR EACH ROW EXECUTE FUNCTION sso_session_proof_immutable();

ALTER TABLE "BillingPlanVersion" DROP CONSTRAINT "BillingPlanVersion_capabilities_check";
ALTER TABLE "BillingPlanVersion" ADD CONSTRAINT "BillingPlanVersion_capabilities_check" CHECK (
  capabilities <@ ARRAY['security.company_policy','security.ip_access','security.mfa_management','security.sso_login_policy']::text[]
  AND array_position(capabilities, NULL) IS NULL
  AND cardinality(capabilities) =
    (CASE WHEN 'security.company_policy'=ANY(capabilities) THEN 1 ELSE 0 END
     + CASE WHEN 'security.ip_access'=ANY(capabilities) THEN 1 ELSE 0 END
     + CASE WHEN 'security.mfa_management'=ANY(capabilities) THEN 1 ELSE 0 END
     + CASE WHEN 'security.sso_login_policy'=ANY(capabilities) THEN 1 ELSE 0 END)
);
-- No existing immutable product version or session is backfilled with new authority.
COMMIT;
