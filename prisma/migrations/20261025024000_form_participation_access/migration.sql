ALTER TABLE "FormVersion"
  ADD COLUMN "participationAccessSchemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "useParticipationAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "participationAccessMethod" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "participationTargetScope" TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN "participationUseOtp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "participationSocialProvider" TEXT NOT NULL DEFAULT 'KAKAO',
  ADD COLUMN "restrictDuplicateReplies" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_participation_access_check" CHECK (
  ("participationAccessSchemaVersion" = 0
    AND "useParticipationAccess" = false
    AND "participationAccessMethod" = 'EMAIL'
    AND "participationTargetScope" = 'ALL'
    AND "participationUseOtp" = false
    AND "participationSocialProvider" = 'KAKAO'
    AND "restrictDuplicateReplies" = false)
  OR
  ("participationAccessSchemaVersion" = 1 AND (
    ("useParticipationAccess" = false
      AND "participationAccessMethod" = 'EMAIL'
      AND "participationTargetScope" = 'ALL'
      AND "participationUseOtp" = false
      AND "participationSocialProvider" = 'KAKAO'
      AND "restrictDuplicateReplies" = false)
    OR
    ("useParticipationAccess" = true AND (
      ("participationAccessMethod" = 'EMAIL'
        AND "participationTargetScope" IN ('ALL', 'WHITELIST')
        AND ("participationTargetScope" = 'WHITELIST' OR "participationUseOtp" = true)
        AND "participationSocialProvider" = 'KAKAO')
      OR
      ("participationAccessMethod" = 'SOCIAL'
        AND "participationTargetScope" = 'ALL'
        AND "participationUseOtp" = false
        AND "participationSocialProvider" IN ('KAKAO', 'NAVER'))
    ))
  ))
);

CREATE TABLE "FormAccessTargetBatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "nameCipher" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "rejectedCount" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormAccessTargetBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FormAccessTargetBatch_counts_check" CHECK ("acceptedCount" >= 0 AND "rejectedCount" >= 0),
  CONSTRAINT "FormAccessTargetBatch_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "FormAccessTargetBatch_tenantId_formId_id_key" ON "FormAccessTargetBatch"("tenantId", "formId", "id");
CREATE INDEX "FormAccessTargetBatch_tenantId_formId_createdAt_id_idx" ON "FormAccessTargetBatch"("tenantId", "formId", "createdAt", "id");
ALTER TABLE "FormAccessTargetBatch" ADD CONSTRAINT "FormAccessTargetBatch_form_fkey"
  FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "FormAccessTarget" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "emailCipher" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormAccessTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormAccessTarget_tenantId_formId_emailHash_key" ON "FormAccessTarget"("tenantId", "formId", "emailHash");
CREATE INDEX "FormAccessTarget_batchId_idx" ON "FormAccessTarget"("batchId");
ALTER TABLE "FormAccessTarget" ADD CONSTRAINT "FormAccessTarget_form_fkey"
  FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "FormAccessTarget" ADD CONSTRAINT "FormAccessTarget_batch_fkey"
  FOREIGN KEY ("tenantId", "formId", "batchId") REFERENCES "FormAccessTargetBatch"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ParticipationChallenge" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "emailCipher" TEXT NOT NULL,
  "clientHash" TEXT NOT NULL,
  "codeHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParticipationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParticipationChallenge_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "ParticipationChallenge_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "ParticipationChallenge_tenantId_publicationId_id_key" ON "ParticipationChallenge"("tenantId", "publicationId", "id");
CREATE INDEX "ParticipationChallenge_publicationId_emailHash_createdAt_idx" ON "ParticipationChallenge"("publicationId", "emailHash", "createdAt");
ALTER TABLE "ParticipationChallenge" ADD CONSTRAINT "ParticipationChallenge_publication_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "Publication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "PublicationParticipant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "identityHash" TEXT NOT NULL,
  "identityCipher" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "provider" TEXT,
  "submissionCount" INTEGER NOT NULL DEFAULT 0,
  "lastSubmittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationParticipant_method_check" CHECK (("method" = 'EMAIL' AND "provider" IS NULL) OR ("method" = 'SOCIAL' AND "provider" IN ('KAKAO', 'NAVER'))),
  CONSTRAINT "PublicationParticipant_submission_count_check" CHECK ("submissionCount" >= 0)
);

CREATE UNIQUE INDEX "PublicationParticipant_tenantId_publicationId_id_key" ON "PublicationParticipant"("tenantId", "publicationId", "id");
CREATE UNIQUE INDEX "PublicationParticipant_tenantId_publicationId_identityHash_key" ON "PublicationParticipant"("tenantId", "publicationId", "identityHash");
CREATE INDEX "PublicationParticipant_publicationId_lastSubmittedAt_idx" ON "PublicationParticipant"("publicationId", "lastSubmittedAt");
ALTER TABLE "PublicationParticipant" ADD CONSTRAINT "PublicationParticipant_publication_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "Publication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ParticipationSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParticipationSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParticipationSession_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "ParticipationSession_challengeId_key" ON "ParticipationSession"("challengeId");
CREATE UNIQUE INDEX "ParticipationSession_tokenHash_key" ON "ParticipationSession"("tokenHash");
CREATE UNIQUE INDEX "ParticipationSession_tenantId_publicationId_challengeId_key" ON "ParticipationSession"("tenantId", "publicationId", "challengeId");
CREATE INDEX "ParticipationSession_participantId_expiresAt_idx" ON "ParticipationSession"("participantId", "expiresAt");
ALTER TABLE "ParticipationSession" ADD CONSTRAINT "ParticipationSession_publication_fkey"
  FOREIGN KEY ("tenantId", "publicationId") REFERENCES "Publication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ParticipationSession" ADD CONSTRAINT "ParticipationSession_participant_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "participantId") REFERENCES "PublicationParticipant"("tenantId", "publicationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ParticipationSession" ADD CONSTRAINT "ParticipationSession_challenge_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "challengeId") REFERENCES "ParticipationChallenge"("tenantId", "publicationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Submission" ADD COLUMN "participantId" TEXT;
CREATE INDEX "Submission_participantId_idx" ON "Submission"("participantId");
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_participant_fkey"
  FOREIGN KEY ("tenantId", "publicationId", "participantId") REFERENCES "PublicationParticipant"("tenantId", "publicationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
