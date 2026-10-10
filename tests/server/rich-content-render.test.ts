import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RichDocumentView } from "@/components/forms/RichDocumentView";
import type { RichDocumentV1 } from "@/contracts/rich-content";

const assetId = "d9e166d4-77f1-44c9-a761-51bf59022222";
const document: RichDocumentV1 = { schemaVersion: 1, blocks: [
  { type: "heading", level: 2, alignment: "right", direction: "rtl", indent: 2,
    children: [{ type: "text", text: "<img onerror='x'>", bold: true, fontColor: "#ab4642" }] },
  { type: "paragraph", children: [{ type: "link", href: "https://example.test/path", children: [{ type: "text", text: "링크" }] }] },
  { type: "image", nodeId: "61b5c2cc-11bc-4e4c-8e31-5d6111d11111", assetId, alt: '대체 "설명"', alignment: "center", width: { unit: "percent", value: 75.5 }, caption: [{ type: "text", text: "캡션" }] },
  { type: "media", provider: "vimeo", mediaId: "123456", width: { unit: "px", value: 640 } },
] };

describe("rich document React renderer", () => {
  test("renders typed nodes with escaped text, safe links and bounded layout styles", () => {
    const html = renderToStaticMarkup(createElement(RichDocumentView, { document, imageUrls: { [assetId]: "/api/v1/owned-assets/image" } }));
    expect(html).toContain("&lt;img onerror=&#x27;x&#x27;&gt;");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("text-align:right");
    expect(html).toContain("padding-inline-start:4rem");
    expect(html).toContain('href="https://example.test/path" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('src="/api/v1/owned-assets/image"');
    expect(html).toContain('alt="대체 &quot;설명&quot;"');
    expect(html).toContain("width:75.5%;max-width:100%");
    expect(html).toContain('href="https://vimeo.com/123456"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  test("never renders remote, protocol-relative, data, blob or malformed image URLs", () => {
    for (const url of ["https://remote.invalid/x", "//remote.invalid/x", "data:image/png,a", "blob:https://local/x", "/api/x\\evil", "/api/x\nheader"]) {
      const html = renderToStaticMarkup(createElement(RichDocumentView, { document, imageUrls: { [assetId]: url } }));
      expect(html).not.toContain("<img");
      expect(html).toContain("이미지를 불러올 수 없습니다.");
      expect(html).not.toContain(url);
    }
  });

  test("rejects unvalidated documents before creating a render tree", () => {
    expect(() => renderToStaticMarkup(createElement(RichDocumentView, { document: {
      schemaVersion: 1, blocks: [{ type: "paragraph", children: [{ type: "text", text: "x", html: "<script>x</script>" }] }],
    } }))).toThrow();
  });
});
