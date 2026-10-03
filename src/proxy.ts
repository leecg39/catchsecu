import { NextResponse, type NextRequest } from "next/server";
import { isReservedQueryKey } from "@/lib/request-query-keys";

// URL 변환에서 사라질 수 있는 키는 원래 URL에서 먼저 검사한다.
export function proxy(request: NextRequest) {
  for (const key of new URL(request.url).searchParams.keys()) {
    if (!isReservedQueryKey(key)) continue;
    const requestId = crypto.randomUUID();
    return NextResponse.json({ error: { code: "INVALID_QUERY", message: "지원하지 않는 검색 조건입니다.", requestId } },
      { status: 422, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } });
  }
  return NextResponse.next();
}
export const config = { matcher: ["/api/v1/marketing/:path*", "/api/v1/email-suppressions", "/api/v1/senders/:path*", "/api/v1/security/ip-rules/:path*", "/api/v1/security/mfa-policy/:path*"] };
