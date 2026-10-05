import { z } from "zod";

const provider = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,63}$/, "공급자 식별자는 영문 소문자·숫자·밑줄·하이픈으로 입력해주세요.").nullable();
const configuration = {
  identityProvider: provider,
  signatureProvider: provider,
  environment: z.enum(["sandbox", "production"]),
  status: z.enum(["pending", "enabled", "disabled"]),
};
const hasProvider = (value: { identityProvider: string | null; signatureProvider: string | null }) => !!(value.identityProvider || value.signatureProvider);
export const verificationCreate = z.object(configuration).strict().refine(hasProvider, { message: "본인인증 또는 전자서명 공급자를 입력해주세요.", path: ["identityProvider"] });
export const verificationPatch = z.object({ ...configuration, version: z.number().int().min(1).max(2147483646) }).strict().refine(hasProvider, { message: "공급자를 입력해주세요.", path: ["identityProvider"] });
export const verificationVersion = z.object({ version: z.number().int().min(1).max(2147483646) }).strict();
export const verificationEmptyQuery = z.object({}).strict();
export type VerificationConfiguration = z.infer<typeof verificationCreate>;
export type VerificationIntegrationRecord = VerificationConfiguration & { id: string; version: number; createdAt: string; updatedAt: string };
export type VerificationStatus = "pending" | "enabled" | "disabled" | "deleted";
export type VerificationState = {
  integration: (Omit<VerificationIntegrationRecord, "status"> & { status: VerificationStatus }) | null;
  readiness: { ready: boolean; reason: "READY" | "NOT_CONFIGURED" | "DISABLED" | "PROVIDER_ADAPTER_REQUIRED"; message: string; sandboxVerified: boolean };
  permissions: { canManage: boolean };
  history: { version: number; identityProvider: string | null; signatureProvider: string | null; environment: "sandbox" | "production"; status: VerificationStatus; createdAt: string }[];
};
const storedConfiguration = { identityProvider: configuration.identityProvider, signatureProvider: configuration.signatureProvider,
  environment: configuration.environment, status: z.enum(["pending", "enabled", "disabled", "deleted"]) };
export const verificationStateSchema = z.object({
  integration: z.object({ ...storedConfiguration, id: z.uuid(), version: z.number().int().positive(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict().nullable(),
  readiness: z.object({ ready: z.boolean(), reason: z.enum(["READY", "NOT_CONFIGURED", "DISABLED", "PROVIDER_ADAPTER_REQUIRED"]), message: z.string(), sandboxVerified: z.boolean() }).strict(),
  permissions: z.object({ canManage: z.boolean() }).strict(),
  history: z.array(z.object({ ...storedConfiguration, version: z.number().int().positive(), createdAt: z.iso.datetime() }).strict()).max(20),
}).strict();

// 공개 폼 본인인증 challenge/콜백 계약
export const verificationKind = z.enum(["identity", "signature"]);
export const verificationChallengeInput = z.object({ kind: verificationKind }).strict();
export const verificationSubject = z.object({
  name: z.string().trim().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "생년월일은 YYYY-MM-DD 형식이어야 합니다.")
    .refine(value => !Number.isNaN(Date.parse(value + "T00:00:00Z")), "올바른 생년월일을 입력해주세요."),
}).strict();
export const verificationProviderInput = z.object({
  attemptId: z.uuid(),
  nonce: z.string().min(32).max(200),
  subject: verificationSubject,
}).strict();
export const verificationCallbackInput = z.object({
  attemptId: z.uuid(),
  eventId: z.uuid(),
  nonce: z.string().min(32).max(200),
  status: z.literal("verified"),
  subject: verificationSubject,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const submissionVerification = z.object({
  attemptId: z.uuid(),
  receipt: z.string().min(40).max(300),
}).strict();
export type VerificationCallbackInput = z.infer<typeof verificationCallbackInput>;

export function verificationQuery(request: Request) {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(query, key)) throw new z.ZodError([{ code: "custom", path: [key], message: "같은 조회 항목을 반복할 수 없습니다." }]);
    query[key] = value;
  }
  return verificationEmptyQuery.parse(query);
}
