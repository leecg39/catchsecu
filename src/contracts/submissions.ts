import { z } from "zod";

export const submissionStatuses = ["submitted", "corrected", "withdrawn", "pendingDestruction", "destroying", "destroyed"] as const;
export const submissionStatusLabels: Record<string, string> = { submitted: "제출 완료", corrected: "정정", withdrawn: "철회", pendingDestruction: "파기 요청", destroying: "파기 처리 중", destroyed: "파기" };
const filterFields = { status: z.enum(["all", ...submissionStatuses]).default("all"), search: z.string().trim().max(100).default(""),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() };
const validRange = (value: { from?: string; to?: string }) => !value.from || !value.to || new Date(value.from) <= new Date(value.to);
export const submissionFilters = z.object(filterFields).strict().refine(validRange, { path: ["to"], message: "종료일시는 시작일시 이후여야 합니다." });
export const submissionListQuery = z.object({ ...filterFields, page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict().refine(validRange, { path: ["to"], message: "종료일시는 시작일시 이후여야 합니다." });
export type SubmissionFilters = z.infer<typeof submissionFilters>;
