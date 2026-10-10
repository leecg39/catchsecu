import { z } from "zod";
import { formNoticeSchema } from "./form-sections";

export const submissionReceiptSchema = z.object({
  id: z.uuid(), submittedAt: z.iso.datetime(), status: z.literal("submitted"),
  completionPage: formNoticeSchema.optional(),
  completionProof: z.string().min(1).max(2048).optional(),
}).strict();
export type SubmissionReceipt = z.infer<typeof submissionReceiptSchema>;
