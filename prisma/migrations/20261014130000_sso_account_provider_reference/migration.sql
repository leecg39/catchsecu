BEGIN;
-- 기존 고아 연결은 임의 삭제하지 않는다. 발견 시 전체 변경을 롤백하고 운영자가 조사한다.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Account" a LEFT JOIN "SsoProvider" p ON p.id=substring(a."providerId" from 5)
             WHERE left(a."providerId",4)='sso:' AND p.id IS NULL) THEN
    RAISE EXCEPTION 'Orphan SSO accounts require review before installing provider reference';
  END IF;
END $$;
ALTER TABLE "Account" ADD COLUMN "ssoProviderId" TEXT;
UPDATE "Account" SET "ssoProviderId"=substring("providerId" from 5) WHERE left("providerId",4)='sso:';
CREATE INDEX "Account_ssoProviderId_idx" ON "Account"("ssoProviderId");
ALTER TABLE "Account" ADD CONSTRAINT "Account_ssoProviderId_fkey"
  FOREIGN KEY ("ssoProviderId") REFERENCES "SsoProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- 인증 라이브러리·이전 앱 버전·직접 SQL 모두 동일한 providerId에서 참조를 도출한다.
CREATE FUNCTION derive_account_sso_provider() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."ssoProviderId" := CASE WHEN left(NEW."providerId",4)='sso:' THEN substring(NEW."providerId" from 5) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "Account_derive_sso_provider" BEFORE INSERT OR UPDATE OF "providerId", "ssoProviderId" ON "Account"
  FOR EACH ROW EXECUTE FUNCTION derive_account_sso_provider();
ALTER TABLE "Account" ADD CONSTRAINT "Account_sso_provider_match" CHECK (
  (left("providerId",4)='sso:' AND "ssoProviderId" IS NOT NULL AND "providerId"='sso:' || "ssoProviderId") OR
  (left("providerId",4)<>'sso:' AND "ssoProviderId" IS NULL)
);
COMMIT;
