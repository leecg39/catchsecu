import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { formContentSchema } from "@/contracts/domains";
import { FormPresentationError, normalizeFormPresentation } from "@/contracts/form-sections";
import type { RichDocumentV1 } from "@/contracts/rich-content";

const rich = (text: string): RichDocumentV1 => ({ schemaVersion: 1, blocks: text ? [{ type: "paragraph", children: [{ type: "text", text }] }] : [] });
const question = (pageId?: string) => ({ id: randomUUID(), type: "단문형 답변" as const, label: "질문", required: true, ...(pageId ? { pageId } : {}) });
const base = (questions = [question()]) => ({ body: "안내", questions, consentRequired: true, consentPurpose: "검증", retentionDays: 30, maxResponses: 100 });
function withoutPageId<T extends { pageId?: string }>(item: T) { const copy = { ...item }; delete copy.pageId; return copy; }

test("legacy content stays page-free and byte-compatible", () => {
  const input = base();
  expect(formContentSchema.parse(input)).toEqual(input);
});

test("version-owned sections use stable page IDs and explicit destinations", () => {
  const first = randomUUID(), second = randomUUID(), third = randomUUID();
  const content = formContentSchema.parse({ ...base([question(first), question(second), question(third)]), sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "상세", body: "설명", bodyRich: rich("설명"), defaultDestination: { kind: "page", pageId: third }, allowBack: true },
    { id: third, title: "마지막", body: "", defaultDestination: { kind: "consent" }, allowBack: true },
  ], completionPage: { mode: "custom", body: "완료", bodyRich: rich("완료") }, closedPage: { mode: "default" } });
  expect(content.sections?.map(section => section.id)).toEqual([first, second, third]);
  expect(content.completionPage?.mode).toBe("custom");
});

test("section graph rejects missing placement, dangling/self targets, cycles and a populated first page", () => {
  const first = randomUUID(), second = randomUUID();
  const make = (sections: unknown, questions = [question(first)]) => formContentSchema.safeParse({ ...base(questions), sections });
  expect(make([{ id: first, title: "첫 페이지", body: "", defaultDestination: { kind: "submit" }, allowBack: false }]).success).toBe(false);
  expect(make([{ id: first, title: "", body: "본문", defaultDestination: { kind: "submit" }, allowBack: false }]).success).toBe(false);
  expect(make([{ id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: first }, allowBack: false }]).success).toBe(false);
  expect(make([{ id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false }]).success).toBe(false);
  expect(make([
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "둘째", body: "", defaultDestination: { kind: "page", pageId: first }, allowBack: true },
  ], [question(first), question(second)]).success).toBe(false);
  expect(make([{ id: first, title: "", body: "", defaultDestination: { kind: "submit" }, allowBack: false }], [question()]).success).toBe(false);
  expect(formContentSchema.safeParse({ ...base([question(first)]), questions: [question(first), question(second)], sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "submit" }, allowBack: false },
  ] }).success).toBe(false);
});

test("custom completion and closed rich text must match their plain projection", () => {
  expect(formContentSchema.safeParse({ ...base(), completionPage: { mode: "custom", body: "완료", bodyRich: rich("다름") } }).success).toBe(false);
  expect(formContentSchema.safeParse({ ...base(), closedPage: { mode: "custom", body: "마감", bodyRich: rich("다름") } }).success).toBe(false);
});

