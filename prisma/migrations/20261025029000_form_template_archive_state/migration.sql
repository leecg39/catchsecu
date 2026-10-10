DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FormTemplate" WHERE status NOT IN ('active', 'archived')) THEN
    RAISE EXCEPTION 'FormTemplate contains unsupported status values';
  END IF;
END $$;

ALTER TABLE "FormTemplate"
  DROP CONSTRAINT IF EXISTS "FormTemplate_status_check";

ALTER TABLE "FormTemplate"
  ADD CONSTRAINT "FormTemplate_status_check"
  CHECK (status IN ('active', 'archived'));
