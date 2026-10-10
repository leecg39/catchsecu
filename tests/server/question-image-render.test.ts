import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthorAssetInfo } from "@/contracts/author-assets";
import type { Question } from "@/contracts/forms";
import { QuestionImage } from "@/components/forms/QuestionImage";
import { QuestionImageEditor } from "@/components/forms/QuestionImageEditor";
import { QuestionSummary } from "@/components/forms/QuestionSummary";
import { AuthorAssetProvider } from "@/components/forms/AuthorAssetProvider";
import type { AuthorAssetEditContext } from "@/components/forms/AuthorAssetUpload";
import { hasAuthorAssets, type AuthorAssetViewScope } from "@/lib/author-assets";
import { questionImageCopy } from "@/contracts/form-system-copy";
import { formLanguageCodes } from "@/contracts/form-language";
import { createQuestionMaterialLink } from "@/contracts/question-materials";

const resource = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock("@/lib/api", () => ({ useResource: resource.use, api: vi.fn(), errorText: (cause: Error) => cause.message }));
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image: AuthorAssetInfo = { id: id(90), purpose: "QUESTION_IMAGE", name: '<script>문항</script>.png', mime: "image/png", size: 512,
  sha256: "a".repeat(64), status: "ready", version: 3, expiresAt: null };
const question: Question = { id: id(1), type: "단문형 답변", label: "안내", required: false, questionImageKey: image.id, additionalExplanation: "평문 설명",
  materialList: [createQuestionMaterialLink({ linkLabel: "자료 링크", linkUrl: "https://example.test/guide" })] };
const context: AuthorAssetEditContext = { serviceId: id(50), capture: () => ({}), isCurrent: () => true, begin: () => () => {}, register: () => {} };
function render(node: ReactElement, scope: AuthorAssetViewScope | null = null, uploads: AuthorAssetInfo[] = [image]) {
  return renderToStaticMarkup(createElement(AuthorAssetProvider, { scope, enabled: !!scope, uploads }, node));
}
beforeEach(() => resource.use.mockReset().mockReturnValue({ loading: false, data: undefined, error: undefined }));

test("absent/null image keeps the legacy no-image output and does not enable a manifest by itself", () => {
  expect(render(createElement(QuestionImage, {}))).toBe("");
  expect(render(createElement(QuestionImage, { assetKey: null }))).toBe("");
  expect(hasAuthorAssets([{ questionImageKey: null }])).toBe(false);
  expect(hasAuthorAssets([{ questionImageKey: image.id }])).toBe(true);
});
test("question image is decorative and non-interactive even inside a disabled answer fieldset", () => {
  const html = render(createElement("fieldset", { disabled: true }, createElement(QuestionImage, { assetKey: image.id })));
  expect(html).toContain(`src="/api/v1/author-assets/uploads/${image.id}/download"`);
  expect(html).toContain('alt=""'); expect(html).toContain('draggable="false"'); expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).not.toContain("/_next/image"); expect(html).not.toMatch(/<(?:a|button)\b/); expect(html).not.toContain("<script>");
});
test.each([
  [{ kind: "form", id: id(2), version: 7 }, `/api/v1/author-assets/${image.id}/download?kind=form&amp;id=${id(2)}&amp;version=7`],
  [{ kind: "template", id: id(3), version: 2 }, `/api/v1/author-assets/${image.id}/download?kind=template&amp;id=${id(3)}&amp;version=2`],
  [{ kind: "approval", id: id(4) }, `/api/v1/author-assets/${image.id}/download?kind=approval&amp;id=${id(4)}`],
  [{ kind: "submission", id: id(5) }, `/api/v1/author-assets/${image.id}/download?kind=submission&amp;id=${id(5)}`],
  [{ kind: "public", token: "public-token" }, `/api/v1/public/forms/public-token/author-assets/${image.id}/download?surface=active`],
  [{ kind: "viewer", submissionId: id(6) }, `/api/v1/viewer/author-assets/${image.id}/download?submissionId=${id(6)}`],
] as const)("saved question image keeps its authorized %j scope", (scope, url) => {
  resource.use.mockReturnValue({ loading: false, data: { items: [image] } });
  const html = render(createElement(QuestionImage, { assetKey: image.id }), scope, []);
  expect(html).toContain(`src="${url}"`); expect(html).not.toContain("/uploads/");
});
test("wrong-purpose, rejected, missing and unsupported-mime assets render a generic localized failure without exposing metadata", () => {
  for (const asset of [{ ...image, purpose: "OPTION_IMAGE" as const }, { ...image, status: "rejected" as const }, { ...image, mime: "application/pdf" as const }]) {
    const html = render(createElement(QuestionImage, { assetKey: image.id, language: "en" }), null, [asset]);
    expect(html).toContain(questionImageCopy("en").unavailable); expect(html).not.toContain("<img"); expect(html).not.toContain("script");
  }
  resource.use.mockReturnValue({ loading: false, error: { message: "private internal failure" } });
  const html = render(createElement(QuestionImage, { assetKey: image.id, language: "en" }), null, []);
  expect(html).toContain(questionImageCopy("en").unavailable); expect(html).not.toContain("private internal failure");
});
test("all sixteen local loading/failure messages are available without changing retained source copy", () => {
  for (const language of formLanguageCodes) {
    const copy = questionImageCopy(language);
    expect(copy.loading).not.toBe(""); expect(copy.unavailable).not.toBe("");
    const escaped = (text: string) => renderToStaticMarkup(createElement("span", null, text)).replace(/^<span>|<\/span>$/g, "");
    resource.use.mockReturnValue({ loading: true });
    expect(render(createElement(QuestionImage, { assetKey: image.id, language }), null, [])).toContain(escaped(copy.loading));
    resource.use.mockReturnValue({ loading: false });
    expect(render(createElement(QuestionImage, { assetKey: image.id, language }), null, [])).toContain(escaped(copy.unavailable));
    if (language !== "ko") expect(copy.unavailable).not.toMatch(/[가-힣]/);
  }
});
test("summary places the question image before materials and plain explanation", () => {
  const html = render(createElement(QuestionSummary, { question, questions: [question], language: "en" }));
  expect(html.indexOf("forms-question-image")).toBeLessThan(html.indexOf("forms-question-materials"));
  expect(html.indexOf("forms-question-materials")).toBeLessThan(html.indexOf("forms-question-explanation"));
});
test("image editor presents one slot with replace/remove while every mutation obeys read-only", () => {
  const html = render(createElement(QuestionImageEditor, { question, index: 0, disabled: true, context, onChange: () => {} }));
  expect(html).toContain('aria-label="Q1 문항 이미지 사용"'); expect(html).toContain("1 / 1");
  expect(html).toContain('aria-label="Q1 문항 설명 이미지 교체"'); expect(html).toContain("JPG·JPEG·PNG · 이미지당 최대 1 MiB");
  expect(html).toContain("&lt;script&gt;문항&lt;/script&gt;.png");
  for (const tag of html.match(/<(?:input|button)\b[^>]*>/g) ?? []) expect(tag).toContain('disabled=""');
});
test("no-image editor begins off with zero count and does not expose an upload until enabled", () => {
  const html = render(createElement(QuestionImageEditor, { question: { ...question, questionImageKey: null }, index: 0, disabled: false, context, onChange: () => {} }));
  expect(html).toContain("0 / 1"); expect(html).not.toContain('checked=""'); expect(html).not.toContain('type="file"');
});
