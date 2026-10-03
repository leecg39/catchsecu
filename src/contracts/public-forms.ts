import { z } from "zod";

export const submissionReceiptSchema = z.object({ id: z.uuid(), submittedAt: z.iso.datetime(), status: z.literal("submitted") }).strict();
export type SubmissionReceipt = z.infer<typeof submissionReceiptSchema>;
