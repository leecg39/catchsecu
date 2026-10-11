import { z } from "zod";
import { oneOf, pageSize, positivePage } from "./list-url-state";

type Query = Pick<URLSearchParams, "get">;
const month = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/);
const date = z.iso.date();
const valid = (schema: z.ZodType<string>, value: string | null) => value && schema.safeParse(value).success ? value : "";

export function billingHistoryListState(params: Query, usageDefault = false) {
  return {
    tab: oneOf(params.get("tab"), ["billing", "message", "identity"] as const, usageDefault ? "identity" : "billing"),
    fromMonth: valid(month, params.get("fromMonth")),
    toMonth: valid(month, params.get("toMonth")),
    from: valid(date, params.get("from")),
    to: valid(date, params.get("to")),
    page: Math.min(100000, positivePage(params.get("page"))),
    pageSize: pageSize(params.get("pageSize"), 10),
  };
}
