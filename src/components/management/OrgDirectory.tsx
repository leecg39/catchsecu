"use client";
import { useRef, useState } from "react";
import type { z } from "zod";
import type { orgMemberList, orgMemberRecord, SsoProviderRecord } from "@/contracts/sso";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { ActionButton, EmptyState, Modal } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";

type Member = z.infer<typeof orgMemberRecord>;
type Directory = z.infer<typeof orgMemberList>;
const emptyDraft = () => ({ orgCode: "", employeeNo: "", name: "", email: "", pin: "" });
const draftOf = (row: Member) => ({ orgCode: row.orgCode, employeeNo: row.employeeNo, name: row.name, email: row.email ?? "", pin: "" });

export function OrgDirectory({ provider, onClose }: { provider: SsoProviderRecord; onClose: () => void }) {
  const path = `/security/sso/${provider.id}/directory`, result = useResource<Directory>(path);
  const [editing, setEditing] = useState<Member | null>(null), [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState(""), [sort, setSort] = useState("identity"), [page, setPage] = useState(1);
  const lock = useRef(false), attempt = useRef<{ body: string; key: string } | null>(null), ask = useConfirm();
  useUnsavedChanges(dirty);
  const canManage = result.data?.canManage === true;
  const rows = (result.data?.items ?? []).filter(row => `${row.orgCode} ${row.employeeNo} ${row.name} ${row.email ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id)
      : a.orgCode.localeCompare(b.orgCode) || a.employeeNo.localeCompare(b.employeeNo));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  const reset = (row: Member | null = null) => {
    setEditing(row); setDraft(row ? draftOf(row) : emptyDraft()); setDirty(false); setConflict(false); setError(""); attempt.current = null;
  };
  async function discard() {
    return !dirty || await ask({ title: "저장하지 않은 변경", message: "입력한 내용을 버리고 계속할까요?", confirmLabel: "변경 버리기" });
  }
  async function close() { if (!lock.current && await discard()) onClose(); }
  async function edit(row: Member | null) { if (!lock.current && await discard()) reset(row); }
  async function latest() {
    if (lock.current || !editing) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const data = await api<Directory>(path);
      if (!data.canManage) { result.reload(); throw new Error("수정 권한이 변경되었습니다. 입력을 복사한 뒤 목록을 확인해주세요."); }
      const row = data.items.find(item => item.id === editing.id);
      if (!row) { result.reload(); throw new Error("구성원이 이미 삭제되었습니다. 입력을 복사한 뒤 새 등록으로 전환해주세요."); }
      reset(row); result.reload(); setNotice("최신 내용을 불러왔습니다. 변경할 항목을 다시 입력해주세요.");
    } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || !canManage || conflict) return;
    const common = { name: draft.name.trim(), email: draft.email.trim() || null };
    const payload = editing ? { version: editing.version, ...common, ...(draft.pin ? { pin: draft.pin } : {}) }
      : { orgCode: draft.orgCode.trim(), employeeNo: draft.employeeNo.trim(), name: common.name,
        ...(common.email ? { email: common.email } : {}), pin: draft.pin };
    const body = JSON.stringify(payload);
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api(editing ? `${path}/${editing.id}` : path, { method: editing ? "PATCH" : "POST", body,
        ...(!editing ? { headers: { "Idempotency-Key": attempt.current.key } } : {}) });
      setNotice(editing ? "디렉터리 구성원을 수정했습니다. 이전 이메일 등록 요청은 무효화됐습니다." : "디렉터리 구성원을 등록했습니다.");
      reset(); result.reload();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError) {
        if (["VERSION_CONFLICT", "CONCURRENT_CHANGE"].includes(cause.code)) setConflict(true);
        if ([401, 403, 404].includes(cause.status)) result.reload();
      }
    } finally { lock.current = false; setBusy(false); }
  }
  async function remove(row: Member) {
    if (lock.current || !await ask({ title: "디렉터리 구성원 삭제", message: `${row.name}(${row.orgCode}/${row.employeeNo})의 새 기관 로그인과 대기 이메일 등록을 차단합니다. 기존 연결 계정과 로그인 세션은 유지됩니다.${editing?.id === row.id && dirty ? " 현재 미저장 입력도 버립니다." : ""}`, confirmLabel: "삭제" }) || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api(`${path}/${row.id}`, { method: "DELETE", body: JSON.stringify({ version: row.version }) });
      if (editing?.id === row.id) reset(); result.reload(); setNotice("디렉터리 구성원을 삭제했습니다.");
    } catch (cause) { setError(errorText(cause)); result.reload(); }
    finally { lock.current = false; setBusy(false); }
  }

  return <Modal title={`가상 디렉터리 — ${provider.name}`} onClose={() => void close()}>
    <p className="mg-description">외부 기관과 연결되지 않은 시험용 디렉터리입니다. 등록된 조직 식별자·사번·인증번호로만 로그인하며 이메일이 없으면 첫 로그인 시 등록합니다.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result.error ? <><p role="alert">{result.error.message}</p><ActionButton secondary disabled={busy} onClick={result.reload}>목록 다시 불러오기</ActionButton></>
      : result.loading ? <p role="status">디렉터리를 불러오는 중입니다.</p>
      : <>
        <div className="mg-flex">
          <label>구성원 검색<input className="cs-input" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="이름·이메일·조직·사번" /></label>
          <label>구성원 정렬<select className="cs-input" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="identity">조직·사번순</option><option value="name">이름순</option></select></label>
        </div>
        {rows.length ? <div className="cs-table-wrap" role="region" aria-label="디렉터리 구성원 목록" tabIndex={0}><table className="cs-table"><thead><tr>
          <th>조직 식별자</th><th>사번</th><th>이름</th><th>이메일</th>{canManage && <th>관리</th>}</tr></thead><tbody>
          {rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.id}>
            <td>{row.orgCode}</td><td>{row.employeeNo}</td><td>{row.name}</td><td>{row.email ?? "미등록"}</td>
            {canManage && <td><div className="mg-flex"><ActionButton secondary disabled={busy} onClick={() => void edit(row)}>수정</ActionButton><ActionButton secondary disabled={busy} onClick={() => void remove(row)}>삭제</ActionButton></div></td>}
          </tr>)}</tbody></table></div> : <EmptyState text={search ? "검색 결과가 없습니다." : "등록된 디렉터리 구성원이 없습니다."} />}
        <div className="cs-pagination"><span>총 {rows.length}명 · {currentPage}/{pages}쪽</span><div><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="구성원 이전 페이지">이전</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="구성원 다음 페이지">다음</button></div></div>
        {!canManage && <p role="status">회사에 직접 소속된 최상위 관리자만 디렉터리를 변경할 수 있습니다.</p>}
      </>}
    {canManage && <form onSubmit={e => void save(e)}>
      <h3>{editing ? "디렉터리 구성원 수정" : "디렉터리 구성원 등록"}</h3>
      {editing && <p className="mg-description">조직 식별자·사번은 변경할 수 없습니다. 디렉터리 수정은 이미 연결된 사용자 프로필이나 로그인 세션을 바꾸지 않습니다.</p>}
      {conflict && <div role="alert"><p>다른 곳에서 수정됐습니다. 현재 입력을 복사한 뒤 최신 내용으로 다시 편집해주세요.</p><ActionButton secondary disabled={busy} onClick={() => void latest()}>최신 내용 불러오기</ActionButton></div>}
      <fieldset disabled={busy || conflict} className="policy-fields">
        <label>조직 식별자<input className="cs-input" required minLength={2} maxLength={60} pattern="[A-Za-z0-9._\-]+" disabled={!!editing} value={draft.orgCode} onChange={e => { setDraft({ ...draft, orgCode: e.target.value }); setDirty(true); }} /></label>
        <label>사번<input className="cs-input" required minLength={2} maxLength={60} pattern="[A-Za-z0-9._\-]+" disabled={!!editing} value={draft.employeeNo} onChange={e => { setDraft({ ...draft, employeeNo: e.target.value }); setDirty(true); }} /></label>
        <label>이름<input className="cs-input" required maxLength={100} value={draft.name} onChange={e => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} /></label>
        <label>이메일 (비우면 첫 로그인 시 등록)<input className="cs-input" type="email" maxLength={320} value={draft.email} onChange={e => { setDraft({ ...draft, email: e.target.value }); setDirty(true); }} /></label>
        <label>{editing ? "인증번호 교체 (비우면 유지)" : "인증번호 (4자 이상)"}<input className="cs-input" type="password" required={!editing} minLength={4} maxLength={64} autoComplete="new-password" value={draft.pin} onChange={e => { setDraft({ ...draft, pin: e.target.value }); setDirty(true); }} /></label>
      </fieldset>
      <div className="mg-flex"><ActionButton type="submit" disabled={busy || conflict || !dirty}>{editing ? "구성원 저장" : "디렉터리에 등록"}</ActionButton>{editing && <ActionButton secondary disabled={busy} onClick={() => void edit(null)}>새 등록으로 전환</ActionButton>}</div>
    </form>}
  </Modal>;
}
