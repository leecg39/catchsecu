"use client";
import { useState } from "react";
import type { MessageContent } from "@/contracts/message-content";
import { api, errorText } from "@/lib/api";
import { ActionButton } from "../shared";

export function SavedMessage({ content }: { content: { subject: string; text: string; html?: string } }) {
  return <div className="campaign-fields"><h3>{content.subject}</h3>{content.html && <iframe title="정제된 HTML 메시지" className="message-html-preview" sandbox="" tabIndex={-1} referrerPolicy="no-referrer"
    srcDoc={'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{font:15px/1.65 sans-serif;overflow-wrap:anywhere;padding:12px;margin:0;color:#1f2937}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #cbd5e1;padding:6px}pre{white-space:pre-wrap}a{pointer-events:none}</style></head><body inert>' + content.html + "</body></html>"} />}
    {content.html && <strong>텍스트 대체 본문</strong>}<pre className="campaign-message">{content.text}</pre></div>;
}
export function contentFromForm(values: FormData): MessageContent {
  const subject = String(values.get("subject") ?? ""), text = String(values.get("text") ?? "");
  return values.get("format") === "html" ? { format: "html", subject, text, html: String(values.get("html") ?? "") } : { format: "text", subject, text };
}
export function MessageContentFields({ channel, serviceId, initial }: { channel: "email" | "sms"; serviceId: string; initial?: MessageContent | null }) {
  const [format, setFormat] = useState(initial?.format ?? "text"), [subject, setSubject] = useState(initial?.subject ?? ""), [text, setText] = useState(initial?.text ?? ""), [html, setHtml] = useState(initial?.format === "html" ? initial.html : "");
  const [preview, setPreview] = useState<{ content: MessageContent; sample: MessageContent | null; sanitized: boolean }>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const content: MessageContent = format === "html" ? { format, subject, text, html } : { format, subject, text };
  return <><label>메시지 형식<select name="format" className="cs-input" value={format} onChange={e => { setFormat(e.target.value as "text" | "html"); setPreview(undefined); }}><option value="text">텍스트</option>{channel === "email" && <option value="html">HTML</option>}</select></label>
    <label>{channel === "email" ? "이메일 제목" : "메시지 제목"}<input className="cs-input" name="subject" required maxLength={200} value={subject} onChange={e => { setSubject(e.target.value); setPreview(undefined); }} /></label>
    {format === "html" && <label>HTML 본문<textarea name="html" className="cs-input" rows={10} required maxLength={100000} value={html} onChange={e => { setHtml(e.target.value); setPreview(undefined); }} placeholder="<p>{{name}} 님, 안녕하세요.</p>" /></label>}
    <label>{format === "html" ? "텍스트 대체 본문" : "메시지 내용"}<textarea className="cs-input" name="text" required maxLength={100000} rows={6} value={text} onChange={e => { setText(e.target.value); setPreview(undefined); }} /></label>
    <p className="campaign-note">본문과 제목에 {"{{name}}"}, {"{{contact}}"}를 사용할 수 있습니다. 이름이 없는 대상은 이름 변수를 쓰는 발송에서 제외됩니다. HTML에서는 본문 글자에만 변수를 넣으세요. 스크립트·이미지·스타일은 제거되며 HTTPS·메일 링크만 허용합니다.</p>
    <ActionButton secondary type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { setPreview(await api("/message-content/preview", { method: "POST", body: JSON.stringify({ serviceId, channel, content }) })); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>편집 내용 정제 미리보기</ActionButton>
    {error && <p role="alert">{error}</p>}{preview && <section className="campaign-preview" aria-label="편집 내용 정제 결과"><p>{preview.sanitized ? "허용하지 않는 HTML을 제거했습니다. 저장·발송에는 아래 정제 결과를 사용합니다." : "저장할 내용의 미리보기입니다."} 예시 이름·연락처를 사용합니다.</p>{preview.sample && <SavedMessage content={preview.sample} />}{preview.content.format === "html" && <details><summary>정제된 HTML 코드</summary><pre className="campaign-message">{preview.content.html}</pre></details>}</section>}
  </>;
}
