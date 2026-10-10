import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import copy from "@/data/form-system-copy.json";
import { formLanguageCodes } from "@/contracts/form-language";
import { formCopyText, formPhrase, formPrivacyPolicyLabel, formRequiredLabel, formSelectionText } from "@/contracts/form-system-copy";
import { ForeignAddressInput } from "@/components/forms/AddressQuestionInput";
import { QuestionInput } from "@/components/forms/QuestionInput";
import { ConsentDisplay, ConsentDocuments } from "@/components/forms/ConsentDocuments";
import type { Question } from "@/contracts/forms";
import type { ConsentDisplaySnapshot, FormConsentBundle } from "@/contracts/form-documents";

const evidenceDirectory = "docs/qa/R08-T02/international-contact/";
const get = (object: unknown, key: string): unknown => key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], object);
type ElementProps = { children?: ReactNode; onChange?: (event: { target: { value: string } }) => void; ref?: (element: { setCustomValidity: (message: string) => void }) => void };
function elements(node: ReactNode, type: string): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement<ElementProps>(node)) return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children, type)];
}
const question: Question = { id: "81e24bc3-7b11-43bc-924d-4fe726f97604", type: "해외 주소", label: "Author address", required: true };

test("all 1552 original leaves are unchanged and 400 added leaves match the 16 retained source locales", () => {
  const old = JSON.parse(readFileSync(evidenceDirectory + "system-copy-source.json", "utf8")) as { leafEvidence: { locale: keyof typeof copy; key: string; value: string }[] };
  expect(old.leafEvidence).toHaveLength(1552);
  for (const leaf of old.leafEvidence) expect(get(copy[leaf.locale].translate, leaf.key), leaf.locale + ":" + leaf.key).toBe(leaf.value);
  const source = JSON.parse(readFileSync(evidenceDirectory + "remaining-localization-plan.json", "utf8")) as { sourceKeys: { key: string; values: Record<string, string> }[] };
  const added = source.sourceKeys.filter(item => item.key.startsWith("infoOwnerForm.internationalAddress.") || item.key.startsWith("infoOwnerForm.selectLimit.") || item.key === "spreadConsent.phrase4");
  expect(added).toHaveLength(25);
  for (const locale of formLanguageCodes) for (const item of added) expect(get(copy[locale].translate, item.key), locale + ":" + item.key).toBe(item.values[locale]);
});

test("source markers are plain line breaks and authored interpolation is neither HTML nor recursively substituted", () => {
  const row = '<0>Authored {{count}} $& <script>alert("x")</script>';
  const text = formCopyText("<0/>{{row}} · {{count}} · {{missing}}", { row, count: 2 });
  expect(text).toBe("\n" + row + " · 2 · {{missing}}");
  expect(renderToStaticMarkup(createElement("p", null, text))).not.toContain("<script>");
  expect(formPhrase("ja", "phrase79")).toContain("\n");
  for (const locale of formLanguageCodes) {
    expect(formSelectionText(locale, "errorExactMatrix", { row: "Author row", count: 3 })).toContain("Author row");
    expect(formSelectionText(locale, "exact", { count: 3 })).not.toContain("{{count}}");
    expect(formRequiredLabel(locale, true)).toBe(copy[locale].translate.formConsentView.essential);
    expect(formRequiredLabel(locale, false)).toBe(copy[locale].translate.formConsentView.select);
    expect(formPrivacyPolicyLabel(locale)).toBe(copy[locale].translate.spreadConsent.phrase4);
  }
});

test("foreign address changes display names without changing canonical Korean countryName or authored address values", () => {
  const value = { country: "US", countryName: "미국", streetAddress: "10 Author Road", addressDetail: "Apt 2", city: "Author city", state: "CA", postalCode: "12345" };
  const original = structuredClone(value), changed = vi.fn();
  const tree = ForeignAddressInput({ question, value, onChange: changed, language: "en" });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('value="US" selected=""');
  expect(html).toContain("United States");
  expect(html).toContain(copy.en.translate.infoOwnerForm.internationalAddress.streetAddress);
  expect(html).toContain('maxLength="255"');
  expect(html).toContain('maxLength="20"');
  expect(value).toEqual(original);
  elements(tree, "select")[0].props.onChange!({ target: { value: "CA" } });
  expect(changed).toHaveBeenCalledWith({ ...value, country: "CA", countryName: "캐나다" });
  const arabic = renderToStaticMarkup(createElement(ForeignAddressInput, { question, value, onChange: changed, language: "ar" }));
  expect(arabic).toContain('lang="ar" dir="rtl"');
  expect(arabic).toContain("10 Author Road");
});

