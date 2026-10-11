import { z } from "zod";
import { oneOf, pageSize, positivePage } from "./list-url-state";
import { reviewStatuses } from "@/contracts/activity-reviews";

type Query = Pick<URLSearchParams, "get">;
export function listDate(value: string | null) {
  return value && z.iso.date().safeParse(value).success ? value : "";
}
export function activityListState(params: Query) {
  return {
    page: Math.min(100000, positivePage(params.get("page"))), pageSize: pageSize(params.get("pageSize"), 10),
    from: listDate(params.get("from")), to: listDate(params.get("to")), search: (params.get("q") ?? "").slice(0, 100),
  };
}
export function reviewListState(params: Query) {
  const serviceId = params.get("serviceId"), reviewId = params.get("reviewId");
  return { ...activityListState(params),
    scope: oneOf(params.get("scope"), ["received", "sent", "company"] as const, "received"),
    status: oneOf(params.get("status"), ["all", ...reviewStatuses] as const, "all"),
    serviceId: serviceId && z.uuid().safeParse(serviceId).success ? serviceId : "",
    reviewId: reviewId && z.uuid().safeParse(reviewId).success ? reviewId : "",
  };
}
// R05 lists default to ten rows. Store explicit numbers so page 20 and a
// twenty-row selection never collapse into another list's defaults.
export function activityListHref(path: string, current: string, values: Record<string, string | number | null>) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  return path + (params.size ? "?" + params.toString() : "");
}
