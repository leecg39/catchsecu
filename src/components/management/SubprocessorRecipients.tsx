"use client";

import { useRef, useState, type FormEvent } from "react";
import { ApiError, api, errorText, useResource } from "@/lib/api";
import type { Paged } from "@/contracts/forms";
import type { SubprocessorRecord } from "@/contracts/subprocessors";
import { ActionButton, EmptyState, Panel } from "../shared";

export function SubprocessorRecipients({ serviceId, selectedId, onSelect, onChanged }: {
  serviceId: string; selectedId: string; onSelect: (id: string) => void; onChanged: (id: string) => void;
}) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [editor, setEditor] = useState<SubprocessorRecord | "new">();
  const [editingBusy, setEditingBusy] = useState(false), [message, setMessage] = useState("");
  const people = useResource<Paged<SubprocessorRecord>>(`/services/${serviceId}/subprocessors?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(query)}`);
  const currentPage = people.data?.page ?? page;
  const pages = Math.max(1, Math.ceil((people.data?.total ?? 0) / pageSize));
  function saved(row: SubprocessorRecord) {
    setEditor(undefined); people.reload(); onChanged(row.id);
    setMessage(row.status === "archived" ? "수신자를 보관했습니다." : "수신자 정보를 저장했습니다.");
  }
  return <Panel title="수신자 관리">
    <form className="mg-toolbar subprocessor-toolbar" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
      <label>이름 검색<input className="cs-input" aria-label="수신자 이름 검색" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <ActionButton secondary>검색</ActionButton>
      <ActionButton secondary type="button" onClick={() => { setSearch(""); setQuery(""); setPage(1); }}>검색 초기화</ActionButton>
      <ActionButton type="button" disabled={editingBusy} onClick={() => { setEditor("new"); setMessage(""); }}>수신자 등록</ActionButton>
      <ActionButton secondary type="button" onClick={people.reload}>수신자 새로고침</ActionButton>
    </form>
    {message && <p role="status">{message}</p>}
    {people.loading && <p role="status">수신자를 불러오는 중입니다.</p>}
    {people.error && <p role="alert">{people.error.message}</p>}
    {people.data && <><p>전체 {people.data.total}명 · 보관된 수신자는 복원 후 선택할 수 있습니다.</p>
      <div className="cs-table-wrap"><table className="cs-table"><thead><tr>
        {["#", "이름", "이메일", "변경 내용", "상태", "관리"].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{people.data.items.length ? people.data.items.map((row, index) => <tr key={row.id}>
        <td>{(currentPage - 1) * pageSize + index + 1}</td><td>{row.name}</td><td>{row.email}</td><td>{row.changeSummary}</td>
        <td>{row.status === "active" ? "활성" : "보관"}</td><td>
          <ActionButton secondary type="button" disabled={row.status !== "active" || editingBusy} aria-label={row.name + " 수신자 선택"}
            onClick={() => onSelect(row.id)}>{selectedId === row.id ? "선택됨" : "선택"}</ActionButton>
          <ActionButton secondary type="button" disabled={editingBusy} aria-label={row.name + " 수정"}
            onClick={() => { setEditor(row); setMessage(""); }}>수정</ActionButton>
        </td>
      </tr>) : <tr><td colSpan={6}><EmptyState text="조회된 수신자가 없습니다." /></td></tr>}</tbody></table></div>
      <nav className="cs-pagination" aria-label="재위탁 수신자 페이지">
        <select aria-label="수신자 페이지당 행 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
          {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}
        </select><div><button type="button" disabled={currentPage <= 1} aria-label="수신자 이전 페이지" onClick={() => setPage(currentPage - 1)}>‹</button>
          <span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} aria-label="수신자 다음 페이지" onClick={() => setPage(currentPage + 1)}>›</button></div>
      </nav></>}
    {editor && <RecipientEditor key={editor === "new" ? "new" : `${editor.id}:${editor.version}`} serviceId={serviceId}
      row={editor === "new" ? undefined : editor} onSaved={saved} onReload={setEditor} onBusy={setEditingBusy} onCancel={() => setEditor(undefined)} />}
  </Panel>;
}

function RecipientEditor({ serviceId, row, onSaved, onReload, onBusy, onCancel }: {
  serviceId: string; row?: SubprocessorRecord; onSaved: (row: SubprocessorRecord) => void;
  onReload: (row: SubprocessorRecord) => void; onBusy: (busy: boolean) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(row?.name ?? ""), [email, setEmail] = useState(row?.email ?? "");
  const [summary, setSummary] = useState(row?.changeSummary ?? ""), [status, setStatus] = useState(row?.status ?? "active");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const lock = useRef(false), request = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current || conflict) return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const body = JSON.stringify({ name, email, changeSummary: summary, ...(row ? { version: row.version, status } : {}) });
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const result = await api<SubprocessorRecord>(`/services/${serviceId}/subprocessors${row ? "/" + row.id : ""}`, {
        method: row ? "PATCH" : "POST", body, headers: row ? undefined : { "Idempotency-Key": request.current.key },
      });
      onSaved(result);
    } catch (cause) {
      setError(errorText(cause)); setConflict(cause instanceof ApiError && cause.code === "VERSION_CONFLICT");
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  async function reload() {
    if (!row || lock.current) return;
    lock.current = true; setBusy(true); onBusy(true);
    try { onReload(await api<SubprocessorRecord>(`/services/${serviceId}/subprocessors/${row.id}`)); }
    catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="mg-fields" aria-label={row ? "수신자 수정" : "새 수신자 등록"} onSubmit={submit}>
    <h3>{row ? "수신자 수정" : "새 수신자 등록"}</h3>
    <fieldset disabled={busy || conflict}>
      <label>이름<input className="cs-input" aria-label="재위탁 수신자 이름" required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>이메일<input className="cs-input" aria-label="재위탁 수신자 이메일" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>변경 내용<textarea className="cs-input" aria-label="재위탁 변경 내용" required maxLength={4000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
      {row && <label>상태<select className="cs-input" aria-label="재위탁 수신자 상태" value={status} onChange={event => setStatus(event.target.value as SubprocessorRecord["status"])}>
        <option value="active">활성 (복원)</option><option value="archived">보관</option>
      </select></label>}
    </fieldset>
    {row && <p>보관하면 새 안내를 보낼 수 없습니다. 이미 요청한 발송과 과거 이력은 유지됩니다.</p>}
    {error && <p role="alert">{error}</p>}
    {conflict && <div><p>최신 정보를 불러오면 저장하지 않은 입력이 최신 값으로 바뀝니다.</p>
      <ActionButton secondary type="button" disabled={busy} onClick={reload}>최신 수신자 다시 불러오기</ActionButton></div>}
    <div className="mg-toolbar"><ActionButton disabled={busy || conflict}>{busy ? "저장 중…" : row ? "수신자 변경 저장" : "새 수신자 저장"}</ActionButton>
      <ActionButton secondary type="button" disabled={busy} onClick={onCancel}>편집 취소</ActionButton></div>
  </form>;
}
