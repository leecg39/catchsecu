import { z } from "zod";
import { fileInput } from "./domains";

export const senderChannel = z.enum(["email", "sms"]);
const clean = (max: number) => z.string().trim().max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "줄바꿈과 제어 문자는 사용할 수 없습니다.");
export function normalizeSenderAddress(channel: "email" | "sms", value: string) {
  if (channel === "email") return z.email().max(254).parse(value.trim().toLowerCase());
  const digits = value.trim().replace(/[ ()-]/g, "").replace(/^\+82/, "0");
  return z.string().regex(/^\d{8,12}$/, "발신번호는 숫자 8~12자리입니다.").parse(digits);
}
export const senderCreate = z.object({ serviceId: z.uuid(), channel: senderChannel, address: clean(254).min(1), label: clean(100).min(1), description: clean(1000).default("") }).strict();
export const senderPatch = senderCreate.omit({ serviceId: true, channel: true }).extend({ version: z.number().int().positive() }).strict();
export const senderVersion = z.object({ version: z.number().int().positive() }).strict();
export const senderList = z.object({ serviceId: z.uuid(), channel: senderChannel, search: clean(254).default(""),
  status: z.enum(["all", "pending", "verified", "expired", "disabled", "deleted"]).default("all"), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "label"]).default("createdAt"), direction: z.enum(["asc", "desc"]).default("desc") }).strict();
export const senderEvidenceInput = fileInput.extend({ version: z.number().int().positive() }).strict().refine(v => ["application/pdf", "image/png", "image/jpeg"].includes(v.mime), "PDF·PNG·JPEG만 첨부할 수 있습니다.");
export const senderStatuses: Record<string, string> = { pending: "인증 대기", verified: "인증 완료", expired: "인증 만료", disabled: "사용 중지", deleted: "삭제" };
export const senderEventLabels: Record<string, string> = { created: "등록", updated: "정보 수정", address_changed: "주소 변경·인증 초기화", email_requested: "이메일 인증 요청", email_confirmed: "이메일 확인", dns_requested: "DNS 확인값 발급", dns_checked: "DNS 확인", provider_checked: "공급자 확인", default_changed: "대표 설정 변경", disabled: "사용 중지", renewed: "재인증 시작", deleted: "삭제", evidence_attached: "증빙 첨부", evidence_removed: "증빙 삭제", expired: "인증 만료" };
export type SenderRecord = { id: string; serviceId: string; channel: "email" | "sms"; address: string | null; label: string; description: string; domain: string | null;
  status: string; storedStatus: string; isDefault: boolean; version: number; generation: number; verifiedAt: string | null; expiresAt: string | null; environment: "live" | "local" | null;
  eligible: boolean; denial: string | null; creator: string; createdAt: string; updatedAt: string; cleanupPending: boolean;
  permissions: { canEdit: boolean; canVerify: boolean; canSetDefault: boolean; canDisable: boolean; canRenew: boolean; canDelete: boolean; canManageEvidence: boolean; canCleanup: boolean };
  verifications?: { id: string; method: string; status: string; attempts: number; expiresAt: string; verifiedAt: string | null; resultCode: string | null; recordName?: string; recordValue?: string }[];
  evidence?: { id: string; name: string; mime: string; size: number; status: string; scanStatus: string; version: number }[];
  events?: { version: number; kind: string; createdAt: string }[];
};
export type SenderPage = { items: SenderRecord[]; total: number; page: number; pageSize: number; permissions: { canCreate: boolean } };
