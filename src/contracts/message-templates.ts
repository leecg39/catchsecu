import { z } from "zod";
import { messageContent, messageTitle, type MessageContent } from "./message-content";

export const messageTemplateCreate = z.object({ serviceId: z.uuid(), channel: z.enum(["email", "sms"]), name: messageTitle, content: messageContent }).strict();
export const messageTemplatePatch = messageTemplateCreate.omit({ serviceId: true, channel: true }).extend({ version: z.number().int().positive() }).strict();
export const messageTemplateVersion = z.object({ version: z.number().int().positive() }).strict();
export const messageTemplateApply = z.object({ version: z.number().int().positive(), templateId: z.uuid(), templateVersion: z.number().int().positive() }).strict();
export const messageTemplateList = z.object({ serviceId: z.uuid(), channel: z.enum(["email", "sms"]), status: z.enum(["active", "archived", "deleted"]).default("active"), search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export type MessageTemplateRecord = { id: string; serviceId: string; channel: "email" | "sms"; name: string; status: "active" | "archived" | "deleted"; version: number; content: MessageContent | null; createdAt: string; updatedAt: string; revisions?: { version: number; kind: string; createdAt: string }[] };
