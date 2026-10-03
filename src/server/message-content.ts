import sanitizeHtml from "sanitize-html";
import { messageContent, type MessageContent } from "@/contracts/message-content";
import { fail } from "./http";

/** HTML is parsed on the server. Only text variables and literal HTTPS/mailto links survive. */
export function sanitizeMessageHtml(input: string) {
  return sanitizeHtml(input, {
    allowedTags: ["p", "br", "div", "span", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "a"],
    allowedAttributes: { a: ["href", "title", "rel"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] },
    allowedSchemes: ["https", "mailto"], allowProtocolRelative: false, parseStyleAttributes: false,
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "svg", "math", "template"],
    transformTags: { "*": (tagName, attributes) => {
      if (Object.values(attributes).some(value => /\{\{|\}\}/.test(value))) fail(422, "HTML_VARIABLE_CONTEXT", "HTML 변수는 본문 글자에만 넣을 수 있습니다. 링크와 속성에는 사용할 수 없습니다.");
      const attribs = { ...attributes };
      if (tagName === "a") {
        try {
          const url = new URL(attribs.href);
          if (!["https:", "mailto:"].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(attribs.href) || /%0[ad]/i.test(attribs.href)) delete attribs.href;
        } catch { delete attribs.href; }
        attribs.rel = "noopener noreferrer";
      }
      for (const attr of ["rowspan", "colspan"]) if (attribs[attr] && !/^(?:[1-9]|10)$/.test(attribs[attr])) delete attribs[attr];
      return { tagName, attribs };
    } },
  });
}
export function normalizeMessageContent(input: MessageContent, channel: string) {
  const parsed = messageContent.parse(input);
  if (parsed.format === "text") return parsed;
  if (channel !== "email") fail(422, "EMAIL_CONTENT_ONLY", "HTML은 이메일에서만 사용할 수 있습니다.");
  const html = sanitizeMessageHtml(parsed.html);
  if (!sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()) fail(422, "EMPTY_HTML", "정제 후 표시할 HTML 내용이 없습니다.");
  return messageContent.parse({ ...parsed, html });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function renderMessageContent(content: MessageContent, contact: { name: string; contact: string }) {
  const source = content.subject + content.text + (content.format === "html" ? content.html : "");
  if (source.includes("{{name}}") && !contact.name.trim()) return null;
  const fill = (value: string, html = false) => value.replace(/\{\{(name|contact)\}\}/g, (_, key: "name" | "contact") => html ? escapeHtml(contact[key]) : contact[key]);
  const result = messageContent.safeParse({ ...content, subject: fill(content.subject), text: fill(content.text), ...(content.format === "html" ? { html: fill(content.html, true) } : {}) });
  return result.success ? result.data : null;
}
