CREATE TABLE "AccountClosure" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE RESTRICT,
  "requestedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reasonCipher" text,
  CONSTRAINT "AccountClosure_time_check" CHECK ("completedAt" >= "requestedAt")
);

CREATE FUNCTION guard_closed_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'CLOSED_ACCOUNT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    IF EXISTS (SELECT 1 FROM "Membership" m JOIN "Company" c ON c.id = m."tenantId"
      WHERE m."userId" = OLD.id AND m.role = 'owner' AND m.status = 'active' AND c.status <> 'closed') THEN
      RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF OLD."platformAdmin" THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('platform-admin-closure', 0));
      IF NOT EXISTS (SELECT 1 FROM "User" WHERE id <> OLD.id AND status = 'active' AND "platformAdmin") THEN
        RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_closed_account_guard BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION guard_closed_account();

CREATE FUNCTION guard_active_account_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_status text;
BEGIN
  IF TG_TABLE_NAME = 'Membership' THEN
    IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  END IF;
  SELECT status INTO account_status FROM "User" WHERE id = NEW."userId" FOR SHARE;
  IF account_status <> 'active' THEN
    RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_active_account_guard BEFORE INSERT OR UPDATE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION guard_active_account_reference();
CREATE TRIGGER session_active_account_guard BEFORE INSERT OR UPDATE ON "Session"
FOR EACH ROW EXECUTE FUNCTION guard_active_account_reference();

CREATE FUNCTION preserve_account_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ACCOUNT_CLOSURE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER account_closure_immutable BEFORE UPDATE OR DELETE ON "AccountClosure"
FOR EACH ROW EXECUTE FUNCTION preserve_account_closure();
