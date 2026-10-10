"use client";
import { AuthorAssetProvider } from "./AuthorAssetProvider";
import { hasAuthorAssets } from "@/lib/author-assets";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActionButton, Panel } from "../shared";
import { api, errorText, type ApiError } from "@/lib/api";
import type { FormContent } from "@/contracts/forms";
import { ConsentDisplay, ConsentDocuments, ConsentItems } from "./ConsentDocuments";
import type { FormConsentBundle } from "@/contracts/form-documents";
import { QuestionInput } from "./QuestionInput";
import { QuestionMaterials } from "./QuestionMaterials";
import { QuestionImage } from "./QuestionImage";
import { QuestionExplanation } from "./QuestionExplanation";
import { emptyAnswer, visibleQuestionIds, type Answers, type AnswerValue } from "@/contracts/questions";
import { uploadFile, type UploadCache } from "@/lib/file-upload";
import { PublicSubmissionSession } from "@/lib/public-submission";
import type { SubmissionReceipt } from "@/contracts/public-forms";
import { drawingAnswerFromFile, isFileQuestion } from "@/contracts/drawing-questions";
import { effectiveFormLanguage } from "@/contracts/form-language";
import { formPhrase, formRequiredLabel } from "@/contracts/form-system-copy";
import { formPageDestination, resolveFormVisit } from "@/contracts/form-sections";
import { richDocumentImages } from "@/contracts/rich-content";
import { OwnedRichDocumentView } from "./OwnedRichDocumentView";

type VerificationKind = "identity" | "signature";
type ActivePublicFormData = { consentBundle?: FormConsentBundle; title: string; content: FormContent; closed: false; expiresAt: string | null; token?: string; verification?: { kinds: VerificationKind[] } };
type ClosedPublicFormData = { title: string; closed: true; closedPage?: FormContent["closedPage"]; formLanguage?: FormContent["formLanguage"]; expiresAt: string | null; token?: string };
type ScheduledPublicFormData = { title: string; closed: true; scheduled: true; formLanguage?: FormContent["formLanguage"]; opensAt: string; expiresAt: string | null; token?: string };
type AccessPublicFormData = { title: string; closed: true; accessRequired: true; closedPage?: undefined; formLanguage?: FormContent["formLanguage"]; expiresAt: string | null; token?: string;
  access: { enabled: true; method: "EMAIL" | "SOCIAL"; targetScope: "ALL" | "WHITELIST"; useOtp: boolean; socialProvider: "KAKAO" | "NAVER"; limitDuplicate: boolean } };
