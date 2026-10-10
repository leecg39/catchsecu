import dns from "node:dns/promises";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { PassThrough, Writable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { env } from "@/server/env";
import { publicOutboundAddress } from "@/server/public-network";
import { requestSsoJson, ssoEndpoint } from "@/server/sso-transport";

const localFlag = env.ALLOW_LOCAL_SSO;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); env.ALLOW_LOCAL_SSO = localFlag; });
function fakeHttps(status = 200, body = '{"keys":[]}', headers: Record<string, string> = {}) {
  const calls: { options: RequestOptions; body: string; request: Writable; response: PassThrough }[] = [];
  vi.spyOn(https, "request").mockImplementation(((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    let bytes = ""; const request = new Writable({ write(chunk, _encoding, done) { bytes += chunk.toString(); done(); } });
    request.on("finish", () => {
      const stream = new PassThrough(), incoming = stream as unknown as IncomingMessage;
      incoming.statusCode = status; incoming.headers = headers;
      calls.push({ options, body: bytes, request, response: stream }); callback(incoming);
      queueMicrotask(() => { incoming.complete = true; if (!stream.destroyed) stream.end(body); });
    });
    return request as unknown as ClientRequest;
  }) as typeof https.request);
  return calls;
}
function publicDns(address = "8.8.8.8", family = 4) {
  return vi.spyOn(dns, "lookup").mockResolvedValue([{ address, family }] as never);
}

