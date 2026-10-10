"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { ExpertAssignmentList, ExpertAssignmentRecord, ExpertOptions } from "@/contracts/expert-assignments";
import { expertStatusLabels } from "@/contracts/expert-assignments";
import { ActionButton, Modal, PageHeading, Panel } from "./shared";
import { RemoteTable } from "./RemoteTable";
import { useConfirm } from "./ux/confirm";
import { useUnsavedChanges } from "./ux/navigation-guard";

function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function AssignmentEditor({ initial, done, onClose, onReload }: { initial?: ExpertAssignmentRecord; done: () => void; onClose: () => void; onReload: (record: ExpertAssignmentRecord) => void }) {
  const [companySearch, setCompanySearch] = useState(initial?.companyName ?? "");
  const [companyId, setCompanyId] = useState(initial?.companyId ?? "");
  const [email, setEmail] = useState(initial?.expertEmail ?? "");
  const [selected, setSelected] = useState(initial?.services.filter(service => service.status === "active").map(service => service.id) ?? []);
  const [expiry, setExpiry] = useState(initial?.expiresAt ? localDate(initial.expiresAt) : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const input = JSON.stringify({ companySearch, companyId, email, selected: [...selected].sort(), expiry });
  const [initialInput] = useState(input), dirty = input !== initialInput, confirm = useConfirm();
  useUnsavedChanges(dirty || busy);
  async function discard() {
    return !dirty || confirm({ title: "저장하지 않은 변경 사항", message: "작성한 전문가 배정 입력을 버릴까요?", confirmLabel: "입력 버리기", cancelLabel: "계속 편집" });
  }
  async function close() { if (!lock.current && await discard()) onClose(); }
  const options = useResource<ExpertOptions>("/expert-assignments/options?search=" + encodeURIComponent(companySearch) + (companyId ? "&companyId=" + companyId : ""));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || conflict || options.loading || options.error) return; lock.current = true; setBusy(true); setError("");
    try {
      if (!companyId || !selected.length) throw new Error("회사와 서비스를 한 개 이상 선택해주세요.");
      const expiresAt = new Date(expiry).toISOString();
      if (initial?.status === "active") await api("/expert-assignments/" + initial.id, { method: "PATCH",
        body: JSON.stringify({ version: initial.version, serviceIds: selected, expiresAt }) });
      else await api("/expert-assignments", { method: "POST", body: JSON.stringify({
        companyId, expertEmail: email.trim(), serviceIds: selected, expiresAt,
      }) });
      done();
    } catch (cause) {
      setError(errorText(cause));
      setConflict(!!initial && cause instanceof ApiError && ["VERSION_CONFLICT", "ASSIGNMENT_EXISTS"].includes(cause.code));
    } finally { lock.current = false; setBusy(false); }
  }
  async function reloadAssignment() {
    if (!initial || lock.current || !await discard()) return;
    lock.current = true; setBusy(true);
    try { onReload(await api<ExpertAssignmentRecord>("/expert-assignments/" + initial.id)); }
    catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal title={initial ? "전문가 배정 변경" : "전문가 배정"} onClose={() => { void close(); }}><form className="member-fields" onSubmit={submit}>
    {initial ? <p><strong>{initial.companyName}</strong> · {initial.expertName} ({initial.expertEmail})</p> : <>
      <label>회사 검색<input className="cs-input" disabled={busy} value={companySearch} maxLength={100} onChange={event => setCompanySearch(event.target.value)} /></label>
      <label>배정 회사<select className="cs-input" disabled={busy} required value={companyId} onChange={event => { setCompanyId(event.target.value); setSelected([]); }}>
        <option value="">회사 선택</option>{options.data?.companies.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}
      </select></label>
      <label>전문가 계정 이메일<input className="cs-input" disabled={busy} type="email" required value={email} maxLength={254} onChange={event => setEmail(event.target.value)} /></label>
    </>}
    {options.error && <p role="alert">{options.error.message} <button type="button" className="cs-link" onClick={options.reload}>다시 시도</button></p>}
    <fieldset><legend>조회 가능한 서비스</legend>{options.data?.services.map(service => <label className="member-check" key={service.id}>
      <input type="checkbox" disabled={busy} checked={selected.includes(service.id)} onChange={event => setSelected(event.target.checked
        ? [...selected, service.id] : selected.filter(id => id !== service.id))} />{service.name}</label>)}
      {companyId && !options.loading && !options.data?.services.length && <p>활성 서비스가 없습니다.</p>}
    </fieldset>
    <label>배정 만료일<input className="cs-input" disabled={busy} type="datetime-local" required value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
    <p className="cs-muted">전문가에게 선택한 서비스의 조회자 권한을 부여합니다. 만료일이 지나거나 회수하면 접근이 차단됩니다.</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {initial && conflict && <div><p className="cs-muted">다른 곳에서 변경한 정보를 불러오면 저장하지 않은 입력이 최신 배정 정보로 바뀝니다. 회수되거나 만료된 배정은 다시 배정할 수 있습니다.</p>
      <button type="button" className="cs-link" disabled={busy} onClick={reloadAssignment}>최신 배정 다시 불러오기</button></div>}
    <div className="mg-flex"><ActionButton disabled={busy || options.loading || !!options.error || conflict}>{busy ? "저장 중…" : initial?.status === "active" ? "배정 변경" : "배정 저장"}</ActionButton>
      <ActionButton type="button" secondary disabled={busy} onClick={close}>취소</ActionButton></div>
  </form></Modal>;
}
export function ExpertAssignmentsAdmin() {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState<ExpertAssignmentRecord | "new">();
  const [revoke, setRevoke] = useState<ExpertAssignmentRecord>();
  const [revokeConflict, setRevokeConflict] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const lock = useRef(false);
  const list = useResource<ExpertAssignmentList>("/expert-assignments?scope=admin&page=" + page + "&pageSize=" + pageSize + "&search=" + encodeURIComponent(search));
  async function confirmRevoke() {
    if (!revoke || lock.current || revokeConflict) return; lock.current = true;
    setError(""); setBusy(true);
    try {
      await api("/expert-assignments/" + revoke.id, { method: "DELETE", headers: { "If-Match": String(revoke.version) } });
      setRevoke(undefined); setNotice("전문가 배정을 회수했습니다."); list.reload();
    } catch (cause) { setError(errorText(cause)); setRevokeConflict(cause instanceof ApiError && cause.code === "VERSION_CONFLICT"); list.reload(); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reloadRevoke() {
    if (!revoke || lock.current) return; lock.current = true; setBusy(true);
    try {
      const current = await api<ExpertAssignmentRecord>("/expert-assignments/" + revoke.id);
      if (current.status === "active") { setRevoke(current); setError(""); }
      else { setRevoke(undefined); setNotice("배정 상태가 변경되었습니다. 최신 목록을 확인해주세요."); }
      setRevokeConflict(false); list.reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="expert-admin-page"><PageHeading title="전문가 배정 관리"><Link className="cs-button secondary" href="/dashboard">대시보드</Link>
    <ActionButton onClick={() => { setEditor("new"); setError(""); }}>새 배정</ActionButton></PageHeading>
    <Panel><p className="cs-muted">운영자만 활성·인증된 계정에 회사별 조회 범위를 배정할 수 있습니다.</p>
      <form className="mg-flex mg-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
        <input className="cs-input" placeholder="회사명 또는 전문가 이메일" aria-label="배정 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />
        <ActionButton secondary>검색</ActionButton></form>
      {notice && <p role="status">{notice}</p>}{list.error && <p role="alert">{list.error.message} <button className="cs-link" onClick={list.reload}>다시 시도</button></p>}
      <RemoteTable columns={["회사", "전문가", "서비스", "상태", "만료일", "관리"]}
        rows={(list.data?.items ?? []).map(item => ({ id: item.id, cells: [item.companyName,
          <span key="expert">{item.expertName}<small className="member-email">{item.expertEmail}</small></span>,
          item.services.map(service => service.name).join(", ") || "-", expertStatusLabels[item.status],
          new Date(item.expiresAt).toLocaleString("ko-KR"),
          <div className="mg-flex" key="actions"><button className="cs-link" onClick={() => { setEditor(item); setError(""); }}>
            {item.status === "active" ? "수정" : "다시 배정"}</button>
            {item.status === "active" && <button className="cs-link" onClick={() => { setRevoke(item); setRevokeConflict(false); setError(""); }}>회수</button>}</div>,
        ] }))} total={list.data?.total ?? 0} page={list.data?.page ?? page} pageSize={pageSize} onPage={setPage}
        onPageSize={size => { setPageSize(size); setPage(1); }} loading={list.loading} error={list.error?.message} />
    </Panel>
    {editor && <AssignmentEditor key={editor === "new" ? "new" : editor.id + ":" + editor.version + ":" + editor.status}
        initial={editor === "new" ? undefined : editor} onClose={() => setEditor(undefined)}
        onReload={record => { setEditor(record); list.reload(); }}
        done={() => { setNotice("전문가 배정을 저장했습니다."); setEditor(undefined); list.reload(); }} />}
    {revoke && <Modal title="전문가 배정 회수" onClose={() => { if (!busy) setRevoke(undefined); }}>
      <p>{revoke.expertName} 님의 {revoke.companyName} 접근을 즉시 차단합니다.</p>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {revokeConflict && <div><p className="cs-muted">최신 배정 상태와 범위를 확인한 뒤 회수를 다시 진행해주세요.</p>
        <button type="button" className="cs-link" disabled={busy} onClick={reloadRevoke}>최신 배정 다시 불러오기</button></div>}
      <ActionButton disabled={busy || revokeConflict} onClick={confirmRevoke}>{busy ? "처리 중…" : "회수 확인"}</ActionButton>
    </Modal>}
  </main>;
}
