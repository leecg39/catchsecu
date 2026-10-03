"use client";
import { useRef, useState, type FormEvent } from "react";
import { ActionButton, Panel } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import type { FormContent, Question } from "@/contracts/forms";
import { ConsentDisplay, ConsentDocuments } from "./ConsentDocuments";
import type { FormConsentBundle } from "@/contracts/form-documents";
import { FILE_ACCEPT } from "@/contracts/files";
import { uploadFile, type UploadCache } from "@/lib/file-upload";

type PublicFormData = { consentBundle?: FormConsentBundle; title: string; content: FormContent; closed: boolean; expiresAt: string | null; token?: string };
export function PublicForm({ path }: { path: string }) {
  const value = path.split("/")[2], alias = path.startsWith("/url/");
  const resource = useResource<PublicFormData>(value ? (alias ? "/public/urls/" : "/public/forms/") + encodeURIComponent(value) : null);
  return <div className="public-auth public-form"><Panel>
    {resource.loading ? <p role="status">캐치폼을 불러오는 중입니다.</p> : resource.error ? <p role="alert">{resource.error.message}</p> :
      resource.data ? <ResponseForm key={path} data={resource.data} token={resource.data.token ?? value} /> : <p>표시할 캐치폼이 없습니다. 링크를 확인해주세요.</p>}
    <p className="public-powered">powered by Catchsecu</p>
  </Panel></div>;
}
function QuestionField({ question, onFileChange }: { question: Question; onFileChange: () => void }) {
  const [checked, setChecked] = useState<string[]>([]);
  const common = { name: question.id, required: question.required, "aria-label": question.label };
  let control;
  if (question.type === "장문형 답변") control = <textarea {...common} className="cs-input" rows={5} maxLength={20000} placeholder="답변을 입력해주세요" />;
  else if (question.type === "객관식 답변" || question.type === "체크박스") control = <div className="public-options">
    {question.options?.map(option => <label key={option}><input name={question.id} type={question.type === "체크박스" ? "checkbox" : "radio"} value={option}
      required={question.required && (question.type !== "체크박스" || checked.length === 0)}
      onChange={event => { if (question.type === "체크박스") setChecked(values => event.target.checked ? [...values, option] : values.filter(value => value !== option)); }} />{option}</label>)}</div>;
  else if (question.type === "드롭다운") control = <select {...common} className="cs-input" defaultValue=""><option value="">선택해주세요</option>
    {question.options?.map(option => <option key={option}>{option}</option>)}</select>;
  else control = <input {...common} className="cs-input" type={question.type === "날짜" ? "date" : question.type === "파일 업로드" ? "file" : question.subjectRole === "email" ? "email" : "text"}
    accept={question.type === "파일 업로드" ? FILE_ACCEPT : undefined}
    onChange={question.type === "파일 업로드" ? onFileChange : undefined}
    autoComplete={question.subjectRole === "email" ? "email" : question.subjectRole === "name" ? "name" : undefined}
    maxLength={question.subjectRole === "name" ? 100 : question.subjectRole === "email" ? 254 : question.type === "단문형 답변" ? 1000 : undefined} placeholder="답변을 입력해주세요" />;
  return <fieldset className="public-question"><legend>{question.label} {question.required && <em>*</em>}</legend>{control}
    {question.type === "파일 업로드" && <p className="cs-muted">PDF, PNG, JPG, TXT, CSV · 파일당 최대 10MB · 검사 후 제출됩니다.</p>}</fieldset>;
}
function ResponseForm({ data, token }: { data: PublicFormData; token: string }) {
  const [receipt, setReceipt] = useState<{ id: string; submittedAt: string }>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<{ payload: string; key: string } | null>(null), content = data.content;
  const uploadCache = useRef<UploadCache>(new Map()), [uploadStatus, setUploadStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const formData = new FormData(event.currentTarget), answers: Record<string, string | string[]> = {};
    setBusy(true);
    try {
    const attachments: Record<string, { fileId: string; token: string }> = {};
    for (const question of content.questions) {
      const values = formData.getAll(question.id);
      if (question.type === "파일 업로드") {
        const file = values[0];
        if (file instanceof File && file.name) {
          const uploaded = await uploadFile(file, { token, questionId: question.id }, uploadCache.current, setUploadStatus);
          answers[question.id] = uploaded.id;
          attachments[question.id] = { fileId: uploaded.id, token: uploaded.uploadToken! };
        } else answers[question.id] = "";
        continue;
      }
      answers[question.id] = question.type === "체크박스" ? values.map(String) : String(values[0] ?? "");
    }
    const payload = JSON.stringify({ answers, marketingChannels: formData.getAll("marketingChannels").map(String), consent: formData.get("consent") === "on", documentConsents: formData.getAll("documentConsents").map(String), attachments });
    if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
      setUploadStatus("응답을 제출하고 있습니다.");
      setReceipt(await api("/public/forms/" + token + "/submissions", { method: "POST", body: payload, headers: { "Idempotency-Key": pending.current!.key } }));
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); setUploadStatus(""); }
  }
  if (receipt) return <><h1>제출이 완료되었습니다.</h1>{content.showSubmitNotice !== false && <p>응답해 주셔서 감사합니다.</p>}
    <p>접수 번호: {receipt.id}</p><p>{new Date(receipt.submittedAt).toLocaleString("ko-KR")}</p></>;
  if (data.closed) return <><h1>{data.title}</h1><p>최대 응답 수에 도달하여 응답이 마감되었습니다.</p></>;
  return <form className="cs-stack" onSubmit={submit}><h1>{data.title}</h1>
    <p className="public-form-body" style={{ fontSize: content.font, fontWeight: content.bold ? 700 : 400 }}>{content.body}</p>
    <fieldset className="public-response-fields" disabled={busy}>{content.questions.map(question => <QuestionField key={question.id} question={question}
      onFileChange={() => { uploadCache.current.delete(question.id); pending.current = null; }} />)}
      <section className="public-consent"><h2>개인정보 수집·이용 동의</h2><ConsentDisplay display={data.consentBundle?.display} />
        <p><strong>수집·이용 목적</strong><br />{content.consentPurpose || "별도 동의를 요청하지 않습니다."}</p>
        <p><strong>보유 및 이용 기간</strong><br />제출일로부터 {content.retentionDays}일</p>
        <p>{content.consentRequired ? data.consentBundle?.display?.requiredText : data.consentBundle?.display?.optionalText}</p>
        <label className="cs-row"><input type="checkbox" name="consent" required={content.consentRequired} />{content.consentRequired ? "[필수]" : "[선택]"} 개인정보 수집·이용에 동의합니다.</label>
      </section><ConsentDocuments bundle={data.consentBundle} selectable />
      {content.marketing && <section className="public-consent"><h2>광고성 정보 수신동의 (선택)</h2><p><strong>마케팅 목적</strong><br />{content.marketing.purpose}</p><p>보유 및 이용 기간: 제출일로부터 {content.retentionDays}일 · 철회하면 발송이 중지됩니다.</p><p>동의하지 않아도 응답을 제출할 수 있습니다. 이메일과 문자를 각각 선택해주세요.</p>
        {content.marketing.emailQuestionId && <label className="cs-row"><input name="marketingChannels" type="checkbox" value="email" />[선택] 이메일 광고성 정보 수신에 동의합니다.</label>}
        {content.marketing.smsQuestionId && <label className="cs-row"><input name="marketingChannels" type="checkbox" value="sms" />[선택] 문자 광고성 정보 수신에 동의합니다.</label>}
      </section>}</fieldset>
    {uploadStatus && <p role="status">{uploadStatus}</p>}
    {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "제출 중…" : "제출하기"}</ActionButton>
  </form>;
}
