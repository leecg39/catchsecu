ALTER TABLE "FormTemplate" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_tenantId_serviceId_fkey"
  FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_scope_check"
  CHECK (("tenantId" IS NULL AND "serviceId" IS NULL) OR ("tenantId" IS NOT NULL AND "serviceId" IS NOT NULL));
CREATE UNIQUE INDEX "FormTemplate_tenantId_serviceId_title_key" ON "FormTemplate"("tenantId","serviceId",title);
