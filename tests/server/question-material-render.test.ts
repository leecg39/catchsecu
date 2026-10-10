import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QuestionMaterials } from "@/components/forms/QuestionMaterials";
import { formLanguageCodes } from "@/contracts/form-language";
import { formSystemCopy } from "@/contracts/form-system-copy";
import { createQuestionMaterialLink } from "@/contracts/question-materials";
import type { Question } from "@/contracts/forms";

test("all sixteen new-tab and download labels match retained source translations", () => {
  const source = JSON.parse(readFileSync("docs/qa/R08-T02/question-metadata/reference-link/system-copy-source.json", "utf8")) as {
    leaves: { locale: string; key: string; value: string }[];
  };
  expect(source.leaves).toHaveLength(32);
  for (const locale of formLanguageCodes) for (const key of ["download", "openInNewTab"] as const)
    expect(formSystemCopy(locale).questionMaterial[key]).toBe(source.leaves.find(leaf => leaf.locale === locale && leaf.key.endsWith("." + key))?.value);
});
test("authored names remain literal and each translated link has secure new-tab attributes and exact original URL", () => {
  const name = '<script>window.bad=1</script> & "guide"';
  const item = createQuestionMaterialLink({ linkUrl: "HTTPS://Example.TEST:443/%7e?x=1&y=2", linkLabel: name });
  for (const language of formLanguageCodes) {
    const html = renderToStaticMarkup(createElement(QuestionMaterials, { question: { materialList: [item] }, language }));
    expect(html).toContain('href="HTTPS://Example.TEST:443/%7e?x=1&amp;y=2"');
    expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(formSystemCopy(language).questionMaterial.openInNewTab);
    expect(html).toContain("&lt;script&gt;window.bad=1&lt;/script&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain(" download=");
  }
});
test("unsafe persisted metadata is excluded at render time while a valid sibling remains clickable", () => {
  const valid = createQuestionMaterialLink({ linkUrl: "https://example.test/ok", linkLabel: "Valid" }, 1);
  const unsafe = { ...valid, orderNumber: 0, linkUrl: "javascript:alert(1)", linkLabel: "Unsafe" };
  const html = renderToStaticMarkup(createElement(QuestionMaterials, { question: { materialList: [unsafe, valid] } as Pick<Question, "materialList"> }));
  expect(html).not.toContain("javascript:"); expect(html).not.toContain("Unsafe"); expect(html).toContain("Valid");
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(renderToStaticMarkup(createElement(QuestionMaterials, { question: {} }))).toBe("");
});
