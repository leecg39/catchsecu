import { Resolver } from "node:dns/promises";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "./env";
import { fail } from "./http";

export function senderEnvironment(): "live" | "local" { return env.MAIL_TRANSPORT === "local" ? "local" : "live"; }
export function senderEmailDomain(address: string) {
  const domain = address.split("@")[1];
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.length > 190 || domain.endsWith(".localhost") || domain.endsWith(".local"))
    fail(422, "SENDER_DOMAIN", "조직에서 소유한 도메인의 이메일 주소를 입력해주세요.");
  if (new Set(["gmail.com", "googlemail.com", "naver.com", "daum.net", "hanmail.net", "nate.com", "kakao.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com"]).has(domain))
    fail(422, "SENDER_PUBLIC_DOMAIN", "조직에서 소유한 도메인의 이메일 주소가 필요합니다.");
  if (domain.endsWith(".test") && senderEnvironment() !== "local") fail(422, "SENDER_DOMAIN", "외부 발송에는 실제 도메인이 필요합니다.");
  return domain;
}
export function emailTransportDenial(domain: string, environment: string | null) {
  if (environment !== senderEnvironment()) return "현재 발송 환경에서 다시 인증해야 합니다.";
  if (env.MAIL_TRANSPORT === "local") return null;
  if (!env.SMTP_HOST) return "SMTP 연결 설정이 필요합니다.";
  if (!env.SMTP_SENDER_DOMAINS.split(",").map(s => s.trim().toLowerCase()).includes(domain)) return "SMTP 발신 도메인 승인이 필요합니다.";
  return null;
}
export async function verifySenderDns(domain: string, expected: string) {
  const resolver = new Resolver({ timeout: 2500, tries: 2 });
  if (env.SENDER_DNS_SERVER) {
    // Local DNS fixtures cannot authorize a live identity or query arbitrary zones.
    if (env.MAIL_TRANSPORT !== "local" || !["localhost", "127.0.0.1"].includes(new URL(env.BETTER_AUTH_URL).hostname) ||
      !/^127\.0\.0\.1:\d{2,5}$/.test(env.SENDER_DNS_SERVER) || !domain.endsWith(".test")) fail(503, "DNS_CONFIGURATION", "DNS 확인 설정을 확인해주세요.");
    resolver.setServers([env.SENDER_DNS_SERVER]);
  }
  try { return (await resolver.resolveTxt("_catchsecu-sender." + domain)).some(chunks => chunks.join("") === expected); }
  catch (e) { if (["ENODATA", "ENOTFOUND"].includes((e as NodeJS.ErrnoException).code ?? "")) return false; fail(503, "DNS_UNAVAILABLE", "DNS 조회에 실패했습니다. 잠시 후 다시 확인해주세요."); }
  finally { resolver.cancel(); }
}
const solapiResponse = z.object({ accountId: z.string().min(1), senderIds: z.array(z.object({ handleKey: z.string().min(1), phoneNumber: z.string().regex(/^\d{8,12}$/), status: z.string(), expireAt: z.iso.datetime({ offset: true }).nullable().optional() })).max(10000) });
export function solapiConfigured(tenantId: string) { return !!env.SOLAPI_API_KEY && !!env.SOLAPI_API_SECRET && env.SOLAPI_TENANT_ID === tenantId; }
export async function verifySolapiSender(tenantId: string, address: string) {
  if (!solapiConfigured(tenantId)) fail(503, "SMS_PROVIDER_REQUIRED", "이 회사의 문자 공급자 연결이 필요합니다.");
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", env.SOLAPI_API_SECRET!).update(date + salt).digest("hex");
  let response: Response;
  try { response = await fetch("https://api.solapi.com/senderid/v1/numbers", { headers: { Authorization: `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` }, signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" }); }
  catch { fail(503, "SMS_PROVIDER_UNAVAILABLE", "문자 공급자 조회에 실패했습니다."); }
  if (!response.ok) fail(503, "SMS_PROVIDER_UNAVAILABLE", "문자 공급자의 계정·권한·연결 상태를 확인해주세요.");
  const reader = response.body?.getReader(); if (!reader) fail(503, "SMS_PROVIDER_RESPONSE", "공급자 응답을 확인할 수 없습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 2000000) { await reader.cancel(); fail(503, "SMS_PROVIDER_RESPONSE", "공급자 응답을 확인할 수 없습니다."); } chunks.push(r.value); }
  let raw: unknown; try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(503, "SMS_PROVIDER_RESPONSE", "공급자 응답 형식을 확인할 수 없습니다."); }
  const result = solapiResponse.safeParse(raw); if (!result.success) fail(503, "SMS_PROVIDER_RESPONSE", "공급자 응답 형식을 확인할 수 없습니다.");
  const rows = result.data.senderIds.filter(s => s.phoneNumber === address);
  if (rows.length !== 1 || rows[0].status !== "ACTIVE") return { verified: false as const, code: "NOT_ACTIVE" };
  const row = rows[0], expiresAt = row.expireAt ? new Date(row.expireAt) : new Date(Date.now() + 86400000);
  if (expiresAt <= new Date()) return { verified: false as const, code: "EXPIRED" };
  return { verified: true as const, reference: result.data.accountId + ":" + row.handleKey, expiresAt: new Date(Math.min(expiresAt.getTime(), Date.now() + 90 * 86400000)) };
}
