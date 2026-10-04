import { z } from "zod";

const button = z.object({
  name: z.string().trim().min(1).max(14),
  type: z.enum(["WL", "AL", "BK", "MD"]),
  link: z.string().trim().max(500).default(""),
}).strict().superRefine((value, ctx) => {
  if (value.type === "WL") {
    let valid = false;
    try { const url = new URL(value.link); valid = url.protocol === "https:" && !url.username && !url.password; } catch { valid = false; }
    if (!valid) ctx.addIssue({ code: "custom", path: ["link"], message: "웹 링크 버튼은 HTTPS 주소가 필요합니다." });
  } else if (value.link) ctx.addIssue({ code: "custom", path: ["link"], message: "웹 링크 버튼만 주소를 가질 수 있습니다." });
});
export const kakaoButtons = z.array(button).max(5);
export const kakaoChannelInput = z.object({
  serviceId: z.uuid(),
  name: z.string().trim().min(1).max(40),
  searchId: z.string().trim().regex(/^@[A-Za-z0-9_]{1,20}$/, "채널 검색용 아이디는 @로 시작하는 영문·숫자입니다."),
}).strict();
export const kakaoChannelPatch = kakaoChannelInput.omit({ serviceId: true }).extend({ version: z.number().int().positive(), status: z.enum(["pending", "archived"]) }).strict();
export const kakaoTemplateInput = z.object({
  serviceId: z.uuid(),
  channelId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(1000),
  buttons: kakaoButtons.default([]),
}).strict();
export const kakaoTemplatePatch = kakaoTemplateInput.omit({ serviceId: true, channelId: true }).extend({ version: z.number().int().positive() }).strict();
export const kakaoPreviewInput = z.object({
  body: z.string().trim().min(1).max(1000),
  buttons: kakaoButtons.default([]),
  values: z.record(z.string().regex(/^[A-Za-z0-9_]{1,30}$/), z.string().max(100)).default({}),
}).strict();
export const kakaoReviewInput = z.object({
  kind: z.enum(["channel", "template"]),
  id: z.uuid(),
  outcome: z.enum(["verified", "approved", "rejected"]),
  note: z.string().trim().max(500).default(""),
}).strict();
export function kakaoVariables(body: string) {
  return [...body.matchAll(/#\{([A-Za-z0-9_]{1,30})\}/g)].map(match => match[1]);
}
export type KakaoChannelRecord = { id: string; serviceId: string; name: string; searchId: string; status: "pending" | "verified" | "archived"; version: number };
export type KakaoTemplateRecord = { id: string; serviceId: string; channelId: string; name: string; body: string; buttons: z.infer<typeof kakaoButtons>; status: "draft" | "submitted" | "rejected" | "approved" | "archived"; reviewNote: string; version: number };
