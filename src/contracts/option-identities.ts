import type { QuestionDefinition, OptionDefinition } from "./questions";
import { validateQuestionDefinitions } from "./questions";
import { customChoiceTypes } from "./custom-choice";
import { optionImageQuestionTypes } from "./author-assets";

// Legacy string requests preserve identity only for exactly matching stored values.
// Renaming a label requires optionDefinitions; guessing from array position corrupts reorders.
export function normalizeQuestionOptions(questions: QuestionDefinition[], previous: QuestionDefinition[] = [],
  allocate: (questionId: string, value: string) => string = () => crypto.randomUUID(), current: QuestionDefinition[] = previous): QuestionDefinition[] {
  // Validate explicit metadata before normalization; null/string/extra fields must not be erased.
  validateQuestionDefinitions(questions);
  const oldIds = new Map(previous.flatMap(question => (question.optionDefinitions ?? []).map(option => [option.id, { questionId: question.id, value: option.value }] as const)));
  const normalized = questions.map(question => {
    const old = previous.find(item => item.id === question.id);
    const active = current.find(item => item.id === question.id);
    if (!customChoiceTypes.includes(question.type) && !question.options && !question.optionDefinitions
      && active?.optionDefinitions?.some(option => option.isCustomValue))
      throw new Error("기타 보기를 명시적으로 제거한 뒤 질문 유형을 변경해주세요.");
    if (!optionImageQuestionTypes.includes(question.type) && !question.options && !question.optionDefinitions
      && active?.optionDefinitions?.some(option => option.optionImageKey))
      throw new Error("답변별 이미지를 명시적으로 제거한 뒤 질문 유형을 변경해주세요.");
    const source: OptionDefinition[] = question.optionDefinitions ?? (question.options ?? []).map(value => {
      const prior = old?.optionDefinitions?.find(option => option.value === value);
      // Historical identity/value ownership may be reused. Mutable flags belong only to current.
      return prior ? { id: prior.id, label: prior.label, value: prior.value } : { id: allocate(question.id, value), label: value, value };
    });
    const definitions: OptionDefinition[] = source.map(option => {
      const { isCustomValue, optionImageKey, branchDestination, ...identity } = option;
      const prior = active?.optionDefinitions?.find(item => item.id === option.id && item.value === option.value);
      const imageKey = optionImageKey === undefined ? prior?.optionImageKey : optionImageKey;
      const branch = branchDestination === undefined ? prior?.branchDestination : branchDestination;
      return { ...identity, ...(isCustomValue === true || (isCustomValue === undefined && prior?.isCustomValue === true) ? { isCustomValue: true } : {}),
        ...(imageKey != null ? { optionImageKey: imageKey } : {}), ...(branch ? { branchDestination: branch } : {}) };
    });
    for (const option of definitions) {
      const prior = oldIds.get(option.id);
      if (prior && (prior.questionId !== question.id || prior.value !== option.value))
        throw new Error("기존 보기 ID의 질문이나 선택값은 변경할 수 없습니다. 새 보기를 추가해주세요.");
    }
    return { ...question, ...(question.options || question.optionDefinitions ? { optionDefinitions: definitions } : {}) };
  });
  for (const question of normalized) if (question.condition && !question.condition.optionId) {
    const source = normalized.find(item => item.id === question.condition!.questionId);
    const option = source?.optionDefinitions?.find(item => item.value === question.condition!.value);
    if (option) question.condition = { ...question.condition, optionId: option.id };
  }
  validateQuestionDefinitions(normalized);
  return normalized;
}
