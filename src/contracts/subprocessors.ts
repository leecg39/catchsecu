import { z } from "zod";

export const subprocessorInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  changeSummary: z.string().trim().min(1).max(4000),
}).strict();
export const subprocessorPatch = subprocessorInput.extend({
  version: z.number().int().positive(),
  status: z.enum(["active", "archived"]),
}).strict();
export const subprocessorNoticeInput = z.object({
  subprocessorId: z.uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
}).strict();
export type SubprocessorRecord = {
  id: string; serviceId: string; name: string; email: string; changeSummary: string;
  status: "active" | "archived"; version: number; createdAt: string;
};
export type SubprocessorNoticeRecord = {
  id: string; subprocessorId: string; name: string; email: string; subject: string;
  status: "queued" | "sent" | "suppressed"; createdAt: string;
};
