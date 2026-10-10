import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { fail } from "./http";

const secureName = "__Host-catchsecu-sso-browser";
const localName = "catchsecu-sso-browser-local";
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const hash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const cookieName = (prefix: string, browserHash: string) => prefix + "-" + browserHash.slice(0, 32);

/** Use the configured public origin, never request Host/forwarded headers. */
export function ssoBrowserTransport(protocol?: string) {
  const url = new URL(env.BETTER_AUTH_URL);
  if (url.protocol === "https:" && !url.username && !url.password) return { name: secureName, secure: true };
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (protocol !== "saml" && url.protocol === "http:" && loopback && !url.username && !url.password && env.ALLOW_LOCAL_SSO === "1")
    return { name: localName, secure: false };
  fail(503, "SSO_HTTPS_REQUIRED", "회사 SSO 로그인에는 HTTPS 주소가 필요합니다. 관리자에게 접속 주소를 확인해주세요.");
}

function browserNonce(headers: Headers, name: string) {
  const values = (headers.get("cookie") ?? "").split(";").map(part => part.trim())
    .filter(part => part.split("=", 1)[0] === name).map(part => part.slice(name.length + 1));
  if (!values.length) return null;
  if (values.length !== 1 || !noncePattern.test(values[0]))
    fail(401, "SSO_BROWSER_MISMATCH", "로그인을 시작한 브라우저를 확인할 수 없습니다. 현재 브라우저에서 다시 시작해주세요.");
  return values[0];
}

export function startSsoBrowser(headers: Headers, protocol?: string) {
  const transport = ssoBrowserTransport(protocol);
  // Distinct names prevent simultaneous first-tab responses from overwriting each other.
  // Subsequent starts reuse an established binding instead of accumulating cookies.
  const names = (headers.get("cookie") ?? "").split(";").map(part => part.trim().split("=", 1)[0])
    .filter(name => name.startsWith(transport.name + "-") && /^[a-f0-9]{32}$/.test(name.slice(transport.name.length + 1))).sort();
  let nonce: string | null = null;
  for (const name of names) {
    const candidate = browserNonce(headers, name);
    if (candidate && cookieName(transport.name, hash(candidate)) === name) { nonce = candidate; break; }
  }
  nonce ??= randomBytes(32).toString("base64url");
  const cookie = cookieName(transport.name, hash(nonce)) + "=" + nonce + "; Path=/; HttpOnly; Max-Age=600; SameSite=" + (transport.secure ? "None; Secure" : "Lax");
  return { browserHash: hash(nonce), browserCookie: cookie };
}

export function assertSsoBrowser(state: { browserHash: string | null }, headers: Headers, protocol?: string) {
  const transport = ssoBrowserTransport(protocol);
  const nonce = state.browserHash && /^[a-f0-9]{64}$/.test(state.browserHash)
    ? browserNonce(headers, cookieName(transport.name, state.browserHash)) : null;
  if (!nonce || !state.browserHash || !/^[a-f0-9]{64}$/.test(state.browserHash)
    || !timingSafeEqual(Buffer.from(state.browserHash, "hex"), Buffer.from(hash(nonce), "hex")))
    fail(401, "SSO_BROWSER_MISMATCH", "로그인을 시작한 브라우저를 확인할 수 없습니다. 현재 브라우저에서 다시 시작해주세요.");
}
