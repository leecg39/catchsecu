-- CreateTable
CREATE TABLE "SubjectAccessRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectAccessScope" (
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "SubjectAccessScope_pkey" PRIMARY KEY ("requestId","subjectId")
);

-- CreateTable
CREATE TABLE "SubjectSession" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectWithdrawal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "submissionVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SubjectWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "reason" TEXT NOT NULL,
    "sourceSubmissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubjectAccessRequest_tokenHash_key" ON "SubjectAccessRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SubjectAccessRequest_expiresAt_idx" ON "SubjectAccessRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "SubjectAccessScope_tenantId_subjectId_idx" ON "SubjectAccessScope"("tenantId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectSession_requestId_key" ON "SubjectSession"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectSession_tokenHash_key" ON "SubjectSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SubjectSession_expiresAt_idx" ON "SubjectSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SubjectWithdrawal_sessionId_submissionId_idx" ON "SubjectWithdrawal"("sessionId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_tenantId_serviceId_emailHash_channel_key" ON "Suppression"("tenantId", "serviceId", "emailHash", "channel");

-- AddForeignKey
ALTER TABLE "SubjectAccessScope" ADD CONSTRAINT "SubjectAccessScope_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubjectAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAccessScope" ADD CONSTRAINT "SubjectAccessScope_tenantId_subjectId_fkey" FOREIGN KEY ("tenantId", "subjectId") REFERENCES "DataSubject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectSession" ADD CONSTRAINT "SubjectSession_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubjectAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectWithdrawal" ADD CONSTRAINT "SubjectWithdrawal_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectWithdrawal" ADD CONSTRAINT "SubjectWithdrawal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SubjectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_tenantId_sourceSubmissionId_fkey" FOREIGN KEY ("tenantId", "sourceSubmissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SubjectAccessRequest" ADD CONSTRAINT "subject_access_hashes" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "browserHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SubjectSession" ADD CONSTRAINT "subject_session_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SubjectWithdrawal" ADD CONSTRAINT "subject_withdrawal_state" CHECK ("submissionVersion" > 0 AND ((status='requested' AND "finishedAt" IS NULL) OR (status IN ('completed','cancelled') AND "finishedAt" IS NOT NULL)));
CREATE UNIQUE INDEX "subject_withdrawal_pending" ON "SubjectWithdrawal" ("sessionId", "submissionId") WHERE status='requested';
ALTER TABLE "Suppression" ADD CONSTRAINT "suppression_channel" CHECK (channel='email' AND "emailHash" ~ '^[a-f0-9]{64}$' AND reason IN ('subject_withdrawal','administrator_withdrawal'));
CREATE FUNCTION guard_subject_access_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'subject scope is immutable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "SubjectAccessRequest" WHERE id=NEW."requestId" AND "consumedAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subject scope is closed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subject_access_scope_guard BEFORE INSERT OR UPDATE ON "SubjectAccessScope" FOR EACH ROW EXECUTE FUNCTION guard_subject_access_scope();
CREATE FUNCTION guard_subject_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.status<>'requested' OR NEW.status NOT IN ('completed','cancelled') OR NEW.id<>OLD.id OR NEW."tenantId"<>OLD."tenantId" OR NEW."submissionId"<>OLD."submissionId" OR NEW."sessionId"<>OLD."sessionId" OR NEW."submissionVersion"<>OLD."submissionVersion") THEN
    RAISE EXCEPTION 'invalid withdrawal transition' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'requested' OR NOT EXISTS (
      SELECT 1 FROM "SubjectSession" ss JOIN "SubjectAccessScope" sc ON sc."requestId"=ss."requestId"
      JOIN "Submission" sub ON sub."subjectId"=sc."subjectId" AND sub."tenantId"=sc."tenantId"
      WHERE ss.id=NEW."sessionId" AND sub.id=NEW."submissionId" AND sub."tenantId"=NEW."tenantId" AND sub.version=NEW."submissionVersion"
    ) THEN RAISE EXCEPTION 'invalid withdrawal scope' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subject_withdrawal_guard BEFORE INSERT OR UPDATE ON "SubjectWithdrawal" FOR EACH ROW EXECUTE FUNCTION guard_subject_withdrawal();
CREATE FUNCTION guard_suppression_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'suppression is immutable' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Submission" sub JOIN "DataSubject" ds ON ds.id=sub."subjectId" AND ds."tenantId"=sub."tenantId"
    WHERE sub.id=NEW."sourceSubmissionId" AND sub."tenantId"=NEW."tenantId" AND ds."serviceId"=NEW."serviceId" AND ds."emailHash"=NEW."emailHash" AND sub.status='withdrawn') THEN
    RAISE EXCEPTION 'invalid suppression scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suppression_scope_guard BEFORE INSERT OR UPDATE ON "Suppression" FOR EACH ROW EXECUTE FUNCTION guard_suppression_scope();
