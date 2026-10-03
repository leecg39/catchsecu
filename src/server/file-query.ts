import { z } from "zod";

const binding = z.object({ submissionId: z.uuid().optional(), questionId: z.uuid().optional() }).strict();
const sharedBinding = binding.required();
const listing = z.object({ submissionId: z.uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
function uniqueParams(url: URL) {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(params, key)) throw new z.ZodError([{ code: "custom", path: [key], message: "같은 검색 항목을 반복할 수 없습니다." }]);
    params[key] = value;
  }
  return params;
}
export function fileBindingQuery(url: URL, shared = false) { return (shared ? sharedBinding : binding).parse(uniqueParams(url)); }
export function fileListQuery(url: URL) { return listing.parse(uniqueParams(url)); }
