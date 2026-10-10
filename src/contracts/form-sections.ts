import { z } from "zod";
import { richDocumentSchema, richDocumentText, type RichDocumentV1 } from "./rich-content";

export const MAX_FORM_SECTIONS = 50;
export const formDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: z.uuid() }).strict(),
  z.object({ kind: z.enum(["consent", "submit", "ineligible"]) }).strict(),
]);
export type FormDestination = z.infer<typeof formDestinationSchema>;

export const formSectionSchema = z.object({
  id: z.uuid(),
  title: z.string().max(200),
  body: z.string().max(20000),
  bodyRich: richDocumentSchema.nullable().optional(),
  defaultDestination: formDestinationSchema,
  allowBack: z.boolean(),
}).strict().superRefine((section, ctx) => {
  if (section.bodyRich != null && richDocumentText(section.bodyRich) !== section.body)
    ctx.addIssue({ code: "custom", message: "페이지 본문의 텍스트와 서식 문서가 일치하지 않습니다.", path: ["bodyRich"] });
});
export const formSectionsSchema = z.array(formSectionSchema).min(1).max(MAX_FORM_SECTIONS);
export type FormSectionDefinition = z.infer<typeof formSectionSchema>;

const defaultNoticeSchema = z.object({ mode: z.literal("default") }).strict();
const customNoticeSchema = z.object({
  mode: z.literal("custom"),
  body: z.string().max(20000),
  bodyRich: richDocumentSchema.nullable().optional(),
}).strict().superRefine((notice, ctx) => {
  if (notice.bodyRich != null && richDocumentText(notice.bodyRich) !== notice.body)
    ctx.addIssue({ code: "custom", message: "안내의 텍스트와 서식 문서가 일치하지 않습니다.", path: ["bodyRich"] });
});
export const formNoticeSchema = z.union([defaultNoticeSchema, customNoticeSchema]);
export type FormNotice = z.infer<typeof formNoticeSchema>;

type PlacedQuestion = { id: string; pageId?: string; type?: string; condition?: unknown; optionDefinitions?: {
  value: string; isCustomValue?: boolean; branchDestination?: FormDestination;
}[] };
export type FormPresentation = {
  questions: PlacedQuestion[];
  sections?: FormSectionDefinition[] | null;
  completionPage?: FormNotice | null;
  closedPage?: FormNotice | null;
};

export type FormPresentationIssue = { message: string; path: (string | number)[] };

