DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentOrder" AS payment_order
    JOIN "BillingSubscription" AS subscription
      ON subscription."id" = payment_order."subscriptionId"
    WHERE payment_order."tenantId" <> subscription."tenantId"
  ) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_SUBSCRIPTION_TENANT_MISMATCH';
  END IF;
END
$$;

ALTER TABLE "PaymentOrder"
  DROP CONSTRAINT "PaymentOrder_subscription_fkey";

ALTER TABLE "PaymentOrder"
  ADD CONSTRAINT "PaymentOrder_subscription_fkey"
  FOREIGN KEY ("tenantId", "subscriptionId")
  REFERENCES "BillingSubscription"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