type PublicFormData = ActivePublicFormData | ClosedPublicFormData | ScheduledPublicFormData | AccessPublicFormData;
function hasActiveContentAssets(content: FormContent) {
  if (hasAuthorAssets(content.questions)) return true;
  const documents = [content.bodyRich, ...(content.sections ?? []).map(section => section.bodyRich)];
  return documents.some(document => document && richDocumentImages(document).length > 0);
}
function hasNoticeAssets(notice: FormContent["completionPage"] | FormContent["closedPage"]) {
  return notice?.mode === "custom" && !!notice.bodyRich && richDocumentImages(notice.bodyRich).length > 0;
}
export function PublicForm({ path }: { path: string }) {
  const value = path.split("/")[2], alias = path.startsWith("/url/");
  const endpoint = value ? (alias ? "/public/urls/" : "/public/forms/") + encodeURIComponent(value) : null;
  const storageKey = "catchsecu-participation:" + path;
  const [proof, setProof] = useState(() => { try { return typeof window === "undefined" ? "" : sessionStorage.getItem(storageKey) ?? ""; } catch { return ""; } });
  const resourceKey = (endpoint ?? "") + "\n" + proof;
  const [storedResource, setResource] = useState<{ key?: string; data?: PublicFormData; error?: ApiError }>({});
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    api<PublicFormData>(endpoint, { signal: controller.signal, headers: proof ? { "X-Participation-Proof": proof } : undefined })
      .then(data => setResource({ key: resourceKey, data }))
      .catch(error => {
        if (error.name === "AbortError") return;
        if (proof && ["PARTICIPATION_SESSION_EXPIRED", "PARTICIPATION_TARGET_DENIED", "PARTICIPATION_POLICY_CHANGED"].includes(error.code)) {
          try { sessionStorage.removeItem(storageKey); } catch { /* storage can be unavailable */ }
          setProof(""); return;
        }
        setResource({ key: resourceKey, error });
      });
    return () => controller.abort();
  }, [endpoint, proof, resourceKey, storageKey]);
  const current = storedResource.key === resourceKey ? storedResource : {};
  const resource = { ...current, loading: !!endpoint && !current.data && !current.error };
  const authenticated = (next: string) => { try { sessionStorage.setItem(storageKey, next); } catch { /* storage can be unavailable */ } setProof(next); };
  return <div className="public-auth public-form"><Panel>
    {resource.loading ? <p role="status">캐치폼을 불러오는 중입니다.</p> : resource.error ? <p role="alert">{resource.error.message}</p> :
      resource.data ? "accessRequired" in resource.data
        ? <ParticipationAccess data={resource.data} token={resource.data.token ?? value} onAuthenticated={authenticated} />
        : "scheduled" in resource.data
        ? <ScheduledForm data={resource.data} />
        : resource.data.closed
        ? <AuthorAssetProvider key={path + ":closed:" + (resource.data.token ?? value)} scope={{ kind: "public", token: resource.data.token ?? value, surface: "closed" }} enabled={hasNoticeAssets(resource.data.closedPage)}><ClosedForm data={resource.data} /></AuthorAssetProvider>
        : <AuthorAssetProvider key={path + ":active:" + (resource.data.token ?? value)} scope={{ kind: "public", token: resource.data.token ?? value, surface: "active" }} enabled={hasActiveContentAssets(resource.data.content)}><ResponseForm data={resource.data} token={resource.data.token ?? value} participationProof={proof} /></AuthorAssetProvider>
        : <p>표시할 캐치폼이 없습니다. 링크를 확인해주세요.</p>}
    <p className="public-powered">powered by Catchsecu</p>
  </Panel></div>;
}
function ParticipationAccess({ data, token, onAuthenticated }: { data: AccessPublicFormData; token: string; onAuthenticated: (proof: string) => void }) {
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [challenge, setChallenge] = useState<{ challengeId: string; client: string; requiresCode: boolean; expiresAt: string }>();
  async function requestAccess(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = await api<{ challengeId: string; client: string; requiresCode: boolean; expiresAt: string; proof?: string }>(
        "/public/forms/" + token + "/participation-challenges", { method: "POST", body: JSON.stringify({ email }) });
      if (result.proof) onAuthenticated(result.proof); else setChallenge(result);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); if (busy || !challenge) return; setBusy(true); setError("");
    try {
      const result = await api<{ proof: string }>("/public/forms/" + token + "/participation-challenges-verify", { method: "POST",
        body: JSON.stringify({ challengeId: challenge.challengeId, client: challenge.client, code }) });
      onAuthenticated(result.proof);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  if (data.access.method === "SOCIAL") return <div className="cs-stack public-notice"><h1>{data.title}</h1><p role="alert">{data.access.socialProvider === "KAKAO" ? "카카오" : "네이버"} 참여 인증 연결이 필요합니다.</p></div>;
  return <form className="cs-stack public-notice" onSubmit={challenge ? verify : requestAccess}><h1>{data.title}</h1><h2>참여자 이메일 인증</h2>
    <p>{data.access.targetScope === "WHITELIST" ? "등록된 대상자 이메일로 인증해주세요." : "이메일 인증 후 응답할 수 있습니다."}</p>
    {data.access.limitDuplicate && <p>동일한 이메일로 한 번만 참여할 수 있습니다.</p>}
    {!challenge ? <label>이메일<input className="cs-input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      : <><p><strong>{email}</strong>로 보낸 6자리 인증번호를 입력해주세요.</p><label>인증번호<input className="cs-input" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <button className="cs-button secondary" type="button" disabled={busy} onClick={() => { setChallenge(undefined); setCode(""); setError(""); }}>다른 이메일 사용</button></>}
    {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "확인 중…" : challenge ? "인증번호 확인" : "인증 요청"}</ActionButton>
  </form>;
}
function ScheduledForm({ data }: { data: ScheduledPublicFormData }) {
  const locale = effectiveFormLanguage(data.formLanguage), direction = locale === "ar" ? "rtl" : "ltr";
  return <div className="cs-stack public-notice" lang={locale} dir={direction}><h1>{data.title}</h1>
    <p role="status">아직 응답 수집이 시작되지 않았습니다.</p>
    <p>시작 예정: <time dateTime={data.opensAt}>{new Date(data.opensAt).toLocaleString(locale)}</time></p>
  </div>;
}
function ClosedForm({ data }: { data: ClosedPublicFormData }) {
  const locale = effectiveFormLanguage(data.formLanguage), direction = locale === "ar" ? "rtl" : "ltr", notice = data.closedPage;
  return <div className="cs-stack public-notice" lang={locale} dir={direction}><h1>{data.title}</h1>
    {notice?.mode === "custom" ? notice.bodyRich ? <OwnedRichDocumentView document={notice.bodyRich} className="public-form-body rich-document" />
      : <p className="public-form-body">{notice.body}</p> : <p>{formPhrase(locale, "phrase9")}</p>}
  </div>;
}
type VerificationProof = { attemptId: string; receipt: string; name: string; kind: VerificationKind };
const verificationLabels: Record<VerificationKind, { title: string; hint: string; action: string; busy: string; done: string }> = {
  identity: { title: "본인인증", hint: "이 캐치폼은 본인인증이 필요합니다. 이름과 생년월일을 입력해 테스트 공급자 인증을 완료해주세요.", action: "인증하기", busy: "인증 중…", done: "본인인증을 완료했습니다." },
  signature: { title: "전자서명", hint: "이 캐치폼은 전자서명이 필요합니다. 이름과 생년월일을 입력하면 서명자를 확인하고 문서 내용에 서명합니다.", action: "서명하기", busy: "서명 중…", done: "전자서명을 완료했습니다." },
};
function IdentityVerification({ token, kinds, onDone }: { token: string; kinds: VerificationKind[]; onDone: (proof: VerificationProof) => void }) {
  const [kind, setKind] = useState<VerificationKind>(kinds[0] ?? "identity");
  return <VerificationStep key={kind} token={token} kind={kind} kinds={kinds} onKind={setKind} onDone={onDone} />;
}
function VerificationStep({ token, kind, kinds, onKind, onDone }: { token: string; kind: VerificationKind; kinds: VerificationKind[]; onKind: (kind: VerificationKind) => void; onDone: (proof: VerificationProof) => void }) {
  const [challenge, setChallenge] = useState<{ attemptId: string; nonce: string } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<{ attemptId: string; nonce: string }>("/public/forms/" + token + "/verification", { method: "POST", body: JSON.stringify({ kind }) })
      .then(value => { if (!cancelled) setChallenge(value); })
      .catch(cause => { if (!cancelled) setError(errorText(cause)); });
    return () => { cancelled = true; };
  }, [token, kind]);
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
      onDone({ ...proof, name: subject.name, kind });
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const labels = verificationLabels[kind];
  return <section className="public-consent"><h2>{labels.title}</h2>
    <p>{labels.hint}</p>
    {kinds.length > 1 && <div className="cs-row" role="group" aria-label="검증 방법 선택">
      {kinds.map(option => <button key={option} type="button" className={"cs-button" + (option === kind ? " cs-button-primary" : "")} disabled={busy} onClick={() => onKind(option)}>{verificationLabels[option].title}</button>)}
    </div>}
    {challenge ? <div className="cs-stack">
      <label className="cs-row">이름<input className="cs-input" id="verifyName" required maxLength={100} autoComplete="name" /></label>
      <label className="cs-row">생년월일<input className="cs-input" id="verifyBirth" required placeholder="1990-01-01" pattern="\d{4}-\d{2}-\d{2}" /></label>
      {error && <p role="alert">{error}</p>}
      <ActionButton type="button" disabled={busy} onClick={verify}>{busy ? labels.busy : labels.action}</ActionButton>
    </div> : error ? <p role="alert">{error}</p> : <p role="status">인증 요청을 준비하고 있습니다.</p>}
  </section>;
}
function ResponseForm({ data, token, participationProof }: { data: ActivePublicFormData; token: string; participationProof?: string }) {
  const [receipt, setReceipt] = useState<SubmissionReceipt>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [verification, setVerification] = useState<VerificationProof | null>(null);
  const session = useRef<PublicSubmissionSession | null>(null), content = data.content;
  session.current ??= new PublicSubmissionSession({ send: (payload, key) => api("/public/forms/" + token + "/submissions", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }) });
  const uploadCache = useRef<UploadCache>(new Map()), [uploadStatus, setUploadStatus] = useState("");
  const [values, setValues] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const sections = content.sections?.length ? content.sections : undefined;
  const [pageId, setPageId] = useState(sections?.[0]?.id ?? ""), [pageHistory, setPageHistory] = useState<string[]>(sections?.[0] ? [sections[0].id] : []);
  const [terminal, setTerminal] = useState<"consent" | "submit" | "ineligible" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const visible = visibleQuestionIds(content.questions, values);
  const currentPage = sections?.find(page => page.id === pageId), currentPageIndex = sections?.findIndex(page => page.id === pageId) ?? -1;
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (session.current?.hasPending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function prunePagePath(next: Answers, nextFiles: Record<string, File>) {
    if (!sections) return { answers: next, files: nextFiles };
    const visit = resolveFormVisit(content, next), allowed = visit?.questionIds ?? new Set<string>();
    for (const question of content.questions) if (!allowed.has(question.id)) {
      delete next[question.id]; delete nextFiles[question.id]; uploadCache.current.delete(question.id);
    }
    return { answers: next, files: nextFiles };
  }
  function change(id: string, value: AnswerValue) {
    if (busy || session.current?.hasPending) return;
    const next = { ...values, [id]: value }, shown = visibleQuestionIds(content.questions, next);
    const nextFiles = { ...files };
    for (const question of content.questions) if (!shown.has(question.id)) { delete next[question.id]; delete nextFiles[question.id]; uploadCache.current.delete(question.id); }
    const pruned = prunePagePath(next, nextFiles); setValues(pruned.answers); setFiles(pruned.files);
  }
  function advance() {
    if (!sections || !currentPage || busy || pending || !formRef.current?.reportValidity()) return;
    try {
      const destination = formPageDestination(content, currentPage.id, values);
      const nextValues = { ...values }, nextFiles = { ...files }, pruned = prunePagePath(nextValues, nextFiles);
      setValues(pruned.answers); setFiles(pruned.files); setError("");
      if (destination.kind === "page") {
        setPageHistory(history => [...history.slice(0, Math.max(0, history.lastIndexOf(currentPage.id)) + 1), destination.pageId]);
        setPageId(destination.pageId); setTerminal(null);
      } else setTerminal(destination.kind);
    } catch (cause) { setError(errorText(cause)); }
  }
  function back() {
    if (!sections || busy || pending) return;
    if (terminal) {
      const page = sections.find(item => item.id === pageHistory.at(-1));
      if (page?.allowBack) { setTerminal(null); setPageId(page.id); setError(""); }
      return;
    }
    if (!currentPage?.allowBack || pageHistory.length < 2) return;
    const history = pageHistory.slice(0, -1); setPageHistory(history); setPageId(history.at(-1)!); setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || receipt) return;
    if (sections && !terminal) { advance(); return; }
    if (terminal === "ineligible") return;
    setError("");
    const formData = new FormData(event.currentTarget), answers: Answers = {};
    setBusy(true);
    try {
    if (session.current!.hasPending) {
      setUploadStatus("접수 결과를 확인하고 있습니다."); setReceipt(await session.current!.retry()); return;
    }
    const visit = resolveFormVisit(content, values);
    if (visit?.terminal === "ineligible") throw new Error("이 응답은 참여 대상에 포함되지 않습니다.");
    const allowed = visit?.questionIds ?? visible;
    const attachments: Record<string, { fileId: string; token: string }> = {};
    for (const question of content.questions) {
      if (!visible.has(question.id) || !allowed.has(question.id)) continue;
      if (isFileQuestion(question.type)) {
        const file = files[question.id];
        if (file instanceof File && file.name) {
          const uploaded = await uploadFile(file, { token, questionId: question.id, participationProof }, uploadCache.current, setUploadStatus);
          answers[question.id] = question.type === "직접 그리기" ? drawingAnswerFromFile(uploaded) : uploaded.id;
          attachments[question.id] = { fileId: uploaded.id, token: uploaded.uploadToken! };
        } else answers[question.id] = emptyAnswer(question.type);
        continue;
      }
      answers[question.id] = values[question.id] ?? emptyAnswer(question.type);
    }
    const payload = JSON.stringify({ answers, marketingChannels: formData.getAll("marketingChannels").map(String), consent: formData.get("consent") === "on", documentConsents: formData.getAll("documentConsents").map(String), attachments,
      ...(participationProof ? { participationProof } : {}),
      ...(verification ? { verification: { attemptId: verification.attemptId, receipt: verification.receipt } } : {}) });
      setUploadStatus("응답을 제출하고 있습니다.");
      setReceipt(await session.current!.submit(payload));
    } catch (cause) { setError(errorText(cause)); } finally { setPending(session.current!.hasPending); setBusy(false); setUploadStatus(""); }
  }
  const locale = effectiveFormLanguage(content.formLanguage), direction = locale === "ar" ? "rtl" : "ltr";
  if (receipt) {
    const notice = receipt.completionPage;
    const completed = <div className="cs-stack public-notice" lang={locale} dir={direction}><h1>{locale === "ko" ? "제출이 완료되었습니다." : formPhrase(locale, "phrase24")}</h1>
      {notice?.mode === "custom" ? notice.bodyRich ? <OwnedRichDocumentView document={notice.bodyRich} className="public-form-body rich-document" />
        : <p className="public-form-body">{notice.body}</p>
        : content.showSubmitNotice !== false && <p style={{ whiteSpace: "pre-line" }}>{locale === "ko" ? "응답해 주셔서 감사합니다." : formPhrase(locale, "phrase79")}</p>}
      <p>접수 번호: <span dir="ltr">{receipt.id}</span></p><p>{new Date(receipt.submittedAt).toLocaleString(locale)}</p></div>;
    return receipt.completionProof ? <AuthorAssetProvider scope={{ kind: "public", token, surface: "completion", proof: receipt.completionProof }} enabled={hasNoticeAssets(notice)}>{completed}</AuthorAssetProvider> : completed;
  }
  if (terminal === "ineligible") return <div className="cs-stack" lang={locale} dir={direction}><h1>{data.title}</h1><section className="public-ineligible"><h2>참여 대상이 아닙니다.</h2><p>선택한 답변에 따라 이 캐치폼을 더 진행할 수 없습니다.</p></section>
    {sections?.find(page => page.id === pageHistory.at(-1))?.allowBack && <ActionButton type="button" secondary onClick={back}>이전 페이지</ActionButton>}</div>;

  const questions = sections && currentPage ? content.questions.filter(question => question.pageId === currentPage.id) : content.questions;
  const questionFields = <fieldset className="public-response-fields" disabled={busy || pending}>{questions.filter(question => visible.has(question.id)).map(question =>
      <fieldset className="public-question" key={question.id} aria-describedby={question.additionalExplanation ? "question-explanation-" + question.id : undefined}><legend>{question.label} {question.required && <em>*</em>}</legend>
        <QuestionImage assetKey={question.questionImageKey} language={locale} /><QuestionMaterials question={question} language={locale} /><QuestionExplanation question={question} id={"question-explanation-" + question.id} />
        <QuestionInput question={question} value={values[question.id]} file={files[question.id]} language={content.formLanguage} onChange={value => change(question.id, value)} disabled={busy || pending}
          onFileChange={file => { if (busy || session.current!.hasPending) return;
            setFiles(current => { const next = { ...current }; if (file) next[question.id] = file; else delete next[question.id]; return next; });
            uploadCache.current.delete(question.id);
          }} />
        {question.type === "파일 업로드" && <p className="cs-muted">PDF, PNG, JPG, TXT, CSV · 파일당 최대 10MB · 검사 후 제출됩니다.</p>}</fieldset>)}</fieldset>;
  const finalStep = !sections || !!terminal;
  return <form ref={formRef} className="cs-stack" lang={locale} dir={direction} onSubmit={submit}><h1>{data.title}</h1>
    {sections && <div className="public-page-progress" role="status">{terminal ? "동의 및 제출" : `페이지 ${currentPageIndex + 1} / ${sections.length}`}</div>}
    {!sections || currentPageIndex === 0 ? <div style={{ fontSize: content.font, fontWeight: content.bold ? 700 : 400 }}>
      {content.bodyRich ? <OwnedRichDocumentView document={content.bodyRich} className="public-form-body rich-document" />
        : <p className="public-form-body">{content.body}</p>}</div> : currentPage && <section className="public-page-intro"><h2>{currentPage.title}</h2>
      {currentPage.bodyRich ? <OwnedRichDocumentView document={currentPage.bodyRich} className="public-form-body rich-document" />
        : currentPage.body && <p className="public-form-body">{currentPage.body}</p>}</section>}
    {!sections || !terminal ? questionFields : null}
    {finalStep && <>
      <section className="public-consent"><h2>개인정보 수집·이용 동의</h2><ConsentDisplay display={data.consentBundle?.display} language={locale} />
        <ConsentItems items={data.consentBundle?.collectedItems} />
        <p><strong>수집·이용 목적</strong><br />{content.consentPurpose || "별도 동의를 요청하지 않습니다."}</p>
        <p><strong>보유 및 이용 기간</strong><br />제출일로부터 {content.retentionDays}일</p>
        <p>{content.consentRequired ? data.consentBundle?.display?.requiredText : data.consentBundle?.display?.optionalText}</p>
        <label className="cs-row"><input type="checkbox" name="consent" required={content.consentRequired} />[{formRequiredLabel(locale, content.consentRequired)}] 개인정보 수집·이용에 동의합니다.</label>
      </section><ConsentDocuments bundle={data.consentBundle} selectable language={locale} />
      {content.marketing && <section className="public-consent"><h2>광고성 정보 수신동의 ({formRequiredLabel(locale, false)})</h2><p><strong>마케팅 목적</strong><br />{content.marketing.purpose}</p><p>보유 및 이용 기간: 제출일로부터 {content.retentionDays}일 · 철회하면 발송이 중지됩니다.</p><p>동의하지 않아도 응답을 제출할 수 있습니다. 채널을 각각 선택해주세요.</p>
        {content.marketing.emailQuestionId && <label className="cs-row"><input name="marketingChannels" type="checkbox" value="email" />[{formRequiredLabel(locale, false)}] 이메일 광고성 정보 수신에 동의합니다.</label>}
        {content.marketing.smsQuestionId && <label className="cs-row"><input name="marketingChannels" type="checkbox" value="sms" />[{formRequiredLabel(locale, false)}] 문자 광고성 정보 수신에 동의합니다.</label>}
        {content.marketing.kakaoQuestionId && <label className="cs-row"><input name="marketingChannels" type="checkbox" value="kakao" />[{formRequiredLabel(locale, false)}] 알림톡 광고성 정보 수신에 동의합니다.</label>}
      </section>}
    {content.verify && <fieldset className="public-response-fields" disabled={busy || pending}>
      {verification ? <section className="public-consent"><h2>{verificationLabels[verification.kind].title}</h2><p role="status">{verificationLabels[verification.kind].done} ({verification.name})</p></section>
        : <IdentityVerification key={token} token={token} kinds={data.verification?.kinds?.length ? data.verification.kinds : ["identity"]} onDone={proof => setVerification(proof)} />}
    </fieldset>}</>}
    {uploadStatus && <p role="status">{uploadStatus}</p>}
    {error && <p role="alert">{error}</p>}
    {pending && !busy && <p role="status">접수 여부를 확인할 수 없습니다. 입력 내용과 첨부를 유지하고 같은 요청으로 결과를 다시 확인해주세요.</p>}
    {sections && !terminal ? <div className="public-page-actions">{currentPage?.allowBack && <ActionButton type="button" secondary disabled={busy || pending} onClick={back}>이전 페이지</ActionButton>}
      <ActionButton type="button" disabled={busy || pending} onClick={event => { event.preventDefault(); advance(); }}>다음 페이지</ActionButton></div>
      : <div className="public-page-actions">{sections?.find(page => page.id === pageHistory.at(-1))?.allowBack && <ActionButton type="button" secondary disabled={busy || pending} onClick={back}>이전 페이지</ActionButton>}
        <ActionButton disabled={busy || (!!content.verify && !verification)}>{busy ? locale === "ko" ? "제출 중…" : formPhrase(locale, "phrase44") + "…" : pending ? "같은 요청으로 결과 확인" : formPhrase(locale, "phrase44")}</ActionButton></div>}
  </form>;
}
