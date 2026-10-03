import { z } from "zod";

export function sharingQuery<T>(url: URL, schema: z.ZodType<T>): T {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key)) throw new z.ZodError([{ code: "custom", path: [key], message: "같은 검색 항목을 반복할 수 없습니다." }]);
    values[key] = value;
  }
  return schema.parse(values);
}
