import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QuestionPersonalInformation } from "@/components/forms/QuestionPersonalInformation";
import { ConsentItems } from "@/components/forms/ConsentDocuments";
import type { Question } from "@/contracts/forms";

const base: Question = { id: "10000000-0000-4000-8000-000000000001", type: "단문형 답변", label: "확인", required: false };
test("unset and explicitly cleared classifications produce no admin summary", () => {
  expect(renderToStaticMarkup(React.createElement(QuestionPersonalInformation, { question: base }))).toBe("");
  expect(renderToStaticMarkup(React.createElement(QuestionPersonalInformation, { question: { ...base, catchFormPersonalInformationRequests: [] } }))).toBe("");
});
test("manual names keep whitespace and are escaped text while NONE carries only its classification", () => {
  const html = renderToStaticMarkup(React.createElement(QuestionPersonalInformation, { question: { ...base, catchFormPersonalInformationRequests: [
    { nlpFeedbackId: null, personalInformationSource: "USER", personalInformationType: "SENSITIVE", detectedPersonalInformation: "  <script>window.__qaPi=1</script> & 항목  " },
    { nlpFeedbackId: null, personalInformationSource: "USER", personalInformationType: "NON_PERSONAL_INFORMATION", detectedPersonalInformation: "" },
  ] } }));
  expect(html).toContain('aria-label="수동 개인정보 분류"'); expect(html).toContain("민감정보"); expect(html).toContain("개인정보 없음");
  expect(html).toContain("  &lt;script&gt;window.__qaPi=1&lt;/script&gt; &amp; 항목  "); expect(html).not.toContain("<script>");
  expect(html.match(/forms-personal-information-name/g)).toHaveLength(1); expect(html).not.toContain("자동 분석");
});

test("derived consent items keep duplicates and escape names without creating executable markup", () => {
  const html = renderToStaticMarkup(React.createElement(ConsentItems, { items: [
    { type: "SENSITIVE", name: "<script>window.__qaConsent=1</script> & 건강" },
    { type: "SENSITIVE", name: "<script>window.__qaConsent=1</script> & 건강" },
  ] }));
  expect(html).toContain('aria-label="동의서 자동 집계 항목"');
  expect(html.match(/민감정보/g)).toHaveLength(2);
  expect(html.match(/&lt;script&gt;window.__qaConsent=1&lt;\/script&gt; &amp; 건강/g)).toHaveLength(2);
  expect(html).not.toContain("<script>");
});
