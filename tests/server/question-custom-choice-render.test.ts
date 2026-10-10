import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QuestionInput } from "@/components/forms/QuestionInput";
import { formPhrase } from "@/contracts/form-system-copy";
import { formLanguageCodes } from "@/contracts/form-language";
import type { Question } from "@/contracts/forms";
import type { AnswerValue } from "@/contracts/questions";

const customId = "20000000-0000-4000-8000-000000000002";
const definitions = [
  { id: "20000000-0000-4000-8000-000000000001", label: "기본 보기", value: "standard" },
  { id: customId, label: "기타 보기", value: "other-value", isCustomValue: true },
];
const base: Question = { id: "10000000-0000-4000-8000-000000000001", type: "객관식 답변", label: "선택", required: false,
  options: definitions.map(option => option.value), optionDefinitions: definitions };
const answer = (selectedValues = ["other-value"], text = '  <script>입력</script> & 값  ') =>
  ({ kind: "custom-choice", selectedValues, custom: { optionId: customId, text } }) as unknown as AnswerValue;
const render = (question: Question, value: AnswerValue, disabled = false, language: typeof formLanguageCodes[number] = "ko") =>
  renderToStaticMarkup(React.createElement(QuestionInput, { question, value, disabled, language, onChange: () => undefined }));

test.each(["객관식 답변", "체크박스", "드롭다운"] as const)("%s keeps a selected custom answer visible and requires its literal text even on an optional question", type => {
  const html = render({ ...base, type }, answer(type === "체크박스" ? ["standard", "other-value"] : ["other-value"]));
  expect(html).toContain('maxLength="100"');
  expect(html).toContain('aria-label="선택 · 기타 값을 입력해 주세요."');
  expect(html).toContain('>  &lt;script&gt;입력&lt;/script&gt; &amp; 값  </textarea>');
  expect(html).not.toContain("<script>");
  expect(html).toMatch(/<textarea[^>]*required=""[^>]*>  &lt;script&gt;/);
  if (type === "드롭다운") expect(html).toContain('<option value="other-value" selected="">');
  else expect(html).toMatch(/<input[^>]*checked=""[^>]*value="other-value"/);
});
test("ordinary and cleared choice values do not render a custom text field", () => {
  for (const [type, value] of [["객관식 답변", "standard"], ["드롭다운", ""], ["체크박스", []], ["체크박스", ["standard"]]] as const)
    expect(render({ ...base, type }, value as AnswerValue)).not.toContain('maxLength="100"');
});
test("disabled choice controls include custom text and use the existing sixteen source language prompts", () => {
  for (const language of formLanguageCodes) {
    const html = render(base, answer(), true, language);
    const field = html.match(/<textarea[^>]*maxLength="100"[^>]*>/)?.[0];
    expect(field, language).toBeDefined(); expect(field, language).toContain('disabled=""');
    const escaped = renderToStaticMarkup(React.createElement("span", null, formPhrase(language, "phrase16"))).replace(/^<span>|<\/span>$/g, "");
    expect(html, language).toContain(escaped);
    expect(html.match(/<input[^>]*type="radio"[^>]*>/g)?.every(input => input.includes('disabled=""')), language).toBe(true);
  }
});
test("custom text with stored line breaks remains visible in a multiline editing control", () => {
  expect(render(base, answer(["other-value"], "첫 줄\n둘째 줄"))).toContain('>첫 줄\n둘째 줄</textarea>');
});
