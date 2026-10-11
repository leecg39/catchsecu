CREATE TABLE "SsoSignupIntent" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "providerVersion" INTEGER NOT NULL,
  "stateId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "browserHash" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "payloadCipher" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoSignupIntent_tenantId_providerId_fkey" FOREIGN KEY ("tenantId", "providerId") REFERENCES "SsoProvider"("tenantId", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoSignupIntent_version_check" CHECK ("providerVersion" > 0),
  CONSTRAINT "SsoSignupIntent_mode_check" CHECK ("mode" IN ('login', 'invite')),
  CONSTRAINT "SsoSignupIntent_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "browserHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SsoSignupIntent_payload_check" CHECK ("payloadCipher" LIKE 'v1.%'),
  CONSTRAINT "SsoSignupIntent_expiry_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '5 minutes')
);
CREATE UNIQUE INDEX "SsoSignupIntent_stateId_key" ON "SsoSignupIntent"("stateId");
CREATE UNIQUE INDEX "SsoSignupIntent_tokenHash_key" ON "SsoSignupIntent"("tokenHash");
CREATE INDEX "SsoSignupIntent_expiresAt_idx" ON "SsoSignupIntent"("expiresAt");

CREATE TABLE "SsoSignupAcceptance" (
  "userId" TEXT PRIMARY KEY,
  "overFourteen" BOOLEAN NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "privacyVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoSignupAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoSignupAcceptance_consent_check" CHECK ("overFourteen" AND length("termsVersion") BETWEEN 1 AND 100 AND length("privacyVersion") BETWEEN 1 AND 100)
);
