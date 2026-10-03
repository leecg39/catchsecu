CREATE TABLE "CreditAccount" (
  "tenantId" text NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  available bigint NOT NULL DEFAULT 0 CHECK (available >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", currency)
);

CREATE TABLE "LedgerTransaction" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId" text NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  "serviceId" text,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  kind text NOT NULL CHECK (kind IN ('funding','reserve','capture','release')),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  "sourceKind" text NOT NULL CHECK (length("sourceKind") BETWEEN 1 AND 64 AND "sourceKind" ~ '^[a-z][a-z0-9_:-]*$'),
  "sourceId" text NOT NULL CHECK (length("sourceId") BETWEEN 1 AND 128),
  "reservationId" text REFERENCES "LedgerTransaction"(id) ON DELETE RESTRICT,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId",id) ON DELETE RESTRICT,
  CONSTRAINT "LedgerTransaction_shape_check" CHECK (
    (kind = 'funding' AND "sourceKind" = 'pg_capture' AND "serviceId" IS NULL AND "reservationId" IS NULL) OR
    (kind = 'reserve' AND "serviceId" IS NOT NULL AND "reservationId" IS NULL) OR
    (kind IN ('capture','release') AND "serviceId" IS NOT NULL AND "reservationId" IS NOT NULL)
  ),
  UNIQUE ("tenantId",kind,"sourceKind","sourceId")
);
CREATE INDEX "LedgerTransaction_tenant_currency_created_idx" ON "LedgerTransaction"("tenantId",currency,"createdAt",id);
CREATE INDEX "LedgerTransaction_tenant_service_created_idx" ON "LedgerTransaction"("tenantId","serviceId","createdAt",id);
CREATE INDEX "LedgerTransaction_reservation_idx" ON "LedgerTransaction"("reservationId");

CREATE TABLE "LedgerEntry" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "transactionId" text NOT NULL REFERENCES "LedgerTransaction"(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  account text NOT NULL CHECK (account IN ('external','available','held','spent')),
  amount bigint NOT NULL CHECK (amount <> 0),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("transactionId",account)
);

CREATE FUNCTION credit_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.available <> 0 OR NEW.held <> 0 THEN RAISE EXCEPTION 'CREDIT_ACCOUNT_INITIAL_BALANCE_DENIED'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() >= 2 THEN
    IF (NEW."tenantId",NEW.currency,NEW."createdAt") IS DISTINCT FROM (OLD."tenantId",OLD.currency,OLD."createdAt")
      THEN RAISE EXCEPTION 'CREDIT_ACCOUNT_IDENTITY_IMMUTABLE'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CREDIT_ACCOUNT_DIRECT_CHANGE_DENIED';
END $$;
CREATE TRIGGER credit_account_guard BEFORE INSERT OR UPDATE OR DELETE ON "CreditAccount"
FOR EACH ROW EXECUTE FUNCTION credit_account_guard();

CREATE FUNCTION ledger_transaction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LEDGER_TRANSACTION_IMMUTABLE'; END $$;
CREATE TRIGGER ledger_transaction_immutable BEFORE UPDATE OR DELETE ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION ledger_transaction_immutable();

CREATE FUNCTION ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() >= 2 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'LEDGER_ENTRY_DIRECT_CHANGE_DENIED';
END $$;
CREATE TRIGGER ledger_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION ledger_entry_guard();

CREATE FUNCTION post_ledger_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance "CreditAccount"%ROWTYPE;
  hold "LedgerTransaction"%ROWTYPE;
  settled numeric;
  debit_account text;
  credit_account text;
BEGIN
  INSERT INTO "CreditAccount" ("tenantId",currency) VALUES (NEW."tenantId",NEW.currency)
    ON CONFLICT ("tenantId",currency) DO NOTHING;
  SELECT * INTO balance FROM "CreditAccount"
    WHERE "tenantId"=NEW."tenantId" AND currency=NEW.currency FOR UPDATE;

  IF NEW.kind = 'funding' THEN
    debit_account := 'external'; credit_account := 'available';
    UPDATE "CreditAccount" SET available=available+NEW.amount,"updatedAt"=CURRENT_TIMESTAMP
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
CREATE TRIGGER post_ledger_transaction AFTER INSERT ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION post_ledger_transaction();
