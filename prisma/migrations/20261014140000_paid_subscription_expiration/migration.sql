-- 유료 만료 시 해지일 보존을 검사한다. 과거 적용 SQL/체크섬은 변경하지 않는다.
BEGIN;
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
      IF (NEW.id,NEW."tenantId",NEW."planId",NEW."planVersionId",NEW."priceKrw",NEW.currency,NEW."createdAt")
        IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."planId",OLD."planVersionId",OLD."priceKrw",OLD.currency,OLD."createdAt")
        OR NEW."activationSource"<>'payment' OR NEW."cancelAt" IS NOT NULL
        OR NEW."periodStart" IS NULL OR NEW."periodEnd" IS NULL OR NEW."periodEnd"<=NEW."periodStart"
        OR NEW."periodStart" > utc_now + interval '1 hour'
        THEN RAISE EXCEPTION 'BILLING_INVALID_ACTIVATION'; END IF;
      IF NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o."subscriptionId"=NEW.id AND o."tenantId"=NEW."tenantId"
        AND o.status='paid' AND o.amount=NEW."priceKrw" AND o.currency=NEW.currency)
        THEN RAISE EXCEPTION 'BILLING_ACTIVATION_WITHOUT_PAYMENT'; END IF;
    ELSIF OLD.status='active' AND NEW.status='active' THEN
      -- 유료 해지 예약/철회: cancelAt만 변경 가능하며 예약은 미래·기간 내.
      IF (NEW.id,NEW."tenantId",NEW."planId",NEW."planVersionId",NEW."priceKrw",NEW.currency,
          NEW."periodStart",NEW."periodEnd",NEW."activationSource",NEW."createdAt") IS DISTINCT FROM
         (OLD.id,OLD."tenantId",OLD."planId",OLD."planVersionId",OLD."priceKrw",OLD.currency,
          OLD."periodStart",OLD."periodEnd",OLD."activationSource",OLD."createdAt")
        THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
      IF NEW."cancelAt" IS NOT NULL AND (NEW."cancelAt"<=utc_now OR NEW."cancelAt">OLD."periodEnd")
        THEN RAISE EXCEPTION 'BILLING_INVALID_CANCEL_SCHEDULE'; END IF;
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
        IF NEW."cancelAt" IS DISTINCT FROM OLD."cancelAt" OR LEAST(COALESCE(OLD."cancelAt", OLD."periodEnd"), OLD."periodEnd")>utc_now
          THEN RAISE EXCEPTION 'BILLING_EARLY_EXPIRATION'; END IF;
      ELSE RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX "BillingSubscription_expiry_due_idx"
ON "BillingSubscription" ((LEAST(COALESCE("cancelAt", "periodEnd"), "periodEnd")), id)
WHERE status IN ('trialing', 'active');
COMMIT;
