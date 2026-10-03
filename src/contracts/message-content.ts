import { z } from "zod";

export const messageTitle = z.string().trim().min(1).max(200).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "제어 문자를 사용할 수 없습니다.");
const text = z.string().min(1).max(100000).refine(v => !/[\u0000\u000b\u000c\u007f]/.test(v), "제어 문자를 사용할 수 없습니다.");
export const messageContent = z.discriminatedUnion("format", [
  z.object({ format: z.literal("text"), subject: messageTitle, text }).strict(),
  z.object({ format: z.literal("html"), subject: messageTitle, text, html: text }).strict(),
]).superRefine((v, ctx) => {
  const source = [v.subject, v.text, v.format === "html" ? v.html : ""].join("\n");
  if (/\{\{|\}\}/.test(source.replace(/\{\{(?:name|contact)\}\}/g, "")))
    ctx.addIssue({ code: "custom", message: "변수는 {{name}}, {{contact}}만 사용할 수 있습니다." });
});
export type MessageContent = z.infer<typeof messageContent>;
