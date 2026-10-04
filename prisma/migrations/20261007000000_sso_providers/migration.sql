CREATE TABLE "SsoProvider" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientSecretCipher" TEXT,
  "authorizationUrl" TEXT NOT NULL,
  "tokenUrl" TEXT NOT NULL,
  "jwksUrl" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT 'openid profile email',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "preflightOk" BOOLEAN NOT NULL DEFAULT false,
  "preflightDetail" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SsoProvider_tenantId_enabled_idx" ON "SsoProvider"("tenantId", "enabled");
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_urls_https" CHECK (
  (("authorizationUrl" LIKE 'https://%' OR "authorizationUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
    AND ("tokenUrl" LIKE 'https://%' OR "tokenUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
    AND ("jwksUrl" LIKE 'https://%' OR "jwksUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]'))
  AND position('@' in "authorizationUrl") = 0 AND position('@' in "tokenUrl") = 0 AND position('@' in "jwksUrl") = 0);
CREATE TABLE "SsoState" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "verifierCipher" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "userId" TEXT,
  "invitationId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SsoState_stateHash_key" UNIQUE ("stateHash"),
  CONSTRAINT "SsoState_mode_check" CHECK ("mode" IN ('login','link','invite'))
);
CREATE INDEX "SsoState_expiresAt_idx" ON "SsoState"("expiresAt");
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "SsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
