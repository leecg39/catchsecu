"use client";
import { useRef, useState } from "react";
import { api, errorText, useResource } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import type { Paged } from "@/contracts/forms";
import type { ShareEvent, ShareOptions, ShareRecord } from "@/contracts/sharing";

const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const states = { active: "열람 가능", expired: "만료", revoked: "회수" };
const actions: Record<string, string> = { "share.created": "초대 생성", "share.updated": "공유 변경", "share.resent": "초대 재발송", "share.revoked": "권한 회수",
  "share.challenge_requested": "이메일 인증 요청", "share.authenticated": "이메일 인증 완료", "share.logged_out": "열람 종료", "share.responses_viewed": "응답 목록 열람",
  "share.response_viewed": "응답 열람", "share.files_viewed": "파일 목록 열람", "share.file_viewed": "파일 정보 열람", "share.file_downloaded": "파일 다운로드" };
export function ShareGrants({ formId }: { formId: string }) {
  const app = useApplication(), allowed = !!app.data?.capabilities.includes("share.manage");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [status, setStatus] = useState("all"), [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const list = useResource<Paged<ShareRecord>>(allowed ? `/share-grants?formId=${formId}&page=${page}&pageSize=${pageSize}&status=${status}&search=${encodeURIComponent(search)}` : null);
  const [editing, setEditing] = useState<ShareRecord | "new">(), [revoking, setRevoking] = useState<ShareRecord>(), [events, setEvents] = useState<ShareRecord>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function change(row: ShareRecord, revoke = false) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try {
      await api(`/share-grants/${row.id}${revoke ? "" : "/resend"}`, { method: revoke ? "DELETE" : "POST",
        ...(revoke ? { headers: { "If-Match": String(row.version) } } : { body: JSON.stringify({ version: row.version }) }) });
      setRevoking(undefined); list.reload(); setMessage(revoke ? "공유 권한을 회수했습니다. 기존 인증으로 열람할 수 없습니다." : "새 초대 메일 발송을 요청했습니다. 기존 인증은 해제되었습니다.");
    } catch (cause) { setError(errorText(cause)); list.reload(); } finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <Panel title="외부 열람자 관리" className="share-manager">
    <p>게시 버전과 항목을 지정해 응답을 공유합니다. 이후 추가한 버전·항목은 자동으로 공유되지 않습니다.</p>
    <div className="forms-actions"><ActionButton onClick={() => { setEditing("new"); setError(""); }}>외부 열람자 초대</ActionButton>
      <label>공유 상태 <select className="cs-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
        <option value="all">전체</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <ActionButton secondary onClick={list.reload}>공유 목록 새로고침</ActionButton></div>
    <form className="forms-actions" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><label>열람자 이메일 검색 <input className="cs-input" placeholder="전체 이메일 주소" value={query} onChange={e => setQuery(e.target.value)} /></label><ActionButton secondary type="submit">이메일 검색</ActionButton></form>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <RemoteTable columns={["열람자 이메일", "게시 버전 / 공유 항목", "종료일", "상태", "관리"]} rows={(list.data?.items ?? []).map(row => ({ id: row.id,
      cells: [row.email, <span key="fields">v{row.formNumber} · {row.questions.map(q => q.label).join(", ")}</span>, new Date(row.expiresAt).toLocaleString("ko-KR"), states[row.status],
        <div className="forms-actions" key="actions">{row.status !== "revoked" && <><ActionButton secondary disabled={busy} onClick={() => setEditing(row)}>수정</ActionButton>
          <ActionButton secondary disabled={busy || row.status === "expired"} onClick={() => change(row)}>초대 재발송</ActionButton>
          <ActionButton secondary disabled={busy} onClick={() => { setRevoking(row); setError(""); }}>회수</ActionButton></>}
          <ActionButton secondary onClick={() => setEvents(row)}>열람 로그</ActionButton></div>],
    }))} page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }} loading={list.loading} error={list.error?.message} empty="초대한 외부 열람자가 없습니다." />
    {editing && <ShareEditor formId={formId} initial={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => {
      setEditing(undefined); list.reload(); setMessage("초대 메일 발송을 요청했습니다. 새 초대 정보로 이메일 인증을 완료하면 열람할 수 있습니다.");
    }} />}
    {revoking && <Modal title="공유 권한 회수" onClose={() => { if (!busy) setRevoking(undefined); }}>
      <p>{revoking.email}의 응답과 첨부파일 열람 권한을 회수합니다.</p><p>기존 인증은 즉시 해제되며 다시 공유하려면 새로 초대해야 합니다.</p>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={() => change(revoking, true)}>공유 회수 확인</ActionButton>
    </Modal>}
    {events && <ShareEvents row={events} onClose={() => setEvents(undefined)} />}
  </Panel>;
}
function ShareEditor({ formId, initial, onClose, onSaved }: { formId: string; initial?: ShareRecord; onClose: () => void; onSaved: () => void }) {
  const options = useResource<ShareOptions>("/share-grants/options?formId=" + formId);
  const [email, setEmail] = useState(initial?.email ?? ""), [version, setVersion] = useState(initial?.formVersionId ?? ""),
    [fields, setFields] = useState(initial?.questionIds ?? []), [expiry, setExpiry] = useState(() => localDate(initial ? new Date(initial.expiresAt) : new Date(Date.now() + 7 * 86400000)));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), pending = useRef<{ json: string; key: string } | null>(null);
  const selected = options.data?.versions.find(v => v.id === (version || options.data?.versions[0]?.id));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || !selected) return; setBusy(true); setError("");
    try {
      if (!fields.length) throw new Error("공유할 항목을 선택해주세요.");
      const payload = JSON.stringify({ email: email.trim(), questionIds: fields, expiresAt: new Date(expiry).toISOString(),
        ...(initial ? { version: initial.version } : { formId, formVersionId: selected.id }) });
      if (pending.current?.json !== payload) pending.current = { json: payload, key: crypto.randomUUID() };
      await api("/share-grants" + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: payload,
        headers: initial ? {} : { "Idempotency-Key": pending.current.key } });
      onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <Modal title={initial ? "외부 공유 수정" : "외부 열람자 초대"} onClose={() => { if (!busy) onClose(); }}>
    {options.error ? <p role="alert">{options.error.message}</p> : options.loading ? <p role="status">게시 버전을 불러오는 중입니다.</p> : !selected ? <p>게시된 폼 버전이 없습니다. 폼을 먼저 게시해주세요.</p> :
      <form onSubmit={save} className="cs-stack"><fieldset disabled={busy} className="share-fields">
        <label>열람자 이메일<input className="cs-input" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>공유할 게시 버전<select className="cs-input" disabled={!!initial} value={selected.id} onChange={e => { setVersion(e.target.value); setFields([]); }}>
          {options.data!.versions.map(v => <option value={v.id} key={v.id}>v{v.number} · {v.title}</option>)}</select></label>
        <fieldset className="share-fields"><legend>공유할 항목 (필수)</legend>{selected.questions.map(q => <label key={q.id} className="share-check">
          <input type="checkbox" checked={fields.includes(q.id)} onChange={e => setFields(current => e.target.checked ? [...current, q.id] : current.filter(id => id !== q.id))} />
          {q.label}{q.type === "파일 업로드" ? " (첨부파일 포함)" : ""}</label>)}</fieldset>
        <label>공유 종료일<input className="cs-input" type="datetime-local" required value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
        <p>최대 90일. 이 버전의 현재 응답과 이후 수집되는 응답 중 선택한 항목만 공유합니다. 철회·파기 요청·보유 기한 종료 응답은 제외합니다.</p>
        {initial && <p>저장하면 기존 인증을 해제하고 새 초대 메일을 발송합니다.</p>}
        <ActionButton type="submit" disabled={busy || !fields.length}>{busy ? "저장 중…" : initial ? "공유 변경 저장" : "초대 메일 보내기"}</ActionButton>
      </fieldset>{error && <p role="alert">{error}</p>}</form>}
  </Modal>;
}
function ShareEvents({ row, onClose }: { row: ShareRecord; onClose: () => void }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(10);
  const resource = useResource<Paged<ShareEvent>>(`/share-grants/${row.id}/events?page=${page}&pageSize=${size}`);
  return <Modal title="외부 공유 열람 로그" onClose={onClose}><p>{row.email}</p><RemoteTable columns={["일시", "행위", "응답 ID"]}
    rows={(resource.data?.items ?? []).map(event => ({ id: event.id, cells: [new Date(event.createdAt).toLocaleString("ko-KR"), actions[event.action] ?? event.action, event.detail.submissionId ?? "-"] }))}
    page={page} pageSize={size} total={resource.data?.total ?? 0} onPage={setPage} onPageSize={value => { setSize(value); setPage(1); }} loading={resource.loading} error={resource.error?.message} /></Modal>;
}
