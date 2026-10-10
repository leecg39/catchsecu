import { authorAssetKeySchema } from "./author-assets";

type ImageQuestion = { id: string; questionImageKey?: string | null };

/** Omission retains the same CURRENT logical question's image. Explicit null clears it.
 * Historical versions must not be passed as previous: deleted images must not revive.
 * Absent images stay absent so legacy JSON and approval fingerprints do not change. */
export function normalizeQuestionImages<T extends ImageQuestion>(questions: T[], previous: readonly ImageQuestion[] = []): T[] {
  const current = new Map(previous.map(question => [question.id, question.questionImageKey]));
  return questions.map(question => {
    const key = question.questionImageKey === undefined ? current.get(question.id) : question.questionImageKey;
    const { questionImageKey: _key, ...rest } = question; void _key;
    return { ...rest, ...(key != null ? { questionImageKey: authorAssetKeySchema.parse(key) } : {}) } as T;
  });
}
