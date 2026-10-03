import { z } from "zod";

const provider = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,63}$/, "공급자 식별자는 영문 소문자·숫자·밑줄·하이픈으로 입력해주세요.").nullable();
const configuration = {
  identityProvider: provider,
  signatureProvider: provider,
  environment: z.enum(["sandbox", "production"]),
  status: z.enum(["pending", "disabled"]),
};
const hasProvider = (value: { identityProvider: string | null; signatureProvider: string | null }) => !!(value.identityProvider || value.signatureProvider);
export const verificationCreate = z.object(configuration).strict().refine(hasProvider, { message: "본인인증 또는 전자서명 공급자를 입력해주세요.", path: ["identityProvider"] });
export const verificationPatch = z.object({ ...configuration, version: z.number().int().min(1).max(2147483646) }).strict().refine(hasProvider, { message: "공급자를 입력해주세요.", path: ["identityProvider"] });
export const verificationVersion = z.object({ version: z.number().int().min(1).max(2147483646) }).strict();
export const verificationEmptyQuery = z.object({}).strict();
export type VerificationConfiguration = z.infer<typeof verificationCreate>;
export type VerificationIntegrationRecord = VerificationConfiguration & { id: string; version: number; createdAt: string; updatedAt: string };
export type VerificationState = {
  integration: (Omit<VerificationIntegrationRecord, "status"> & { status: "pending" | "disabled" | "deleted" }) | null;
  readiness: { ready: false; reason: "NOT_CONFIGURED" | "DISABLED" | "PROVIDER_ADAPTER_REQUIRED"; message: string; sandboxVerified: false };
  permissions: { canManage: boolean };
  history: { version: number; identityProvider: string | null; signatureProvider: string | null; environment: "sandbox" | "production"; status: "pending" | "disabled" | "deleted"; createdAt: string }[];
};
const storedConfiguration = { ...configuration, status: z.enum(["pending", "disabled", "deleted"]) };
export const verificationStateSchema = z.object({
  integration: z.object({ ...storedConfiguration, id: z.uuid(), version: z.number().int().positive(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict().nullable(),
  readiness: z.object({ ready: z.literal(false), reason: z.enum(["NOT_CONFIGURED", "DISABLED", "PROVIDER_ADAPTER_REQUIRED"]), message: z.string(), sandboxVerified: z.literal(false) }).strict(),
  permissions: z.object({ canManage: z.boolean() }).strict(),
  history: z.array(z.object({ ...storedConfiguration, version: z.number().int().positive(), createdAt: z.iso.datetime() }).strict()).max(20),
}).strict();

export function verificationQuery(request: Request) {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(query, key)) throw new z.ZodError([{ code: "custom", path: [key], message: "같은 조회 항목을 반복할 수 없습니다." }]);
    query[key] = value;
  }
  return verificationEmptyQuery.parse(query);
}
