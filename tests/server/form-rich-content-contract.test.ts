import { describe, expect, it } from "vitest";
import { formRichBodyInput, FormRichBodyError, formRichContentTotals, MAX_FORM_RICH_DOCUMENT_BYTES,
  MAX_FORM_RICH_DOCUMENT_IMAGES, normalizeFormRichBody } from "@/contracts/form-rich-content";
import { plainTextRichDocument, type RichDocumentV1 } from "@/contracts/rich-content";

const rich = (text: string) => plainTextRichDocument(text);
const imageOnly = (): RichDocumentV1 => ({ schemaVersion: 1, blocks: [{
  type: "image", nodeId: "61b5c2cc-11bc-4e4c-8e31-5d6111d11111",
  assetId: "d9e166d4-77f1-44c9-a761-51bf59022222", alt: "작성한 대체 텍스트",
}] });

describe("versioned rich body compatibility", () => {
  it("keeps legacy plain text literal and omits the new key", () => {
    const body = " <img src=x>\n\n  끝 ";
    expect(JSON.stringify(normalizeFormRichBody({ body }))).toBe(JSON.stringify({ body }));
  });
  it("accepts rich text only with its exact plain projection", () => {
    const body = " 첫줄\n\n끝 ";
    expect(normalizeFormRichBody({ body, bodyRich: rich(body) })).toEqual({ body, bodyRich: rich(body) });
    expect(() => normalizeFormRichBody({ body: body.trim(), bodyRich: rich(body) })).toThrow(FormRichBodyError);
  });
  it("preserves image-only bodies when an old client resaves the unchanged plain body", () => {
    const current = { body: "", bodyRich: imageOnly() };
    const next = normalizeFormRichBody({ body: "" }, current);
    expect(next).toEqual(current);
    expect(next.bodyRich).not.toBe(current.bodyRich);
    expect(next.bodyRich!.blocks[0]).not.toBe(current.bodyRich.blocks[0]);
  });
  it("rejects ambiguous old-client edits without losing the existing image", () => {
    const current = { body: "", bodyRich: imageOnly() }, before = JSON.stringify(current);
    try {
      normalizeFormRichBody({ body: "교체할 본문" }, current);
      expect.fail("an omitted rich document must not silently remove the saved image");
    } catch (error) {
      expect(error).toBeInstanceOf(FormRichBodyError);
      expect((error as FormRichBodyError).code).toBe("RICH_BODY_AMBIGUOUS");
    }
    expect(JSON.stringify(current)).toBe(before);
  });
  it("honors explicit null even when supplied plain text changes", () => {
    const current = { body: "", bodyRich: imageOnly() };
    expect(normalizeFormRichBody({ body: "새 평문", bodyRich: null }, current)).toEqual({ body: "새 평문" });
    expect(current.bodyRich.blocks).toHaveLength(1);
  });
  it("does not resurrect cleared rich content on a later omitted-field save", () => {
    const history = { body: "", bodyRich: imageOnly() };
    const cleared = normalizeFormRichBody({ body: "", bodyRich: null }, history);
    expect(normalizeFormRichBody({ body: "" }, cleared)).toEqual({ body: "" });
  });
  it("replaces the current document with the explicit new version and never merges images", () => {
    const current = { body: "", bodyRich: imageOnly() };
    const next = normalizeFormRichBody({ body: "텍스트만", bodyRich: rich("텍스트만") }, current);
    expect(next.bodyRich).toEqual(rich("텍스트만"));
    expect(current.bodyRich.blocks[0].type).toBe("image");
  });
  it("accepts an explicit empty rich document without treating it as omission", () => {
    const bodyRich: RichDocumentV1 = { schemaVersion: 1, blocks: [] };
    expect(normalizeFormRichBody({ body: "", bodyRich }, { body: "", bodyRich: imageOnly() }))
      .toEqual({ body: "", bodyRich });
  });
  it("rejects a corrupt current projection rather than carrying it into a new version", () => {
    expect(() => normalizeFormRichBody({ body: "현재" }, { body: "현재", bodyRich: rich("다른 내용") }))
      .toThrow("현재 본문의 텍스트와 서식 문서가 일치하지 않습니다.");
  });
  it("validates the rich payload even for direct internal callers", () => {
    expect(formRichBodyInput.safeParse({ body: "", bodyRich: { ...imageOnly(), html: "<script />" } }).success).toBe(false);
    expect(formRichBodyInput.safeParse({ body: "", bodyRich: { schemaVersion: 2, blocks: [] } }).success).toBe(false);
  });
  it("retains the legacy 20000 character bound", () => {
    expect(formRichBodyInput.safeParse({ body: "가".repeat(20000) }).success).toBe(true);
    expect(formRichBodyInput.safeParse({ body: "가".repeat(20001), bodyRich: null }).success).toBe(false);
  });
  it("counts the whole presentation byte and image budget across every document", () => {
    const document = imageOnly();
    const totals = formRichContentTotals({ bodyRich: document,
      sections: [{ bodyRich: document }, { bodyRich: null }],
      completionPage: { mode: "custom", bodyRich: document },
      closedPage: { mode: "default", bodyRich: document },
    });
    expect(totals.images).toBe(3);
    expect(totals.bytes).toBe(new TextEncoder().encode(JSON.stringify(document)).byteLength * 3);
    expect(MAX_FORM_RICH_DOCUMENT_BYTES).toBe(524288);
    expect(MAX_FORM_RICH_DOCUMENT_IMAGES).toBe(100);
  });
});
