-- SAML 2.0 프로토콜 지원: protocol 구분 + IdP 서명 인증서 저장. tokenUrl/jwksUrl은 OIDC 전용으로 완화.
ALTER TABLE "SsoProvider" ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'oidc';
ALTER TABLE "SsoProvider" ADD COLUMN "idpCert" TEXT;
ALTER TABLE "SsoProvider" ALTER COLUMN "tokenUrl" DROP NOT NULL;
ALTER TABLE "SsoProvider" ALTER COLUMN "jwksUrl" DROP NOT NULL;
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_protocol_check" CHECK ("protocol" IN ('oidc','saml'));
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_saml_cert_check"
  CHECK ("protocol" <> 'saml' OR ("idpCert" IS NOT NULL AND "idpCert" LIKE '%BEGIN CERTIFICATE%'));
ALTER TABLE "SsoProvider" DROP CONSTRAINT "SsoProvider_urls_https";
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_urls_https" CHECK (
  ("authorizationUrl" LIKE 'https://%' OR "authorizationUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
  AND position('@' in "authorizationUrl") = 0
  AND ("protocol" = 'saml' OR (
    "tokenUrl" IS NOT NULL AND ("tokenUrl" LIKE 'https://%' OR "tokenUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
      AND position('@' in "tokenUrl") = 0
    AND "jwksUrl" IS NOT NULL AND ("jwksUrl" LIKE 'https://%' OR "jwksUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
      AND position('@' in "jwksUrl") = 0)));
