BEGIN;
ALTER TABLE "BillingPlanVersion" ADD COLUMN capabilities TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "BillingPlanVersion" ADD CONSTRAINT "BillingPlanVersion_capabilities_check" CHECK (
  capabilities <@ ARRAY['security.company_policy','security.ip_access','security.mfa_management']::text[]
  AND array_position(capabilities, NULL) IS NULL
  AND cardinality(capabilities) =
    (CASE WHEN 'security.company_policy'=ANY(capabilities) THEN 1 ELSE 0 END
     + CASE WHEN 'security.ip_access'=ANY(capabilities) THEN 1 ELSE 0 END
     + CASE WHEN 'security.mfa_management'=ANY(capabilities) THEN 1 ELSE 0 END)
);
-- One-time explicit product contract, not an inferred mapping from product names.
DROP TRIGGER billing_plan_version_immutable ON "BillingPlanVersion";
UPDATE "BillingPlanVersion" SET capabilities=ARRAY['security.company_policy','security.ip_access','security.mfa_management']
  WHERE id='trial-v1' AND "planId"='trial';
UPDATE "BillingPlanVersion" SET capabilities=ARRAY['security.mfa_management']
  WHERE id IN ('privacy-lifecycle-month-v1','privacy-lifecycle-year-v1','policy-management-month-v1','policy-management-year-v1');
CREATE TRIGGER billing_plan_version_immutable BEFORE UPDATE OR DELETE ON "BillingPlanVersion"
  FOR EACH ROW EXECUTE FUNCTION billing_plan_version_immutable();
COMMIT;