export function formPresentationIssues(content: FormPresentation): FormPresentationIssue[] {
  const sections = content.sections ?? undefined;
  const issues: FormPresentationIssue[] = [];
  if (!sections) {
    content.questions.forEach((question, index) => {
      if (question.pageId !== undefined) issues.push({ message: "단일 페이지 폼에는 질문 페이지를 지정할 수 없습니다.", path: ["questions", index, "pageId"] });
      if (question.optionDefinitions?.some(option => option.branchDestination))
        issues.push({ message: "보기별 페이지 이동은 페이지형 폼에서만 사용할 수 있습니다.", path: ["questions", index, "optionDefinitions"] });
    });
    return issues;
  }
  const pages = new Map<string, FormSectionDefinition>();
  sections.forEach((section, index) => {
    if (pages.has(section.id)) issues.push({ message: "페이지 ID가 중복되었습니다.", path: ["sections", index, "id"] });
    pages.set(section.id, section);
  });
  if (sections[0] && (sections[0].title !== "" || sections[0].body !== "" || sections[0].bodyRich != null))
    issues.push({ message: "첫 페이지의 제목과 본문은 폼 안내를 사용하므로 비워주세요.", path: ["sections", 0] });
  content.questions.forEach((question, index) => {
    if (!question.pageId || !pages.has(question.pageId))
      issues.push({ message: "모든 질문을 같은 폼 버전의 페이지에 배치해주세요.", path: ["questions", index, "pageId"] });
  });
  const branchQuestions = new Map<string, string>();
  content.questions.forEach((question, questionIndex) => {
    const branches = question.optionDefinitions?.flatMap((option, optionIndex) => option.branchDestination
      ? [{ destination: option.branchDestination, optionIndex, custom: option.isCustomValue === true }] : []) ?? [];
    if (!branches.length) return;
    if (!question.pageId || !pages.has(question.pageId)) return;
    if (!['객관식 답변', '드롭다운'].includes(question.type ?? ''))
      issues.push({ message: "보기별 이동은 객관식 또는 드롭다운 질문에만 지정할 수 있습니다.", path: ["questions", questionIndex, "optionDefinitions"] });
    if (question.condition)
      issues.push({ message: "보기별 이동 질문은 페이지에서 항상 표시되어야 합니다.", path: ["questions", questionIndex, "condition"] });
    if (branches.some(branch => branch.custom))
      issues.push({ message: "직접입력 보기에는 페이지 이동을 지정할 수 없습니다.", path: ["questions", questionIndex, "optionDefinitions"] });
    const prior = branchQuestions.get(question.pageId);
    if (prior && prior !== question.id)
      issues.push({ message: "한 페이지에는 보기별 이동 질문을 하나만 둘 수 있습니다.", path: ["questions", questionIndex, "optionDefinitions"] });
    else branchQuestions.set(question.pageId, question.id);
    for (const branch of branches) if (branch.destination.kind === "page") {
      if (branch.destination.pageId === question.pageId)
        issues.push({ message: "보기별 이동으로 현재 페이지를 다시 열 수 없습니다.", path: ["questions", questionIndex, "optionDefinitions", branch.optionIndex, "branchDestination"] });
      else if (!pages.has(branch.destination.pageId))
        issues.push({ message: "보기별 이동 대상이 같은 폼 버전에 없습니다.", path: ["questions", questionIndex, "optionDefinitions", branch.optionIndex, "branchDestination", "pageId"] });
    }
  });
  sections.forEach((section, index) => {
    const destination = section.defaultDestination;
    if (destination.kind === "page") {
      if (destination.pageId === section.id)
        issues.push({ message: "페이지를 자기 자신으로 이동시킬 수 없습니다.", path: ["sections", index, "defaultDestination"] });
      else if (!pages.has(destination.pageId))
        issues.push({ message: "이동할 페이지가 같은 폼 버전에 없습니다.", path: ["sections", index, "defaultDestination", "pageId"] });
    }
  });
  const pageEdges = new Map(sections.map(section => [section.id, new Set<string>(section.defaultDestination.kind === "page" ? [section.defaultDestination.pageId] : [])]));
  for (const question of content.questions) for (const option of question.optionDefinitions ?? [])
    if (question.pageId && option.branchDestination?.kind === "page") pageEdges.get(question.pageId)?.add(option.branchDestination.pageId);
  const visiting = new Set<string>(), visited = new Set<string>();
  const hasCycle = (pageId: string): boolean => {
    if (visiting.has(pageId)) return true;
    if (visited.has(pageId)) return false;
    visiting.add(pageId);
    for (const next of pageEdges.get(pageId) ?? []) if (pages.has(next) && hasCycle(next)) return true;
    visiting.delete(pageId); visited.add(pageId); return false;
  };
  for (const [startIndex, section] of sections.entries()) if (hasCycle(section.id)) {
    issues.push({ message: "모든 기본·보기별 페이지 이동은 완료되는 경로여야 합니다.", path: ["sections", startIndex, "defaultDestination"] });
    break;
  }
  return issues;
}

export type FormVisit = { pageIds: string[]; questionIds: Set<string>; terminal: "consent" | "submit" | "ineligible" };

/** Resolve one page edge with the same branch precedence used by the server's
 * complete visit calculation. Public UI uses this instead of duplicating the
 * graph rule in the browser. */
export function formPageDestination(content: FormPresentation, pageId: string,
  answers: Record<string, unknown>): FormDestination {
  const page = content.sections?.find(section => section.id === pageId);
  if (!page) throw new FormPresentationError("PRESENTATION_INVALID", "현재 페이지를 찾을 수 없습니다.");
  const branchQuestion = content.questions.find(question => question.pageId === pageId
    && question.optionDefinitions?.some(option => option.branchDestination));
  const value = branchQuestion ? answers[branchQuestion.id] : undefined;
  const selected = typeof value === "string"
    ? branchQuestion?.optionDefinitions?.find(option => option.value === value) : undefined;
  return selected?.branchDestination ?? page.defaultDestination;
}

