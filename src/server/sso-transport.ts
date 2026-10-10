import dns from "node:dns/promises";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { env } from "./env";
import { publicOutboundAddress } from "./public-network";

const messages = {
  INVALID_URL: "인증 제공자 URL 형식을 확인해주세요.",
  INSECURE_URL: "인증 제공자는 HTTPS 주소만 허용됩니다.",
  UNSAFE_DNS: "인증 제공자가 공개 인터넷 주소를 사용하지 않습니다.",
  DNS_UNAVAILABLE: "인증 제공자의 주소를 확인할 수 없습니다.",
  TIMEOUT: "인증 제공자 응답 시간이 초과되었습니다.",
  CONNECTION_FAILED: "인증 제공자와 안전하게 연결할 수 없습니다.",
  REDIRECT_BLOCKED: "인증 제공자의 다른 주소로의 이동은 허용되지 않습니다.",
  RESPONSE_TOO_LARGE: "인증 제공자 응답이 허용 크기를 초과했습니다.",
  INVALID_RESPONSE: "인증 제공자의 JSON 응답을 확인할 수 없습니다.",
  REQUEST_TOO_LARGE: "인증 제공자 요청이 허용 크기를 초과했습니다.",
} as const;
export class SsoTransportError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); this.name = "SsoTransportError"; }
}
const reject = (code: keyof typeof messages): never => { throw new SsoTransportError(code); };
const loopback = (host: string) => ["localhost", "127.0.0.1", "::1"].includes(host);

/** Syntax/transport check also runs at use time, including rows written before this guard. */
export function ssoEndpoint(input: string) {
  if (input.length > 2048 || input !== input.trim() || /[\s\\\u0000-\u001f\u007f]/.test(input)) reject("INVALID_URL");
  let url: URL; try { url = new URL(input); } catch { return reject("INVALID_URL"); }
  if (url.username || url.password || url.hash || !["https:", "http:"].includes(url.protocol)) reject("INVALID_URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowLocal = process.env.NODE_ENV !== "production" && env.ALLOW_LOCAL_SSO === "1" && loopback(hostname);
  if (url.protocol !== "https:" && !allowLocal) reject("INSECURE_URL");
  return { url, hostname, allowLocal };
}
async function resolveAddress(hostname: string, allowLocal: boolean, timeoutMs: number) {
  let addresses: { address: string; family: number }[];
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([dns.lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, rejectPromise) => { timer = setTimeout(() => rejectPromise(new SsoTransportError("TIMEOUT")), Math.min(3000, timeoutMs)); })]);
    } catch (error) { if (error instanceof SsoTransportError) throw error; return reject("DNS_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
  }
  // Validate EVERY answer before choosing one; never resolve again when connecting.
  if (!addresses.length || addresses.some(a => a.family !== isIP(a.address) || !isIP(a.address)
    || !(allowLocal ? ["127.0.0.1", "::1"].includes(a.address) : publicOutboundAddress(a.address)))) reject("UNSAFE_DNS");
  return addresses.find(a => a.family === 4) ?? addresses[0];
}

type Options = { method?: "GET" | "POST"; body?: URLSearchParams; authorization?: string; timeoutMs?: number };
export async function requestSsoJson(input: string, options: Options = {}): Promise<{ status: number; ok: boolean; body: Record<string, unknown> }> {
  const { url, hostname, allowLocal } = ssoEndpoint(input);
  const timeoutMs = Math.min(10000, Math.max(1, options.timeoutMs ?? 8000)), deadline = Date.now() + timeoutMs;
  const bytes = options.body ? Buffer.from(options.body.toString()) : undefined;
  if (bytes && bytes.length > 65536) reject("REQUEST_TOO_LARGE");
  const target = await resolveAddress(hostname, allowLocal, timeoutMs);
  if (Date.now() >= deadline) reject("TIMEOUT");
  return new Promise((resolveResult, rejectResult) => {
    let settled = false, request: ClientRequest | undefined, response: IncomingMessage | undefined;
    const finish = (error?: SsoTransportError, result?: { status: number; ok: boolean; body: Record<string, unknown> }) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { response?.destroy(); request?.destroy(); rejectResult(error); }
      else resolveResult(result!);
    };
    const fail = (code: keyof typeof messages) => finish(new SsoTransportError(code));
    const timer = setTimeout(() => fail("TIMEOUT"), Math.max(1, deadline - Date.now()));
    try {
      const transport = url.protocol === "https:" ? https : http;
      const requestOptions: https.RequestOptions & { autoSelectFamily: boolean } = {
        protocol: url.protocol, hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search, method: options.method ?? "GET", agent: false, family: target.family,
        autoSelectFamily: false, lookup: (_hostname, options, callback) => options.all ? callback(null, [target]) : callback(null, target.address, target.family),
        ...(url.protocol === "https:" ? { rejectUnauthorized: true, servername: isIP(hostname) ? "" : hostname, minVersion: "TLSv1.2" as const } : {}),
        maxHeaderSize: 16384,
        headers: { accept: "application/json", "accept-encoding": "identity", "user-agent": "CatchsecuSSO/1",
          ...(bytes ? { "content-type": "application/x-www-form-urlencoded", "content-length": bytes.length } : {}),
          ...(options.authorization ? { authorization: options.authorization } : {}) },
      };
      request = transport.request(requestOptions, incoming => {
        response = incoming;
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) { fail("REDIRECT_BLOCKED"); return; }
        if (status < 200 || status > 599 || incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") { fail("INVALID_RESPONSE"); return; }
        if (Number(incoming.headers["content-length"] ?? 0) > 1048576) { fail("RESPONSE_TOO_LARGE"); return; }
        const chunks: Buffer[] = []; let received = 0;
        incoming.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > 1048576) fail("RESPONSE_TOO_LARGE"); else chunks.push(chunk);
        });
        incoming.on("aborted", () => fail("CONNECTION_FAILED"));
        incoming.on("error", () => fail("CONNECTION_FAILED"));
        incoming.on("close", () => { if (!incoming.complete) fail("CONNECTION_FAILED"); });
        incoming.on("end", () => {
          if (settled) return;
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!body || typeof body !== "object" || Array.isArray(body)) { fail("INVALID_RESPONSE"); return; }
            finish(undefined, { status, ok: status >= 200 && status < 300, body: body as Record<string, unknown> });
          } catch { fail("INVALID_RESPONSE"); }
        });
      });
      request.on("error", () => fail("CONNECTION_FAILED"));
      request.on("upgrade", (_response, socket) => { socket.destroy(); fail("INVALID_RESPONSE"); });
      request.end(bytes);
    } catch { fail("CONNECTION_FAILED"); }
  });
}
