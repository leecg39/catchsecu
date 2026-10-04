-- Preserve every existing close while protecting future updates/deletes.
CREATE UNIQUE INDEX "ComplianceClose_tenantId_id_key" ON "ComplianceClose"("tenantId","id");
CREATE FUNCTION protect_compliance_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'compliance closes are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER compliance_close_immutable BEFORE UPDATE OR DELETE ON "ComplianceClose" FOR EACH ROW EXECUTE FUNCTION protect_compliance_close();
CREATE TABLE "ComplianceExportJob" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "closeId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "requesterId" TEXT NOT NULL,
 "format" TEXT NOT NULL, "sourceHash" TEXT NOT NULL, "requestKeyHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued', "version" INTEGER NOT NULL DEFAULT 1,
 "resultCipher" TEXT, "resultHash" TEXT, "byteLength" INTEGER NOT NULL DEFAULT 0, "pageCount" INTEGER NOT NULL DEFAULT 0,
 "leaseOwner" TEXT, "leaseUntil" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ComplianceExportJob_close_fkey" FOREIGN KEY ("tenantId","closeId") REFERENCES "ComplianceClose"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceExportJob_requester_fkey" FOREIGN KEY ("tenantId","memberId","requesterId") REFERENCES "Membership"("tenantId","id","userId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ComplianceExportJob_state" CHECK ("status" IN ('queued','processing','ready','failed','cancelled','expired','deleted') AND "format" IN ('pdf','csv') AND "version">0 AND "attempts">=0 AND "byteLength" BETWEEN 0 AND 16777216 AND "pageCount" BETWEEN 0 AND 250),
 CONSTRAINT "ComplianceExportJob_content" CHECK (("status"='ready' AND "resultCipher" IS NOT NULL AND "resultHash" IS NOT NULL AND "completedAt" IS NOT NULL AND "byteLength">0) OR ("status"<>'ready' AND "resultCipher" IS NULL AND "resultHash" IS NULL)),
 CONSTRAINT "ComplianceExportJob_lease" CHECK (("status"='processing' AND "leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR ("status"<>'processing' AND "leaseOwner" IS NULL)),
 CONSTRAINT "ComplianceExportJob_expiry" CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '24 hours')
);
CREATE UNIQUE INDEX "ComplianceExportJob_tenantId_memberId_requestKeyHash_key" ON "ComplianceExportJob"("tenantId","memberId","requestKeyHash");
CREATE INDEX "ComplianceExportJob_tenantId_memberId_closeId_createdAt_id_idx" ON "ComplianceExportJob"("tenantId","memberId","closeId","createdAt","id");
CREATE INDEX "ComplianceExportJob_status_leaseUntil_createdAt_idx" ON "ComplianceExportJob"("status","leaseUntil","createdAt");
CREATE INDEX "ComplianceExportJob_expiresAt_idx" ON "ComplianceExportJob"("expiresAt");
CREATE FUNCTION protect_compliance_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."tenantId",NEW."closeId",NEW."memberId",NEW."requesterId",NEW."format",NEW."sourceHash",NEW."requestKeyHash",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM ROW(OLD."tenantId",OLD."closeId",OLD."memberId",OLD."requesterId",OLD."format",OLD."sourceHash",OLD."requestKeyHash",OLD."createdAt",OLD."expiresAt") OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'immutable export scope or invalid version' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD."status"='queued' AND NEW."status" IN ('processing','cancelled','expired','deleted')) OR (OLD."status"='processing' AND NEW."status" IN ('processing','ready','failed','cancelled','expired','deleted')) OR (OLD."status"='ready' AND NEW."status" IN ('expired','deleted')) OR (OLD."status" IN ('failed','cancelled','expired') AND NEW."status"='deleted')) THEN RAISE EXCEPTION 'invalid export transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER compliance_export_transition BEFORE UPDATE ON "ComplianceExportJob" FOR EACH ROW EXECUTE FUNCTION protect_compliance_export();
