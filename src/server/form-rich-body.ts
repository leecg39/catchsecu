import { FormRichBodyError, normalizeFormRichBody } from "@/contracts/form-rich-content";
import type { RichDocumentV1 } from "@/contracts/rich-content";
import { fail } from "./http";

type RichBodyCarrier = { body: string; bodyRich?: RichDocumentV1 | null };

function bodyInput(content: RichBodyCarrier) {
  return {
    body: content.body,
    ...(Object.hasOwn(content, "bodyRich") ? { bodyRich: content.bodyRich } : {}),
  };
}
/** Apply the omission/null compatibility rule only against the locked current
 * draft. The returned object never contains null: SQL null and DTO omission are
 * the canonical legacy/plain-text representation. */
export function normalizeFormContentRichBody<T extends RichBodyCarrier>(content: T, current?: RichBodyCarrier): T {
  try {
    const body = normalizeFormRichBody(bodyInput(content), current ? bodyInput(current) : undefined);
    const result = { ...content };
    delete result.bodyRich;
    if (body.bodyRich !== undefined) result.bodyRich = body.bodyRich;
    return result;
  } catch (error) {
    if (error instanceof FormRichBodyError) fail(422, error.code, error.message);
    throw error;
  }
}
