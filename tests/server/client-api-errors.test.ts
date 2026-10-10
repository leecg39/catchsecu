import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());
test("네트워크 장애는 한국어 재시도 안내와 식별 가능한 오류로 전달한다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(api("/documents/options")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR", message: "서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요." });
});
test("화면 전환으로 취소한 요청은 네트워크 장애로 바꾸지 않는다", async () => {
  const controller = new AbortController(); controller.abort();
  const error = new DOMException("aborted", "AbortError");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(api("/documents/options", { signal: controller.signal })).rejects.toBe(error);
});
test("서버의 권한 거부와 충돌 오류는 상태·코드·요청 식별자를 보존한다", async () => {
  for (const status of [403, 409]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "합성 서버 오류", code: "SYNTHETIC_ERROR", requestId: "request-example" } }), { status })));
    await expect(api("/documents/example")).rejects.toMatchObject({ status, code: "SYNTHETIC_ERROR", requestId: "request-example", message: "합성 서버 오류" });
  }
});