test("dropdown and exact matrix keep option values and authored row labels while localizing placeholders and validity", () => {
  const authoredOptions = { options: ["Author A", "Author B"], optionDefinitions: [
    { id: "c3ef6d89-18ba-496d-aa8e-6163581e3301", value: "a", label: "Author A" },
    { id: "c3ef6d89-18ba-496d-aa8e-6163581e3302", value: "b", label: "Author B" },
  ] };
  const dropdown: Question = { ...question, ...authoredOptions, type: "드롭다운" };
  const html = renderToStaticMarkup(createElement(QuestionInput, { question: dropdown, value: "b", onChange: vi.fn(), language: "en" }));
  expect(html).toContain(formPhrase("en", "phrase38"));
  expect(html).toContain('value="b" selected=""');
  expect(html).toContain("Author B");
  const row = { id: "c3ef6d89-18ba-496d-aa8e-6163581e3303", label: "Authored <0> row" };
  const matrix: Question = { ...question, ...authoredOptions, type: "행렬형 복수 선택", required: false, rows: [row], selectionLimits: { mode: "exact", min: 2, max: 2 } };
  const tree = QuestionInput({ question: matrix, value: { [row.id]: ["a"] }, onChange: vi.fn(), language: "en" });
  const validity = vi.fn();
  elements(tree, "input")[0].props.ref!({ setCustomValidity: validity });
  expect(validity).toHaveBeenCalledWith(formSelectionText("en", "errorExactOptionalMatrix", { row: row.label, count: 2 }));
  expect(renderToStaticMarkup(tree)).toContain("Please select 2 in each row");
  const empty = QuestionInput({ question: matrix, value: {}, onChange: vi.fn(), language: "en" });
  validity.mockClear(); elements(empty, "input")[0].props.ref!({ setCustomValidity: validity });
  expect(validity).toHaveBeenCalledWith("");
});

test("arbitrary minimum ranges retain their complete local message rather than misreporting a max-only rule", () => {
  const q: Question = { ...question, type: "체크박스", options: ["A", "B", "C"], selectionLimits: { min: 2, max: 3 } };
  const html = renderToStaticMarkup(createElement(QuestionInput, { question: q, value: [], onChange: vi.fn(), language: "en" }));
  expect(html).toContain("최소 2개 · 최대 3개 선택");
  const maxOnly = renderToStaticMarkup(createElement(QuestionInput, { question: { ...q, selectionLimits: { max: 3 } }, value: [], onChange: vi.fn(), language: "en" }));
  expect(maxOnly).toContain("Select up to 3");
});

test("consent labels localize while document text, keys, versions, links and hashes remain unchanged", () => {
  const display: ConsentDisplaySnapshot = { schemaVersion: 1, kind: "collection", version: 1, name: "Author company", startText: "Authored start", processorText: "", policyText: "", requiredText: "Authored required", optionalText: "Authored optional", policy: { kind: "external", url: "https://example.test/policy" } };
  const bundle: FormConsentBundle = { display, documents: [{ key: "76e24bc3-7b11-43bc-924d-4fe726f97604", required: true, kind: "collection", title: "Author title", type: "consent", number: 2, contentHash: "same-hash", renderedText: "법적 원문 그대로", display }] };
  const original = structuredClone(bundle);
  const html = renderToStaticMarkup(createElement(ConsentDocuments, { bundle, selectable: true, language: "en" }));
  expect(html).toContain("Privacy Policy"); expect(html).toContain(formRequiredLabel("en", true));
  expect(html).toContain('name="documentConsents"'); expect(html).toContain(bundle.documents[0].key);
  expect(html).toContain("법적 원문 그대로"); expect(html).toContain("same-hash"); expect(html).toContain("Author title");
  expect(bundle).toEqual(original);
  expect(renderToStaticMarkup(createElement(ConsentDisplay, { display }))).toContain("개인정보처리방침");
});
