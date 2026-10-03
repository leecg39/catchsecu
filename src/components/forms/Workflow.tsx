"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { ShareGrants } from "./ShareGrants";
import "./sharing.css";
import { SubmissionDetail } from "./SubmissionDetail";
import { ConsentDisplay, ConsentDocuments, FormDocumentsEditor } from "./ConsentDocuments";
import { ApprovalPanel } from "./Approvals";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import type { FormRecord, FormContent, Paged, SubmissionRecord } from "@/contracts/forms";
import { fileDownloadUrl } from "@/lib/file-upload";
const displayValue = (value: string | string[] | undefined) => Array.isArray(value) ? value.join(", ") : value || "-";

export function Workflow({ path }: { path: string }) {
  const params = useSearchParams(), applicant = path.includes("/applicant");
  const id = applicant ? path.split("/").at(-1) : params.get("formId");
  const result = useResource<FormRecord>(id ? "/forms/" + id : null);
  if (result.error) return <Panel><p role="alert">{result.error.message}</p></Panel>;
  if (result.loading) return <Panel><p role="status">캐치폼을 불러오는 중입니다.</p></Panel>;
  if (!result.data) return <Panel><p>목록에서 캐치폼을 선택해주세요.</p><Link className="cs-button" href="/form/manage">캐치폼 목록</Link></Panel>;
  return applicant ? <Responses form={result.data} /> : <Settings key={path + result.data.id} path={path} initial={result.data} />;
}
function Responses({ form }: { form: FormRecord }) {
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const result = useResource<Paged<SubmissionRecord>>("/forms/" + form.id + "/submissions?page=" + page + "&pageSize=" + pageSize);
  return <><PageHeading title="응답 정보"><p>{form.title}</p><Link className="cs-link" href={form.sourceType === "import" ? "/form/info-upload" : "/form/manage"}>목록으로</Link></PageHeading><Panel>
    <RemoteTable columns={["#", "응답 ID", "응답 내용", "제출일", "보유 기한", "상태"]} rows={(result.data?.items ?? []).map((row, index) => ({
      id: row.id, cells: [(page - 1) * pageSize + index + 1, <button key="detail" className="cs-link" onClick={() => setSelected(row.id)}>{row.id}</button>,
        !row.contentAvailable ? <span key="unavailable">{row.status === "destroyed" ? "파기됨" : row.status === "destroying" ? "파기 처리 중 · 열람 차단" : "보유 기한 종료 · 열람 차단"}</span> :
        <dl className="forms-response-values" key="answers">{row.questions.map(question => <div key={question.id}><dt>{question.label}</dt>
          <dd>{row.status === "destroyed" ? "파기됨" : (() => {
            const file = row.attachments.find(item => item.id === row.values[question.id]);
            return file ? <a className="cs-link" href={fileDownloadUrl(file.id, row.id, question.id)}>{file.name}</a> :
              question.type === "파일 업로드" && row.values[question.id] ? "첨부파일" : displayValue(row.values[question.id]);
          })()}</dd></div>)}</dl>,
        new Date(row.created).toLocaleString("ko-KR"), new Date(row.retentionUntil).toLocaleDateString("ko-KR"),
        ({ submitted: "제출 완료", corrected: "정정", withdrawn: "철회", pendingDestruction: "파기 요청", destroying: "파기 처리 중", destroyed: "파기" } as Record<string, string>)[row.status] ?? row.status],
    }))} page={page} pageSize={pageSize} total={result.data?.total ?? 0} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
      loading={result.loading} error={result.error?.message} />
  </Panel><ShareGrants formId={form.id} />{selected && <SubmissionDetail id={selected} onClose={() => setSelected(undefined)} onChanged={result.reload} />}</>;
}
function Settings({ initial, path }: { initial: FormRecord; path: string }) {
  const app = useApplication(), canWrite = app.data?.capabilities.includes("form.write");
  const router = useRouter(), share = path.endsWith("/share"), setting = path.endsWith("/set") || path.endsWith("/setting");
  const [form, setForm] = useState(initial), [content, setContent] = useState(initial.content);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pendingPublish = useRef<{ version: number; key: string } | null>(null);
  const update = (patch: Partial<FormContent>) => setContent(current => ({ ...current, ...patch }));
  async function save(next = false, refreshDisplay = false) {
    if (busy) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      // A publish retry reuses the already saved version and idempotency key.
      let saved = form;
      if (refreshDisplay || JSON.stringify(content) !== JSON.stringify(form.content)) {
        saved = await api<FormRecord>("/forms/" + form.id, { method: "PATCH", body: JSON.stringify({ version: form.version, content }) });
        setForm(saved); setContent(saved.content);
      }
      if (setting && next) {
        if (!saved.hasDraft) { router.push("/form/ai/share?formId=" + saved.id); return; }
        if (pendingPublish.current?.version !== saved.version) pendingPublish.current = { version: saved.version, key: crypto.randomUUID() };
        await api("/forms/" + saved.id + "/publish", { method: "POST", body: JSON.stringify({ version: saved.version }),
          headers: { "Idempotency-Key": pendingPublish.current!.key } });
        router.push("/form/ai/share?formId=" + saved.id);
      } else if (next) router.push("/form/ai/setting?formId=" + saved.id);
      else setMessage("서버에 저장했습니다.");
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const publicPath = form.publication?.token ? "/projects/" + form.publication.token + "/form" : "";
  const url = publicPath && typeof window !== "undefined" ? new URL(publicPath, window.location.origin).href : publicPath;
  return <><PageHeading title={share ? "캐치폼 공유" : setting ? "캐치폼 설정" : "개인정보 수집·이용 동의 설정"} /><Panel>
    <h2>{form.title}</h2>{share ? <>
      {publicPath ? <><p>{form.published ? "캐치폼이 게시되었습니다." : "공개가 일시 중지된 캐치폼입니다."}</p><Link className="cs-link" href={"/form/manage/applicant/" + form.id}>응답 정보 보기</Link>
        <div className="forms-actions"><Link className="cs-button" href={publicPath} target="_blank" rel="noopener noreferrer">응답폼 열기</Link>
          <ActionButton secondary onClick={async () => { try { await navigator.clipboard.writeText(url); setMessage("응답폼 URL을 복사했습니다."); }
            catch { setMessage("아래 주소를 선택하여 복사해주세요."); } }}>URL 복사</ActionButton></div>
        <input className="cs-input" aria-label="응답폼 URL" readOnly value={url} onFocus={event => event.target.select()} />
        {form.hasDraft && <p>게시하지 않은 수정 내용이 있습니다.</p>}</> : <p>게시된 링크가 없거나 링크를 확인할 권한이 없습니다.</p>}
    </> : <fieldset disabled={busy || form.status === "archived" || !canWrite} className="forms-settings-fields">{setting ? <>
      <label><input type="checkbox" checked={content.showSubmitNotice ?? true} onChange={event => update({ showSubmitNotice: event.target.checked })} /> 답변 제출 후 안내 표시</label>
      <label>최대 응답 수<input aria-label="최대 응답 수" className="cs-input" type="number" min="1" max="1000000" value={content.maxResponses} onChange={event => update({ maxResponses: Number(event.target.value) })} /></label>
    </> : <>
      <label><input type="checkbox" checked={content.consentRequired} onChange={event => update({ consentRequired: event.target.checked })} /> 개인정보 수집·이용 동의를 받습니다.</label>
      <label>수집·이용 목적<input className="cs-input" aria-label="수집·이용 목적" maxLength={3000} placeholder="수집·이용 목적을 입력해주세요" value={content.consentPurpose} onChange={event => update({ consentPurpose: event.target.value })} /></label>
      <label>보유·이용 기간 (일)<input className="cs-input" aria-label="보유·이용 기간" type="number" min="1" max="36500" value={content.retentionDays} onChange={event => update({ retentionDays: Number(event.target.value) })} /></label>
      <FormDocumentsEditor serviceId={form.serviceId} selections={content.documentConsents ?? []}
        stored={Object.fromEntries((form.content.documentConsents ?? []).map((selection, index) => [selection.documentVersionId, form.consentBundle?.documents[index]]))}
        onChange={documentConsents => update({ documentConsents })} />
      <button type="button" className="cs-button secondary" onClick={() => save(false, true)}>현재 표시 설정으로 저장</button>
      <details className="consent-documents"><summary>저장된 동의 문서·표시 내용 보기</summary><p>마지막 저장 시점의 내용입니다. 수정한 선택은 저장 후 표시됩니다.</p>
        <ConsentDisplay display={form.consentBundle?.display} /><ConsentDocuments bundle={form.consentBundle} /></details>
    </>}</fieldset>}
    {error && <p role="alert">{error}</p>}<p role="status">{message}</p><div className="forms-editor-actions">
      {share ? <Link className="cs-button" href="/form/manage">목록으로</Link> : <>
        <Link className="cs-button secondary" href={setting ? "/form/ai/agreement?formId=" + form.id : "/form/ai/create?edit=" + form.id}>이전으로</Link>
        <ActionButton secondary disabled={busy || form.status === "archived" || !canWrite} onClick={() => save()}>임시저장</ActionButton>
        <ActionButton disabled={busy || form.status === "archived" || !canWrite} onClick={() => save(true)}>{busy ? "저장 중…" : setting ? "게시하고 공유하기" : "다음으로"}</ActionButton></>}
    </div></Panel>{setting && <ApprovalPanel form={form} dirty={JSON.stringify(content) !== JSON.stringify(form.content)} onChanged={async () => {
      const saved = await api<FormRecord>("/forms/" + form.id); setForm(saved); setContent(saved.content); setError(""); setMessage("");
    }} />}</>;
}
