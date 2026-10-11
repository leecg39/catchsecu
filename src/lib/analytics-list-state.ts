import { z } from "zod";
import { pageSize, positivePage } from "./list-url-state";

type Query = Pick<URLSearchParams, "get">;
const date = z.iso.date();
const month = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/);
const uuid = z.uuid();
const valid = (schema: z.ZodType<string>, value: string | null) => value && schema.safeParse(value).success ? value : "";

export function analyticsListState(params: Query) {
  return {
    from: valid(date, params.get("from")),
    to: valid(date, params.get("to")),
    search: (params.get("q") ?? "").slice(0, 100),
  };
}

export function analyticsKstBoundary(value: string, end: boolean) {
  if (!date.safeParse(value).success) return "";
  const [year, monthValue, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, monthValue - 1, day + (end ? 1 : 0)));
  return `${utc.toISOString().slice(0, 10)}T00:00:00+09:00`;
}

export function complianceListState(params: Query, defaultMonth: string) {
  const scope = params.get("scope");
  return {
    month: valid(month, params.get("month")) || defaultMonth,
    scope: scope === "company" || uuid.safeParse(scope).success ? scope : "",
    exportPage: Math.min(100000, positivePage(params.get("exportPage"))),
    exportPageSize: pageSize(params.get("exportPageSize"), 10),
  };
}
