import { z } from "zod";

export const participationAccessPolicySchema = z.object({
  enabled: z.boolean(),
  method: z.enum(["EMAIL", "SOCIAL"]),
  targetScope: z.enum(["ALL", "WHITELIST"]),
  useOtp: z.boolean(),
  socialProvider: z.enum(["KAKAO", "NAVER"]),
  limitDuplicate: z.boolean(),
}).strict().superRefine((policy, ctx) => {
  if (!policy.enabled) {
    if (policy.method !== "EMAIL" || policy.targetScope !== "ALL" || policy.useOtp || policy.socialProvider !== "KAKAO" || policy.limitDuplicate)
      ctx.addIssue({ code: "custom", message: "참여 인증을 사용하지 않을 때는 인증 세부 설정을 초기값으로 저장해주세요." });
    return;
  }
  if (policy.method === "SOCIAL") {
    if (policy.targetScope !== "ALL") ctx.addIssue({ code: "custom", path: ["targetScope"], message: "소셜 로그인은 전체 참여자에게만 사용할 수 있습니다." });
    if (policy.useOtp) ctx.addIssue({ code: "custom", path: ["useOtp"], message: "소셜 로그인에는 이메일 인증번호를 함께 사용할 수 없습니다." });
  } else if (policy.targetScope === "ALL" && !policy.useOtp) {
    ctx.addIssue({ code: "custom", path: ["useOtp"], message: "전체 이메일 참여자는 인증번호 확인이 필요합니다." });
  }
});

export type ParticipationAccessPolicy = z.infer<typeof participationAccessPolicySchema>;

export const defaultParticipationAccessPolicy = (): ParticipationAccessPolicy => ({
  enabled: false,
  method: "EMAIL",
  targetScope: "ALL",
  useOtp: false,
  socialProvider: "KAKAO",
  limitDuplicate: false,
});

export const participationEmailSchema = z.email().trim().toLowerCase().max(254);

export const participationTargetImportSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  emails: z.array(z.string().trim().max(320)).min(1).max(10000),
}).strict();

export const participationChallengeInput = z.object({ email: participationEmailSchema }).strict();

export const participationChallengeVerifyInput = z.object({
  client: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^\d{6}$/).optional(),
}).strict();

export const participationProofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
