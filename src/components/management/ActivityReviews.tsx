"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, api, errorText, useResource } from "@/lib/api";
import { reviewAction, reviewCreate, reviewStatuses, type ReviewDetail, type ReviewList, type ReviewRecord } from "@/contracts/activity-reviews";
import type { AuditEventRecord } from "@/contracts/audit-events";
import { useApplication, type Application } from "../ApplicationContext";
import { ActionButton, EmptyState, Modal, PageHeading, Panel } from "../shared";

const statuses: Record<ReviewRecord["status"], string> = { requested: "답변 대기", responded: "답변 도착", resolved: "처리 완료", cancelled: "요청 취소" };
const notificationStatuses: Record<string, string> = { queued: "발송 대기", leased: "발송 처리 중", retry: "재시도 대기", dead: "발송 실패", cancelled: "발송 취소", local_delivered: "로컬 시험 전달 완료", accepted: "메일 서버 접수 완료", expired: "발송 자료 보관 종료" };
const messageKinds: Record<string, string> = { request: "검토 요청", response: "대상자 답변", resolve: "처리 완료", cancel: "요청 취소" };
function problem(cause: unknown) { return cause instanceof TypeError ? "연결 상태를 확인한 후 다시 시도해주세요." : errorText(cause); }
const when = (value: string) => new Date(value).toLocaleString("ko-KR");
function manager(app: Application) { return ["security.write", "audit.read"].every(c => app.capabilities.includes(c)); }

