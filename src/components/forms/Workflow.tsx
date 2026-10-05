"use client";
import { ExportJobs } from "./ExportJobs";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { ShareGrants } from "./ShareGrants";
import "./sharing.css";
import { SubmissionDetail } from "./SubmissionDetail";
import { ConsentDisplay, ConsentDocuments, FormDocumentsEditor } from "./ConsentDocuments";
import { ApprovalPanel } from "./Approvals";
import { useToast } from "../ux/toast";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import type { FormRecord, FormContent, FormActions, Paged, SubmissionRecord } from "@/contracts/forms";
import { fileDownloadUrl } from "@/lib/file-upload";
import { formatAnswer } from "@/contracts/questions";
import { submissionStatusLabels, submissionStatuses } from "@/contracts/submissions";
import { useFormDraft } from "@/lib/use-form-draft";
import { draftValue } from "@/lib/form-draft";
import { DraftStatus } from "./DraftStatus";
import { FormPublicationSession } from "@/lib/form-publication";

export function Workflow({ path }: { path: string }) {
  const params = useSearchParams(), applicant = path.includes("/applicant");
  const id = applicant ? path.split("/").at(-1) : params.get("formId") ?? params.get("edit");
  const result = useResource<FormRecord>(id ? "/forms/" + id : null);
  if (result.error) return <Panel><p role="alert">{result.error.message}</p></Panel>;
  if (result.loading) return <Panel><p role="status">캐치폼을 불러오는 중입니다.</p></Panel>;
  if (!result.data) return <Panel><p>목록에서 캐치폼을 선택해주세요.</p><Link className="cs-button" href="/form/manage">캐치폼 목록</Link></Panel>;
  return applicant ? <Responses form={result.data} /> : <Settings key={path + result.data.id} path={path} initial={result.data} />;
}
function Responses({ form }: { form: FormRecord }) {
  const app = useApplication();
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const blank = { status: "all", start: "", end: "", search: "" };
  const [draft, setDraft] = useState(blank), [filters, setFilters] = useState(blank);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const query = new URLSearchParams({ status: filters.status });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.start) query.set("from", new Date(filters.start + "T00:00:00+09:00").toISOString());
  if (filters.end) query.set("to", new Date(new Date(filters.end + "T00:00:00+09:00").getTime() + 86400000).toISOString());
  const responsePath = "/forms/" + form.id + "/submissions";
  const result = useResource<Paged<SubmissionRecord>>(responsePath + "?" + query.toString() + "&page=" + page + "&pageSize=" + pageSize);
  function search() {
    if (draft.start && draft.end && draft.start > draft.end) { setExportError("종료일은 시작일 이후로 선택해주세요."); return; }
    setExportError(""); setPage(1); setFilters({ ...draft });
  }
  async function download() {
    if (exporting) return;
    setExportError(""); setExporting(true);
    try {
      const response = await fetch("/api/v1" + responsePath + "/export?" + query.toString(), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const value = await response.json().catch(() => null); throw new Error(value?.error?.message ?? "CSV를 내려받을 수 없습니다."); }
      if (!response.headers.get("content-type")?.startsWith("text/csv")) throw new Error("CSV 응답 형식을 확인할 수 없습니다.");
      const objectUrl = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = objectUrl; link.download = "responses-" + form.id + ".csv"; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
    } catch (cause) { setExportError(errorText(cause)); } finally { setExporting(false); }
  }
  return <><PageHeading title="응답 정보"><p>{form.title}</p><Link className="cs-link" href={form.sourceType === "import" ? "/form/info-upload" : "/form/manage"}>목록으로</Link></PageHeading><Panel>
    <form className="forms-actions" onSubmit={event => { event.preventDefault(); search(); }}>
      <label className="cs-label">제출 시작일<input className="cs-input" type="date" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
      <label className="cs-label">제출 종료일<input className="cs-input" type="date" value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
      <label className="cs-label">응답 상태<select className="cs-input" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="all">전체</option>
        {submissionStatuses.map(status => <option key={status} value={status}>{submissionStatusLabels[status]}</option>)}</select></label>
      <label className="cs-label">응답 ID 검색<input className="cs-input" maxLength={100} value={draft.search} onChange={event => setDraft({ ...draft, search: event.target.value })} /></label>
      <button className="cs-button" type="submit">검색</button><button className="cs-button secondary" type="button" onClick={() => { setDraft(blank); setFilters(blank); setPage(1); setExportError(""); }}>초기화</button>
    </form><div className="forms-actions"><ActionButton secondary disabled={exporting || !app.data?.capabilities.includes("submission.read")} onClick={download}>{exporting ? "CSV 준비 중…" : "CSV 내보내기"}</ActionButton>
      <p className="cs-muted">현재 검색 조건의 전체 응답을 내보냅니다. 최대 5,000건·20MB이며 종료일을 포함합니다.</p></div>
    {exportError && <p role="alert">{exportError}</p>}
    <RemoteTable columns={["#", "응답 ID", "응답 내용", "제출일", "보유 기한", "상태"]} rows={(result.data?.items ?? []).map((row, index) => ({
      id: row.id, cells: [((result.data?.page ?? page) - 1) * pageSize + index + 1, <button key="detail" className="cs-link" onClick={() => setSelected(row.id)}>{row.id}</button>,
        !row.contentAvailable ? <span key="unavailable">{row.status === "destroyed" ? "파기됨" : row.status === "destroying" ? "파기 처리 중 · 열람 차단" : "보유 기한 종료 · 열람 차단"}</span> :
        <dl className="forms-response-values" key="answers">{row.questions.map(question => <div key={question.id}><dt>{question.label}</dt>
          <dd>{row.status === "destroyed" ? "파기됨" : (() => {
            const file = row.attachments.find(item => item.id === row.values[question.id]);
            return file ? <a className="cs-link" href={fileDownloadUrl(file.id, row.id, question.id)}>{file.name}</a> :
              question.type === "파일 업로드" && row.values[question.id] ? "첨부파일" : formatAnswer(row.values[question.id], question.rows);
          })()}</dd></div>)}</dl>,
        new Date(row.created).toLocaleString("ko-KR"), new Date(row.retentionUntil).toLocaleDateString("ko-KR"),
        ({ submitted: "제출 완료", corrected: "정정", withdrawn: "철회", pendingDestruction: "파기 요청", destroying: "파기 처리 중", destroyed: "파기" } as Record<string, string>)[row.status] ?? row.status],
    }))} page={result.data?.page ?? page} pageSize={pageSize} total={result.data?.total ?? 0} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
      loading={result.loading} error={result.error?.message} />
  </Panel><ExportJobs formId={form.id} filters={Object.fromEntries(query)} /><ShareGrants formId={form.id} />{selected && <SubmissionDetail id={selected} onClose={() => setSelected(undefined)} onChanged={result.reload} />}</>;
}
function Settings({ initial, path }: { initial: FormRecord; path: string }) {
  const [permissions, setPermissions] = useState<FormActions | undefined>(initial.actions);
  const [permissionError, setPermissionError] = useState("");
  const readRevision = useRef(0);
  const invalidateReads = useCallback(() => { readRevision.current++; }, []);
  const readCurrent = useCallback(async (id: string) => {
    const revision = ++readRevision.current;
    try {
      const current = await api<FormRecord>("/forms/" + id);
      if (revision === readRevision.current) { setPermissions(current.actions); setPermissionError(""); }
      return current;
    } catch (cause) {
      if (revision === readRevision.current) { setPermissions(undefined); setPermissionError(errorText(cause)); }
      throw cause;
    }
  }, []);
  const canWrite = !!permissions?.edit;
  const router = useRouter(), share = path.endsWith("/share"), setting = path.endsWith("/set") || path.endsWith("/setting"), recipient = path.endsWith("/recipient");
  const draft = useFormDraft(initial, draftValue(initial), !share && !!canWrite && initial.status !== "archived");
  const form = draft.record ?? initial, content = draft.value.content;
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [transitioning, setTransitioning] = useState(false);
  const toast = useToast();
  const busy = transitioning || draft.saving;
  const [publicationSession] = useState(() => new FormPublicationSession({ read: id => api<FormRecord>("/forms/" + id),
    publish: (id, version, key) => api("/forms/" + id + "/publish", { method: "POST", body: JSON.stringify({ version }), headers: { "Idempotency-Key": key } }) }));
  useEffect(() => {
    const refresh = () => { void readCurrent(initial.id).catch(() => undefined); };
    refresh(); const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); invalidateReads(); };
  }, [initial.id, form.version, readCurrent, invalidateReads]);
  const update = (patch: Partial<FormContent>) => draft.edit(current => ({ ...current, content: { ...current.content, ...patch } }));
  async function save(next = false, refreshDisplay = false) {
    if (busy) return;
    if (refreshDisplay && !canWrite || !canWrite && draft.dirty) { setError("이 서비스의 작성 권한이 없습니다. 수정한 내용은 화면에 남아 있습니다."); return; }
    setError(""); setMessage(""); setTransitioning(true);
    try {
      const saved = await draft.save(refreshDisplay);
      if (!saved) return;
      if (setting && next) {
        await publicationSession.publish(saved); await readCurrent(saved.id);
        router.push("/form/ai/share?formId=" + saved.id);
      } else {
        await readCurrent(saved.id);
        if (next) router.push((recipient ? "/form/ai/agreement" : "/form/ai/setting") + "?formId=" + saved.id);
        else setMessage("서버에 저장했습니다.");
      }
    } catch (cause) { setError(errorText(cause)); void readCurrent(form.id).catch(() => undefined); } finally { setTransitioning(false); }
  }
  async function previous() {
    if (busy) return;
    if (!canWrite && draft.dirty) { setError("작성 권한이 회수되었습니다. 수정한 내용은 화면에 남아 있습니다."); return; }
    setTransitioning(true);
    try {
      const saved = await draft.save();
      if (saved) router.push(setting ? "/form/ai/agreement?formId=" + saved.id : recipient ? "/form/ai/create?edit=" + saved.id : "/form/ai/recipient?formId=" + saved.id);
    } catch (cause) { setError(errorText(cause)); } finally { setTransitioning(false); }
  }
  const publicPath = permissions?.share && form.publication?.token ? "/projects/" + form.publication.token + "/form" : "";
  const url = publicPath && typeof window !== "undefined" ? new URL(publicPath, window.location.origin).href : publicPath;
  return <><PageHeading title={share ? "캐치폼 공유" : setting ? "캐치폼 설정" : recipient ? "제3자 제공 동의 설정" : "개인정보 수집·이용 동의 설정"} />
    <nav className="forms-steps" aria-label="캐치폼 편집 단계"><Link href={"/form/ai/create?edit=" + form.id}>질문</Link>
      <Link href={"/form/ai/recipient?formId=" + form.id} aria-current={recipient ? "step" : undefined}>제공 동의</Link>
      <Link href={"/form/ai/agreement?formId=" + form.id} aria-current={!recipient && !setting && !share ? "step" : undefined}>수집 동의</Link>
      <Link href={"/form/ai/setting?formId=" + form.id} aria-current={setting ? "step" : undefined}>설정</Link>
      {share && <span aria-current="step">공유</span>}</nav><Panel>
    <h2>{form.title}</h2>{share ? <>
      {publicPath ? <><p>{form.published ? "캐치폼이 게시되었습니다." : "공개가 일시 중지된 캐치폼입니다."}</p>{permissions?.responses && <Link className="cs-link" href={"/form/manage/applicant/" + form.id}>응답 정보 보기</Link>}
        <div className="forms-actions"><Link className="cs-button" href={publicPath} target="_blank" rel="noopener noreferrer">응답폼 열기</Link>
          <ActionButton secondary onClick={async () => { try { await navigator.clipboard.writeText(url); toast("응답폼 URL을 복사했습니다."); }
            catch { toast("자동 복사를 할 수 없습니다. 아래 주소를 선택하여 복사해주세요.", "error"); } }}>URL 복사</ActionButton></div>
        <input className="cs-input" aria-label="응답폼 URL" readOnly value={url} onFocus={event => event.target.select()} />
        {form.hasDraft && <p>게시하지 않은 수정 내용이 있습니다.</p>}</> : <p>게시된 링크가 없거나 링크를 확인할 권한이 없습니다.</p>}
    </> : <fieldset disabled={transitioning || form.status === "archived" || !canWrite} className="forms-settings-fields">{setting ? <>
      <label><input type="checkbox" checked={content.showSubmitNotice ?? true} onChange={event => update({ showSubmitNotice: event.target.checked })} /> 답변 제출 후 안내 표시</label>
      <label>최대 응답 수<input aria-label="최대 응답 수" className="cs-input" type="number" min="1" max="1000000" value={content.maxResponses} onChange={event => update({ maxResponses: Number(event.target.value) })} /></label>
    </> : <>{!recipient && <>
      <label><input type="checkbox" checked={content.consentRequired} onChange={event => update({ consentRequired: event.target.checked })} /> 개인정보 수집·이용 동의를 받습니다.</label>
      <label>수집·이용 목적<input className="cs-input" aria-label="수집·이용 목적" maxLength={3000} placeholder="수집·이용 목적을 입력해주세요" value={content.consentPurpose} onChange={event => update({ consentPurpose: event.target.value })} /></label>
      <label className="member-check"><input type="checkbox" checked={content.retentionDays === null} onChange={event => update({ retentionDays: event.target.checked ? null : 365 })} /> 보유 기간 미지정 (제출 시점의 회사 기본 보유 기간 적용)</label>
      {content.retentionDays !== null
        ? <label>보유·이용 기간 (일)<input className="cs-input" aria-label="보유·이용 기간" type="number" min="1" max="36500" value={content.retentionDays} onChange={event => update({ retentionDays: Number(event.target.value) })} /></label>
        : <p>이 폼의 응답은 접수 시점의 회사 기본 보유 기간으로 보유·이용 기간을 계산합니다. 회사 정책 변경은 이후 접수 건부터 반영됩니다.</p>}
      </>}{recipient && <p>제공받는 자와 항목·목적·기간을 담은 게시 문서를 연결합니다. 수집·이용 문서는 다음 단계에서 설정합니다.</p>}
      <FormDocumentsEditor serviceId={form.serviceId} selections={content.documentConsents ?? []} kind={recipient ? "third_party" : "collection"}
        stored={Object.fromEntries((form.content.documentConsents ?? []).map((selection, index) => [selection.documentVersionId, form.consentBundle?.documents[index]]))}
        onChange={documentConsents => update({ documentConsents })} />
      <button type="button" className="cs-button secondary" onClick={() => save(false, true)}>현재 표시 설정으로 저장</button>
      <details className="consent-documents"><summary>저장된 동의 문서·표시 내용 보기</summary><p>마지막 저장 시점의 내용입니다. 수정한 선택은 저장 후 표시됩니다.</p>
        <ConsentDisplay display={form.consentBundle?.display} /><ConsentDocuments bundle={form.consentBundle} /></details>
    </>}</fieldset>}
    {permissionError && <p role="alert">{permissionError}</p>}{error && <p role="alert">{error}</p>}<p role="status">{message}</p>
    {!share && !canWrite && <p role="status">현재 서비스의 작성 권한이 없어 설정을 조회하고 있습니다. 게시 권한이 있으면 저장된 초안을 게시할 수 있습니다.</p>}
    {!share && setting && form.hasDraft && !permissions?.publish && <p>현재 서비스의 게시 권한이 필요합니다. 승인이 필요한 회사는 아래 승인 내역도 확인해주세요.</p>}
    {!share && canWrite && <DraftStatus draft={draft} />}<div className="forms-editor-actions">
      {share ? <Link className="cs-button" href="/form/manage">목록으로</Link> : <>
        <ActionButton secondary disabled={busy || !canWrite && draft.dirty} onClick={previous}>이전으로</ActionButton>
        <ActionButton secondary disabled={busy || form.status === "archived" || !canWrite} onClick={() => save()}>임시저장</ActionButton>
        <ActionButton disabled={busy || !canWrite && draft.dirty || (setting ? !(permissions?.publish || !form.hasDraft && permissions?.share) : false)} onClick={() => save(true)}>{busy ? "처리 중…" : setting ? form.hasDraft ? "게시하고 공유하기" : "공유하기" : "다음으로"}</ActionButton></>}
    </div></Panel>{setting && <ApprovalPanel form={form} dirty={draft.dirty || busy} onChanged={async () => {
      const saved = await readCurrent(form.id); draft.accept(saved); setError(""); setMessage("");
    }} />}</>;
}
