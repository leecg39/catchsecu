import { z } from "zod";
import { authorAssetKeySchema } from "./author-assets";

export const MAX_QUESTION_MATERIALS = 3;
export const MAX_MATERIAL_LINK_URL_LENGTH = 512;
export const MAX_MATERIAL_LINK_LABEL_LENGTH = 100;

function wellFormed(value: string) {
  return !value.includes("\u0000") && new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
}
function safeLinkUrl(value: string): boolean {
  // This only parses a URL. Reference links never cause a server-side request or preview.
  // Check controls before trim: URL parsing would otherwise silently discard tabs/newlines.
  if (!wellFormed(value) || /[\u0000-\u001f\u007f-\u009f\\]/.test(value)) return false;
  const url = value.trim();
  if (!url || url.length > MAX_MATERIAL_LINK_URL_LENGTH || !/^https?:\/\//i.test(url)) return false;
  const authority = url.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}
function fallbackLabel(url: string) {
  if (url.length <= MAX_MATERIAL_LINK_LABEL_LENGTH) return url;
  let prefix = url.slice(0, MAX_MATERIAL_LINK_LABEL_LENGTH - 1);
  // The URL is well formed; only slicing can leave a high surrogate at the boundary.
  if (/[\ud800-\udbff]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + "…";
}
const linkUrlSchema = z.string()
  .refine(safeLinkUrl, "참고 링크는 사용자 정보·제어문자·역슬래시 없는 http(s):// URL을 512자 이내로 입력해주세요.")
  .trim()
  .meta({ description: "Trimmed original absolute HTTP(S) URL; no userinfo, controls or backslashes. Never fetched by the server.", "x-max-utf16-length": MAX_MATERIAL_LINK_URL_LENGTH });
const linkLabelSchema = z.string()
  .refine(wellFormed, "참고 링크 이름의 문자 인코딩을 확인해주세요.")
  .trim()
  .refine(value => value.length <= MAX_MATERIAL_LINK_LABEL_LENGTH, "참고 링크 이름은 100자 이내로 입력해주세요.")
  .meta({ description: "Optional display text after trim; an empty string uses a surrogate-safe URL fallback.", "x-max-utf16-length": MAX_MATERIAL_LINK_LABEL_LENGTH });

export const questionMaterialLinkSchema = z.object({
  materialType: z.literal("LINK"),
  orderNumber: z.number().int().min(0).max(MAX_QUESTION_MATERIALS - 1),
  fileKey: z.null(),
  linkLabel: linkLabelSchema,
  linkUrl: linkUrlSchema,
}).strict().overwrite(value => ({ ...value, linkLabel: value.linkLabel || fallbackLabel(value.linkUrl) }));
export type QuestionMaterialLink = z.infer<typeof questionMaterialLinkSchema>;
export const questionMaterialFileSchema = z.object({
  materialType: z.literal("FILE"),
  orderNumber: z.number().int().min(0).max(MAX_QUESTION_MATERIALS - 1),
  fileKey: authorAssetKeySchema,
  linkLabel: z.null(),
  linkUrl: z.null(),
}).strict();
export type QuestionMaterialFile = z.infer<typeof questionMaterialFileSchema>;
export const questionMaterialSchema = z.discriminatedUnion("materialType", [questionMaterialLinkSchema, questionMaterialFileSchema]);
export type QuestionMaterial = z.infer<typeof questionMaterialSchema>;
export const questionMaterialsSchema = z.array(questionMaterialSchema).max(MAX_QUESTION_MATERIALS)
  .refine(items => items.every((item, index) => item.orderNumber === index), "참고 자료 순서는 0부터 연속이어야 합니다.");

export function createQuestionMaterialLink(input: { linkUrl: string; linkLabel?: string }, orderNumber = 0): QuestionMaterialLink {
  return questionMaterialLinkSchema.parse({ materialType: "LINK", orderNumber, fileKey: null, linkLabel: input.linkLabel ?? "", linkUrl: input.linkUrl });
}
export function createQuestionMaterialFile(fileKey: string, orderNumber = 0): QuestionMaterialFile {
  return questionMaterialFileSchema.parse({ materialType: "FILE", orderNumber, fileKey, linkLabel: null, linkUrl: null });
}
export function reindexQuestionMaterials(items: readonly QuestionMaterial[]): QuestionMaterial[] {
  return questionMaterialsSchema.parse(items.map((item, orderNumber) => ({ ...item, orderNumber })));
}
type MaterialQuestion = { id: string; materialList?: QuestionMaterial[] };
/** Only the current logical question can supply omitted materials. Explicit [] removes them,
 * so history, a replaced question, or an old client must never resurrect deleted links. */
export function normalizeQuestionMaterials<T extends MaterialQuestion>(questions: T[], previous: MaterialQuestion[] = []): T[] {
  const existing = new Map(previous.map(question => [question.id, question.materialList]));
  return questions.map(question => {
    const list = question.materialList === undefined ? existing.get(question.id) : question.materialList;
    const materialList = list === undefined ? undefined : questionMaterialsSchema.parse(list);
    const { materialList: _materials, ...rest } = question; void _materials;
    return { ...rest, ...(materialList?.length ? { materialList } : {}) } as T;
  });
}
