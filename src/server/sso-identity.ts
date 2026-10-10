import type { SsoProvider } from "@/generated/prisma/client";
import type { SsoIdentityProvider } from "@/contracts/sso-login-policy";

type Endpoints = Pick<SsoProvider, "protocol" | "issuer" | "authorizationUrl" | "tokenUrl" | "jwksUrl">;

/** Classification is configuration evidence, never a substitute for ID-token verification.
 * Pin the entire official endpoint tuple: a familiar issuer with attacker-controlled
 * signing keys or token endpoint must remain an independent provider.
 */
export function ssoIdentityProvider(provider: Endpoints): SsoIdentityProvider {
  if (provider.protocol !== "oidc") return "OTHER";
  if (provider.issuer === "https://accounts.google.com"
    && provider.authorizationUrl === "https://accounts.google.com/o/oauth2/v2/auth"
    && provider.tokenUrl === "https://oauth2.googleapis.com/token"
    && provider.jwksUrl === "https://www.googleapis.com/oauth2/v3/certs") return "GOOGLE";
  const tenant = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0$/.exec(provider.issuer)?.[1];
  if (tenant) {
    const base = `https://login.microsoftonline.com/${tenant}`;
    if (provider.authorizationUrl === base + "/oauth2/v2.0/authorize"
      && provider.tokenUrl === base + "/oauth2/v2.0/token"
      && provider.jwksUrl === base + "/discovery/v2.0/keys") return "AZURE";
  }
  return "OTHER";
}
