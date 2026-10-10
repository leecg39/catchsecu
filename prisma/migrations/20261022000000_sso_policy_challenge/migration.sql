CREATE TABLE "SsoPolicyChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoPolicyChallenge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoPolicyChallenge_userId_sessionId_fkey" FOREIGN KEY ("userId", "sessionId") REFERENCES "Session"("userId", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SsoPolicyChallenge_mode_check" CHECK ("mode" IN ('NONE', 'AZURE', 'GOOGLE')),
  CONSTRAINT "SsoPolicyChallenge_version_check" CHECK ("policyVersion" >= 0),
  CONSTRAINT "SsoPolicyChallenge_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
  CONSTRAINT "SsoPolicyChallenge_hash_check" CHECK ("emailHash" ~ '^[a-f0-9]{64}$' AND "codeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SsoPolicyChallenge_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "SsoPolicyChallenge_tenantId_userId_createdAt_idx" ON "SsoPolicyChallenge"("tenantId", "userId", "createdAt");
