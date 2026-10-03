CREATE TABLE "BillingPlan" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BillingPlanVersion" (
  "id" TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL REFERENCES "BillingPlan"("id") ON DELETE RESTRICT,
  "number" INTEGER NOT NULL CHECK ("number" > 0),
  "cycle" TEXT NOT NULL CHECK ("cycle" IN ('trial','month','year')),
  "priceKrw" INTEGER CHECK ("priceKrw" IS NULL OR "priceKrw" >= 0),
  "currency" TEXT NOT NULL DEFAULT 'KRW' CHECK ("currency" = 'KRW'),
  "serviceLimit" INTEGER CHECK ("serviceLimit" IS NULL OR "serviceLimit" >= 0),
  "memberLimit" INTEGER CHECK ("memberLimit" IS NULL OR "memberLimit" >= 0),
  "subjectLimit" INTEGER CHECK ("subjectLimit" IS NULL OR "subjectLimit" >= 0),
  "formLimit" INTEGER CHECK ("formLimit" IS NULL OR "formLimit" >= 0),
  "features" JSONB NOT NULL,
  "orderable" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("planId","number","cycle"),
  UNIQUE ("id","planId"),
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CHECK (NOT "orderable" OR ("cycle" <> 'trial' AND "priceKrw" IS NOT NULL))
);
CREATE INDEX "BillingPlanVersion_planId_cycle_orderable_idx" ON "BillingPlanVersion"("planId","cycle","orderable");
CREATE FUNCTION billing_plan_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BILLING_PLAN_VERSION_IMMUTABLE'; END $$;
CREATE TRIGGER billing_plan_version_immutable BEFORE UPDATE OR DELETE ON "BillingPlanVersion"
FOR EACH ROW EXECUTE FUNCTION billing_plan_version_immutable();

CREATE TABLE "BillingSubscription" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "planId" TEXT NOT NULL REFERENCES "BillingPlan"("id") ON DELETE RESTRICT,
  "planVersionId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('trialing','pending','cancelled','expired')),
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "cancelAt" TIMESTAMP(3),
  "priceKrw" INTEGER CHECK ("priceKrw" IS NULL OR "priceKrw" >= 0),
  "currency" TEXT NOT NULL DEFAULT 'KRW' CHECK ("currency" = 'KRW'),
  "activationSource" TEXT CHECK ("activationSource" IS NULL OR "activationSource" = 'trial'),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("tenantId","id"),
  FOREIGN KEY ("planVersionId","planId") REFERENCES "BillingPlanVersion"("id","planId") ON DELETE RESTRICT,
  CHECK (("status" = 'trialing' AND "planId" = 'trial' AND "priceKrw" = 0 AND "activationSource" = 'trial'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" > "periodStart" AND "cancelAt" IS NULL)
    OR ("status" = 'expired' AND "planId" = 'trial' AND "priceKrw" = 0 AND "activationSource" = 'trial'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" > "periodStart" AND "cancelAt" IS NULL)
    OR ("status" IN ('pending','cancelled') AND "planId" <> 'trial' AND "priceKrw" IS NOT NULL
    AND "activationSource" IS NULL AND "periodStart" IS NULL AND "periodEnd" IS NULL AND "cancelAt" IS NULL))
);
CREATE INDEX "BillingSubscription_tenantId_status_periodEnd_idx" ON "BillingSubscription"("tenantId","status","periodEnd");
CREATE UNIQUE INDEX billing_subscription_live_plan ON "BillingSubscription"("tenantId","planId")
WHERE "status" IN ('trialing','pending');
CREATE TABLE "BillingSubscriptionEvent" (
  "id" TEXT PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL REFERENCES "BillingSubscription"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('trial_started','trial_imported','purchase_requested','request_cancelled')),
  "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("subscriptionId","version")
);
CREATE FUNCTION billing_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "BillingPlanVersion";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_DELETE_DENIED'; END IF;
  SELECT * INTO p FROM "BillingPlanVersion" WHERE id = NEW."planVersionId";
  IF p."planId" <> NEW."planId" OR NEW."priceKrw" IS DISTINCT FROM p."priceKrw" OR NEW.currency <> p.currency
    THEN RAISE EXCEPTION 'BILLING_PRICE_MISMATCH'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR (NEW.status = 'pending' AND (NOT p.orderable OR p.cycle = 'trial' OR p."effectiveFrom" > CURRENT_TIMESTAMP
      OR (p."effectiveTo" IS NOT NULL AND p."effectiveTo" <= CURRENT_TIMESTAMP)))
      OR (NEW."planId" = 'trial' AND (p.cycle <> 'trial' OR NEW."periodEnd" <> NEW."periodStart" + interval '7 days'))
      THEN RAISE EXCEPTION 'BILLING_INVALID_SUBSCRIPTION'; END IF;
  ELSE
    IF (NEW.id,NEW."tenantId",NEW."planId",NEW."planVersionId",NEW."priceKrw",NEW.currency,
        NEW."periodStart",NEW."periodEnd",NEW."activationSource",NEW."createdAt") IS DISTINCT FROM
       (OLD.id,OLD."tenantId",OLD."planId",OLD."planVersionId",OLD."priceKrw",OLD.currency,
        OLD."periodStart",OLD."periodEnd",OLD."activationSource",OLD."createdAt")
       OR NEW.version <> OLD.version + 1 OR NOT (OLD.status = 'pending' AND NEW.status = 'cancelled')
       THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_subscription_guard BEFORE INSERT OR UPDATE OR DELETE ON "BillingSubscription"
