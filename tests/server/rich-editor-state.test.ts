import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { RichDocumentV1, RichImage } from "@/contracts/rich-content";
import { findRichImage, insertRichBlock, updateRichImage } from "@/components/forms/rich-editor-state";

const paragraph = (text = "") => ({ type: "paragraph" as const, children: text ? [{ type: "text" as const, text }] : [] });
const image = (): RichImage => ({ type: "image", nodeId: randomUUID(), assetId: randomUUID(), alt: "원본" });

describe("rich editor state changes", () => {
  test("inserts after the active top-level block and preserves validated order", () => {
    const document: RichDocumentV1 = { schemaVersion: 1, blocks: [paragraph("앞"), paragraph("뒤")] };
    const picture = image(), next = insertRichBlock(document, picture, 0);
    expect(next.blocks.map(block => block.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(document.blocks.map(block => block.type)).toEqual(["paragraph", "paragraph"]);
  });

  test("finds, updates and removes nested images without mutating the source", () => {
    const picture = image();
    const document: RichDocumentV1 = { schemaVersion: 1, blocks: [{ type: "list", ordered: false, items: [[picture]] }] };
    expect(findRichImage(document, picture.nodeId)).toEqual(picture);
    const updated = updateRichImage(document, picture.nodeId, current => ({ ...current, alt: "변경", alignment: "right", width: { unit: "percent", value: 75 } }));
    expect(findRichImage(updated, picture.nodeId)).toMatchObject({ alt: "변경", alignment: "right", width: { unit: "percent", value: 75 } });
    expect(findRichImage(document, picture.nodeId)?.alt).toBe("원본");
    const removed = updateRichImage(updated, picture.nodeId, () => null);
    expect(findRichImage(removed, picture.nodeId)).toBeUndefined();
    expect(removed.blocks[0]).toEqual({ type: "list", ordered: false, items: [[paragraph()]] });
  });

  test("rejects updates for stale image occurrences", () => {
    expect(() => updateRichImage({ schemaVersion: 1, blocks: [] }, randomUUID(), current => current)).toThrow("찾을 수 없습니다");
  });
});
