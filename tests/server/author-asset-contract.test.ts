import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import { questionSchema, validateQuestionDefinitions, type QuestionDefinition } from "@/contracts/questions";
import { questionMaterialsSchema, normalizeQuestionMaterials } from "@/contracts/question-materials";
import { normalizeQuestionOptions } from "@/contracts/option-identities";
import { cloneFormContent } from "@/contracts/form-copy";
import { formContentSchema } from "@/contracts/domains";

// Call only the existing contracts so the initial RED demonstrates missing behavior,
// rather than a missing import. Asset ownership and scanning are separate DB tests.
const material = (orderNumber = 0, fileKey = randomUUID()) => ({ materialType: "FILE", orderNumber, fileKey, linkLabel: null, linkUrl: null });
const link = (orderNumber: number) => ({ materialType: "LINK", orderNumber, fileKey: null, linkLabel: "설명", linkUrl: "https://example.test/help" });
function rawQuestion(count = 2) {
  const optionDefinitions = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), value: `v${index}`, label: `보기 ${index + 1}`, optionImageKey: randomUUID() }));
  return { id: randomUUID(), type: "객관식 답변", label: "선택", required: false,
    options: optionDefinitions.map(option => option.value), optionDefinitions };
}
const question = (value: unknown) => questionSchema.parse(value);
const checked = (value: unknown) => { const parsed = question(value); validateQuestionDefinitions([parsed]); return parsed; };
const imageKeys = (q: QuestionDefinition) => q.optionDefinitions?.map(option => (option as unknown as { optionImageKey?: string | null }).optionImageKey);

