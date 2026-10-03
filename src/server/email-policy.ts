import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { tokenHash } from "./crypto";
import { env } from "./env";
import { fail } from "./http";
export const UNSUBSCRIBE_LIFETIME_MS = 90 * 86400000;
export function unsubscribeToken(jobId: string) { return jobId + "." + tokenHash("email-unsubscribe:v1:" + jobId); }
export function unsubscribeJobId(token: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || !z.uuid().safeParse(parts[0]).success || !/^[a-f0-9]{64}$/.test(parts[1])) fail(404, "UNSUBSCRIBE_NOT_FOUND", "수신거부 링크를 확인해주세요.");
  const expected = tokenHash("email-unsubscribe:v1:" + parts[0]);
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts[1], "hex"))) fail(404, "UNSUBSCRIBE_NOT_FOUND", "수신거부 링크를 확인해주세요.");
  return parts[0];
}
export function unsubscribeUrl(jobId: string) { return new URL("/email/unsubscribe/" + unsubscribeToken(jobId), env.BETTER_AUTH_URL).href; }
const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function withEmailPolicy<T extends { text: string; html?: string }>(jobId: string, mail: T) {
  const url = unsubscribeUrl(jobId), oneClick = env.SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED === "true" && new URL(url).protocol === "https:";
  const headerUrl = oneClick ? new URL("/api/v1/email-unsubscribe/" + unsubscribeToken(jobId) + "?confirmPage=1", new URL(env.BETTER_AUTH_URL).origin).href : url;
  return { ...mail, text: mail.text + "\n\n이 서비스의 이메일 수신 거부: " + url,
    ...(mail.html === undefined ? {} : { html: mail.html + '<hr><p><a href="' + htmlEscape(url) + '">이 서비스의 이메일 수신 거부</a></p>' }),
    headers: { "List-Unsubscribe": "<" + headerUrl + ">", ...(oneClick ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}) } };
}
