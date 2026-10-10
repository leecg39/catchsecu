import { expect, test } from "vitest";
import { ssoIdentityProvider } from "@/server/sso-identity";

const google = { protocol: "oidc", issuer: "https://accounts.google.com",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs" };
const tenant = "01234567-89ab-cdef-0123-456789abcdef", base = `https://login.microsoftonline.com/${tenant}`;
const azure = { protocol: "oidc", issuer: base + "/v2.0", authorizationUrl: base + "/oauth2/v2.0/authorize",
  tokenUrl: base + "/oauth2/v2.0/token", jwksUrl: base + "/discovery/v2.0/keys" };

test("공식 전체 OIDC endpoint 조합만 Google/Microsoft로 분류한다", () => {
  expect(ssoIdentityProvider(google)).toBe("GOOGLE");
  expect(ssoIdentityProvider(azure)).toBe("AZURE");
});
test.each(["issuer", "authorizationUrl", "tokenUrl", "jwksUrl"] as const)("%s가 공격자 주소이면 알려진 issuer도 신뢰하지 않는다", field => {
  for (const provider of [google, azure]) {
    for (const url of ["https://attacker.test/oauth", "http://localhost:3999/oauth", provider[field] + "?redirect=https://attacker.test",
      provider[field] + "/../redirect", provider[field].replace("https://", "https://attacker.test@")]) {
      expect(ssoIdentityProvider({ ...provider, [field]: url })).toBe("OTHER");
    }
  }
});
test.each(["saml", "gpki", "saeol", "groupware"])("%s는 이름이나 issuer로 Google/Microsoft 인증이 되지 않는다", protocol => {
  expect(ssoIdentityProvider({ ...google, protocol })).toBe("OTHER");
  expect(ssoIdentityProvider({ ...azure, protocol })).toBe("OTHER");
});
test("Microsoft tenant·공급자 endpoint를 섞거나 common issuer를 사용할 수 없다", () => {
  for (const field of ["issuer", "authorizationUrl", "tokenUrl", "jwksUrl"] as const)
    expect(ssoIdentityProvider({ ...azure, [field]: azure[field].replace(tenant, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") })).toBe("OTHER");
  expect(ssoIdentityProvider({ ...azure, issuer: azure.issuer.replace(tenant, "common") })).toBe("OTHER");
  expect(ssoIdentityProvider({ ...google, tokenUrl: azure.tokenUrl })).toBe("OTHER");
});
