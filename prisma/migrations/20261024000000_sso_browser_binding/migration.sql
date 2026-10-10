-- Legacy rows remain intact, but all client-presented states require a binding in application code.
-- NULL is reserved for a direct, same-origin PIN login state created and consumed inside the server.
ALTER TABLE "SsoState" ADD COLUMN "browserHash" TEXT;
ALTER TABLE "SsoState" ADD CONSTRAINT "SsoState_browserHash_check"
  CHECK ("browserHash" IS NULL OR "browserHash" ~ '^[a-f0-9]{64}$');
