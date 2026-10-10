import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { QuestionInput } from "@/components/forms/QuestionInput";
import { QuestionOptions } from "@/components/forms/QuestionOptions";
import { QuestionMaterialsEditor } from "@/components/forms/QuestionMaterialsEditor";
import { AuthorAssetProvider } from "@/components/forms/AuthorAssetProvider";
import type { AuthorAssetEditContext } from "@/components/forms/AuthorAssetUpload";
import { createQuestionMaterialFile, createQuestionMaterialLink } from "@/contracts/question-materials";
import type { AuthorAssetInfo } from "@/contracts/author-assets";
import { formSystemCopy } from "@/contracts/form-system-copy";
import { formLanguageCodes } from "@/contracts/form-language";
import type { Question } from "@/contracts/forms";

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image: AuthorAssetInfo = { id: id(90), name: '<script>사진</script>.png', purpose: "OPTION_IMAGE", mime: "image/png", size: 32,
  sha256: "a".repeat(64), status: "ready", version: 3, expiresAt: null };
const document: AuthorAssetInfo = { ...image, id: id(91), name: "참고 안내.pdf", purpose: "QUESTION_MATERIAL", mime: "application/pdf", size: 1024 };
const question: Question = { id: id(1), type: "체크박스", label: "사진 선택", required: true,
  options: ["a", "b"], optionDefinitions: [{ id: id(2), value: "a", label: "A <script>alert(1)</script>", optionImageKey: image.id }, { id: id(3), value: "b", label: "B" }] };
const context: AuthorAssetEditContext = { serviceId: id(50), capture: () => ({}), isCurrent: () => true, begin: () => () => {}, register: () => {} };
function render(node: ReactElement, uploads = [image, document]) {
  return renderToStaticMarkup(createElement(AuthorAssetProvider, { scope: null, enabled: false, uploads }, node));
}
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}

test("three mixed materials show filename and reject further additions while preserving replace/reorder controls", () => {
  const materialList = [createQuestionMaterialLink({ linkUrl: "https://example.test/first", linkLabel: "첫 링크" }), createQuestionMaterialFile(document.id, 1), createQuestionMaterialLink({ linkUrl: "https://example.test/last" }, 2)];
  const html = render(createElement(QuestionMaterialsEditor, { question: { ...question, materialList }, index: 0, disabled: false, context, onChange: () => {} }));
  expect(html).toContain("참고 안내.pdf"); expect(html).toContain("1 KB"); expect(html).toContain("첫 링크"); expect(html).toContain("파일과 링크를 합해");
  expect(html).toMatch(/aria-label="Q1 참고 링크 추가" disabled=""/);
  expect(html).toMatch(/aria-label="Q1 참고 파일 추가"[^>]*disabled=""/);
  expect(html.match(/aria-label="Q1 참고 자료 [123] 파일로 교체"/g)).toHaveLength(3);
  expect(html).toContain("PDF·DOCX·AI · 파일당 최대 5 MiB");
});
test.each(["객관식 답변", "체크박스"] as const)("%s images are limited to twenty ordinary options, and existing image replacement remains available", type => {
  const definitions = Array.from({ length: 21 }, (_, n) => ({ id: id(n + 2), value: `option-${n}`, label: `보기 ${n}`, ...(n < 20 ? { optionImageKey: image.id } : {}) }));
  const q = { ...question, type, optionDefinitions: [...definitions, { id: id(25), value: "other", label: "기타", isCustomValue: true }] };
  const html = render(createElement(QuestionOptions, { question: q, index: 0, questions: [q], disabled: false, assetContext: context, change: () => {} }));
  expect(html).toContain("20 / 20"); expect(html).toMatch(/aria-label="Q1 보기 21 이미지 추가"[^>]*disabled=""/);
  expect(html).toMatch(/aria-label="Q1 보기 1 이미지 교체"[^>]*accept="image\/jpeg,image\/png"\/?>/);
  expect(html).not.toContain('aria-label="Q1 보기 22 이미지');
});
test.each(["드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"] as const)("%s has no image uploader even for legacy/invalid image metadata", type => {
  const q = { ...question, type }, html = render(createElement(QuestionOptions, { question: q, index: 0, questions: [q], assetContext: context, change: () => {} }));
  expect(html).not.toContain("답변별 이미지 사용"); expect(html).not.toContain('type="file"');
});
test("parent read-only state disables every material mutation and upload control", () => {
  const html = render(createElement(QuestionMaterialsEditor, { question: { ...question, materialList: [createQuestionMaterialFile(document.id)] }, index: 0, disabled: true, context, onChange: () => {} }));
  for (const tag of html.match(/<(?:button|input)\b[^>]*>/g) ?? []) expect(tag).toContain('disabled=""');
});
test("public images use 72px safe scoped URLs, reserve missing slots, and separate zoom from selection labels", () => {
  const html = render(createElement("fieldset", { disabled: true }, createElement(QuestionInput, { question, value: ["a"], disabled: true, onChange: () => {} })));
  expect(html).toContain(`href="/api/v1/author-assets/uploads/${image.id}/download"`); expect(html).toContain('width="72" height="72"');
  expect(html).toContain('class="forms-option-image-slot"'); expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).toContain('A &lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain("<script>");
  expect(html).not.toMatch(/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*class="forms-option-image"/);
  expect(html).toMatch(/<a[^>]*role="button"/); expect(html).not.toMatch(/<a[^>]*disabled=/);
});
test("all sixteen public zoom labels come from retained source copy", () => {
  for (const language of formLanguageCodes) {
    const html = render(createElement(QuestionInput, { question, language, value: [], onChange: () => {} }));
    const expected = renderToStaticMarkup(createElement("span", null, formSystemCopy(language).optionImage.zoomTitle)).replace(/^<span>|<\/span>$/g, "");
    expect(html).toContain(expected);
  }
});
test("custom-choice branch still displays ordinary images but never renders a custom-option image", () => {
  const q = { ...question, optionDefinitions: [...question.optionDefinitions!, { id: id(4), value: "other", label: "기타", isCustomValue: true, optionImageKey: id(99) }] };
  const html = render(createElement(QuestionInput, { question: q, value: "a", onChange: () => {} }));
  expect(html).toContain(`/uploads/${image.id}/download`); expect(html).not.toContain(`/uploads/${id(99)}/download`);
  expect(html.match(/class="forms-option-image"/g)).toHaveLength(1);
});
test("disabled ordinary inputs do not emit changes while enabled checkbox selection keeps its value contract", () => {
  const changed = vi.fn(), inputs = (disabled: boolean) => descendants(QuestionInput({ question, value: ["b"], disabled, onChange: changed })).filter(element => element.type === "input");
  (inputs(true)[0].props.onChange as (event: unknown) => void)({ target: { checked: true } }); expect(changed).not.toHaveBeenCalled();
  (inputs(false)[0].props.onChange as (event: unknown) => void)({ target: { checked: true } }); expect(changed).toHaveBeenCalledWith(["b", "a"]);
});