test("omission preserves only current presentation while null explicitly removes it", () => {
  const first = randomUUID(), second = randomUUID();
  const current = formContentSchema.parse({ ...base([question(first), question(second)]), sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "둘째", body: "서식", bodyRich: rich("서식"), defaultDestination: { kind: "submit" }, allowBack: true },
  ], completionPage: { mode: "custom", body: "완료", bodyRich: rich("완료") }, closedPage: { mode: "default" } });
  const oldClient = formContentSchema.parse({ body: "안내",
    questions: current.questions.map(withoutPageId),
    consentRequired: true, consentPurpose: "검증", retentionDays: 30, maxResponses: 100 });
  const preserved = normalizeFormPresentation(oldClient, current);
  expect(preserved.sections).toEqual(current.sections);
  expect(preserved.questions.map(item => item.pageId)).toEqual([first, second]);
  expect(preserved.completionPage).toEqual(current.completionPage);
  expect(preserved.closedPage).toEqual(current.closedPage);

  const removed = normalizeFormPresentation({ ...current, sections: null, completionPage: null, closedPage: null });
  expect(removed).not.toHaveProperty("sections");
  expect(removed).not.toHaveProperty("completionPage");
  expect(removed).not.toHaveProperty("closedPage");
  expect(removed.questions.every(item => item.pageId === undefined)).toBe(true);
});

test("omitted rich content cannot silently follow changed section or completion text", () => {
  const first = randomUUID(), second = randomUUID();
  const current = formContentSchema.parse({ ...base([question(first), question(second)]), sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "둘째", body: "현재", bodyRich: rich("현재"), defaultDestination: { kind: "submit" }, allowBack: true },
  ], completionPage: { mode: "custom", body: "현재 완료", bodyRich: rich("현재 완료") } });
  const next = structuredClone(current);
  next.sections![1] = { ...next.sections![1], body: "변경", bodyRich: undefined };
  expect(() => normalizeFormPresentation(next, current)).toThrow(FormPresentationError);
  const completion = structuredClone(current);
  completion.completionPage = { mode: "custom", body: "변경" };
  expect(() => normalizeFormPresentation(completion, current)).toThrow(FormPresentationError);
});

test("whole-form rich budgets allow 100 images and reject the 101st or more than 512KiB", () => {
  const imageDocument = (count: number): RichDocumentV1 => ({ schemaVersion: 1,
    blocks: Array.from({ length: count }, () => ({ type: "image" as const, nodeId: randomUUID(), assetId: randomUUID(), alt: "" })) });
  const imageText = (count: number) => "\n".repeat(Math.max(0, count - 1));
  const pages = [randomUUID(), randomUUID(), randomUUID()];
  const imageContent = (completionImages: number) => ({
    body: imageText(32), bodyRich: imageDocument(32), questions: [question(pages[0])],
    sections: [
      { id: pages[0], title: "", body: "", defaultDestination: { kind: "page" as const, pageId: pages[1] }, allowBack: false },
      { id: pages[1], title: "둘째", body: imageText(32), bodyRich: imageDocument(32), defaultDestination: { kind: "page" as const, pageId: pages[2] }, allowBack: true },
      { id: pages[2], title: "셋째", body: imageText(32), bodyRich: imageDocument(32), defaultDestination: { kind: "submit" as const }, allowBack: true },
    ], completionPage: { mode: "custom" as const, body: imageText(completionImages), bodyRich: imageDocument(completionImages) },
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100,
  });
  expect(formContentSchema.safeParse(imageContent(4)).success).toBe(true);
  const tooMany = formContentSchema.safeParse(imageContent(5));
  expect(tooMany.success).toBe(false);
  if (!tooMany.success) expect(tooMany.error.issues.some(issue => issue.message.includes("100개"))).toBe(true);

  const text = "가".repeat(20_000), textDocument = rich(text);
  const textPages = Array.from({ length: 27 }, () => randomUUID());
  const oversized = formContentSchema.safeParse({
    body: text, bodyRich: textDocument, questions: [question(textPages[0])],
    sections: textPages.map((id, index) => index === 0
      ? { id, title: "", body: "", defaultDestination: { kind: "page", pageId: textPages[1] }, allowBack: false }
      : { id, title: `페이지 ${index + 1}`, body: text, bodyRich: textDocument,
        defaultDestination: index === textPages.length - 1 ? { kind: "submit" } : { kind: "page", pageId: textPages[index + 1] }, allowBack: true }),
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100,
  });
  expect(oversized.success).toBe(false);
  if (!oversized.success) expect(oversized.error.issues.some(issue => issue.message.includes("512KiB"))).toBe(true);
});
