import { z } from "zod";

const endpoint = z.string().trim().min(8).max(500)
  .refine(value => /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(value) && !value.includes("@"),
    "HTTPS 또는 루프백 HTTP 주소만 허용됩니다.");

export const ssoProviderCreate = z.object({
  name: z.string().trim().min(1).max(60),
  issuer: z.string().trim().min(1).max(500),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().min(1).max(500).optional(),
  authorizationUrl: endpoint,
  tokenUrl: endpoint,
  jwksUrl: endpoint,
  scopes: z.string().trim().min(6).max(300).default("openid profile email"),
}).strict();

export const ssoProviderPatch = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  scopes: z.string().trim().min(6).max(300).optional(),
  clientSecret: z.string().min(1).max(500).optional(),
}).strict();

export const ssoProviderRemove = z.object({ version: z.number().int().min(1) }).strict();

export type SsoProviderRecord = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  scopes: string;
  enabled: boolean;
  hasSecret: boolean;
  preflightOk: boolean;
  preflightDetail: string;
  version: number;
  createdAt: string;
};
