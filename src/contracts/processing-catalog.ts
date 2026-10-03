import { z } from "zod";
import regionCodes from "@/data/region-codes.json";

export const itemKinds = { general: "일반 개인정보", sensitive: "민감정보", unique_identifier: "고유식별정보" } as const;
export const basisLabels = { consent: "정보주체 동의", contract: "계약 이행", legal_obligation: "법령상 의무", other: "그 밖의 근거" } as const;
export const recipientKinds = { third_party: "제3자 제공", processor: "처리 위탁", source: "원자료 제공자" } as const;
export const retentionModes = { days: "일수로 지정", until_purpose: "목적 달성까지", statutory: "별도 보존 기준" } as const;
export const normalizedCatalogName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
const name = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(3000);
const retention = { retentionMode: z.enum(["days", "until_purpose", "statutory"]),
  retentionDays: z.number().int().min(1).max(36500).nullable(), retentionReason: z.string().trim().max(2000) };
function retentionErrors(value: { retentionMode: string; retentionDays: number | null; retentionReason: string }, ctx: z.RefinementCtx) {
  if (value.retentionMode === "days" ? value.retentionDays === null : value.retentionDays !== null || !value.retentionReason)
    ctx.addIssue({ code: "custom", path: ["retentionDays"], message: "일수 또는 해당 보유 기간의 종료·보존 기준을 입력해주세요." });
}
export const catalogItem = z.object({ name, kind: z.enum(["general", "sensitive", "unique_identifier"]), required: z.boolean() }).strict();
export const purposeInput = z.object({ serviceId: z.uuid(), name, purpose: text,
  lawfulBasis: z.enum(["consent", "contract", "legal_obligation", "other"]), basisReference: z.string().trim().max(3000),
  items: z.array(catalogItem).min(1).max(100), recipientIds: z.array(z.uuid()).max(100), ...retention,
}).strict().superRefine((value, ctx) => {
  retentionErrors(value, ctx);
  if (value.lawfulBasis !== "consent" && !value.basisReference) ctx.addIssue({ code: "custom", path: ["basisReference"], message: "계약·법령 등 구체적인 수집 근거를 입력해주세요." });
  if (new Set(value.items.map(item => normalizedCatalogName(item.name))).size !== value.items.length)
    ctx.addIssue({ code: "custom", path: ["items"], message: "개인정보 항목 이름이 중복되었습니다." });
  if (new Set(value.recipientIds).size !== value.recipientIds.length)
    ctx.addIssue({ code: "custom", path: ["recipientIds"], message: "제공·수탁자 연결이 중복되었습니다." });
});
export const recipientInput = z.object({ serviceId: z.uuid(), name, kind: z.enum(["third_party", "processor", "source"]),
  countryCode: z.string().refine(value => regionCodes.includes(value), "유효한 국가·지역을 선택해주세요."),
  purpose: text, items: z.array(name).min(1).max(100), ...retention,
  contact: z.string().trim().max(1000), transferMethod: z.string().trim().max(2000), transferTiming: z.string().trim().max(2000), refusalNotice: z.string().trim().max(3000),
}).strict().superRefine((value, ctx) => {
  retentionErrors(value, ctx);
  if (new Set(value.items.map(normalizedCatalogName)).size !== value.items.length)
    ctx.addIssue({ code: "custom", path: ["items"], message: "개인정보 항목 이름이 중복되었습니다." });
  if (value.countryCode !== "KR" && value.kind !== "source") for (const key of ["contact", "transferMethod", "transferTiming", "refusalNotice"] as const)
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "국외 처리의 연락처·이전 방법·시기·거부 안내를 입력해주세요." });
});
export const purposePatch = purposeInput.safeExtend({ version: z.number().int().positive() });
export const recipientPatch = recipientInput.safeExtend({ version: z.number().int().positive() });
export const catalogAction = z.object({ version: z.number().int().positive() }).strict();
export type PurposeInput = z.infer<typeof purposeInput>;
export type RecipientInput = z.infer<typeof recipientInput>;
type StoredCatalog = { id: string; status: "active" | "archived"; version: number; createdAt: string; updatedAt: string; serviceName: string };
export type PurposeRecord = PurposeInput & StoredCatalog & { recipients: RecipientRecord[] };
export type RecipientRecord = RecipientInput & StoredCatalog & { activePurposeCount: number };
export type CatalogHistory = { items: { id: string; version: number; createdAt: string; snapshot: unknown }[]; total: number; page: number; pageSize: number };
