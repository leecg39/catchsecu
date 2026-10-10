import { z } from "zod";

export const ssoLoginModes = ["NONE", "AZURE", "GOOGLE"] as const;
export const ssoLoginMode = z.enum(ssoLoginModes);
export type SsoLoginMode = z.infer<typeof ssoLoginMode>;
export type SsoIdentityProvider = Exclude<SsoLoginMode, "NONE"> | "OTHER";
export const ssoIdentityKind = z.enum(["GOOGLE", "AZURE", "OTHER"]);
export const ssoLoginModeLabels: Record<SsoLoginMode, string> = {
  NONE: "아이디 및 SSO 로그인 허용", AZURE: "Microsoft 로그인만 허용", GOOGLE: "Google 로그인만 허용",
};

export const ssoPolicySelection = z.object({ tenantId: z.uuid(), mode: ssoLoginMode, version: z.number().int().min(0) }).strict();
export const ssoPolicySave = ssoPolicySelection.extend({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/, "6자리 인증번호를 입력해주세요.") }).strict();
export const ssoPolicyChallengeDto = z.object({ challengeId: z.uuid(), expiresAt: z.iso.datetime(), retryAt: z.iso.datetime() }).strict();
export const ssoPolicyView = z.object({
  tenantId: z.uuid(), mode: ssoLoginMode, version: z.number().int().nonnegative(), canManage: z.boolean(),
  entitlement: z.object({ available: z.boolean(), state: z.enum(["included", "not_included", "expired", "pending", "unsubscribed"]), expiresAt: z.iso.datetime().nullable() }).strict(),
  authentication: z.object({ identityProvider: ssoIdentityKind.nullable(), freshUntil: z.iso.datetime().nullable() }).strict(),
  options: z.array(z.object({ mode: ssoLoginMode, configured: z.boolean(), linked: z.boolean(), activeMembers: z.number().int().nonnegative(),
    linkedMembers: z.number().int().nonnegative(), unlinkedMembers: z.number().int().nonnegative() }).strict()).length(3),
}).strict();
export type SsoPolicyView = z.infer<typeof ssoPolicyView>;
