-- A company mutation lock serializes ownership changes, including direct SQL updates.
CREATE FUNCTION protect_last_company_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_state text;
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
    AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active' OR NEW."tenantId" <> OLD."tenantId") THEN
    SELECT status INTO company_state FROM "Company" WHERE id = OLD."tenantId" FOR UPDATE;
    IF company_state <> 'closed' AND NOT EXISTS (
      SELECT 1 FROM "Membership" WHERE "tenantId" = OLD."tenantId"
        AND role = 'owner' AND status = 'active' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'LAST_OWNER_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_last_owner_guard
BEFORE UPDATE OR DELETE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION protect_last_company_owner();
