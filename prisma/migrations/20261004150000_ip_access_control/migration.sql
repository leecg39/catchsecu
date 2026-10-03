CREATE TABLE "IpAccessPolicy" (
  "tenantId" TEXT PRIMARY KEY REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "IpRule" ADD CONSTRAINT "IpRule_cidr_canonical" CHECK (cidr = (cidr::cidr)::text);
ALTER TABLE "IpRule" ADD CONSTRAINT "IpRule_version_positive" CHECK (version > 0);
CREATE FUNCTION guard_ip_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_id TEXT; remaining INTEGER;
BEGIN
  company_id := CASE WHEN TG_OP='DELETE' THEN OLD."tenantId" ELSE NEW."tenantId" END;
  PERFORM id FROM "Company" WHERE id=company_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 THEN RAISE EXCEPTION 'IP rule initial version' USING ERRCODE='23514'; END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW."tenantId"<>OLD."tenantId" OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'IP rule version or scope' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM "IpAccessPolicy" WHERE "tenantId"=company_id AND enabled) THEN
    SELECT count(*) INTO remaining FROM "IpRule" WHERE "tenantId"=company_id AND enabled AND id<>OLD.id;
    IF remaining=0 AND (TG_OP='DELETE' OR NOT NEW.enabled) THEN
      RAISE EXCEPTION 'Enabled IP restriction needs an enabled rule' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "IpRule_guard" BEFORE INSERT OR UPDATE OR DELETE ON "IpRule" FOR EACH ROW EXECUTE FUNCTION guard_ip_rule();
CREATE FUNCTION guard_ip_access_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Company" WHERE id=NEW."tenantId" FOR UPDATE;
  IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'IP policy initial version' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW."tenantId"<>OLD."tenantId" OR NEW.version<>OLD.version+1) THEN
    RAISE EXCEPTION 'IP policy version or scope' USING ERRCODE='23514';
  END IF;
  IF NEW.enabled AND NOT EXISTS(SELECT 1 FROM "IpRule" WHERE "tenantId"=NEW."tenantId" AND enabled) THEN
    RAISE EXCEPTION 'Enabled IP restriction needs an enabled rule' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "IpAccessPolicy_guard" BEFORE INSERT OR UPDATE ON "IpAccessPolicy" FOR EACH ROW EXECUTE FUNCTION guard_ip_access_policy();