export function ActivityReviewRequest({ event, onClose }: { event: AuditEventRecord; onClose: () => void }) {
  const [title, setTitle] = useState("개인정보 활동 검토"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [createdId, setCreatedId] = useState("");
  const lock = useRef(false), request = useRef({ payload: "", key: "" });
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const parsed = reviewCreate.safeParse({ auditEventId: event.id, title, message });
      if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(" "));
      const payload = JSON.stringify(parsed.data);
      if (request.current.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
      const result = await api<{ id: string }>("/activity-reviews", { method: "POST", headers: { "Idempotency-Key": request.current.key }, body: payload });
      setCreatedId(result.id);
    } catch (cause) { setError(problem(cause)); } finally { lock.current = false; setBusy(false); }
  }
  return <Modal title="개인정보 활동 검토 요청" onClose={() => { if (!lock.current) onClose(); }}>
    {createdId ? <div className="activity-review-fields"><p role="status">검토 요청을 등록했습니다. 대상자는 마이페이지에서 확인하고 답변할 수 있습니다.</p><Link className="cs-button" href={"/my-page/info-activity-log?reviewId=" + createdId}>검토 이력 열기</Link></div> : <form className="activity-review-fields" onSubmit={submit}>
      <p>{event.serviceName ?? "서비스"} · {event.actorName ?? "처리자"} · {when(event.createdAt)}</p><p>{event.action}</p>
      <p className="mg-muted">요청은 이 기록의 처리자에게 전달됩니다. 주민번호·연락처 등 개인정보 원문을 입력하지 마세요.</p>
      <fieldset disabled={busy}><label>제목<input className="cs-input" aria-label="검토 요청 제목" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>요청 내용<textarea className="cs-input" aria-label="검토 요청 내용" required maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} /></label></fieldset>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "등록 중…" : "검토 요청 등록"}</ActionButton>
      <Link className="cs-link" href="/my-page/info-activity-log">기존 검토 이력 확인</Link>
    </form>}
  </Modal>;
}
export function ActivityReviews() {
  const app = useApplication(), params = useSearchParams();
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  return <ReviewWorkspace key={app.data.company?.id ?? "none"} app={app.data} initialId={params.get("reviewId") ?? ""} />;
}
type Filters = { status: string; search: string; serviceId: string; from: string; to: string };
const blank = (): Filters => ({ status: "all", search: "", serviceId: "", from: "", to: "" });
function boundary(value: string, end: boolean) { const date = new Date(value + "T00:00:00"); if (end) date.setDate(date.getDate() + 1); return date.toISOString(); }
function ReviewWorkspace({ app, initialId }: { app: Application; initialId: string }) {
  const [scope, setScope] = useState("received"), [draft, setDraft] = useState(blank), [filters, setFilters] = useState(blank), [page, setPage] = useState(1), [size, setSize] = useState(10);
  const [selected, setSelected] = useState(initialId), [error, setError] = useState("");
  const params = new URLSearchParams({ scope, status: filters.status, search: filters.search, page: String(page), pageSize: String(size) });
  if (filters.serviceId) params.set("serviceId", filters.serviceId);
  if (filters.from) params.set("from", boundary(filters.from, false)); if (filters.to) params.set("to", boundary(filters.to, true));
  const result = useResource<ReviewList>("/activity-reviews?" + params), currentPage = result.data?.page ?? page, pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / size));
  function search(e: FormEvent) { e.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) { setError("종료일은 시작일 이후로 선택해주세요."); return; } setError(""); setFilters({ ...draft }); setPage(1); }
  return <div className="activity-reviews"><PageHeading title="개인정보 활동 검토 이력"><Link className="cs-button secondary" href="/my-page/info">프로필</Link></PageHeading>
    <p className="mg-description">받은 검토 요청에 처리 사유를 답변하고 진행 상태를 확인합니다. 앱 내 메시지이며 이메일 발송 결과를 뜻하지 않습니다.</p>
    <div className="mg-tabs" role="tablist" aria-label="검토 이력 범위">{[["received", "받은 요청"], ...(manager(app) ? [["sent", "보낸 요청"], ["company", "회사 전체"]] : [])].map(([value, label]) => <button key={value} role="tab" aria-selected={scope === value} className={scope === value ? "active" : ""} onClick={() => { setScope(value); setPage(1); }}>{label}</button>)}</div>
    <Panel><form className="activity-review-filters" onSubmit={search}>
      <label>상태<select className="cs-input" aria-label="검토 상태" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="all">전체 상태</option>{reviewStatuses.map(s => <option value={s} key={s}>{statuses[s]}</option>)}</select></label>
      <label>서비스<select className="cs-input" aria-label="검토 서비스" value={draft.serviceId} onChange={e => setDraft({ ...draft, serviceId: e.target.value })}><option value="">전체 서비스</option>{app.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>시작일<input className="cs-input" aria-label="검토 시작일" type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>종료일<input className="cs-input" aria-label="검토 종료일" type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <label>제목 검색<input className="cs-input" aria-label="검토 제목 검색" maxLength={100} value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} /></label>
      <ActionButton>검색</ActionButton><ActionButton secondary type="button" onClick={() => { setDraft(blank()); setFilters(blank()); setPage(1); setError(""); result.reload(); }}>검색 초기화</ActionButton>
    </form>{error && <p role="alert">{error}</p>}
      <div className="activity-review-toolbar"><span>전체 {result.data?.total ?? 0}건</span><ActionButton secondary onClick={result.reload}>검토 이력 새로고침</ActionButton></div>
      {result.loading && <p role="status">검토 이력을 불러오는 중입니다.</p>}{result.error && <p role="alert">{problem(result.error)}</p>}
      {result.data && <><div className="cs-table-wrap"><table className="cs-table"><thead><tr>{["#", "수신일시", "발신자", "내용", "구분", "대상자", "상태", "메시지"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {result.data.items.length ? result.data.items.map((row, index) => <tr key={row.id}><td>{(currentPage - 1) * size + index + 1}</td><td>{when(row.createdAt)}</td><td>{row.requesterName}</td>
          <td><button className="cs-link" onClick={() => setSelected(row.id)}>{row.title}</button><small className="activity-review-service">{row.serviceName}</small></td><td>{row.action}</td><td>{row.recipientName}</td><td>{statuses[row.status]}</td>
          <td><button className="cs-link" aria-label={row.title + " 메시지 확인"} onClick={() => setSelected(row.id)}>메시지 확인</button></td></tr>) : <tr><td colSpan={8}><EmptyState text="조건에 맞는 검토 요청이 없습니다." /></td></tr>}
      </tbody></table></div><nav className="cs-pagination" aria-label="검토 이력 페이지"><select aria-label="검토 페이지당 행 수" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>{[10, 20, 50, 100].map(n => <option key={n}>{n}</option>)}</select>
        <div><button aria-label="검토 이전 페이지" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage} / {pages}</span><button aria-label="검토 다음 페이지" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>›</button></div></nav></>}
    </Panel>{selected && <ReviewDialog id={selected} onClose={() => setSelected("")} onChanged={result.reload} />}
  </div>;
}
function ReviewDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const result = useResource<ReviewDetail>("/activity-reviews/" + id), busy = useRef(false);
  return <Modal title="개인정보 활동 검토 상세" onClose={() => { if (!busy.current) onClose(); }}>
    {result.loading && <p role="status">검토 내용을 불러오는 중입니다.</p>}
    {result.error && <div><p role="alert">{problem(result.error)}</p><ActionButton secondary onClick={result.reload}>검토 상세 다시 불러오기</ActionButton></div>}
    {result.data && <ReviewConversation key={id + ":" + result.data.version} row={result.data} onBusy={value => { busy.current = value; }} onReload={result.reload} onChanged={() => { result.reload(); onChanged(); }} />}
  </Modal>;
}
function ReviewConversation({ row, onBusy, onReload, onChanged }: { row: ReviewDetail; onBusy: (value: boolean) => void; onReload: () => void; onChanged: () => void }) {
  const notificationKey = useRef("");
  const [action, setAction] = useState<"response" | "resolve" | "cancel">(row.canRespond ? "response" : row.status === "responded" ? "resolve" : "cancel"), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), request = useRef({ payload: "", key: "" }), lock = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current || conflict) return; lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const parsed = reviewAction.safeParse({ version: row.version, action, message }); if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(" "));
      const payload = JSON.stringify(parsed.data); if (request.current.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
      await api("/activity-reviews/" + row.id + "/actions", { method: "POST", headers: { "Idempotency-Key": request.current.key }, body: payload }); onChanged();
    } catch (cause) { setError(problem(cause)); setConflict(cause instanceof ApiError && cause.status === 409); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  async function notify() {
    if (lock.current || conflict) return; lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      notificationKey.current ||= crypto.randomUUID();
      await api("/activity-reviews/" + row.id + "/notifications", { method: "POST", headers: { "Idempotency-Key": notificationKey.current }, body: JSON.stringify({ version: row.version }) });
      onChanged();
    } catch (cause) { setError(problem(cause)); setConflict(cause instanceof ApiError && cause.status === 409); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <div className="activity-review-fields"><h3>{row.title}</h3><p>{row.serviceName} · {row.action}</p><p>요청자 {row.requesterName} · 대상자 {row.recipientName}</p><p role="status">{statuses[row.status]} · 버전 {row.version}</p>
    {row.notification && <div><p role="status">이메일 알림: {notificationStatuses[row.notification.status] ?? "상태 확인 필요"}</p><small>{when(row.notification.createdAt)} 요청 · 외부 수신 완료를 뜻하지 않습니다.</small><ActionButton type="button" secondary disabled={busy} onClick={onReload}>알림 상태 새로고침</ActionButton></div>}
    {row.canNotify && <div><p>대상자의 등록 이메일로 확인 안내만 보냅니다. 검토 제목과 본문은 메일에 포함하지 않습니다.</p><ActionButton type="button" secondary disabled={busy || conflict} onClick={notify}>{busy ? "처리 중…" : "이메일 알림 요청"}</ActionButton></div>}
    <ol className="activity-review-messages">{row.messages.map(m => <li key={m.id}><strong>{messageKinds[m.kind] ?? m.kind} · {m.authorName}</strong><time dateTime={m.createdAt}>{when(m.createdAt)}</time><p>{m.body}</p></li>)}</ol>
    {(row.canRespond || row.canClose) && <form className="activity-review-fields" onSubmit={submit}><fieldset disabled={busy || conflict}>
      {row.canClose && <label>처리 방식<select className="cs-input" aria-label="검토 처리 방식" value={action} onChange={e => setAction(e.target.value as "resolve" | "cancel")}>{row.status === "responded" && <option value="resolve">처리 완료</option>}<option value="cancel">요청 취소</option></select></label>}
      <label>{row.canRespond ? "답변 내용" : "처리 내용"}<textarea className="cs-input" aria-label="검토 메시지" required maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} /></label><small>{message.length} / 4000</small>
    </fieldset>{error && <p role="alert">{error}</p>}
      {conflict && <div><p>저장하지 않은 입력은 유지됩니다. 최신 이력을 불러오면 현재 입력이 초기화됩니다.</p><ActionButton type="button" secondary onClick={onReload}>최신 검토 불러오기</ActionButton></div>}
      <ActionButton disabled={busy || conflict}>{busy ? "저장 중…" : action === "response" ? "답변 보내기" : action === "resolve" ? "처리 완료" : "요청 취소"}</ActionButton>
    </form>}
  </div>;
}
