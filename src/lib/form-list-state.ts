import { z } from "zod";
import { oneOf, pageSize, positivePage } from "./list-url-state";
type Query = Pick<URLSearchParams, "get">;
function date(value: string | null) { return value && z.iso.date().safeParse(value).success ? value : ""; }
export function formListState(params: Query) {
  const start = date(params.get("start")), end = date(params.get("end"));
  const status = oneOf(params.get("status"), ["", "all", "draft", "pendingApproval", "published", "paused", "archived"] as const, "");
  return { search: (params.get("q") ?? "").slice(0, 100), page: Math.min(100000, positivePage(params.get("page"))), pageSize: pageSize(params.get("pageSize")),
    start, end, status, favorite: params.get("favorite") === "true",
    sort: oneOf(params.get("sort"), ["createdAt", "name"] as const, "createdAt"), direction: oneOf(params.get("direction"), ["asc", "desc"] as const, "desc"),
    expanded: params.get("details") === "1" || (params.get("details") !== "0" && !!(start || end || status)) };
}
