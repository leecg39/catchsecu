-- Initial catalog rows were inserted using the database session's local timestamp.
-- Set their publication date explicitly; subsequent versions use UTC application timestamps.
DROP TRIGGER billing_plan_version_immutable ON "BillingPlanVersion";
UPDATE "BillingPlanVersion" SET "effectiveFrom" = TIMESTAMP '2026-01-01 00:00:00'
WHERE id IN ('trial-v1','privacy-lifecycle-month-v1','privacy-lifecycle-year-v1',
             'policy-management-month-v1','policy-management-year-v1');
CREATE TRIGGER billing_plan_version_immutable BEFORE UPDATE OR DELETE ON "BillingPlanVersion"
FOR EACH ROW EXECUTE FUNCTION billing_plan_version_immutable();
