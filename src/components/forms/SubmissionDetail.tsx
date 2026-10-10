"use client";
import { AuthorAssetProvider } from "./AuthorAssetProvider";
import { hasAuthorAssets } from "@/lib/author-assets";
import { ConsentDisplay, ConsentDocuments } from "./ConsentDocuments";
import { PdfDownload } from "../PdfDownload";
import type { ConsentEvidence } from "@/contracts/form-documents";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { Question } from "@/contracts/forms";
import { useApplication } from "../ApplicationContext";
import { Modal, ActionButton } from "../shared";
import { FILE_ACCEPT, type FileInfo } from "@/contracts/files";
import { fileDownloadUrl, uploadFile, type UploadCache } from "@/lib/file-upload";
import { SubmissionDestruction } from "../management/destruction";
import { QuestionInput } from "./QuestionInput";
import { QuestionChoiceSummary } from "./QuestionChoiceSummary";
import { QuestionMaterials } from "./QuestionMaterials";
import { QuestionImage } from "./QuestionImage";
import { QuestionExplanation } from "./QuestionExplanation";
import { QuestionPersonalInformation } from "./QuestionPersonalInformation";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { emptyAnswer, formatAnswer, visibleQuestionIds, type AnswerValue, type Answers } from "@/contracts/questions";
import { drawingAnswerFromFile, fileAnswerId, isFileQuestion } from "@/contracts/drawing-questions";
import type { FormLanguage } from "@/contracts/form-language";