test("FILE has the observed strict five-field wire and supports mixed FILE/LINK order", () => {
  const values = [material(0), link(1), material(2)];
  expect(questionMaterialsSchema.parse(values)).toEqual(values);
  expect(() => z.toJSONSchema(questionMaterialsSchema)).not.toThrow();
});
test("the shared three-material limit and contiguous order apply to both kinds", () => {
  expect(questionMaterialsSchema.parse([material(), material(1), link(2)])).toHaveLength(3);
  for (const values of [[material(0), link(1), material(2), link(3)], [material(1)], [material(0), link(0)], [link(0), material(2)]])
    expect(() => questionMaterialsSchema.parse(values)).toThrow();
});
test("FILE rejects client URLs, display metadata, non-null link fields and unissued key shapes", () => {
  for (const item of [{ ...material(), fileKey: null }, { ...material(), fileKey: "https://example.test/a.pdf" },
    { ...material(), fileKey: "../private" }, { ...material(), fileKey: "" }, { ...material(), linkLabel: "name" },
    { ...material(), linkUrl: "https://example.test/file" }, { ...material(), fileName: "name.pdf" },
    { ...material(), fileUrl: "https://example.test/file" }, { ...material(), blobId: randomUUID() }])
    expect(() => questionMaterialsSchema.parse([item])).toThrow();
});
test("material omission preserves only the current logical question and explicit empty deletes", () => {
  const current = question({ ...rawQuestion(0), type: "단문형 답변", materialList: [material()] });
  const { materialList: _old, ...omitted } = current; void _old;
  expect(normalizeQuestionMaterials([omitted], [current])[0]).toHaveProperty("materialList", current.materialList);
  expect(normalizeQuestionMaterials([{ ...omitted, materialList: [] }], [current])[0]).not.toHaveProperty("materialList");
  expect(normalizeQuestionMaterials([{ ...omitted, id: randomUUID() }], [current])[0]).not.toHaveProperty("materialList");
});
test("ordinary radio and checkbox accept exactly twenty single image keys", () => {
  for (const type of ["객관식 답변", "체크박스"]) {
    const raw = { ...rawQuestion(20), type }, parsed = checked(raw);
    expect(imageKeys(parsed)).toEqual(raw.optionDefinitions.map(option => option.optionImageKey));
  }
});
test("twenty images may coexist with additional plain options but a twenty-first is rejected", () => {
  const raw = rawQuestion(21);
  expect(() => checked(raw)).toThrow();
  const optionDefinitions = raw.optionDefinitions.map((option, index) => ({ ...option, optionImageKey: index === 20 ? null : option.optionImageKey }));
  expect(checked({ ...raw, optionDefinitions }).optionDefinitions).toHaveLength(21);
});
test("only the precise optionImageKey field is accepted; URLs and storage metadata are not", () => {
  const raw = rawQuestion(1), option = raw.optionDefinitions[0];
  for (const patch of [{ optionImageKey: "https://example.test/image.png" }, { optionImageKey: "" },
    { optionImageKey: 2 }, { imageFileKey: randomUUID() }, { optionImageUrl: "https://example.test/image.png" },
    { optionImageFileSize: 1 }, { optionImageUploadToken: randomUUID() }])
    expect(() => checked({ ...raw, optionDefinitions: [{ ...option, ...patch }] })).toThrow();
});
test("dropdown, matrices and custom options cannot carry image keys", () => {
  const raw = rawQuestion(1);
  for (const type of ["드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"])
    expect(() => checked({ ...raw, type, ...(type.startsWith("행렬") ? { rows: [{ id: randomUUID(), label: "행" }] } : {}) })).toThrow();
  expect(() => checked({ ...raw, optionDefinitions: [{ ...raw.optionDefinitions[0], isCustomValue: true }] })).toThrow();
});
test("omitted image keys inherit current exact option identities, including legacy string clients", () => {
  const current = question(rawQuestion()), input = structuredClone(current);
  input.optionDefinitions = input.optionDefinitions!.map(({ id, label, value }) => ({ id, label, value }));
  expect(imageKeys(normalizeQuestionOptions([input], [current])[0])).toEqual(imageKeys(current));
  delete input.optionDefinitions;
  expect(imageKeys(normalizeQuestionOptions([input], [current])[0])).toEqual(imageKeys(current));
});
test("explicit null clears an image without changing option identity, value or label", () => {
  const raw = rawQuestion(1), current = question(raw);
  const cleared = question({ ...raw, optionDefinitions: [{ ...raw.optionDefinitions[0], optionImageKey: null }] });
  const result = normalizeQuestionOptions([cleared], [current])[0].optionDefinitions![0];
  expect(result).toEqual({ id: raw.optionDefinitions[0].id, value: "v0", label: "보기 1" });
});
test("history validates identity ownership but never restores an already removed image", () => {
  const old = question(rawQuestion(1)), current = structuredClone(old);
  current.optionDefinitions = current.optionDefinitions!.map(({ id, label, value }) => ({ id, label, value }));
  const result = normalizeQuestionOptions([structuredClone(current)], [old, current], undefined, [current])[0];
  expect(imageKeys(result)).toEqual([undefined]);
});
test("new option identities do not inherit the replaced option's image", () => {
  const old = question(rawQuestion(1));
  const next = { ...old, optionDefinitions: [{ id: randomUUID(), label: "새 보기", value: "v0" }] };
  expect(imageKeys(normalizeQuestionOptions([next], [old])[0])).toEqual([undefined]);
});
test("type or custom transitions cannot silently drop a current image through omission", () => {
  // Prior is deliberately passed through the existing identity API, without a new helper.
  const raw = rawQuestion(1), current = raw as unknown as QuestionDefinition;
  const plain = { ...raw.optionDefinitions[0] } as Record<string, unknown>; delete plain.optionImageKey;
  const unsupported = { ...raw, type: "드롭다운", optionDefinitions: [plain] };
  expect(() => normalizeQuestionOptions([question(unsupported)], [current])).toThrow();
  const custom = { ...raw, optionDefinitions: [{ ...plain, isCustomValue: true }] };
  expect(() => normalizeQuestionOptions([question(custom)], [current])).toThrow();
  const { options: _options, optionDefinitions: _definitions, ...withoutOptions } = raw; void _options; void _definitions;
  expect(() => normalizeQuestionOptions([question({ ...withoutOptions, type: "단문형 답변" })], [current])).toThrow();
});
test("explicit removal permits a type transition and old plain options remain byte-compatible", () => {
  const raw = rawQuestion(1), current = raw as unknown as QuestionDefinition;
  const next = question({ ...raw, type: "드롭다운", optionDefinitions: [{ ...raw.optionDefinitions[0], optionImageKey: null }] });
  expect(imageKeys(normalizeQuestionOptions([next], [current])[0])).toEqual([undefined]);
  const plain = question({ ...raw, optionDefinitions: raw.optionDefinitions.map(({ id, label, value }) => ({ id, label, value })) });
  expect(JSON.stringify(normalizeQuestionOptions([plain]))).toBe(JSON.stringify([plain]));
});
test("structural clone retains asset references for an authorized server-side key remap", () => {
  const original = formContentSchema.parse({ body: "안내", questions: [{ ...rawQuestion(), materialList: [material()] }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const copied = cloneFormContent(original);
  expect(copied.questions[0].id).not.toBe(original.questions[0].id);
  expect(copied.questions[0].optionDefinitions!.map(option => option.id)).not.toEqual(original.questions[0].optionDefinitions!.map(option => option.id));
  expect(imageKeys(copied.questions[0])).toEqual(imageKeys(original.questions[0]));
  expect(copied.questions[0].materialList).toEqual(original.questions[0].materialList);
  expect(() => z.toJSONSchema(formContentSchema)).not.toThrow();
});
