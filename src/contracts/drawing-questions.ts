import { z } from "zod";

export const DRAWING_QUESTION_TYPE = "직접 그리기";
export const fileQuestionTypes: readonly string[] = ["파일 업로드", DRAWING_QUESTION_TYPE];
export const drawingAnswerSchema = z.object({
  // Compatibility field: an opaque FileObject.id, never a private storage key or URL.
  s3Key: z.uuid(),
  fileName: z.string().trim().min(1).max(200)
    .refine(value => !/[\u0000-\u001f\u007f/\\]/.test(value), "파일 이름을 확인해주세요."),
  fileSize: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();
export type DrawingAnswer = z.infer<typeof drawingAnswerSchema>;
export function isDrawingAnswer(value: unknown): value is DrawingAnswer { return drawingAnswerSchema.safeParse(value).success; }
export function isFileQuestion(type: string): boolean { return fileQuestionTypes.includes(type); }
export function fileAnswerId(value: unknown): string | undefined {
  if (typeof value === "string") return z.uuid().safeParse(value).success ? value : undefined;
  return isDrawingAnswer(value) ? value.s3Key : undefined;
}
export function drawingAnswerFromFile(file: { id: string; name: string; size: number }): DrawingAnswer {
  return drawingAnswerSchema.parse({ s3Key: file.id, fileName: file.name, fileSize: file.size });
}
