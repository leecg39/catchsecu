-- The backfill in migration 40 compared UTC Company timestamps with a
-- session-local clock. Correct the imported trial status at the UTC boundary.
DROP TRIGGER billing_subscription_guard ON "BillingSubscription";
UPDATE "BillingSubscription"
SET status = CASE WHEN "periodEnd" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 'trialing' ELSE 'expired' END,
    "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
WHERE "planId" = 'trial' AND status IS DISTINCT FROM
    CASE WHEN "periodEnd" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 'trialing' ELSE 'expired' END;
CREATE TRIGGER billing_subscription_guard BEFORE INSERT OR UPDATE OR DELETE ON "BillingSubscription"
FOR EACH ROW EXECUTE FUNCTION billing_subscription_guard();
