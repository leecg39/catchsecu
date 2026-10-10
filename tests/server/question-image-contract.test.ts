import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import { questionSchema, questionTypes, validateQuestionDefinitions } from "@/contracts/questions";
import { authorAssetUploadInput } from "@/contracts/author-assets";
import { cloneFormContent } from "@/contracts/form-copy";
import { formContentSchema } from "@/contracts/domains";
import { normalizeQuestionImages } from "@/contracts/question-images";

const question = () => ({ id: randomUUID(), type: "단문형 답변", label: "설명 그림", required: false });
const upload = () => ({ serviceId: randomUUID(), purpose: "QUESTION_IMAGE", name: "image.png", mime: "image/png", size: 1024 * 1024, sha256: "0".repeat(64) });

test("questionImageKey is a separate single owned image and coexists with literal explanation", () => {
  const value = { ...question(), questionImageKey: randomUUID(), additionalExplanation: "그림 아래 설명" };
  expect(questionSchema.parse(value)).toEqual(value);
});
test("omitted legacy question images remain absent in serialization", () => {
  const old = question();
  expect(JSON.stringify(questionSchema.parse(old))).toBe(JSON.stringify(old));
});
test("explicit null is an accepted deletion command", () => {
  const value = { ...question(), questionImageKey: null };
  expect(questionSchema.parse(value)).toEqual(value);
});
test("all currently supported question types allow the independent question image", () => {
  for (const type of questionTypes) {
    const value = questionSchema.parse({ ...question(), type, questionImageKey: randomUUID(),
      ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "행" }] } : {}) });
    expect(() => validateQuestionDefinitions([value])).not.toThrow();
  }
});
test("one question image can coexist with an option image and a FILE material", () => {
  const value = { ...question(), type: "객관식 답변", questionImageKey: randomUUID(), options: ["A"],
    optionDefinitions: [{ id: randomUUID(), value: "A", label: "A", optionImageKey: randomUUID() }],
    materialList: [{ materialType: "FILE", fileKey: randomUUID(), orderNumber: 0, linkLabel: null, linkUrl: null }] };
  expect(questionSchema.parse(value)).toEqual(value);
});
test("question image rejects remote URLs, paths, arrays, empty and non-string keys", () => {
  for (const key of ["https://example.test/a.png", "../image.png", "", [randomUUID()], 1, {}])
    expect(() => questionSchema.parse({ ...question(), questionImageKey: key })).toThrow();
});
test("question image clients cannot supply URL, size or storage metadata", () => {
  for (const patch of [{ questionImageUrl: "https://example.test/a.png" }, { imageUrl: "https://example.test/a.png" },
    { questionImageFileSize: 10 }, { questionImageStorageKey: randomUUID() }])
    expect(() => questionSchema.parse({ ...question(), questionImageKey: randomUUID(), ...patch })).toThrow();
});
test("QUESTION_IMAGE uploads accept a PNG exactly at the observed 1 MiB boundary", () => {
  const value = upload();
  expect(authorAssetUploadInput.parse(value)).toEqual(value);
});
test("QUESTION_IMAGE uploads accept jpg and jpeg with image/jpeg", () => {
  for (const name of ["image.jpg", "IMAGE.JPEG"])
    expect(authorAssetUploadInput.parse({ ...upload(), name, mime: "image/jpeg" })).toHaveProperty("mime", "image/jpeg");
});
test("QUESTION_IMAGE rejects over-limit bytes and non-positive sizes", () => {
  for (const size of [0, -1, 1048577]) expect(() => authorAssetUploadInput.parse({ ...upload(), size })).toThrow();
});
test("QUESTION_IMAGE rejects PDF, SVG, GIF, WebP and spoofed image MIME", () => {
  for (const [name, mime] of [["a.pdf", "application/pdf"], ["a.svg", "image/svg+xml"], ["a.gif", "image/gif"],
    ["a.webp", "image/webp"], ["a.png", "image/jpeg"], ["a.jpg", "image/png"]])
    expect(() => authorAssetUploadInput.parse({ ...upload(), name, mime })).toThrow();
});
test("structural form copy preserves the image key for the authorized server ownership remap", () => {
  const key = randomUUID(), original = formContentSchema.parse({ body: "원본 본문", questions: [{ ...question(), questionImageKey: key }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const copy = cloneFormContent(original);
  expect(copy.questions[0].id).not.toBe(original.questions[0].id);
  expect(copy.questions[0]).toHaveProperty("questionImageKey", key);
});
test("the generated form API schema exposes the strict optional question image key", () => {
  const schema = z.toJSONSchema(formContentSchema);
  expect(JSON.stringify(schema)).toContain('"questionImageKey"');
  expect(JSON.stringify(schema)).not.toContain('"questionImageUrl"');
});
test("omission inherits only the current logical question and survives general type changes", () => {
  const plain = question(), key = randomUUID(), current = { ...plain, questionImageKey: key };
  expect(normalizeQuestionImages([{ ...plain, type: "이메일" }], [current])[0]).toHaveProperty("questionImageKey", key);
  expect(normalizeQuestionImages([{ ...plain, id: randomUUID() }], [current])[0]).not.toHaveProperty("questionImageKey");
});
test("explicit deletion and a following old-client save do not revive the image", () => {
  const plain = question(), current = { ...plain, questionImageKey: randomUUID() };
  const cleared = normalizeQuestionImages([{ ...plain, questionImageKey: null }], [current]);
  expect(cleared[0]).not.toHaveProperty("questionImageKey");
  expect(normalizeQuestionImages([plain], cleared)[0]).not.toHaveProperty("questionImageKey");
});
test("normalization preserves legacy JSON and never edits its inputs", () => {
  const old = [question()], snapshot = structuredClone(old);
  expect(JSON.stringify(normalizeQuestionImages(old))).toBe(JSON.stringify(old));
  expect(old).toEqual(snapshot);
});
test("normalization rejects invalid explicit and inherited keys at typed server boundaries", () => {
  const plain = question();
  expect(() => normalizeQuestionImages([{ ...plain, questionImageKey: "../asset" }])).toThrow();
  expect(() => normalizeQuestionImages([plain], [{ ...plain, questionImageKey: "https://example.test/a.png" }])).toThrow();
});