FOR EACH ROW EXECUTE FUNCTION billing_subscription_guard();
CREATE FUNCTION billing_subscription_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'BILLING_EVENT_IMMUTABLE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER billing_subscription_event_guard BEFORE UPDATE OR DELETE ON "BillingSubscriptionEvent"
FOR EACH ROW EXECUTE FUNCTION billing_subscription_event_guard();

INSERT INTO "BillingPlan" (id,name,description) VALUES
('trial','무료 체험','회사 등록 후 7일 체험'),
('privacy_lifecycle','개인정보 수명 관리','원본 월 구독 상품'),
('policy_management','처리방침 관리','원본 월 구독 상품');
INSERT INTO "BillingPlanVersion" (id,"planId",number,cycle,"priceKrw","serviceLimit","memberLimit","subjectLimit","formLimit",features,orderable)
VALUES
('trial-v1','trial',1,'trial',0,10,10,1000,NULL,'{"source":"company_registration"}',false),
('privacy-lifecycle-month-v1','privacy_lifecycle',1,'month',50000,10,10,1000,NULL,'{"source":"observed_membership_page"}',true),
('privacy-lifecycle-year-v1','privacy_lifecycle',1,'year',NULL,10,10,1000,NULL,'{"priceStatus":"unverified"}',false),
('policy-management-month-v1','policy_management',1,'month',50000,5,5,1000,NULL,'{"source":"observed_membership_page"}',true),
('policy-management-year-v1','policy_management',1,'year',NULL,5,5,1000,NULL,'{"priceStatus":"unverified"}',false);
INSERT INTO "BillingSubscription" (id,"tenantId","planId","planVersionId",status,"periodStart","periodEnd","priceKrw",currency,"activationSource",version,"createdAt","updatedAt")
SELECT gen_random_uuid()::text,c.id,'trial','trial-v1',
  CASE WHEN c."createdAt" + interval '7 days' > CURRENT_TIMESTAMP THEN 'trialing' ELSE 'expired' END,
  c."createdAt",c."createdAt" + interval '7 days',0,'KRW','trial',1,c."createdAt",CURRENT_TIMESTAMP
FROM "Company" c;
INSERT INTO "BillingSubscriptionEvent" (id,"subscriptionId",version,kind,detail,"createdAt")
SELECT gen_random_uuid()::text,s.id,1,'trial_imported','{"source":"migration"}'::jsonb,CURRENT_TIMESTAMP
FROM "BillingSubscription" s;
