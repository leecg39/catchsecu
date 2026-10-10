import { z } from "zod";

export const MAX_QUESTION_EXPLANATION_LENGTH = 3000;
// This is literal text: preserve whitespace, line breaks and HTML-looking characters.
// PostgreSQL text cannot represent NUL or malformed UTF-16 converted to invalid Unicode.
// Use UTF-16 length explicitly: the installed Zod string max counts Unicode code points.
export const questionExplanationSchema = z.string()
  .refine(value => value.length <= MAX_QUESTION_EXPLANATION_LENGTH, "추가 설명은 3000자 이내로 입력해주세요.")
  .refine(value => !value.includes("\u0000"), "추가 설명에 NUL 문자를 사용할 수 없습니다.")
  .refine(value => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value, "추가 설명의 문자 인코딩을 확인해주세요.")
  .meta({ description: "Literal question explanation; whitespace and line breaks are preserved. At most 3000 UTF-16 code units; NUL and unpaired surrogates are rejected. Empty text removes the explanation.", "x-max-utf16-length": MAX_QUESTION_EXPLANATION_LENGTH });

type ExplainedQuestion = { id: string; additionalExplanation?: string };
/** Omission from an old client retains only the same current logical question's explanation.
 * Explicit empty text clears it. New questions and old absent fields remain absent. */
export function normalizeQuestionExplanations<T extends ExplainedQuestion>(questions: T[], previous: ExplainedQuestion[] = []): T[] {
  const existing = new Map(previous.map(question => [question.id, question.additionalExplanation]));
  return questions.map(question => {
    const explanation = question.additionalExplanation === undefined ? existing.get(question.id) : question.additionalExplanation;
    const { additionalExplanation: _explanation, ...rest } = question; void _explanation;
    return { ...rest, ...(explanation !== undefined && explanation !== "" ? { additionalExplanation: explanation } : {}) } as T;
  });
}
