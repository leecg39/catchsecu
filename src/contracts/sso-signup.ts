import { z } from "zod";

// The existing local legal documents display this publication date.
export const signupLegalVersions = { terms: "2026-10-07", privacy: "2026-10-07" } as const;
export const ssoSignupAccept = z.object({
  intentId: z.uuid(),
  overFourteen: z.literal(true),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  termsVersion: z.literal(signupLegalVersions.terms),
  privacyVersion: z.literal(signupLegalVersions.privacy),
}).strict();
export const ssoSignupCancel = z.object({ intentId: z.uuid() }).strict();
export const ssoSignupView = z.object({
  id: z.uuid(), email: z.email(), name: z.string(), companyName: z.string().nullable(),
  expiresAt: z.iso.datetime(), termsVersion: z.literal(signupLegalVersions.terms), privacyVersion: z.literal(signupLegalVersions.privacy),
}).strict();
export type SsoSignupView = z.infer<typeof ssoSignupView>;
