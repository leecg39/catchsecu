import { oneOf, pageSize, positivePage } from "./list-url-state";
type Query = Pick<URLSearchParams, "get">;
function common(params: Query) {
  return { search: (params.get("q") ?? "").slice(0, 100), page: Math.min(100000, positivePage(params.get("page"))), pageSize: pageSize(params.get("pageSize")) };
}
export function ipListState(params: Query) {
  return { ...common(params), status: oneOf(params.get("status"), ["all", "enabled", "disabled"] as const, "all"),
    sort: oneOf(params.get("sort"), ["createdAt", "cidr"] as const, "createdAt"), direction: oneOf(params.get("direction"), ["asc", "desc"] as const, "desc") };
}
export function mfaListState(params: Query) {
  return { ...common(params), status: oneOf(params.get("status"), ["all", "enabled", "required", "exception"] as const, "all") };
}
