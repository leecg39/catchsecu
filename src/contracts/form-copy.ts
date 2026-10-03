import type { FormContent } from "./forms";

export function cloneFormContent(original: FormContent): FormContent {
  const content = structuredClone(original);
  const ids = new Map(content.questions.map(question => [question.id, crypto.randomUUID()]));
  for (const question of content.questions) {
    question.id = ids.get(question.id)!;
    if (question.condition) question.condition.questionId = ids.get(question.condition.questionId)!;
    if (question.rows) for (const row of question.rows) row.id = crypto.randomUUID();
  }
  if (content.marketing) {
    content.marketing.nameQuestionId = ids.get(content.marketing.nameQuestionId)!;
    if (content.marketing.emailQuestionId) content.marketing.emailQuestionId = ids.get(content.marketing.emailQuestionId)!;
    if (content.marketing.smsQuestionId) content.marketing.smsQuestionId = ids.get(content.marketing.smsQuestionId)!;
  }
  return content;
}
