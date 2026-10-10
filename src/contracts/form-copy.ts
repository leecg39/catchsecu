import type { FormContent } from "./forms";
import { normalizeQuestionOptions } from "./option-identities";

export function cloneFormContent(original: FormContent): FormContent {
  const content = structuredClone(original);
  content.questions = normalizeQuestionOptions(content.questions);
  const pageIds = new Map((content.sections ?? []).map(section => [section.id, crypto.randomUUID()]));
  if (content.sections) for (const section of content.sections) {
    section.id = pageIds.get(section.id)!;
    if (section.defaultDestination.kind === "page") section.defaultDestination.pageId = pageIds.get(section.defaultDestination.pageId)!;
  }
  for (const question of content.questions) for (const option of question.optionDefinitions ?? [])
    if (option.branchDestination?.kind === "page") option.branchDestination.pageId = pageIds.get(option.branchDestination.pageId)!;
  const ids = new Map(content.questions.map(question => [question.id, crypto.randomUUID()]));
  const optionIds = new Map(content.questions.flatMap(question => (question.optionDefinitions ?? []).map(option => [option.id, crypto.randomUUID()])));
  for (const question of content.questions) {
    if (question.pageId) question.pageId = pageIds.get(question.pageId)!;
    question.id = ids.get(question.id)!;
    if (question.condition) question.condition.questionId = ids.get(question.condition.questionId)!;
    if (question.condition?.optionId) question.condition.optionId = optionIds.get(question.condition.optionId)!;
    if (question.optionDefinitions) for (const option of question.optionDefinitions) option.id = optionIds.get(option.id)!;
    if (question.rows) for (const row of question.rows) row.id = crypto.randomUUID();
  }
  if (content.marketing) {
    content.marketing.nameQuestionId = ids.get(content.marketing.nameQuestionId)!;
    if (content.marketing.emailQuestionId) content.marketing.emailQuestionId = ids.get(content.marketing.emailQuestionId)!;
    if (content.marketing.smsQuestionId) content.marketing.smsQuestionId = ids.get(content.marketing.smsQuestionId)!;
    if (content.marketing.kakaoQuestionId) content.marketing.kakaoQuestionId = ids.get(content.marketing.kakaoQuestionId)!;
  }
  return content;
}
