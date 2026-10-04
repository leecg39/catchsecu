import { z } from "zod";

const endpoint = z.string().trim().min(8).max(500)
  .refine(value => /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(value) && !value.includes("@"),
    "HTTPS 또는 루프백 HTTP 주소만 허용됩니다.");
const pem = z.string().trim().min(60).max(8000)
  .refine(value => value.includes("-----BEGIN CERTIFICATE-----") && value.includes("-----END CERTIFICATE-----"),
    "PEM 형식의 X.509 인증서가 필요합니다.");

const base = {
  name: z.string().trim().min(1).max(60),
  issuer: z.string().trim().min(1).max(500),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().min(1).max(500).optional(),
  authorizationUrl: endpoint,
};

export const ssoProviderCreate = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("oidc").default("oidc"), ...base,
    tokenUrl: endpoint, jwksUrl: endpoint,
    scopes: z.string().trim().min(6).max(300).default("openid profile email") }).strict(),
  z.object({ protocol: z.literal("saml"), ...base, idpCert: pem }).strict(),
]);

export const ssoProviderPatch = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  scopes: z.string().trim().min(6).max(300).optional(),
  clientSecret: z.string().min(1).max(500).optional(),
  idpCert: pem.optional(),
}).strict();

export const ssoProviderRemove = z.object({ version: z.number().int().min(1) }).strict();

export type SsoProviderRecord = {
  id: string;
  name: string;
  protocol: "oidc" | "saml";
  issuer: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string | null;
  jwksUrl: string | null;
  scopes: string;
  enabled: boolean;
  hasSecret: boolean;
  hasCert: boolean;
  preflightOk: boolean;
  preflightDetail: string;
  version: number;
  createdAt: string;
};
