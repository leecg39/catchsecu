"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActionButton, Panel } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import type { FormContent } from "@/contracts/forms";
import { ConsentDisplay, ConsentDocuments } from "./ConsentDocuments";
import type { FormConsentBundle } from "@/contracts/form-documents";
import { QuestionInput } from "./QuestionInput";
import { emptyAnswer, visibleQuestionIds, type Answers, type AnswerValue } from "@/contracts/questions";
import { uploadFile, type UploadCache } from "@/lib/file-upload";
import { PublicSubmissionSession } from "@/lib/public-submission";
import type { SubmissionReceipt } from "@/contracts/public-forms";

type PublicFormData = { consentBundle?: FormConsentBundle; title: string; content: FormContent; closed: boolean; expiresAt: string | null; token?: string };
export function PublicForm({ path }: { path: string }) {
  const value = path.split("/")[2], alias = path.startsWith("/url/");
  const resource = useResource<PublicFormData>(value ? (alias ? "/public/urls/" : "/public/forms/") + encodeURIComponent(value) : null);
  return <div className="public-auth public-form"><Panel>
    {resource.loading ? <p role="status">캐치폼을 불러오는 중입니다.</p> : resource.error ? <p role="alert">{resource.error.message}</p> :
      resource.data ? <ResponseForm key={path + ":" + (resource.data.token ?? value)} data={resource.data} token={resource.data.token ?? value} /> : <p>표시할 캐치폼이 없습니다. 링크를 확인해주세요.</p>}
    <p className="public-powered">powered by Catchsecu</p>
  </Panel></div>;
}
type VerificationProof = { attemptId: string; receipt: string; name: string };
function IdentityVerification({ token, onDone }: { token: string; onDone: (proof: VerificationProof) => void }) {
  const [challenge, setChallenge] = useState<{ attemptId: string; nonce: string } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<{ attemptId: string; nonce: string }>("/public/forms/" + token + "/verification", { method: "POST", body: JSON.stringify({ kind: "identity" }) })
      .then(value => { if (!cancelled) setChallenge(value); })
      .catch(cause => { if (!cancelled) setError(errorText(cause)); });
    return () => { cancelled = true; };
  }, [token]);
  async function verify() {
    if (busy || !challenge) return;
    setBusy(true); setError("");
    const name = (document.getElementById("verifyName") as HTMLInputElement | null)?.value.trim() ?? "";
    const birthDate = (document.getElementById("verifyBirth") as HTMLInputElement | null)?.value ?? "";
    const subject = { name, birthDate };
    try {
      const assertion = await api<Record<string, unknown>>("/public/verify/local", { method: "POST",
        body: JSON.stringify({ attemptId: challenge.attemptId, nonce: challenge.nonce, subject }) });
      const proof = await api<VerificationProof>("/public/forms/" + token + "/verification-callback", { method: "POST", body: JSON.stringify(assertion) });
      onDone({ ...proof, name: subject.name });
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section className="public-consent"><h2>본인인증</h2>
    <p>이 캐치폼은 본인인증이 필요합니다. 이름과 생년월일을 입력해 테스트 공급자 인증을 완료해주세요.</p>
    {challenge ? <div className="cs-stack">
      <label className="cs-row">이름<input className="cs-input" id="verifyName" required maxLength={100} autoComplete="name" /></label>
      <label className="cs-row">생년월일<input className="cs-input" id="verifyBirth" required placeholder="1990-01-01" pattern="\d{4}-\d{2}-\d{2}" /></label>
      {error && <p role="alert">{error}</p>}
      <ActionButton type="button" disabled={busy} onClick={verify}>{busy ? "인증 중…" : "인증하기"}</ActionButton>
    </div> : error ? <p role="alert">{error}</p> : <p role="status">인증 요청을 준비하고 있습니다.</p>}
  </section>;
}
function ResponseForm({ data, token }: { data: PublicFormData; token: string }) {
  const [receipt, setReceipt] = useState<SubmissionReceipt>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [verification, setVerification] = useState<VerificationProof | null>(null);
  const session = useRef<PublicSubmissionSession | null>(null), content = data.content;
  session.current ??= new PublicSubmissionSession({ send: (payload, key) => api("/public/forms/" + token + "/submissions", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }) });
  const uploadCache = useRef<UploadCache>(new Map()), [uploadStatus, setUploadStatus] = useState("");
  const [values, setValues] = useState<Answers>({});
  const visible = visibleQuestionIds(content.questions, values);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (session.current?.hasPending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function change(id: string, value: AnswerValue) {
    if (busy || session.current?.hasPending) return;
    const next = { ...values, [id]: value }, shown = visibleQuestionIds(content.questions, next);
    for (const question of content.questions) if (!shown.has(question.id)) { delete next[question.id]; uploadCache.current.delete(question.id); }
    setValues(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || receipt) return;
    setError("");
    const formData = new FormData(event.currentTarget), answers: Answers = {};
    setBusy(true);
    try {
    if (session.current!.hasPending) {
      setUploadStatus("접수 결과를 확인하고 있습니다."); setReceipt(await session.current!.retry()); return;
    }
    const attachments: Record<string, { fileId: string; token: string }> = {};
    for (const question of content.questions) {
      if (!visible.has(question.id)) continue;
      if (question.type === "파일 업로드") {
        const file = formData.get(question.id);
        if (file instanceof File && file.name) {
          const uploaded = await uploadFile(file, { token, questionId: question.id }, uploadCache.current, setUploadStatus);
          answers[question.id] = uploaded.id;
          attachments[question.id] = { fileId: uploaded.id, token: uploaded.uploadToken! };
        } else answers[question.id] = "";
        continue;
      }
      answers[question.id] = values[question.id] ?? emptyAnswer(question.type);
    }
    const payload = JSON.stringify({ answers, marketingChannels: formData.getAll("marketingChannels").map(String), consent: formData.get("consent") === "on", documentConsents: formData.getAll("documentConsents").map(String), attachments,
      ...(verification ? { verification: { attemptId: verification.attemptId, receipt: verification.receipt } } : {}) });
      setUploadStatus("응답을 제출하고 있습니다.");
      setReceipt(await session.current!.submit(payload));
    } catch (cause) { setError(errorText(cause)); } finally { setPending(session.current!.hasPending); setBusy(false); setUploadStatus(""); }
  }
  if (receipt) return <><h1>제출이 완료되었습니다.</h1>{content.showSubmitNotice !== false && <p>응답해 주셔서 감사합니다.</p>}
    <p>접수 번호: {receipt.id}</p><p>{new Date(receipt.submittedAt).toLocaleString("ko-KR")}</p></>;
  if (data.closed) return <><h1>{data.title}</h1><p>최대 응답 수에 도달하여 응답이 마감되었습니다.</p></>;
  return <form className="cs-stack" onSubmit={submit}><h1>{data.title}</h1>
    <p className="public-form-body" style={{ fontSize: content.font, fontWeight: content.bold ? 700 : 400 }}>{content.body}</p>
    <fieldset className="public-response-fields" disabled={busy || pending}>{content.questions.filter(question => visible.has(question.id)).map(question =>
      <fieldset className="public-question" key={question.id}><legend>{question.label} {question.required && <em>*</em>}</legend>
        <QuestionInput question={question} value={values[question.id]} onChange={value => change(question.id, value)}
          onFileChange={() => { if (!busy && !session.current!.hasPending) uploadCache.current.delete(question.id); }} />
        {question.type === "파일 업로드" && <p className="cs-muted">PDF, PNG, JPG, TXT, CSV · 파일당 최대 10MB · 검사 후 제출됩니다.</p>}</fieldset>)}
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
    {content.verify && <fieldset className="public-response-fields" disabled={busy || pending}>
      {verification ? <section className="public-consent"><h2>본인인증</h2><p role="status">본인인증을 완료했습니다. ({verification.name})</p></section>
        : <IdentityVerification key={token} token={token} onDone={proof => setVerification(proof)} />}
    </fieldset>}
    {uploadStatus && <p role="status">{uploadStatus}</p>}
    {error && <p role="alert">{error}</p>}
    {pending && !busy && <p role="status">접수 여부를 확인할 수 없습니다. 입력 내용과 첨부를 유지하고 같은 요청으로 결과를 다시 확인해주세요.</p>}
    <ActionButton disabled={busy || (!!content.verify && !verification)}>{busy ? "제출 중…" : pending ? "같은 요청으로 결과 확인" : "제출하기"}</ActionButton>
  </form>;
}