type Values = Answers;
type Detail = {
  id: string; formId: string; title: string; version: number; status: string; createdAt: string; retentionUntil: string; legalHold: boolean;
  originalRetentionUntil: string; contentAvailable: boolean;
  source: "csv" | "form"; importEvidence: { origin: string; collectedAt: string; sourceStatement: string; rowEvidence: string; consentAsserted: boolean;
    snapshot: { purpose: { name: string; basisReference: string }; recipient: { name: string } | null } } | null;
  values: Values; questions: Question[]; formLanguage?: FormLanguage;
  attachments: FileInfo[];
  corrections: { id: string; reason: string; actorId: string; createdAt: string; changedFields: string[]; before: Values | null; after: Values | null }[];
  notes: { id: string; text: string; version: number; actorId: string; createdAt: string }[];
  receipts: { id: string; purpose: string; retentionDays: number; grantedAt: string; documentHash: string; pdfHash: string | null; pdfAvailable: boolean; evidence: ConsentEvidence | null; events: { type: string; reason: string; createdAt: string }[] }[];
};
const statuses: Record<string, string> = { submitted: "제출 완료", corrected: "정정", withdrawn: "철회", pendingDestruction: "파기 요청", destroying: "파기 처리 중", destroyed: "파기 완료" };
export function SubmissionDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const result = useResource<Detail>("/submissions/" + id);
  if (result.data) return <DetailView key={result.data.version + ":" + result.data.notes.map(note => note.id + note.version).join(",")}
    row={result.data} onClose={onClose} reload={() => { result.reload(); onChanged(); }} />;
  return <Modal title="응답 상세" onClose={onClose}>
    {result.loading ? <p role="status">응답을 불러오는 중입니다.</p> : result.error && <p role="alert">{result.error.message}</p>}
  </Modal>;
}
function DetailView({ row, reload, onClose }: { row: Detail; reload: () => void; onClose: () => void }) {
  const app = useApplication(), canWrite = app.data?.capabilities.includes("submission.write"), canDestroy = app.data?.capabilities.includes("submission.destroy");
  const confirm = useConfirm();
  const [mode, setMode] = useState<"edit" | "withdraw" | "hold" | "destruction-request" | "retention">(), [values, setValues] = useState(row.values);
  const [retention, setRetention] = useState(() => { const d = new Date(row.retentionUntil); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [noteText, setNoteText] = useState(""), [editingNote, setEditingNote] = useState<Detail["notes"][number]>(), [deleteNote, setDeleteNote] = useState("");
  const pendingNote = useRef<{ payload: string; key: string } | null>(null);
  const uploads = useRef<UploadCache>(new Map()), [files, setFiles] = useState<Record<string, File>>({}), [uploadStatus, setUploadStatus] = useState("");
  const noteDirty = noteText !== (editingNote?.text ?? "");
  const originalDate = new Date(row.retentionUntil);
  const originalRetention = new Date(originalDate.getTime() - originalDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const modeDirty = !!mode && (!!reason || Object.keys(files).length > 0 ||
    mode === "edit" && JSON.stringify(values) !== JSON.stringify(row.values) || mode === "retention" && retention !== originalRetention);
  const dirty = noteDirty || modeDirty;
  useUnsavedChanges(dirty || busy);
  async function discard(changed = dirty) {
    return !changed || confirm({ title: "저장하지 않은 변경 사항", message: "저장하지 않은 응답 또는 메모 입력을 버릴까요?", confirmLabel: "입력 버리기", cancelLabel: "계속 편집" });
  }
  function failed(cause: unknown) { setError(errorText(cause)); if (cause instanceof ApiError && cause.status === 409) setConflict(true); }
  async function cancelMode() {
    if (busy || !await discard(modeDirty)) return;
    setMode(undefined); setReason(""); setValues(row.values); setRetention(originalRetention); setFiles({}); uploads.current.clear();
  }
  const visible = visibleQuestionIds(row.questions, values);
  function change(id: string, value: AnswerValue) {
    if (busy || conflict) return;
    const next = { ...values, [id]: value }, shown = visibleQuestionIds(row.questions, next);
    const nextFiles = { ...files };
    for (const question of row.questions) if (!shown.has(question.id)) {
      next[question.id] = emptyAnswer(question.type); delete nextFiles[question.id]; uploads.current.delete(question.id);
    }
    setValues(next); setFiles(nextFiles);
  }
  function answerView(questionId: string, value: AnswerValue | undefined) {
    if (questionId === "status" && typeof value === "string") return statuses[value] ?? value;
    if (questionId === "legalHold" && typeof value === "string") return value === "true" ? "보존 조치" : "해제";
    if (questionId === "retentionUntil" && typeof value === "string") return new Date(value).toLocaleString("ko-KR");
    const question = row.questions.find(question => question.id === questionId);
    if (!question || !isFileQuestion(question.type) || !value) return formatAnswer(value, question?.rows, question?.optionDefinitions, question?.type);
    const file = row.attachments.find(item => item.id === fileAnswerId(value));
    return file ? <a className="cs-link" href={fileDownloadUrl(file.id, row.id, questionId)}>{file.name} · 다운로드</a> : "열람할 수 없는 첨부파일";
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || conflict) return; setBusy(true); setError("");
    try {
      if (mode === "edit") {
        const answers = { ...values };
        // Redacted DRAW values are opaque IDs for display; omit them from the strict
        // write contract so the server keeps the encrypted baseline unchanged.
        if (!app.data?.capabilities.includes("file.read")) for (const question of row.questions) if (isFileQuestion(question.type)) delete answers[question.id];
        for (const [questionId, file] of Object.entries(files)) {
          const uploaded = await uploadFile(file, { submissionId: row.id, questionId }, uploads.current, setUploadStatus);
          answers[questionId] = row.questions.find(question => question.id === questionId)?.type === "직접 그리기" ? drawingAnswerFromFile(uploaded) : uploaded.id;
        }
        await api("/submissions/" + row.id, { method: "PATCH", body: JSON.stringify({ version: row.version, reason, answers }) });
      }
      else if (mode === "retention") await api("/submissions/" + row.id + "/retention", { method: "PATCH", body: JSON.stringify({
        version: row.version, reason, retentionUntil: new Date(retention).toISOString(),
      }) });
      else await api("/submissions/" + row.id + "/" + mode, { method: "POST", body: JSON.stringify({
        version: row.version, reason, ...(mode === "hold" ? { hold: !row.legalHold } : {}),
      }) });
      reload();
    } catch (cause) { failed(cause); } finally { setBusy(false); setUploadStatus(""); }
  }
  async function saveNote(event: FormEvent) {
    event.preventDefault(); if (busy || conflict || mode) return; setBusy(true); setError("");
    try {
      const payload = JSON.stringify({ text: noteText, ...(editingNote ? { version: editingNote.version } : {}) });
      if (pendingNote.current?.payload !== payload) pendingNote.current = { payload, key: crypto.randomUUID() };
      await api("/submissions/" + row.id + "/notes" + (editingNote ? "/" + editingNote.id : ""), {
        method: editingNote ? "PATCH" : "POST", body: payload, headers: { "Idempotency-Key": pendingNote.current!.key },
      }); reload();
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  }
  return <AuthorAssetProvider scope={{ kind: "submission", id: row.id }} enabled={row.contentAvailable && hasAuthorAssets(row.questions)}><Modal title="응답 상세" onClose={() => { if (!busy) void discard().then(leave => { if (leave) onClose(); }); }}>
    <div className="forms-submission-detail"><h3>{row.title}</h3><p>{statuses[row.status]} · {new Date(row.createdAt).toLocaleString("ko-KR")}</p>
    <p>보유 기한: {new Date(row.retentionUntil).toLocaleDateString("ko-KR")} {row.legalHold && "· 보존 조치 중"}</p>
    {mode ? <form className="cs-stack" onSubmit={save}>
      <h3>{{ edit: "응답 정정", withdraw: "동의 철회", hold: row.legalHold ? "보존 조치 해제" : "보존 조치", "destruction-request": "파기 요청", retention: "보유 기한 변경" }[mode]}</h3>
      {mode === "retention" && <label className="cs-label">변경할 보유 기한<input className="cs-input" aria-label="변경할 보유 기한" type="datetime-local" required value={retention} onChange={event => setRetention(event.target.value)} />
        <span>회사 정책이 허용한 경우, 동의받은 원래 기한 {new Date(row.originalRetentionUntil).toLocaleString("ko-KR")} 이내로 변경합니다.</span></label>}
      {mode === "edit" && row.questions.filter(question => visible.has(question.id)).map(question => <fieldset disabled={busy} className="cs-label forms-correction-field" key={question.id}
        aria-describedby={question.additionalExplanation ? "correction-explanation-" + question.id : undefined}><legend>{question.label}</legend>
        <QuestionImage assetKey={question.questionImageKey} language={row.formLanguage} /><QuestionPersonalInformation question={question} /><QuestionMaterials question={question} language={row.formLanguage} /><QuestionExplanation question={question} id={"correction-explanation-" + question.id} />
        {question.type === "직접 그리기" ? <div><p>{answerView(question.id, values[question.id])}</p>
          <QuestionInput question={question} value={values[question.id]} file={files[question.id]} language={row.formLanguage}
            savedPreview={row.attachments.some(item => item.id === fileAnswerId(values[question.id])) ? fileDownloadUrl(fileAnswerId(values[question.id])!, row.id, question.id) : undefined}
            disabled={busy || conflict || row.legalHold || !app.data?.capabilities.includes("file.read")}
            onChange={value => change(question.id, value)} onFileChange={file => {
              if (busy || conflict || row.legalHold || !app.data?.capabilities.includes("file.read")) return;
              const next = { ...files }; if (file) next[question.id] = file; else delete next[question.id];
              setFiles(next); if (!file) setValues(current => ({ ...current, [question.id]: null })); uploads.current.delete(question.id);
            }} />
          <p className="cs-muted">새 그림을 적용하면 검사 후 교체합니다. 이전 그림은 정정 이력에 보관됩니다.</p>
        </div> : question.type === "파일 업로드" ? <div><p>{answerView(question.id, values[question.id])}</p>
          <input className="cs-input" type="file" accept={FILE_ACCEPT} aria-label={question.label} required={question.required && !values[question.id]}
            disabled={busy || row.legalHold || !app.data?.capabilities.includes("file.read")} onChange={event => {
              const next = { ...files }; if (event.target.files?.[0]) next[question.id] = event.target.files[0]; else delete next[question.id];
              setFiles(next); uploads.current.delete(question.id);
            }} /><p className="cs-muted">새 파일을 선택하면 검사 후 첨부파일을 교체합니다. 이전 파일은 정정 이력에 보관됩니다.</p>
          {!question.required && <label><input type="checkbox" disabled={busy || row.legalHold || !app.data?.capabilities.includes("file.read")} checked={!values[question.id] && !files[question.id]}
            onChange={event => { setValues({ ...values, [question.id]: event.target.checked ? "" : row.values[question.id] }); const next = { ...files }; delete next[question.id]; setFiles(next); }} />첨부파일 비우기</label>}
        </div> : <QuestionInput question={question} value={values[question.id]} language={row.formLanguage} onChange={value => change(question.id, value)} disabled={busy || conflict} />}</fieldset>)}
      {mode === "destruction-request" && <p>파기 요청을 등록합니다. 실제 파기 완료 상태는 처리 결과에 따라 별도로 표시됩니다.</p>}
      <label className="cs-label">변경 사유<textarea aria-label="변경 사유" className="cs-input" disabled={busy} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="forms-actions"><ActionButton disabled={busy || conflict}>확인</ActionButton><ActionButton secondary type="button" disabled={busy} onClick={() => void cancelMode()}>취소</ActionButton></div>
    </form> : <>
      {!row.contentAvailable && <p role="status">{row.status === "destroyed" ? "응답 원문과 관련 자료를 파기했습니다." : "보유 기한이 지났거나 파기가 시작되어 원문 열람을 차단했습니다."}</p>}
      {row.contentAvailable && <PdfDownload label="응답 PDF 다운로드" path={`/submissions/${row.id}/pdf`} />}
      <dl className="forms-response-values">{row.questions.map(question => <div key={question.id}><dt>{question.label}{row.contentAvailable && <QuestionImage assetKey={question.questionImageKey} language={row.formLanguage} />}<QuestionPersonalInformation question={question} /><QuestionMaterials question={question} language={row.formLanguage} /><QuestionExplanation question={question} /><QuestionChoiceSummary question={question} language={row.formLanguage} imagesOnly /></dt><dd>{row.contentAvailable ? answerView(question.id, row.values[question.id]) : row.status === "destroyed" ? "파기됨" : "열람 차단"}</dd></div>)}</dl>
      <fieldset disabled={busy || noteDirty || conflict} style={{ border: 0, padding: 0, margin: 0 }}><div className="forms-actions">{canWrite && row.contentAvailable && !row.legalHold && ["submitted", "corrected"].includes(row.status) && <>
        <ActionButton secondary onClick={() => setMode("edit")}>응답 정정</ActionButton><ActionButton secondary onClick={() => setMode("withdraw")}>동의 철회</ActionButton></>}
        {canDestroy && !["destroying", "destroyed"].includes(row.status) && <>
          <ActionButton secondary onClick={() => setMode("hold")}>{row.legalHold ? "보존 조치 해제" : "보존 조치"}</ActionButton>
          <ActionButton secondary disabled={row.legalHold || row.status === "pendingDestruction"} onClick={() => setMode("destruction-request")}>파기 요청</ActionButton>
          {row.contentAvailable && !row.legalHold && row.status !== "pendingDestruction" && <ActionButton secondary onClick={() => setMode("retention")}>보유 기한 변경</ActionButton>}</>}
      </div></fieldset>
    </>}
    {error && <p role="alert">{error}</p>}
    {conflict && <div><p>현재 응답이나 메모가 변경되었습니다. 입력은 유지했습니다. 최신 내용을 확인한 뒤 다시 수정해주세요.</p>
      <ActionButton secondary disabled={busy} onClick={() => { void discard().then(leave => { if (leave) reload(); }); }}>최신 응답 다시 불러오기</ActionButton></div>}
    {uploadStatus && <p role="status">{uploadStatus}</p>}
    {canDestroy && <fieldset disabled={busy || dirty || !!mode || conflict} style={{ border: 0, padding: 0, margin: 0 }}><SubmissionDestruction key={row.version} id={row.id} changed={reload} /></fieldset>}
    <fieldset disabled={busy || !!mode || conflict} style={{ border: 0, padding: 0, margin: 0 }}><section><h3>담당자 메모</h3>{row.notes.length ? row.notes.map(note => <article className="forms-note" key={note.id}>
      <p>{note.text}</p><small>{new Date(note.createdAt).toLocaleString("ko-KR")}</small>
      {canWrite && <div className="forms-row-actions"><button disabled={busy || noteDirty} onClick={() => { setEditingNote(note); setNoteText(note.text); }}>메모 수정</button>
        <button disabled={busy || noteDirty} onClick={async () => { if (deleteNote !== note.id) { setDeleteNote(note.id); return; }
          setBusy(true); setError(""); try { await api("/submissions/" + row.id + "/notes/" + note.id, { method: "DELETE", headers: { "If-Match": String(note.version) } }); reload(); }
          catch (cause) { failed(cause); } finally { setBusy(false); } }}>{deleteNote === note.id ? "메모 삭제 확인" : "메모 삭제"}</button></div>}
    </article>) : <p>등록된 메모가 없습니다.</p>}
      {canWrite && row.contentAvailable && <form className="cs-stack" onSubmit={saveNote}><label className="cs-label">{editingNote ? "메모 수정" : "새 메모"}
        <textarea aria-label="담당자 메모" className="cs-input" required maxLength={5000} value={noteText} onChange={event => setNoteText(event.target.value)} /></label>
        <div className="forms-actions"><ActionButton secondary disabled={busy}>{editingNote ? "메모 수정 저장" : "메모 저장"}</ActionButton>
          {editingNote && <ActionButton type="button" secondary onClick={() => { void discard(noteDirty).then(leave => { if (leave) { setEditingNote(undefined); setNoteText(""); } }); }}>취소</ActionButton>}</div></form>}
    </section></fieldset>
    <section><h3>변경 이력</h3>{row.corrections.length ? row.corrections.map(change => <article className="forms-note" key={change.id}>
      <p>{change.reason}</p><small>{new Date(change.createdAt).toLocaleString("ko-KR")}</small>
      {change.changedFields.map(id => <p key={id}>{row.questions.find(question => question.id === id)?.label ?? ({status:"상태",legalHold:"보존 조치"} as Record<string,string>)[id] ?? id}: {answerView(id, change.before?.[id])} → {answerView(id, change.after?.[id])}</p>)}
    </article>) : <p>변경 이력이 없습니다.</p>}</section>
    {row.source === "csv" && <section><h3>CSV 수집 근거</h3>{row.importEvidence ? <>
      <p>{row.importEvidence.origin} · 원 수집일 {new Date(row.importEvidence.collectedAt).toLocaleString("ko-KR")}</p>
      <p>목적: {row.importEvidence.snapshot.purpose.name} · {row.importEvidence.snapshot.purpose.basisReference}</p>
      <p>{row.importEvidence.sourceStatement}</p>{row.importEvidence.rowEvidence && <p>행별 증거: {row.importEvidence.rowEvidence}</p>}
      {row.importEvidence.snapshot.recipient && <p>원자료 제공자: {row.importEvidence.snapshot.recipient.name}</p>}
      {row.importEvidence.consentAsserted && <p>업로더가 CSV에 기재한 동의 기록입니다.</p>}</> : <p>수집 증거의 열람 기간이 종료되었습니다.</p>}</section>}
    <section><h3>동의 이력</h3>{row.receipts.length ? row.receipts.map(receipt => <article className="forms-note" key={receipt.id}><p>{receipt.purpose} · {receipt.retentionDays}일</p>
      {receipt.evidence && <details className="consent-documents"><summary>제출 당시 동의 증거 보기</summary><p>기본 수집·이용: {receipt.evidence.generalConsent ? "동의함" : "동의하지 않음"} · 폼 v{receipt.evidence.formVersion}</p>
        {receipt.evidence.schemaVersion === 2 && <><p>제시 경로: {receipt.evidence.presentation.visitedPageIds.join(" → ") || "단일 페이지"} · {receipt.evidence.presentation.terminationKind === "consent" ? "동의 단계" : "제출 단계"}</p>
          <p>고정 본문 {receipt.evidence.presentation.documents.length}개 · 이미지 {receipt.evidence.presentation.documents.reduce((sum, document) => sum + document.images.length, 0)}개 · 증거 v2</p></>}
        <ConsentDisplay display={receipt.evidence.bundle.display} /><ConsentDocuments bundle={receipt.evidence.bundle} />
        <p className="consent-hash">증거 해시: {receipt.documentHash}</p><p className="consent-hash">PDF 해시: {receipt.pdfHash}</p></details>}
      {receipt.pdfAvailable ? <PdfDownload label="동의 영수증 PDF 다운로드" path={`/submissions/${row.id}/receipts/${receipt.id}/pdf`} /> : <p>이 기록에는 제출 당시의 문서 PDF가 없습니다.</p>}
      {receipt.events.map((event, index) => <p key={index}>{event.type === "granted" ? "동의" : event.type === "withdrawn" ? "철회" : event.type === "imported" ? "CSV 동의 기록 반영" : event.type} · {new Date(event.createdAt).toLocaleString("ko-KR")}</p>)}</article>) : <p>동의 영수증이 없습니다.</p>}</section>
  </div></Modal></AuthorAssetProvider>;
}
