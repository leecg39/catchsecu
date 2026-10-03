import { z } from "zod";
import { fileInput } from "./domains";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.csv";
export const publicUploadInput = fileInput.extend({ questionId: z.uuid() }).strict();
export const memberUploadInput = z.discriminatedUnion("purpose", [
  fileInput.extend({ purpose: z.literal("service"), serviceId: z.uuid() }).strict(),
  fileInput.extend({ purpose: z.literal("submission"), submissionId: z.uuid(), questionId: z.uuid() }).strict(),
]);
export type FileInfo = {
  id: string; name: string; mime: string; size: number; status: string; scanStatus: string;
  version: number; questionId: string | null; submissionId: string | null; expiresAt: string | null;
};
export type UploadInfo = FileInfo & { uploadToken?: string };
