import { z } from "zod";

export const securityCapabilities = ["security.company_policy", "security.ip_access", "security.mfa_management", "security.sso_login_policy"] as const;
export type SecurityCapability = typeof securityCapabilities[number];
export const planCapabilities = z.array(z.enum(securityCapabilities)).max(securityCapabilities.length)
  .refine(values => new Set(values).size === values.length, "같은 기능은 한 번만 선택해주세요.").default([]);
export type FeatureAccess = { available: boolean; state: "included" | "not_included" | "expired" | "pending" | "unsubscribed"; expiresAt: string | null };
export type SecurityEntitlements = Record<SecurityCapability, FeatureAccess>;
export const securityCapabilityLabels: Record<SecurityCapability, string> = {
  "security.company_policy": "회사 보안 정책", "security.ip_access": "IP 접근 관리", "security.mfa_management": "회사 2단계 인증 관리",
  "security.sso_login_policy": "SSO 로그인 정책",
};
