import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { parseRichDocumentHtml, RichHtmlError, serializeRichDocumentHtml } from "@/contracts/rich-content-html";
import { richDocumentImages, richDocumentText } from "@/contracts/rich-content";

const assetId = "d9e166d4-77f1-44c9-a761-51bf59022222";
const nodeId = "61b5c2cc-11bc-4e4c-8e31-5d6111d11111";
const reject = (html: string) => expect(() => parseRichDocumentHtml(html)).toThrow(RichHtmlError);

describe("rich editor HTML boundary", () => {
  test("converts observed headings, marks, links, direction, indentation and lists", () => {
    const document = parseRichDocumentHtml([
      '<h2 style="text-align:right" dir="rtl" data-rich-indent="2"><strong>제목</strong></h2>',
      '<p><span style="font-size:20px;color:#ab4642"><i>서식</i></span><br><a href="https://example.test/a?b=1">링크</a></p>',
      '<blockquote><p>인용</p></blockquote><ol><li>첫째</li><li><p>둘째</p><ul><li>안쪽</li></ul></li></ol>',
    ].join(""));
    expect(richDocumentText(document)).toBe("제목\n서식\n링크\n인용\n첫째\n둘째\n안쪽");
    expect(document.blocks[0]).toMatchObject({ type: "heading", level: 2, alignment: "right", direction: "rtl", indent: 2 });
  });

  test("converts merged tables, owned images and canonical provider media without retaining source URLs", () => {
    const document = parseRichDocumentHtml([
      '<figure class="table"><table><tbody><tr><th rowspan="2">A</th><td>B</td></tr><tr><td>C</td></tr></tbody></table></figure>',
      `<figure class="image image-style-align-right" style="width:75.5%"><img data-rich-asset-id="${assetId}" data-rich-node-id="${nodeId}" alt="대체 &amp; 설명"><figcaption><strong>캡션</strong></figcaption></figure>`,
      '<figure class="media media-align-center" style="width:640px"><div data-oembed-url="https://www.youtube.com/watch?v=aB_09-Zxy12"><iframe src="https://attacker.invalid/embed" onload="alert(1)"></iframe></div></figure>',
      '<oembed url="https://vimeo.com/123456"></oembed>',
    ].join(""));
    expect(richDocumentText(document)).toBe("A\tB\nC\n캡션\nhttps://www.youtube.com/watch?v=aB_09-Zxy12\nhttps://vimeo.com/123456");
    expect(richDocumentImages(document)).toEqual([expect.objectContaining({ assetId, nodeId, alt: "대체 & 설명", alignment: "right", width: { unit: "percent", value: 75.5 } })]);
    expect(JSON.stringify(document)).not.toContain("attacker.invalid");
  });

  test("allocates a fresh occurrence ID only when editor HTML omits it", () => {
    const generated = randomUUID();
    const document = parseRichDocumentHtml(`<figure class="image"><img data-rich-asset-id="${assetId}" alt=""></figure>`, { nodeId: () => generated });
    expect(richDocumentImages(document)[0].nodeId).toBe(generated);
  });

  test("rejects active tags, handlers, arbitrary CSS, remote images and unsafe links", () => {
    for (const html of [
      "<script>alert(1)</script>", "<style>body{display:none}</style>", "<svg><script>alert(1)</script></svg>",
      '<p onclick="alert(1)">본문</p>', '<p style="background:url(https://track.invalid/x)">본문</p>',
      '<p><span style="font-size:18px">본문</span></p>', '<p><span style="color:#ABCDEF">본문</span></p>',
      '<p><a href="javascript:alert(1)">링크</a></p>', '<p><a href="/relative">링크</a></p>',
      '<figure class="image"><img src="https://remote.invalid/a.png" alt="원격"></figure>',
      `<figure class="image"><img data-rich-asset-id="${assetId}" src="data:image/png;base64,a"></figure>`,
      '<iframe src="https://remote.invalid"></iframe>', '<form action="https://remote.invalid"><input></form>',
    ]) reject(html);
  });

  test("rejects ambiguous figures, invalid IDs, table gaps and unsupported media URLs", () => {
    for (const html of [
      `<figure class="image unknown"><img data-rich-asset-id="${assetId}"></figure>`,
      '<figure class="image"><img data-rich-asset-id="not-a-uuid"></figure>',
      '<figure class="table"><table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table></figure>',
      '<figure class="media"><div data-oembed-url="http://www.youtube.com/watch?v=aB_09-Zxy12"></div></figure>',
      '<figure class="media"><div data-oembed-url="https://example.test/video"></div></figure>',
      '<figure class="media"><div data-oembed-url="https://www.youtube.com/watch?v=aB_09-Zxy12"><script>x</script></div></figure>',
    ]) reject(html);
  });

  test("bounds HTML bytes and physical nesting before recursive conversion", () => {
    reject(`<p>${"x".repeat(524_289)}</p>`);
    reject("<blockquote>".repeat(70) + "<p>x</p>" + "</blockquote>".repeat(70));
  });

  test("serializes validated documents to canonical editor HTML and round-trips every block", () => {
    const original = parseRichDocumentHtml([
      '<h3 style="text-align:center" dir="rtl" data-rich-indent="1"><span style="font-size:24px;color:#123abc"><strong><i>&lt;제목&gt;</i></strong></span></h3>',
      '<p><a href="https://example.test/a?b=1&amp;c=2">링크 &amp; 표시</a><br>끝</p>',
      '<blockquote><p>인용</p></blockquote><ul><li><p>목록</p></li></ul>',
      '<figure class="table"><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></tbody></table></figure>',
      `<figure class="image image-style-align-left" style="width:50%"><img data-rich-asset-id="${assetId}" data-rich-node-id="${nodeId}" alt="&quot;대체&quot;"><figcaption>캡션</figcaption></figure>`,
      '<figure class="media media-style-align-right" style="width:640px"><div data-oembed-url="https://vimeo.com/12345"></div></figure>',
    ].join(""));
    const html = serializeRichDocumentHtml(original);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(" src=");
    expect(parseRichDocumentHtml(html)).toEqual(original);
    expect(serializeRichDocumentHtml({ schemaVersion: 1, blocks: [] })).toBe("");
  });
});
