-- P10-T04: 환불 누계·환불 원장 종류·유료 해지 예약·월마감 스냅샷.
-- 환불 승인(refunded)은 서명된 공급자 이벤트(providerRef)가 있어야 한다. 누계는 결제액을 넘을 수 없다.

ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_outcome";
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_outcome" CHECK ("outcome" IN ('paid','failed','refunded','refund_rejected'));

CREATE TABLE "PaymentRefund" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KRW',
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "providerRef" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRefund_order_fkey" FOREIGN KEY ("tenantId","orderId") REFERENCES "PaymentOrder"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentRefund_tenant_id" ON "PaymentRefund"("tenantId","id");
CREATE INDEX "PaymentRefund_order" ON "PaymentRefund"("tenantId","orderId",status);
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shape" CHECK (
  status IN ('requested','refunded','rejected') AND amount>0 AND amount<=1000000000000 AND currency ~ '^[A-Z]{3}$'
  AND length(reason) BETWEEN 1 AND 500 AND version>0 AND (status<>'refunded' OR "providerRef" IS NOT NULL)
);

CREATE FUNCTION check_payment_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "PaymentOrder"; refunded_total bigint;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAYMENT_REFUND_DELETE_DENIED' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM "PaymentOrder" WHERE id=NEW."orderId" AND "tenantId"=NEW."tenantId" FOR SHARE;
  IF NOT FOUND OR o.status<>'paid' OR o.currency<>NEW.currency THEN RAISE EXCEPTION 'PAYMENT_REFUND_ORDER_INVALID' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'requested' OR NEW.version<>1 OR NEW."providerRef" IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_REFUND_STARTS_REQUESTED' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(SUM(amount),0) INTO refunded_total FROM "PaymentRefund"
      WHERE "orderId"=NEW."orderId" AND "tenantId"=NEW."tenantId" AND status IN ('requested','refunded');
    IF refunded_total + NEW.amount > o.amount THEN RAISE EXCEPTION 'REFUND_EXCEEDS_PAID' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.version<>OLD.version+1 OR
      (NEW.id,NEW."tenantId",NEW."orderId",NEW.amount,NEW.currency,NEW."createdAt") IS DISTINCT FROM
      (OLD.id,OLD."tenantId",OLD."orderId",OLD.amount,OLD.currency,OLD."createdAt")
      THEN RAISE EXCEPTION 'PAYMENT_REFUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
    IF NOT (OLD.status='requested' AND NEW.status IN ('refunded','rejected'))
      THEN RAISE EXCEPTION 'PAYMENT_REFUND_TERMINAL' USING ERRCODE='23514'; END IF;
    IF NEW.reason IS DISTINCT FROM OLD.reason THEN RAISE EXCEPTION 'PAYMENT_REFUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
    IF OLD.status='requested' AND NEW.status='refunded' THEN
      IF NEW."providerRef" IS NULL THEN RAISE EXCEPTION 'PAYMENT_REFUND_NEEDS_PROVIDER' USING ERRCODE='23514'; END IF;
      SELECT COALESCE(SUM(amount),0) INTO refunded_total FROM "PaymentRefund"
        WHERE "orderId"=NEW."orderId" AND "tenantId"=NEW."tenantId" AND status='refunded' AND id<>NEW.id;
      IF refunded_total + NEW.amount > o.amount THEN RAISE EXCEPTION 'REFUND_EXCEEDS_PAID' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.status='rejected' AND NEW."providerRef" IS NULL THEN RAISE EXCEPTION 'PAYMENT_REFUND_NEEDS_PROVIDER' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PaymentRefund_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PaymentRefund" FOR EACH ROW EXECUTE FUNCTION check_payment_refund();

