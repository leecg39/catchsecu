-- 가상 조직 인증 프로토콜(gpki·saeol·groupware) 허용. 이 프로토콜은 외부 URL이 없으므로
-- HTTPS 엔드포인트 검사를 면제하고, 대신 디렉터리 자격만으로 인증한다.
ALTER TABLE "SsoProvider" DROP CONSTRAINT "SsoProvider_protocol_check";
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_protocol_check"
  CHECK ("protocol" IN ('oidc','saml','gpki','saeol','groupware'));
ALTER TABLE "SsoProvider" DROP CONSTRAINT "SsoProvider_urls_https";
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_urls_https" CHECK (
  "protocol" IN ('gpki','saeol','groupware')
  OR (
    ("authorizationUrl" ~~ 'https://%' OR "authorizationUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')
    AND position('@' in "authorizationUrl") = 0
    AND (
      "protocol" = 'saml'
      OR (
        "tokenUrl" IS NOT NULL AND ("tokenUrl" ~~ 'https://%' OR "tokenUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]') AND position('@' in "tokenUrl") = 0
        AND "jwksUrl" IS NOT NULL AND ("jwksUrl" ~~ 'https://%' OR "jwksUrl" ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]') AND position('@' in "jwksUrl") = 0
      )
    )
  )
);
