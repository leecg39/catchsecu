-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requestKeyHash" TEXT NOT NULL,
    "requestHash" TEXT,
    "filtersCipher" TEXT,
    "layoutCipher" TEXT,
    "readFiles" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "byteLength" INTEGER NOT NULL DEFAULT 0,
    "resultHash" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contentCipher" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,

    CONSTRAINT "ExportChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "sourceHash" TEXT,

    CONSTRAINT "ExportSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_tenantId_requesterId_formId_createdAt_id_idx" ON "ExportJob"("tenantId", "requesterId", "formId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ExportJob_status_leaseUntil_createdAt_idx" ON "ExportJob"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_expiresAt_idx" ON "ExportJob"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_tenantId_id_key" ON "ExportJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_tenantId_requesterId_requestKeyHash_key" ON "ExportJob"("tenantId", "requesterId", "requestKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExportChunk_jobId_number_key" ON "ExportChunk"("jobId", "number");

-- CreateIndex
CREATE INDEX "ExportSource_tenantId_submissionId_jobId_idx" ON "ExportSource"("tenantId", "submissionId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportSource_jobId_rowNo_key" ON "ExportSource"("jobId", "rowNo");

-- CreateIndex
CREATE UNIQUE INDEX "ExportSource_jobId_submissionId_key" ON "ExportSource"("jobId", "submissionId");

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_tenantId_serviceId_formId_fkey" FOREIGN KEY ("tenantId", "serviceId", "formId") REFERENCES "Form"("tenantId", "serviceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_tenantId_requesterId_fkey" FOREIGN KEY ("tenantId", "requesterId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportChunk" ADD CONSTRAINT "ExportChunk_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "ExportJob"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportSource" ADD CONSTRAINT "ExportSource_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "ExportJob"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportSource" ADD CONSTRAINT "ExportSource_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_state" CHECK (status IN ('queued','processing','ready','failed','cancelled','expired','invalidated','deleted'));
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_counts" CHECK (version>0 AND "totalRows">=0 AND "totalRows"<=100000 AND "processedRows">=0 AND "processedRows"<="totalRows" AND "byteLength">=0 AND "byteLength"<=20971520 AND attempts>=0);
ALTER TABLE "ExportSource" ADD CONSTRAINT "ExportSource_row" CHECK ("rowNo">=0);
ALTER TABLE "ExportChunk" ADD CONSTRAINT "ExportChunk_counts" CHECK (number>=0 AND "byteLength">=0 AND "byteLength"<=20971520);

CREATE FUNCTION erase_export_jobs(ids text[], reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_id text;
BEGIN
  FOR current_id IN SELECT id FROM "ExportJob" WHERE id=ANY(ids) AND status IN ('queued','processing','ready') ORDER BY id FOR UPDATE LOOP
    UPDATE "ExportJob" SET status='invalidated',version=version+1,"lastError"=reason,"filtersCipher"=NULL,"layoutCipher"=NULL,"requestHash"=NULL,"resultHash"=NULL,"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=current_id;
    DELETE FROM "ExportChunk" WHERE "jobId"=current_id;
    UPDATE "ExportSource" SET "sourceHash"=NULL WHERE "jobId"=current_id;
  END LOOP;
END $$;

CREATE FUNCTION invalidate_export_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; source_id text;
BEGIN
  row_data:=to_jsonb(OLD);
  source_id:=CASE WHEN TG_TABLE_NAME='Submission' THEN row_data->>'id' ELSE row_data->>'submissionId' END;
  PERFORM erase_export_jobs(ARRAY(SELECT DISTINCT "jobId" FROM "ExportSource" WHERE "tenantId"=row_data->>'tenantId' AND "submissionId"=source_id),'SOURCE_CHANGED');
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER export_submission_change BEFORE UPDATE OR DELETE ON "Submission" FOR EACH ROW EXECUTE FUNCTION invalidate_export_source();
CREATE TRIGGER export_answer_change BEFORE UPDATE OR DELETE ON "Answer" FOR EACH ROW EXECUTE FUNCTION invalidate_export_source();
CREATE TRIGGER export_file_change BEFORE UPDATE OR DELETE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION invalidate_export_source();

CREATE FUNCTION invalidate_export_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; actor_id text; tenant_id text; service_id text;
BEGIN
  IF TG_OP='INSERT' THEN row_data:=to_jsonb(NEW); ELSE row_data:=to_jsonb(OLD); END IF;
  tenant_id:=row_data->>'tenantId';
  IF TG_TABLE_NAME='User' THEN actor_id:=row_data->>'id';
  ELSIF TG_TABLE_NAME='Company' THEN tenant_id:=row_data->>'id';
  ELSIF TG_TABLE_NAME='Service' THEN service_id:=row_data->>'id';
  ELSIF TG_TABLE_NAME='Membership' THEN actor_id:=row_data->>'userId';
  ELSIF TG_TABLE_NAME='ExpertAssignment' THEN actor_id:=row_data->>'expertUserId';
  ELSIF TG_TABLE_NAME='ServiceGrant' THEN
    SELECT "userId" INTO actor_id FROM "Membership" WHERE id=row_data->>'memberId' AND "tenantId"=tenant_id;
    service_id:=row_data->>'serviceId';
  ELSIF TG_TABLE_NAME='ExpertAssignmentService' THEN
    SELECT "expertUserId" INTO actor_id FROM "ExpertAssignment" WHERE id=row_data->>'assignmentId' AND "tenantId"=tenant_id;
    service_id:=row_data->>'serviceId';
  END IF;
  PERFORM erase_export_jobs(ARRAY(SELECT id FROM "ExportJob" WHERE (tenant_id IS NULL OR "tenantId"=tenant_id) AND (actor_id IS NULL OR "requesterId"=actor_id) AND (service_id IS NULL OR "serviceId"=service_id)),'ACCESS_CHANGED');
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER export_user_access BEFORE UPDATE OF status,"emailVerified" OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_company_access BEFORE UPDATE OF status OR DELETE ON "Company" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_member_access BEFORE UPDATE OF role,status,"accessKind","expertAssignmentId" OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_service_access BEFORE UPDATE OF status OR DELETE ON "Service" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_grant_access BEFORE INSERT OR UPDATE OR DELETE ON "ServiceGrant" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_expert_access BEFORE UPDATE OF status,"expiresAt" OR DELETE ON "ExpertAssignment" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_expert_service_access BEFORE INSERT OR UPDATE OR DELETE ON "ExpertAssignmentService" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
