import { describe, expect, test } from "vitest";
import { messageContent } from "@/contracts/message-content";
import { normalizeMessageContent, renderMessageContent, sanitizeMessageHtml } from "@/server/message-content";
const base = { format: "html" as const, subject: "안내", text: "텍스트 대체 내용" };
describe("message HTML boundary", () => {
  test("removes executable content, active embeds, tracking resources and CSS", () => {
    const dirty = '<p onclick="alert(1)" style="background:url(https://tracker.example/a)">유지<strong>강조</strong></p><script>alert(1)</script><style>@import "https://track.example"</style><img src="https://track.example/1" onerror="alert(1)"><iframe srcdoc="bad">숨김</iframe><svg><a href="https://track.example">숨김</a></svg><math><mtext>숨김</mtext></math><object data="https://track.example">숨김</object><form action="https://track.example"><input name="a"></form><template><p>숨김</p></template>';
    const clean = normalizeMessageContent({ ...base, html: dirty }, "email");
    expect(clean).toEqual({ ...base, html: "<p>유지<strong>강조</strong></p>" });
  });
  test("allows literal HTTPS and mail links while removing encoded or relative dangerous URLs", () => {
    for (const href of ["javascript:alert(1)", "jav&#x61;script:alert(1)", "java&#9;script:alert(1)", "data:text/html,a", "file:///etc/passwd", "//tracker.test/a", "/relative", "http://legacy.test", "https://u:p@example.com", "mailto:a@example.com?subject=x%0abcc:b@example.com"]) {
      expect(sanitizeMessageHtml('<a href="' + href + '" target="_blank" ping="https://track.test">링크</a>')).toBe('<a rel="noopener noreferrer">링크</a>');
    }
    expect(sanitizeMessageHtml('<a href="https://example.com/path?a=1&amp;b=2">HTTPS</a><a href="mailto:help@example.com">메일</a>')).toBe('<a href="https://example.com/path?a=1&amp;b=2" rel="noopener noreferrer">HTTPS</a><a href="mailto:help@example.com" rel="noopener noreferrer">메일</a>');
  });
  test("rejects variable attributes including encoded braces and unknown variable names", () => {
    for (const html of ['<a href="https://example.com/{{contact}}">내용</a>', '<p title="&#123;&#123;name&#125;&#125;">내용</p>', '<p>{{unknown}}</p>', '<p>{{name</p>']) {
      expect(() => normalizeMessageContent({ ...base, html }, "email")).toThrow();
    }
    expect(() => normalizeMessageContent({ ...base, html: "<script>onlyScript()</script>" }, "email")).toThrow();
    expect(() => normalizeMessageContent({ ...base, html: "<p>내용</p>" }, "sms")).toThrow();
  });
  test("escapes text variables after sanitizing and enforces rendered headers and missing names", () => {
    const saved = normalizeMessageContent({ ...base, subject: "{{name}} 안내", text: "{{name}} {{contact}}", html: "<p>{{name}} 님 <strong>{{contact}}</strong></p>" }, "email");
    const name = '<img src=x onerror=alert(1)> "홍" & 김';
    expect(renderMessageContent(saved, { name, contact: "qa@example.com" })).toMatchObject({ subject: name + " 안내", text: name + " qa@example.com", html: '<p>&lt;img src=x onerror=alert(1)&gt; &quot;홍&quot; &amp; 김 님 <strong>qa@example.com</strong></p>' });
    expect(renderMessageContent(saved, { name: "", contact: "qa@example.com" })).toBeNull();
    expect(renderMessageContent(saved, { name: "홍\r\nBcc:other@example.com", contact: "qa@example.com" })).toBeNull();
  });
  test("parses malformed HTML and is idempotent without broadening the element policy", () => {
    for (const html of ['<p><strong>한글 & 내용', '<table><tr><td rowspan="999" colspan="2">표</td></tr></table>', '<noscript><img src=x onerror=alert(1)></noscript><p>나머지</p>', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">']) {
      const clean = sanitizeMessageHtml(html); expect(sanitizeMessageHtml(clean)).toBe(clean); expect(clean).not.toMatch(/<(?:script|style|img|math|svg|iframe)\b/i); expect(clean).not.toMatch(/(?:onerror|onclick|style|rowspan)\s*=/i);
    }
  });
  test("rejects inconsistent formats, empty fallbacks, excessive input and header controls", () => {
    for (const input of [{ ...base, html: "내용", text: "" }, { ...base, html: "x".repeat(100001) }, { format: "text", subject: "안내", text: "내용", html: "unexpected" }, { ...base, html: "내용", subject: "안내\n헤더" }]) expect(messageContent.safeParse(input).success).toBe(false);
  });
});
