import { fail } from "./http";
import { isReservedQueryKey } from "@/lib/request-query-keys";
export function requestQuery(request: Request) {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of new URL(request.url).searchParams) {
    if (isReservedQueryKey(key)) fail(422, "INVALID_QUERY", "지원하지 않는 검색 조건입니다.");
    if (Object.hasOwn(result, key)) fail(422, "DUPLICATE_QUERY", "같은 검색 조건을 두 번 지정할 수 없습니다.");
    result[key] = value;
  }
  return result;
}
export function requireEmptyQuery(request: Request) {
  if (Object.keys(requestQuery(request)).length) fail(422, "INVALID_QUERY", "이 요청에는 검색 조건을 사용할 수 없습니다.");
}
