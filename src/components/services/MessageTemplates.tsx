"use client";
import { useRef, useState } from "react";
import { api, errorText, useResource } from "@/lib/api";
import type { Paged } from "@/contracts/forms";
import type { MessageTemplateRecord } from "@/contracts/message-templates";
import type { MessageContent } from "@/contracts/message-content";
import { ActionButton, Modal, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { MessageContentFields, SavedMessage, contentFromForm } from "./MessageContent";
const labels = { active: "사용 중", archived: "보관", deleted: "삭제" };
const events: Record<string, string> = { created: "생성", updated: "내용 변경", archived: "보관", restored: "복원", deleted: "삭제" };
type Props = { serviceId: string; channel: "email" | "sms"; canManage: boolean; onApply?: (id: string, version: number) => Promise<void> };
export function MessageTemplateLibrary({ serviceId, channel, canManage, onApply }: Props) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState("active"), [id, setId] = useState<string | null>(null);
  const result = useResource<Paged<MessageTemplateRecord>>("/message-templates?" + new URLSearchParams({ serviceId, channel, page: String(page), pageSize: String(pageSize), search, status }));
  return <Panel title={channel === "email" ? "이메일 템플릿" : "문자 템플릿"}><div className="campaign-fields"><p>내용을 저장해 다시 사용할 수 있습니다. 적용하면 캠페인에 해당 버전의 내용이 복사됩니다. 첨부와 발신자는 복사하지 않습니다.</p>
    <form className="campaign-filters" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input className="cs-input" aria-label="템플릿 이름 검색" placeholder="템플릿 이름" value={query} onChange={e => setQuery(e.target.value)} maxLength={200} /><select className="cs-input" aria-label="템플릿 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{Object.entries(labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><ActionButton secondary>템플릿 검색</ActionButton><ActionButton secondary type="button" onClick={result.reload}>새로고침</ActionButton>{canManage && !onApply && <ActionButton type="button" onClick={() => setId("new")}>템플릿 생성</ActionButton>}</form>
    <RemoteTable columns={["템플릿", "버전", "상태", "수정일"]} rows={(result.data?.items ?? []).map(r => ({ id: r.id, cells: [<button key="name" className="cs-link" onClick={() => setId(r.id)}>{r.name || "삭제된 템플릿"}</button>, r.version, labels[r.status], new Date(r.updatedAt).toLocaleString("ko-KR")] }))} total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={result.loading} error={result.error?.message} />
    {id && <TemplateEditor key={id} id={id} serviceId={serviceId} channel={channel} canManage={canManage && !onApply} onApply={onApply} close={() => setId(null)} saved={newId => { setId(newId); result.reload(); }} />}
  </div></Panel>;
}
function TemplateEditor({ id, close, saved, ...scope }: Props & { id: string; close: () => void; saved: (id: string) => void }) {
  const result = useResource<MessageTemplateRecord>(id === "new" ? null : "/message-templates/" + id);
  if (id !== "new" && result.loading) return <p role="status">템플릿을 불러오는 중입니다.</p>;
  if (result.error) return <p role="alert">{result.error.message}</p>;
  const record = result.data;
  return <TemplateBody key={id + ":" + record?.version} record={record} close={close} {...scope} saved={newId => { saved(newId); result.reload(); }} />;
}
function TemplateBody({ record, close, saved, onApply, ...scope }: Props & { record?: MessageTemplateRecord; close: () => void; saved: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmDelete, setConfirmDelete] = useState(false), [revision, setRevision] = useState<{ version: number; content: MessageContent | null }>();
  const key = useRef<{ signature: string; key: string }>(null), editable = scope.canManage && (!record || record.status === "active");
  async function change(action: string, input: object, method = "POST") {
    if (busy) return; setBusy(true); setError("");
    const signature = JSON.stringify(input); if (!key.current || key.current.signature !== signature) key.current = { signature, key: crypto.randomUUID() };
    try { const out = await api<{ id: string }>("/message-templates" + (record ? "/" + record.id : "") + action, { method, headers: { "Idempotency-Key": key.current.key }, body: JSON.stringify(input) }); saved(out.id); }
    catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <section className="message-template-editor" aria-label="템플릿 상세"><div className="campaign-toolbar"><h3>{record ? record.name || "삭제된 템플릿" : "새 메시지 템플릿"}</h3><ActionButton secondary disabled={busy} onClick={close}>상세 닫기</ActionButton></div>
    {record && <p>버전 {record.version} · {labels[record.status]}</p>}
    {editable ? <form className="campaign-fields" onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); change("", { name: values.get("name"), content: contentFromForm(values), ...(record ? { version: record.version } : { serviceId: scope.serviceId, channel: scope.channel }) }, record ? "PATCH" : "POST"); }}><fieldset className="campaign-fields" disabled={busy}>
      <label>템플릿 이름<input className="cs-input" name="name" required maxLength={200} defaultValue={record?.name} /></label><MessageContentFields serviceId={scope.serviceId} channel={scope.channel} initial={record?.content} /><ActionButton>{record ? "템플릿 저장" : "템플릿 등록"}</ActionButton>
    </fieldset></form> : record?.content && <SavedMessage content={record.content} />}
    {error && <p role="alert">{error}</p>}
    {record && record.status !== "deleted" && <div className="campaign-actions">
      {onApply && record.status === "active" && <ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onApply(record.id, record.version); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>이 버전을 캠페인에 적용</ActionButton>}
      {scope.canManage && <><ActionButton secondary disabled={busy} onClick={() => change(record.status === "active" ? "/archive" : "/restore", { version: record.version })}>{record.status === "active" ? "템플릿 보관" : "템플릿 복원"}</ActionButton><ActionButton secondary disabled={busy} onClick={() => setConfirmDelete(true)}>템플릿 삭제</ActionButton></>}
    </div>}
    {record && <details><summary>최근 100개 변경 이력</summary><ul>{record.revisions?.map(r => <li key={r.version}>버전 {r.version} · {events[r.kind] ?? r.kind} · {new Date(r.createdAt).toLocaleString("ko-KR")} {record.status !== "deleted" && <button type="button" className="cs-link" disabled={busy} onClick={async () => { try { setRevision(await api("/message-templates/" + record.id + "/revisions/" + r.version)); } catch (error) { setError(errorText(error)); } }}>버전 {r.version} 내용 보기</button>}</li>)}</ul>{revision?.content && <section className="campaign-preview" aria-label="과거 템플릿 내용"><strong>저장된 버전 {revision.version}</strong><SavedMessage content={revision.content} /></section>}</details>}
    {confirmDelete && record && <Modal title="템플릿 삭제" onClose={() => setConfirmDelete(false)}><p>템플릿과 모든 과거 버전의 이름·내용을 삭제합니다. 이미 캠페인에 복사한 내용은 해당 캠페인의 보관 기한을 따릅니다.</p><ActionButton disabled={busy} onClick={async () => { await change("", { version: record.version }, "DELETE"); setConfirmDelete(false); }}>원문 삭제 확인</ActionButton></Modal>}
  </section>;
}