-- 환불 원장 종류: 가용 잔액에서 외부 계정으로 되돌린다. 잔액 부족 환불은 거부.
ALTER TABLE "LedgerTransaction" DROP CONSTRAINT "LedgerTransaction_kind_check";
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_kind_check" CHECK (kind IN ('funding','reserve','capture','release','refund'));
ALTER TABLE "LedgerTransaction" DROP CONSTRAINT "LedgerTransaction_shape_check";
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_shape_check" CHECK (
  (kind = 'funding' AND "sourceKind" = 'pg_capture' AND "serviceId" IS NULL AND "reservationId" IS NULL) OR
  (kind = 'refund' AND "sourceKind" = 'payment_refund' AND "serviceId" IS NULL AND "reservationId" IS NULL) OR
  (kind = 'reserve' AND "serviceId" IS NOT NULL AND "reservationId" IS NULL) OR
  (kind IN ('capture','release') AND "serviceId" IS NOT NULL AND "reservationId" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION post_ledger_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance "CreditAccount"; hold "LedgerTransaction"; settled bigint; debit_account text; credit_account text;
BEGIN
  INSERT INTO "CreditAccount" ("tenantId",currency) VALUES (NEW."tenantId",NEW.currency)
    ON CONFLICT ("tenantId",currency) DO NOTHING;
  SELECT * INTO balance FROM "CreditAccount"
    WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency FOR UPDATE;

  IF NEW.kind = 'funding' THEN
    debit_account := 'external'; credit_account := 'available';
    UPDATE "CreditAccount" SET available=available+NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency;
  ELSIF NEW.kind = 'refund' THEN
    IF balance.available < NEW.amount THEN RAISE EXCEPTION 'REFUND_EXCEEDS_BALANCE' USING ERRCODE='23514'; END IF;
    debit_account := 'available'; credit_account := 'external';
    UPDATE "CreditAccount" SET available=available-NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency;
  ELSIF NEW.kind = 'reserve' THEN
    IF balance.available < NEW.amount THEN RAISE EXCEPTION 'CREDIT_INSUFFICIENT'; END IF;
    debit_account := 'available'; credit_account := 'held';
    UPDATE "CreditAccount" SET available=available-NEW.amount,held=held+NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency;
  ELSE
    SELECT * INTO hold FROM "LedgerTransaction" WHERE id=NEW."reservationId" FOR SHARE;
    IF NOT FOUND OR hold.kind <> 'reserve' OR hold."tenantId" <> NEW."tenantId" OR hold.currency <> NEW.currency
      OR hold."serviceId" <> NEW."serviceId" THEN RAISE EXCEPTION 'CREDIT_RESERVATION_MISMATCH'; END IF;
    SELECT COALESCE(SUM(amount),0) INTO settled FROM "LedgerTransaction"
      WHERE "reservationId"=NEW."reservationId" AND kind IN ('capture','release');
    IF settled > hold.amount OR balance.held < NEW.amount THEN RAISE EXCEPTION 'CREDIT_RESERVATION_EXCEEDED'; END IF;
    debit_account := 'held';
    IF NEW.kind = 'capture' THEN
      credit_account := 'spent';
      UPDATE "CreditAccount" SET held=held-NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency;
    ELSE
      credit_account := 'available';
      UPDATE "CreditAccount" SET held=held-NEW.amount,available=available+NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency;
    END IF;
  END IF;

  INSERT INTO "LedgerEntry" ("transactionId",currency,account,amount) VALUES
    (NEW.id,NEW.currency,debit_account,-NEW.amount),
    (NEW.id,NEW.currency,credit_account,NEW.amount);
  RETURN NEW;
END $$;

-- 유료(active) 구독의 해지 예약: cancelAt은 기간 안 미래 시각, 도래 시 expired.
ALTER TABLE "BillingSubscription" DROP CONSTRAINT "BillingSubscription_check";
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_check" CHECK (
  (status IN ('trialing','expired') AND "planId"='trial' AND "priceKrw"=0 AND "activationSource"='trial'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart"
    AND ("cancelAt" IS NULL OR ("cancelAt">"periodStart" AND "cancelAt"<="periodEnd")))
  OR (status IN ('pending','cancelled') AND "planId"<>'trial' AND "priceKrw" IS NOT NULL
    AND "activationSource" IS NULL AND "periodStart" IS NULL AND "periodEnd" IS NULL AND "cancelAt" IS NULL)
  OR (status='active' AND "planId"<>'trial' AND "priceKrw" IS NOT NULL AND "activationSource"='payment'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart"
    AND ("cancelAt" IS NULL OR ("cancelAt">"periodStart" AND "cancelAt"<="periodEnd")))
  OR (status='expired' AND "planId"<>'trial' AND "priceKrw" IS NOT NULL AND "activationSource"='payment'
    AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd">"periodStart"
    AND ("cancelAt" IS NULL OR ("cancelAt">"periodStart" AND "cancelAt"<="periodEnd")))
);
ALTER TABLE "BillingSubscriptionEvent" DROP CONSTRAINT "BillingSubscriptionEvent_kind_check";
ALTER TABLE "BillingSubscriptionEvent" ADD CONSTRAINT "BillingSubscriptionEvent_kind_check" CHECK (
  kind IN ('trial_started','trial_imported','purchase_requested','request_cancelled',
           'trial_cancel_scheduled','trial_cancel_revoked','trial_expired','activated','expired',
           'cancel_scheduled','cancel_revoked')
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
        IF NEW."cancelAt" IS NOT DISTINCT FROM OLD."cancelAt" OR LEAST(COALESCE(OLD."cancelAt", OLD."periodEnd"), OLD."periodEnd")>utc_now
          THEN RAISE EXCEPTION 'BILLING_EARLY_EXPIRATION'; END IF;
      ELSE RAISE EXCEPTION 'BILLING_SUBSCRIPTION_IMMUTABLE'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 월마감 스냅샷: 닫힌 월의 합계를 고정하고 이후 거래는 사후 정정으로 식별한다.
CREATE TABLE "BillingMonthClose" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  "month" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "totals" JSONB NOT NULL,
  "closedBy" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingMonthClose_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingMonthClose_shape" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND currency ~ '^[A-Z]{3}$' AND length("closedBy") BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX "BillingMonthClose_key" ON "BillingMonthClose"("tenantId","month",currency);
CREATE FUNCTION check_month_close() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MONTH_CLOSE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW."month" >= to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM')
    THEN RAISE EXCEPTION 'MONTH_CLOSE_NOT_PAST' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BillingMonthClose_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BillingMonthClose" FOR EACH ROW EXECUTE FUNCTION check_month_close();
