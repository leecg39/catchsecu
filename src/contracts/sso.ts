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

// 가상 조직 인증 프로토콜 — 외부 GPKI·새올·그룹웨어 기관 미연동 상태에서
// VirtualOrgMember 디렉터리로 login/verified/fail/email-register 경로를 시험한다.
export const virtualOrgProtocols = ["gpki", "saeol", "groupware"] as const;
export type VirtualOrgProtocol = (typeof virtualOrgProtocols)[number];

export const ssoProviderCreate = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("oidc").default("oidc"), ...base,
    tokenUrl: endpoint, jwksUrl: endpoint,
    scopes: z.string().trim().min(6).max(300).default("openid profile email") }).strict(),
  z.object({ protocol: z.literal("saml"), ...base, idpCert: pem }).strict(),
  z.object({ protocol: z.enum(virtualOrgProtocols), name: base.name }).strict(),
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

export const ssoProviderRecord = z.object({
  id: z.uuid(), name: z.string(), protocol: z.enum(["oidc", "saml", ...virtualOrgProtocols]), issuer: z.string(), clientId: z.string(),
  authorizationUrl: z.string(), tokenUrl: z.string().nullable(), jwksUrl: z.string().nullable(), scopes: z.string(),
  enabled: z.boolean(), hasSecret: z.boolean(), hasCert: z.boolean(), preflightOk: z.boolean(), preflightDetail: z.string(),
  version: z.number().int().positive(), createdAt: z.iso.datetime(),
}).strict();
export const ssoProviderCheckedRecord = ssoProviderRecord.extend({ preflight: z.object({ ok: z.boolean(), detail: z.string() }).strict() });
export type SsoProviderRecord = z.infer<typeof ssoProviderRecord>;
export const ownSsoAccounts = z.object({
  companyName: z.string(), reauthenticate: z.boolean(),
  providers: z.array(z.object({ id: z.uuid(), name: z.string(), protocol: z.string(), available: z.boolean() }).strict()),
  items: z.array(z.object({ id: z.uuid(), providerId: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), canUnlink: z.boolean() }).strict()),
}).strict();
export type OwnSsoAccounts = z.infer<typeof ownSsoAccounts>;
export const ssoAccountUnlink = z.object({ updatedAt: z.iso.datetime(), confirm: z.literal(true) }).strict();

// ---- 가상 조직 인증 디렉터리·로그인 ----
// 조직 식별자+사번이 전역으로 유일해야 한다(어느 회사의 어느 기관인지 식별).
export const orgMemberCreate = z.object({
  orgCode: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/),
  employeeNo: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).optional(),
  pin: z.string().min(4).max(64),
}).strict();
export const orgMemberRecord = z.object({
  id: z.uuid(), orgCode: z.string(), employeeNo: z.string(), name: z.string(), email: z.string().nullable(),
  version: z.number().int().positive(), createdAt: z.iso.datetime(),
}).strict();
export const orgMemberRemove = z.object({ version: z.number().int().min(1) }).strict();

export const orgLoginBody = z.object({
  protocol: z.enum(virtualOrgProtocols),
  orgCode: orgMemberCreate.shape.orgCode,
  employeeNo: orgMemberCreate.shape.employeeNo,
  pin: z.string().min(4).max(64),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/).optional(),
}).strict();
export const orgEmailRegisterBody = z.object({
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  email: z.string().trim().email().max(320),
}).strict();
export const orgLoginResult = z.object({
  status: z.enum(["verified", "email-register"]),
  redirect: z.string().optional(), ticket: z.string().optional(),
}).strict();

export const ssoInvitationToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const ssoInvitationStart = ssoInvitationToken.extend({ providerId: z.uuid() });
export type SsoInvitationOptions = { providers: { id: string; name: string; protocol: string }[] };