/** Recomputes the canonical server-side page path from submitted answers. */
export function resolveFormVisit(content: FormPresentation, answers: Record<string, unknown>): FormVisit | null {
  const sections = content.sections ?? undefined;
  if (!sections?.length) return null;
  const pages = new Map(sections.map(section => [section.id, section]));
  const pageIds: string[] = [], questionIds = new Set<string>(), seen = new Set<string>();
  let page = sections[0];
  while (page) {
    if (seen.has(page.id)) throw new FormPresentationError("PRESENTATION_INVALID", "페이지 이동 경로가 순환합니다.");
    seen.add(page.id); pageIds.push(page.id);
    const pageQuestions = content.questions.filter(question => question.pageId === page.id);
    pageQuestions.forEach(question => questionIds.add(question.id));
    const destination = formPageDestination(content, page.id, answers);
    if (destination.kind !== "page") return { pageIds, questionIds, terminal: destination.kind };
    const next = pages.get(destination.pageId);
    if (!next) throw new FormPresentationError("PRESENTATION_INVALID", "페이지 이동 대상을 찾을 수 없습니다.");
    page = next;
  }
  throw new FormPresentationError("PRESENTATION_INVALID", "페이지 이동 경로가 끝나지 않습니다.");
}

export class FormPresentationError extends Error {
  constructor(public readonly code: "PRESENTATION_AMBIGUOUS" | "PRESENTATION_INVALID", message: string) {
    super(message);
    this.name = "FormPresentationError";
  }
}

type RichCarrier = { body: string; bodyRich?: RichDocumentV1 | null };
function normalizeRichCarrier<T extends RichCarrier>(next: T, current: RichCarrier | undefined, label: string): T {
  const result = structuredClone(next);
  if (result.bodyRich === null) {
    delete result.bodyRich;
    return result;
  }
  if (result.bodyRich !== undefined) {
    if (richDocumentText(result.bodyRich) !== result.body)
      throw new FormPresentationError("PRESENTATION_INVALID", `${label}의 텍스트와 서식 문서가 일치하지 않습니다.`);
    return result;
  }
  if (current?.bodyRich != null) {
    if (current.body !== result.body)
      throw new FormPresentationError("PRESENTATION_AMBIGUOUS", `서식이 있는 ${label}을 수정하려면 최신 편집기에서 다시 저장해주세요.`);
    result.bodyRich = structuredClone(current.bodyRich);
  }
  return result;
}

function normalizeNotice(next: FormNotice, current: FormNotice | null | undefined, label: string): FormNotice {
  if (next.mode === "default") return { mode: "default" };
  return normalizeRichCarrier(next, current?.mode === "custom" ? current : undefined, label);
}

/**
 * New presentation fields distinguish omission from explicit null. Omission is
 * compatible with an older editor and preserves only the locked current draft.
 * Null removes the setting. A rich document cannot silently follow changed text.
 */
export function normalizeFormPresentation<T extends FormPresentation>(input: T, current?: FormPresentation): T {
  const result = structuredClone(input);
  const currentQuestions = new Map(current?.questions.map(question => [question.id, question]) ?? []);
  if (input.sections === null) {
    delete result.sections;
    result.questions = result.questions.map(question => {
      const next = { ...question };
      delete next.pageId;
      return next;
    });
  } else if (input.sections === undefined && current?.sections) {
    result.sections = structuredClone(current.sections);
    result.questions = result.questions.map(question => ({ ...question,
      ...(question.pageId === undefined && currentQuestions.get(question.id)?.pageId ? { pageId: currentQuestions.get(question.id)!.pageId } : {}) }));
  } else if (input.sections) {
    const currentSections = new Map((current?.sections ?? []).map(section => [section.id, section]));
    result.sections = input.sections.map(section => normalizeRichCarrier(section, currentSections.get(section.id), "페이지 본문"));
    result.questions = result.questions.map(question => ({ ...question,
      ...(question.pageId === undefined && currentQuestions.get(question.id)?.pageId ? { pageId: currentQuestions.get(question.id)!.pageId } : {}) }));
  }
  for (const [key, label] of [["completionPage", "완료 안내"], ["closedPage", "마감 안내"]] as const) {
    const next = input[key], prior = current?.[key];
    if (next === null) delete result[key];
    else if (next === undefined && prior) result[key] = structuredClone(prior);
    else if (next) result[key] = normalizeNotice(next, prior, label);
  }
  const issues = formPresentationIssues(result);
  if (issues.length) throw new FormPresentationError("PRESENTATION_INVALID", issues[0].message);
  return result;
}
