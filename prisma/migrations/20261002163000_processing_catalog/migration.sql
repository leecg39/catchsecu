BEGIN;
CREATE FUNCTION catalog_retention_valid(mode text, days integer, reason text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN mode='days' THEN days IS NOT NULL AND days BETWEEN 1 AND 36500
WHEN mode IN ('until_purpose','statutory') THEN days IS NULL AND length(btrim(reason)) BETWEEN 1 AND 2000 ELSE false END $$;
CREATE FUNCTION catalog_items_valid(items jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; names text[] := '{}'; key text;
BEGIN
  IF jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'name')<>'string' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 200
      OR coalesce(item->>'kind','') NOT IN ('general','sensitive','unique_identifier') OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    key:=lower(btrim(normalize(item->>'name', NFKC)));
    IF key=ANY(names) THEN RETURN false; END IF; names:=array_append(names,key);
  END LOOP; RETURN true;
END $$;
CREATE FUNCTION recipient_items_valid(items text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
SELECT items IS NOT NULL AND cardinality(items) BETWEEN 1 AND 100
AND NOT EXISTS(SELECT 1 FROM unnest(items) v WHERE v IS NULL OR length(btrim(v)) NOT BETWEEN 1 AND 200)
AND (SELECT count(DISTINCT lower(btrim(normalize(v,NFKC)))) FROM unnest(items) v)=cardinality(items) $$;
-- CreateTable
CREATE TABLE "ProcessingPurpose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "basisReference" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL,
    "retentionMode" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "retentionReason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "items" TEXT[],
    "retentionMode" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "retentionReason" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "transferMethod" TEXT NOT NULL DEFAULT '',
    "transferTiming" TEXT NOT NULL DEFAULT '',
    "refusalNotice" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurposeRecipient" (
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,

    CONSTRAINT "PurposeRecipient_pkey" PRIMARY KEY ("tenantId","purposeId","recipientId")
);

-- CreateTable
CREATE TABLE "PurposeRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurposeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingPurpose_tenantId_serviceId_status_createdAt_id_idx" ON "ProcessingPurpose"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingPurpose_tenantId_id_key" ON "ProcessingPurpose"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingPurpose_tenantId_serviceId_id_key" ON "ProcessingPurpose"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE INDEX "Recipient_tenantId_serviceId_status_createdAt_id_idx" ON "Recipient"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_tenantId_id_key" ON "Recipient"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_tenantId_serviceId_id_key" ON "Recipient"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE INDEX "PurposeRecipient_tenantId_recipientId_idx" ON "PurposeRecipient"("tenantId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurposeRevision_tenantId_purposeId_version_key" ON "PurposeRevision"("tenantId", "purposeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientRevision_tenantId_recipientId_version_key" ON "RecipientRevision"("tenantId", "recipientId", "version");

-- AddForeignKey
ALTER TABLE "ProcessingPurpose" ADD CONSTRAINT "ProcessingPurpose_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurposeRecipient" ADD CONSTRAINT "PurposeRecipient_tenantId_serviceId_purposeId_fkey" FOREIGN KEY ("tenantId", "serviceId", "purposeId") REFERENCES "ProcessingPurpose"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurposeRecipient" ADD CONSTRAINT "PurposeRecipient_tenantId_serviceId_recipientId_fkey" FOREIGN KEY ("tenantId", "serviceId", "recipientId") REFERENCES "Recipient"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_tenantId_purposeId_fkey" FOREIGN KEY ("tenantId", "purposeId") REFERENCES "ProcessingPurpose"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_tenantId_recipientId_fkey" FOREIGN KEY ("tenantId", "recipientId") REFERENCES "Recipient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_region_check" CHECK ("countryCode" = ANY(ARRAY['AC','AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CP','CQ','CR','CU','CV','CW','CX','CY','CZ','DE','DG','DJ','DK','DM','DO','DZ','EA','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','IC','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW']::text[]));

ALTER TABLE "ProcessingPurpose"
 ADD CONSTRAINT "ProcessingPurpose_fields_check" CHECK (length(btrim(name)) BETWEEN 1 AND 200 AND length(btrim(purpose)) BETWEEN 1 AND 3000 AND length("basisReference")<=3000),
 ADD CONSTRAINT "ProcessingPurpose_basis_check" CHECK ("lawfulBasis" IN ('consent','contract','legal_obligation','other') AND ("lawfulBasis"='consent' OR length(btrim("basisReference"))>0)),
 ADD CONSTRAINT "ProcessingPurpose_items_check" CHECK (catalog_items_valid(items)),
 ADD CONSTRAINT "ProcessingPurpose_retention_check" CHECK (catalog_retention_valid("retentionMode","retentionDays","retentionReason")),
 ADD CONSTRAINT "ProcessingPurpose_state_check" CHECK (status IN ('active','archived') AND version>0);
ALTER TABLE "Recipient"
 ADD CONSTRAINT "Recipient_fields_check" CHECK (length(btrim(name)) BETWEEN 1 AND 200 AND length(btrim(purpose)) BETWEEN 1 AND 3000 AND kind IN ('third_party','processor','source')),
 ADD CONSTRAINT "Recipient_items_check" CHECK (recipient_items_valid(items)),
 ADD CONSTRAINT "Recipient_retention_check" CHECK (catalog_retention_valid("retentionMode","retentionDays","retentionReason")),
 ADD CONSTRAINT "Recipient_overseas_check" CHECK (("countryCode"='KR' OR kind='source') OR (length(btrim(contact))>0 AND length(btrim("transferMethod"))>0 AND length(btrim("transferTiming"))>0 AND length(btrim("refusalNotice"))>0)),
 ADD CONSTRAINT "Recipient_lengths_check" CHECK (length(contact)<=1000 AND length("transferMethod")<=2000 AND length("transferTiming")<=2000 AND length("refusalNotice")<=3000),
 ADD CONSTRAINT "Recipient_state_check" CHECK (status IN ('active','archived') AND version>0);
CREATE UNIQUE INDEX "ProcessingPurpose_active_name_key" ON "ProcessingPurpose"("tenantId","serviceId","nameKey") WHERE status='active';
CREATE UNIQUE INDEX "Recipient_active_name_key" ON "Recipient"("tenantId","serviceId","kind","nameKey") WHERE status='active';
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT;
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT;
CREATE FUNCTION guard_processing_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.version<>1 OR NEW.status<>'active' THEN RAISE EXCEPTION 'invalid initial catalog state' USING ERRCODE='23514'; END IF;
 ELSE
   IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."serviceId",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN
     RAISE EXCEPTION 'immutable catalog scope or invalid revision' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='Recipient' THEN
   IF NEW.status='archived' AND EXISTS (SELECT 1 FROM "PurposeRecipient" link JOIN "ProcessingPurpose" p ON p.id=link."purposeId" WHERE link."recipientId"=NEW.id AND p.status='active') THEN
     RAISE EXCEPTION 'recipient is used by an active purpose' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW.status='active' AND EXISTS (SELECT 1 FROM "PurposeRecipient" link JOIN "Recipient" r ON r.id=link."recipientId" WHERE link."purposeId"=NEW.id AND r.status<>'active') THEN
     RAISE EXCEPTION 'purpose references archived recipient' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProcessingPurpose_guard" BEFORE INSERT OR UPDATE ON "ProcessingPurpose" FOR EACH ROW EXECUTE FUNCTION guard_processing_catalog();
CREATE TRIGGER "Recipient_guard" BEFORE INSERT OR UPDATE ON "Recipient" FOR EACH ROW EXECUTE FUNCTION guard_processing_catalog();
CREATE FUNCTION guard_purpose_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "ProcessingPurpose" WHERE id=NEW."purposeId" AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'active purpose required' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Recipient" WHERE id=NEW."recipientId" AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'active recipient required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PurposeRecipient_guard" BEFORE INSERT OR UPDATE ON "PurposeRecipient" FOR EACH ROW EXECUTE FUNCTION guard_purpose_recipient();
CREATE FUNCTION immutable_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catalog revisions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "PurposeRevision_immutable" BEFORE UPDATE OR DELETE ON "PurposeRevision" FOR EACH ROW EXECUTE FUNCTION immutable_catalog_revision();
CREATE TRIGGER "RecipientRevision_immutable" BEFORE UPDATE OR DELETE ON "RecipientRevision" FOR EACH ROW EXECUTE FUNCTION immutable_catalog_revision();
COMMIT;
