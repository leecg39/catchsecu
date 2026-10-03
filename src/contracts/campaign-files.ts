import { z } from "zod";
import { fileInput } from "./domains";
export const MAX_CAMPAIGN_FILES = 5;
export const MAX_CAMPAIGN_FILE_BYTES = 20 * 1024 * 1024;
export const campaignFileInput = fileInput.extend({ version: z.number().int().positive() }).strict();
export const attachmentSnapshot = z.array(z.object({ id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(10485760), mime: fileInput.shape.mime }).strict()).max(MAX_CAMPAIGN_FILES);