test.each(["https://user:secret@idp.test/jwks", "https://idp.test/jwks#token", "ftp://idp.test/jwks", "file:///etc/passwd", " https://idp.test", "https://idp.test\\@localhost", "https://idp.test/\npath"])("URL 구문 경계: %s", input => {
  expect(() => ssoEndpoint(input)).toThrow(expect.objectContaining({ code: "INVALID_URL" }));
});
test.each(["http://localhost:1234", "http://127.0.0.1:1234", "http://[::1]:1234"])("루프백 HTTP는 개발 명시 허용에만 접근: %s", input => {
  vi.stubEnv("NODE_ENV", "test"); env.ALLOW_LOCAL_SSO = "0";
  expect(() => ssoEndpoint(input)).toThrow(expect.objectContaining({ code: "INSECURE_URL" }));
  env.ALLOW_LOCAL_SSO = "1"; expect(ssoEndpoint(input).allowLocal).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => ssoEndpoint(input)).toThrow(expect.objectContaining({ code: "INSECURE_URL" }));
});
test.each(["127.0.0.1", "0.0.0.0", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "198.18.0.1", "192.0.2.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1"])("운영 비공개 IP 거절: %s", address => {
  expect(publicOutboundAddress(address)).toBe(false);
});
test("사설 HTTPS 리터럴은 DNS나 HTTP 함수 호출 전에 차단한다", async () => {
  vi.stubEnv("NODE_ENV", "production"); env.ALLOW_LOCAL_SSO = "1";
  const dnsSpy = publicDns(), calls = fakeHttps();
  for (const input of ["https://127.0.0.1/jwks", "https://169.254.169.254/token", "https://[::ffff:127.0.0.1]/", "https://0x7f000001/"])
    await expect(requestSsoJson(input)).rejects.toMatchObject({ code: "UNSAFE_DNS" });
  expect(dnsSpy).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
});
test.each([
  [], [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }],
  [{ address: "2606:4700:4700::1111", family: 6 }, { address: "fd00::1", family: 6 }],
  [{ address: "8.8.8.8", family: 6 }], [{ address: "invalid", family: 4 }],
].map(records => ({ records })))("DNS 전체 응답 검증: %#", async ({ records }) => {
  vi.spyOn(dns, "lookup").mockResolvedValue(records as never); const calls = fakeHttps();
  await expect(requestSsoJson("https://idp.test/jwks")).rejects.toMatchObject({ code: "UNSAFE_DNS" });
  expect(calls).toHaveLength(0);
});
test("공개 이름이 루프백으로 해석되면 개발 플래그가 있어도 거절한다", async () => {
  vi.stubEnv("NODE_ENV", "test"); env.ALLOW_LOCAL_SSO = "1"; publicDns("127.0.0.1"); const calls = fakeHttps();
  await expect(requestSsoJson("https://idp.test/jwks")).rejects.toMatchObject({ code: "UNSAFE_DNS" }); expect(calls).toHaveLength(0);
});
test("localhost도 모든 DNS 응답이 정확한 루프백이어야 한다", async () => {
  vi.stubEnv("NODE_ENV", "test"); env.ALLOW_LOCAL_SSO = "1"; publicDns("10.0.0.1"); const calls = fakeHttps();
  await expect(requestSsoJson("https://localhost/jwks")).rejects.toMatchObject({ code: "UNSAFE_DNS" }); expect(calls).toHaveLength(0);
});
test.each([["8.8.8.8", 4], ["2606:4700:4700::1111", 6]] as const)("DNS 한 번 검사·%s 고정·SNI/인증서 검증 보존", async (address, family) => {
  const lookup = publicDns(address, family), calls = fakeHttps();
  const result = await requestSsoJson("https://idp.test:8443/token?realm=test", { method: "POST", authorization: "Basic synthetic-only", body: new URLSearchParams({ code: "code", code_verifier: "verifier" }) });
  expect(result).toMatchObject({ status: 200, ok: true }); expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith("idp.test", { all: true, verbatim: true });
  expect(calls[0].options).toMatchObject({ hostname: "idp.test", servername: "idp.test", port: "8443", path: "/token?realm=test", family,
    rejectUnauthorized: true, agent: false, autoSelectFamily: false, minVersion: "TLSv1.2", maxHeaderSize: 16384 });
  expect(calls[0].options.headers).toMatchObject({ authorization: "Basic synthetic-only", "accept-encoding": "identity" });
  expect(calls[0].body).toBe("code=code&code_verifier=verifier");
  // A later DNS change cannot affect this request's pinned lookup.
  lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
  const callback = vi.fn(); calls[0].options.lookup!("idp.test", {}, callback);
  expect(callback).toHaveBeenLastCalledWith(null, address, family);
  calls[0].options.lookup!("idp.test", { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [{ address, family }]); expect(lookup).toHaveBeenCalledTimes(1);
});
test.each([301, 302, 303, 307, 308])("%d 응답은 인증정보를 다음 주소로 보내지 않는다", async status => {
  publicDns(); const calls = fakeHttps(status, "", { location: "http://169.254.169.254/token" });
  await expect(requestSsoJson("https://idp.test/token", { method: "POST", authorization: "Basic synthetic-only" })).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
  expect(calls).toHaveLength(1); expect(calls[0].request.destroyed).toBe(true);
});
test.each(["declared", "streamed", "compressed", "array", "invalid"])("응답 제한: %s", async variant => {
  publicDns();
  const headers: Record<string, string> = variant === "declared" ? { "content-length": "1048577" } : variant === "compressed" ? { "content-encoding": "gzip" } : {};
  fakeHttps(200, variant === "streamed" ? "x".repeat(1048577) : variant === "array" ? "[]" : variant === "invalid" ? "secret-invalid" : "{}", headers);
  await expect(requestSsoJson("https://idp.test/jwks")).rejects.toMatchObject({ code: ["declared", "streamed"].includes(variant) ? "RESPONSE_TOO_LARGE" : "INVALID_RESPONSE" });
});
test("DNS 오류 상세값은 공개 오류로 전달하지 않는다", async () => {
  vi.spyOn(dns, "lookup").mockRejectedValue(new Error("PRIVATE_DNS_SECRET")); fakeHttps();
  const result = await requestSsoJson("https://idp.test/jwks").catch(error => error);
  expect(result).toMatchObject({ code: "DNS_UNAVAILABLE" }); expect(result.message).not.toContain("PRIVATE_DNS_SECRET");
});
test("DNS 지연은 제한 시간 후 종료하며 나중에 연결하지 않는다", async () => {
  vi.useFakeTimers(); let release!: (records: never) => void;
  vi.spyOn(dns, "lookup").mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
  const calls = fakeHttps(), result = requestSsoJson("https://idp.test/jwks", { timeoutMs: 100 }).catch(error => error);
  await vi.advanceTimersByTimeAsync(101); expect(await result).toMatchObject({ code: "TIMEOUT" });
  release([{ address: "8.8.8.8", family: 4 }] as never); await vi.advanceTimersByTimeAsync(1); expect(calls).toHaveLength(0);
});
test("연결/본문 지연은 총 제한 시간 후 요청을 파기한다", async () => {
  vi.useFakeTimers(); publicDns();
  const request = new Writable({ write(_chunk, _encoding, done) { done(); } });
  vi.spyOn(https, "request").mockReturnValue(request as unknown as ClientRequest);
  const result = requestSsoJson("https://idp.test/token", { timeoutMs: 100 }).catch(error => error);
  await vi.advanceTimersByTimeAsync(101); expect(await result).toMatchObject({ code: "TIMEOUT" }); expect(request.destroyed).toBe(true);
});
test("과도한 인증 요청은 DNS 조회 전에 거절한다", async () => {
  const lookup = publicDns();
  await expect(requestSsoJson("https://idp.test/token", { method: "POST", body: new URLSearchParams({ code: "x".repeat(65536) }) })).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  expect(lookup).not.toHaveBeenCalled();
});

let localOrigin = "", hits: string[] = [];
const server = http.createServer((request, response) => {
  const path = request.url ?? ""; hits.push(path);
  if (path === "/redirect") { response.writeHead(302, { location: localOrigin + "/target" }); response.end(); return; }
  if (path === "/large") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"value":"' + "x".repeat(1048576) + '"}'); return; }
  if (path === "/stall") { response.writeHead(200); response.write('{"partial":'); return; }
  if (path === "/broken") { response.writeHead(200, { "content-length": "100" }); response.write("{}"); response.destroy(); return; }
  const chunks: Buffer[] = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), authorization: request.headers.authorization ?? null })); });
});
beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); localOrigin = "http://127.0.0.1:" + (server.address() as { port: number }).port; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
test("실제 로컬 HTTP 토큰 POST·redirect 차단·스트림 크기·부분 응답 종료", async () => {
  vi.stubEnv("NODE_ENV", "test"); env.ALLOW_LOCAL_SSO = "1"; hits = [];
  expect(await requestSsoJson(localOrigin + "/token", { method: "POST", body: new URLSearchParams({ code: "synthetic" }), authorization: "Basic local-fixture" }))
    .toMatchObject({ status: 200, body: { body: "code=synthetic", authorization: "Basic local-fixture" } });
  await expect(requestSsoJson(localOrigin + "/redirect")).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
  expect(hits).not.toContain("/target");
  await expect(requestSsoJson(localOrigin + "/large")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  await expect(requestSsoJson(localOrigin + "/stall", { timeoutMs: 100 })).rejects.toMatchObject({ code: "TIMEOUT" });
  await expect(requestSsoJson(localOrigin + "/broken")).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
});
