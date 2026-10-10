import type { FormContent, Question } from "@/contracts/forms";
import type { FormDestination, FormSectionDefinition } from "@/contracts/form-sections";

export type IdFactory = () => string;

const terminal: FormDestination = { kind: "consent" };
const page = (id: string, order: number, destination: FormDestination = terminal): FormSectionDefinition => ({
  id, title: order === 0 ? "" : `페이지 ${order + 1}`, body: "", defaultDestination: destination, allowBack: order > 0,
});

export function enableFormPages(content: FormContent, makeId: IdFactory): FormContent {
  if (content.sections?.length) return structuredClone(content);
  const id = makeId();
  return { ...structuredClone(content), sections: [page(id, 0)], questions: content.questions.map(question => ({ ...question, pageId: id })) };
}

export function disableFormPages(content: FormContent): FormContent {
  const result = structuredClone(content);
  delete result.sections;
  result.questions = result.questions.map(question => {
    const next = { ...question };
    delete next.pageId;
    if (next.optionDefinitions) next.optionDefinitions = next.optionDefinitions.map(option => {
      const copy = { ...option }; delete copy.branchDestination; return copy;
    });
    return next;
  });
  return result;
}

export function addFormPage(content: FormContent, makeId: IdFactory): FormContent {
  if (!content.sections?.length) return enableFormPages(content, makeId);
  const result = structuredClone(content), sections = result.sections!;
  const previous = sections.at(-1)!, id = makeId(), destination = structuredClone(previous.defaultDestination);
  previous.defaultDestination = { kind: "page", pageId: id };
  sections.push(page(id, sections.length, destination));
  return result;
}

function cloneQuestion(question: Question, pageId: string, questionIds: ReadonlyMap<string, string>,
  optionIds: ReadonlyMap<string, string>, makeId: IdFactory): Question {
  const next = structuredClone(question);
  next.id = questionIds.get(question.id)!; next.pageId = pageId;
  if (next.rows) next.rows = next.rows.map(row => ({ ...row, id: makeId() }));
  if (next.optionDefinitions) next.optionDefinitions = next.optionDefinitions.map(option => ({ ...option, id: optionIds.get(option.id)! }));
  if (next.condition && questionIds.has(next.condition.questionId)) {
    next.condition.questionId = questionIds.get(next.condition.questionId)!;
    if (next.condition.optionId) next.condition.optionId = optionIds.get(next.condition.optionId)!;
  }
  return next;
}

export function duplicateFormPage(content: FormContent, pageId: string, makeId: IdFactory): FormContent {
  const result = structuredClone(content), sections = result.sections;
  if (!sections) return result;
  const index = sections.findIndex(section => section.id === pageId);
  if (index < 0) return result;
  const source = sections[index], newPageId = makeId(), copied = structuredClone(source);
  copied.id = newPageId; copied.title = source.title ? `${source.title} 복사본` : `페이지 ${index + 2}`; copied.allowBack = true;
  source.defaultDestination = { kind: "page", pageId: newPageId };
  sections.splice(index + 1, 0, copied);

  const originals = result.questions.filter(question => question.pageId === pageId);
  const questionIds = new Map(originals.map(question => [question.id, makeId()]));
  const optionIds = new Map(originals.flatMap(question => (question.optionDefinitions ?? []).map(option => [option.id, makeId()])));
  const clones = originals.map(question => cloneQuestion(question, newPageId, questionIds, optionIds, makeId));
  const last = result.questions.reduce((found, question, position) => question.pageId === pageId ? position : found, -1);
  result.questions.splice(last + 1, 0, ...clones);
  return result;
}

export function moveFormPage(content: FormContent, pageId: string, delta: -1 | 1): FormContent {
  const result = structuredClone(content), sections = result.sections;
  if (!sections) return result;
  const from = sections.findIndex(section => section.id === pageId), to = from + delta;
  if (from <= 0 || to <= 0 || to >= sections.length) return result;
  [sections[from], sections[to]] = [sections[to], sections[from]];
  return result;
}

export function pageDeleteImpact(content: FormContent, pageId: string) {
  const sections = content.sections ?? [], target = sections.find(section => section.id === pageId);
  const questions = content.questions.filter(question => question.pageId === pageId).length;
  let references = 0;
  for (const section of sections) if (section.id !== pageId && section.defaultDestination.kind === "page" && section.defaultDestination.pageId === pageId) references++;
  for (const question of content.questions) for (const option of question.optionDefinitions ?? [])
    if (option.branchDestination?.kind === "page" && option.branchDestination.pageId === pageId) references++;
  return { first: sections[0]?.id === pageId, questions, references, replacement: target?.defaultDestination };
}

export function removeFormPage(content: FormContent, pageId: string): FormContent {
  const impact = pageDeleteImpact(content, pageId), result = structuredClone(content), sections = result.sections;
  if (!sections || impact.first || impact.questions || !impact.replacement) return result;
  const replacement = impact.replacement;
  result.sections = sections.filter(section => section.id !== pageId).map(section => ({ ...section,
    defaultDestination: section.defaultDestination.kind === "page" && section.defaultDestination.pageId === pageId
      ? structuredClone(replacement) : section.defaultDestination,
  }));
  result.questions = result.questions.map(question => ({ ...question,
    ...(question.optionDefinitions ? { optionDefinitions: question.optionDefinitions.map(option => ({ ...option,
      ...(option.branchDestination?.kind === "page" && option.branchDestination.pageId === pageId
        ? { branchDestination: structuredClone(replacement) } : {}),
    })) } : {}),
  }));
  return result;
}

export function changePage(content: FormContent, pageId: string, patch: Partial<FormSectionDefinition>): FormContent {
  const result = structuredClone(content);
  if (result.sections) result.sections = result.sections.map(section => section.id === pageId ? { ...section, ...structuredClone(patch), id: section.id } : section);
  return result;
}

export function destinationValue(destination: FormDestination | undefined): string {
  return !destination ? "" : destination.kind === "page" ? `page:${destination.pageId}` : destination.kind;
}

export function destinationFromValue(value: string): FormDestination | undefined {
  if (value.startsWith("page:")) return { kind: "page", pageId: value.slice(5) };
  if (["consent", "submit", "ineligible"].includes(value)) return { kind: value as "consent" | "submit" | "ineligible" };
}
