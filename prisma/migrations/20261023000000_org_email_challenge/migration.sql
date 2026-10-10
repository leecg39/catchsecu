CREATE UNIQUE INDEX "SsoState_tenantId_id_key" ON "SsoState"("tenantId", "id");
CREATE TABLE "OrgEmailChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "stateId" TEXT NOT NULL,
  "emailCipher" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgEmailChallenge_tenantId_stateId_fkey" FOREIGN KEY ("tenantId", "stateId") REFERENCES "SsoState"("tenantId", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "OrgEmailChallenge_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
  CONSTRAINT "OrgEmailChallenge_hash_check" CHECK ("emailHash" ~ '^[a-f0-9]{64}$' AND "codeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "OrgEmailChallenge_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "OrgEmailChallenge_tenantId_stateId_createdAt_idx" ON "OrgEmailChallenge"("tenantId", "stateId", "createdAt");
