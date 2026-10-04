-- PG 토큰 결제수단. 토큰은 해시+암호문으로만 저장하고 카드 원문(13~19자리 연속 숫자)은 어떤 필드에도 저장하지 않는다.
CREATE TABLE "PaymentMethod" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenCipher" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PaymentOrder" ADD COLUMN "methodId" TEXT;
CREATE UNIQUE INDEX "PaymentMethod_tenantId_id_key" ON "PaymentMethod"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentMethod_tokenHash_key" ON "PaymentMethod"("tokenHash");
CREATE INDEX "PaymentMethod_tenantId_status_idx" ON "PaymentMethod"("tenantId", "status");
CREATE UNIQUE INDEX "PaymentMethod_single_default" ON "PaymentMethod"("tenantId") WHERE "isDefault" AND "status" = 'active';
CREATE INDEX "PaymentOrder_tenantId_methodId_idx" ON "PaymentOrder"("tenantId", "methodId");
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_method_fkey" FOREIGN KEY ("tenantId", "methodId") REFERENCES "PaymentMethod"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_shape" CHECK (
  "kind" IN ('card', 'transfer') AND "status" IN ('active', 'revoked')
  AND "provider" ~ '^[a-z][a-z0-9-]{0,31}$' AND "tokenHash" ~ '^[0-9a-f]{64}$' AND "tokenCipher" LIKE 'v1.%'
  AND length(regexp_replace("label", '[^0-9]', '', 'g')) < 13 AND char_length("label") BETWEEN 1 AND 40
);
CREATE OR REPLACE FUNCTION check_payment_method() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash" OR NEW."tokenCipher" IS DISTINCT FROM OLD."tokenCipher" OR NEW."provider" IS DISTINCT FROM OLD."provider")
 THEN RAISE EXCEPTION 'immutable payment method token' USING ERRCODE='23514'; END IF;
 IF NEW."isDefault" AND NEW."status"<>'active' THEN RAISE EXCEPTION 'default must be active' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PaymentMethod_guard" BEFORE INSERT OR UPDATE ON "PaymentMethod" FOR EACH ROW EXECUTE FUNCTION check_payment_method();
