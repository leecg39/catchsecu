-- Preserve every UPDATE and all sellable/referenced version history.
-- Only draft, never-subscribed versions can be removed with an unused plan.
CREATE OR REPLACE FUNCTION billing_plan_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD."orderable" AND NOT EXISTS (
      SELECT 1 FROM "BillingSubscription" WHERE "planVersionId" = OLD.id
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'BILLING_PLAN_VERSION_IMMUTABLE';
END $$;
