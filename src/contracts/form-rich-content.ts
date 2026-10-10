import { z } from "zod";
import { richDocumentImages, richDocumentSchema, richDocumentText, type RichDocumentV1 } from "./rich-content";

export const MAX_FORM_RICH_DOCUMENT_BYTES = 512 * 1024;
export const MAX_FORM_RICH_DOCUMENT_IMAGES = 100;

/** This is the body slice, not a replacement for the full FormContent contract. */
export const formRichBodyInput = z.object({
  body: z.string().max(20000),
  bodyRich: richDocumentSchema.nullable().optional(),
}).strict();
export type FormRichBodyInput = z.infer<typeof formRichBodyInput>;
export type FormRichBody = { body: string; bodyRich?: RichDocumentV1 };
export type FormRichPresentation = {
  bodyRich?: RichDocumentV1 | null;
  sections?: { bodyRich?: RichDocumentV1 | null }[] | null;
  completionPage?: { mode: string; bodyRich?: RichDocumentV1 | null } | null;
  closedPage?: { mode: string; bodyRich?: RichDocumentV1 | null } | null;
};
export class FormRichBodyError extends Error {
  constructor(public readonly code: "RICH_BODY_AMBIGUOUS" | "RICH_BODY_TEXT_MISMATCH", message: string) {
    super(message);
    this.name = "FormRichBodyError";
  }
}

/**
 * Omission preserves only the current draft. Callers must not pass an earlier
 * published version as a fallback when the current draft has cleared its body.
 * Null is an explicit conversion back to the supplied plain text.
 */
export function normalizeFormRichBody(input: FormRichBodyInput, current?: FormRichBodyInput): FormRichBody {
  const next = formRichBodyInput.parse(input);
  if (next.bodyRich === null) return { body: next.body };
  if (next.bodyRich !== undefined) {
    if (richDocumentText(next.bodyRich) !== next.body)
      throw new FormRichBodyError("RICH_BODY_TEXT_MISMATCH", "본문의 텍스트와 서식 문서가 일치하지 않습니다.");
    return { body: next.body, bodyRich: next.bodyRich };
  }
  if (current?.bodyRich != null) {
    const prior = formRichBodyInput.parse(current);
    if (next.body !== prior.body)
      throw new FormRichBodyError("RICH_BODY_AMBIGUOUS", "서식이 있는 본문을 수정하려면 최신 편집기에서 다시 저장해주세요.");
    if (richDocumentText(prior.bodyRich!) !== prior.body)
      throw new FormRichBodyError("RICH_BODY_TEXT_MISMATCH", "현재 본문의 텍스트와 서식 문서가 일치하지 않습니다.");
    return { body: next.body, bodyRich: prior.bodyRich! };
  }
  return { body: next.body };
}

export function formRichContentTotals(content: FormRichPresentation) {
  const documents = [content.bodyRich, ...(content.sections ?? []).map(section => section.bodyRich),
    content.completionPage?.mode === "custom" ? content.completionPage.bodyRich : undefined,
    content.closedPage?.mode === "custom" ? content.closedPage.bodyRich : undefined]
    .filter((document): document is RichDocumentV1 => document != null);
  return {
    bytes: documents.reduce((total, document) => total + new TextEncoder().encode(JSON.stringify(document)).byteLength, 0),
    images: documents.reduce((total, document) => total + richDocumentImages(document).length, 0),
  };
}
