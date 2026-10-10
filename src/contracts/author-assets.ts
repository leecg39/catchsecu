import { z } from "zod";

export const bodyImagePurposes = ["FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE", "END_PAGE_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"] as const;
export const authorAssetPurposes = ["QUESTION_MATERIAL", "OPTION_IMAGE", "QUESTION_IMAGE", ...bodyImagePurposes] as const;
export type AuthorAssetPurpose = typeof authorAssetPurposes[number];
export const MAX_MATERIAL_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_OPTION_IMAGE_BYTES = 1024 * 1024;
export const MAX_QUESTION_IMAGE_BYTES = 1024 * 1024;
export const MAX_BODY_IMAGE_BYTES = 14 * 1024 * 1024;
export const MAX_AUTHOR_ASSET_NAME_LENGTH = 255;
export const MAX_OPTION_IMAGES = 20;
export const optionImageQuestionTypes: readonly string[] = ["객관식 답변", "체크박스"];
export const MATERIAL_FILE_ACCEPT = ".pdf,.docx,.ai";
export const OPTION_IMAGE_ACCEPT = "image/jpeg,image/png";
export const QUESTION_IMAGE_ACCEPT = "image/jpeg,image/png";
export const BODY_IMAGE_ACCEPT = "image/jpeg,image/png";
/** Local ownership ID, never a storage key or an externally supplied URL. */
export const authorAssetKeySchema = z.uuid();
export const authorAssetPurposeSchema = z.enum(authorAssetPurposes);
export const authorAssetMimeSchema = z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/postscript", "image/jpeg", "image/png"]);
export type AuthorAssetMime = z.infer<typeof authorAssetMimeSchema>;
export function isAuthorImagePurpose(purpose: string) {
  return purpose === "OPTION_IMAGE" || purpose === "QUESTION_IMAGE" || (bodyImagePurposes as readonly string[]).includes(purpose);
}
export const authorAssetPurposeByteLimits = {
  QUESTION_MATERIAL: MAX_MATERIAL_FILE_BYTES, OPTION_IMAGE: MAX_OPTION_IMAGE_BYTES, QUESTION_IMAGE: MAX_QUESTION_IMAGE_BYTES,
  FORM_CONTENT_IMAGE: MAX_BODY_IMAGE_BYTES, PAGE_CONTENT_IMAGE: MAX_BODY_IMAGE_BYTES,
  END_PAGE_CONTENT_IMAGE: MAX_BODY_IMAGE_BYTES, PRIVATE_PAGE_CONTENT_IMAGE: MAX_BODY_IMAGE_BYTES,
} as const satisfies Record<AuthorAssetPurpose, number>;
export function authorAssetByteLimit(purpose: AuthorAssetPurpose) {
  return authorAssetPurposeByteLimits[purpose];
}
export function authorAssetMimeForName(name: string, purpose: AuthorAssetPurpose): AuthorAssetMime | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  if (isAuthorImagePurpose(purpose)) return extension === "png" ? "image/png" : ["jpg", "jpeg"].includes(extension) ? "image/jpeg" : undefined;
  if (purpose !== "QUESTION_MATERIAL") return undefined;
  return extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : extension === "ai" ? "application/postscript" : undefined;
}
export const authorAssetNameSchema = z.string().refine(name => name.trim().length > 0 && name.length <= MAX_AUTHOR_ASSET_NAME_LENGTH
  && !/[\u0000-\u001f\u007f-\u009f/\\]/.test(name)
  && new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(name)) === name,
"파일 이름은 경로·제어문자 없이 255자 이내로 입력해주세요.")
  .meta({ "x-max-utf16-length": MAX_AUTHOR_ASSET_NAME_LENGTH, description: "Original well-formed display filename; never a storage path." });
export const authorAssetUploadInput = z.object({
  serviceId: z.uuid(), purpose: authorAssetPurposeSchema, name: authorAssetNameSchema,
  mime: authorAssetMimeSchema, size: z.number().int().positive().max(MAX_BODY_IMAGE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((input, ctx) => {
  if (input.size > authorAssetByteLimit(input.purpose)) ctx.addIssue({ code: "custom", path: ["size"], message: "자료는 5MiB, 문항·보기 이미지는 1MiB, 본문 이미지는 14MiB까지 첨부할 수 있습니다." });
  if (authorAssetMimeForName(input.name, input.purpose) !== input.mime)
    ctx.addIssue({ code: "custom", path: ["mime"], message: "파일의 용도·확장자·형식을 확인해주세요." });
});
export function optionImageError(question: { type: string; optionDefinitions?: { optionImageKey?: string | null; isCustomValue?: boolean }[] }): string | undefined {
  const images = (question.optionDefinitions ?? []).filter(option => option.optionImageKey != null);
  if (images.length && !optionImageQuestionTypes.includes(question.type)) return "답변별 이미지는 객관식·체크박스의 일반 보기에만 사용할 수 있습니다.";
  if (images.some(option => option.isCustomValue === true)) return "기타 직접입력 보기에는 이미지를 사용할 수 없습니다.";
  if (images.length > MAX_OPTION_IMAGES) return "선택지 이미지는 문항당 20개까지 첨부할 수 있습니다.";
}

export const authorAssetReadScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("form"), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("template"), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("approval"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("submission"), id: z.uuid() }).strict(),
]);
export type AuthorAssetReadScope = z.infer<typeof authorAssetReadScopeSchema>;
export type AuthorAssetInfo = {
  id: string; purpose: AuthorAssetPurpose; name: string; mime: AuthorAssetMime; size: number; sha256: string;
  status: "pending" | "uploaded" | "ready" | "rejected" | "deleting" | "deleted";
  version: number; expiresAt: string | null;
};
export type AuthorAssetUsage = { usedBytes: number; limitBytes: number };
export type AuthorAssetUploadInfo = AuthorAssetInfo & { usage: AuthorAssetUsage };
export type AuthorAssetManifest = { items: AuthorAssetInfo[] };
