-- 유료 구독 활성화: 결제 승인(paid 주문 존재)만이 pending→active를 만든다. active→expired는 기간 경과 후만.
ALTER TABLE "BillingSubscription" DROP CONSTRAINT "BillingSubscription_check";
ALTER TABLE "BillingSubscription" DROP CONSTRAINT "BillingSubscription_status_check";
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_status_check" CHECK (status IN ('trialing','pending','active','cancelled','expired'));
ALTER TABLE "BillingSubscription" DROP CONSTRAINT "BillingSubscription_activationSource_check";
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_activationSource_check"
  CHECK ("activationSource" IS NULL OR "activationSource" IN ('trial','payment'));
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_check" CHECK (
  (status IN ('trialing','expired') AND "planId"='trial' AND "priceKrw"=0 AND "activationSource"='trial'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart"
    AND ("cancelAt" IS NULL OR ("cancelAt">"periodStart" AND "cancelAt"<="periodEnd")))
  OR (status IN ('pending','cancelled') AND "planId"<>'trial' AND "priceKrw" IS NOT NULL
    AND "activationSource" IS NULL AND "periodStart" IS NULL AND "periodEnd" IS NULL AND "cancelAt" IS NULL)
  OR (status='active' AND "planId"<>'trial' AND "priceKrw" IS NOT NULL AND "activationSource"='payment'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart" AND "cancelAt" IS NULL)
  OR (status='expired' AND "planId"<>'trial' AND "priceKrw" IS NOT NULL AND "activationSource"='payment'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart")
);
ALTER TABLE "BillingSubscriptionEvent" DROP CONSTRAINT "BillingSubscriptionEvent_kind_check";
ALTER TABLE "BillingSubscriptionEvent" ADD CONSTRAINT "BillingSubscriptionEvent_kind_check" CHECK (
  kind IN ('trial_started','trial_imported','purchase_requested','request_cancelled',
           'trial_cancel_scheduled','trial_cancel_revoked','trial_expired','activated','expired')
);
CREATE OR REPLACE FUNCTION billing_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "BillingPlanVersion";
DECLARE utc_now timestamp := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_DELETE_DENIED'; END IF;
  SELECT * INTO p FROM "BillingPlanVersion" WHERE id=NEW."planVersionId";
  IF p."planId"<>NEW."planId" OR NEW."priceKrw" IS DISTINCT FROM p."priceKrw" OR NEW.currency<>p.currency
    THEN RAISE EXCEPTION 'BILLING_PRICE_MISMATCH'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version<>1 OR (NEW.status='pending' AND (NOT p.orderable OR p.cycle='trial' OR p."effectiveFrom">utc_now
      OR (p."effectiveTo" IS NOT NULL AND p."effectiveTo"<=utc_now)))
      OR (NEW."planId"='trial' AND (p.cycle<>'trial' OR NEW."periodEnd"<>NEW."periodStart"+interval '7 days'))
      OR (NEW.status='active' AND NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o."subscriptionId"=NEW.id
        AND o."tenantId"=NEW."tenantId" AND o.status='paid' AND o.amount=NEW."priceKrw" AND o.currency=NEW.currency))
      THEN RAISE EXCEPTION 'BILLING_INVALID_SUBSCRIPTION'; END IF;
  ELSE
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
    IF OLD.status='pending' AND NEW.status='active' THEN
      -- 결제 활성화: 기간·활성화 원천만 이번 전이에서 설정된다. 나머지 식별 필드는 불변.
      IF (NEW.id,NEW."tenantId",NEW."planId",NEW."planVersionId",NEW."priceKrw",NEW.currency,NEW."createdAt")
        IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."planId",OLD."planVersionId",OLD."priceKrw",OLD.currency,OLD."createdAt")
        OR NEW."activationSource"<>'payment' OR NEW."cancelAt" IS NOT NULL
        OR NEW."periodStart" IS NULL OR NEW."periodEnd" IS NULL OR NEW."periodEnd"<=NEW."periodStart"
        OR NEW."periodStart" > utc_now + interval '1 hour'
        THEN RAISE EXCEPTION 'BILLING_INVALID_ACTIVATION'; END IF;
      IF NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o."subscriptionId"=NEW.id AND o."tenantId"=NEW."tenantId"
        AND o.status='paid' AND o.amount=NEW."priceKrw" AND o.currency=NEW.currency)
        THEN RAISE EXCEPTION 'BILLING_ACTIVATION_WITHOUT_PAYMENT'; END IF;
    ELSE
      IF (NEW.id,NEW."tenantId",NEW."planId",NEW."planVersionId",NEW."priceKrw",NEW.currency,
          NEW."periodStart",NEW."periodEnd",NEW."activationSource",NEW."createdAt") IS DISTINCT FROM
         (OLD.id,OLD."tenantId",OLD."planId",OLD."planVersionId",OLD."priceKrw",OLD.currency,
          OLD."periodStart",OLD."periodEnd",OLD."activationSource",OLD."createdAt")
        THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
      IF OLD.status='pending' AND NEW.status='cancelled' THEN
        IF NEW."cancelAt" IS DISTINCT FROM OLD."cancelAt" THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
      ELSIF OLD.status='trialing' AND NEW.status='trialing' THEN
        IF NEW."cancelAt" IS NOT DISTINCT FROM OLD."cancelAt"
          OR (NEW."cancelAt" IS NOT NULL AND (NEW."cancelAt"<=utc_now OR NEW."cancelAt">OLD."periodEnd"))
          OR LEAST(COALESCE(OLD."cancelAt", OLD."periodEnd"), OLD."periodEnd")<=utc_now
          THEN RAISE EXCEPTION 'BILLING_INVALID_CANCEL_SCHEDULE'; END IF;
      ELSIF OLD.status='trialing' AND NEW.status='expired' THEN
        IF NEW."cancelAt" IS DISTINCT FROM OLD."cancelAt" OR LEAST(COALESCE(OLD."cancelAt", OLD."periodEnd"), OLD."periodEnd")>utc_now
          THEN RAISE EXCEPTION 'BILLING_EARLY_EXPIRATION'; END IF;
      ELSIF OLD.status='active' AND NEW.status='expired' THEN
        IF NEW."cancelAt" IS DISTINCT FROM OLD."cancelAt" OR OLD."periodEnd">utc_now
          THEN RAISE EXCEPTION 'BILLING_EARLY_EXPIRATION'; END IF;
      ELSE RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
