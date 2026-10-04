"use client";
import { useRef, useState, type FormEvent } from "react";
import { PageHeading, Panel, ActionButton, EmptyState } from "../shared";
import { useApplication } from "../ApplicationContext";
import { ApiError, api, errorText, useResource } from "@/lib/api";
import type { SubprocessorNoticeRecord, SubprocessorRecord } from "@/contracts/subprocessors";
import type { Paged } from "@/contracts/forms";
import { SubprocessorRecipients } from "./SubprocessorRecipients";

export function SubprocessorMail() {
  const app = useApplication();
  const [service, setService] = useState("");
  const [history, setHistory] = useState(false);
  const serviceId = service || app.data?.serviceId || "";
  return <>
    <PageHeading title="재위탁 안내 메일 발송">
      <ActionButton secondary onClick={() => setHistory(value => !value)}>{history ? "메일 작성" : "메일 발송 이력"}</ActionButton>
    </PageHeading>
    <div className="mg-toolbar"><label>서비스<select className="cs-input" aria-label="재위탁 서비스" value={serviceId} onChange={event => setService(event.target.value)}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {history ? serviceId && <NoticeHistory key={serviceId} serviceId={serviceId} />
      : serviceId && <Composer key={serviceId} serviceId={serviceId} />}
  </>;
}
const noticeStatus: Record<SubprocessorNoticeRecord["status"], string> = {
  queued: "발송 대기", processing: "처리 중", retry: "재시도 대기", processed: "전송 처리 완료",
  failed: "발송 실패", suppressed: "발송 취소·차단", unknown: "확인 불가",
};
function NoticeHistory({ serviceId }: { serviceId: string }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const notices = useResource<Paged<SubprocessorNoticeRecord>>(`/services/${serviceId}/subprocessor-notices?page=${page}&pageSize=${pageSize}`);
  const currentPage = notices.data?.page ?? page;
  const pages = Math.max(1, Math.ceil((notices.data?.total ?? 0) / pageSize));
  return <Panel>
    <div className="mg-toolbar"><span>전체 {notices.data?.total ?? 0}건</span><ActionButton secondary onClick={notices.reload}>이력 새로고침</ActionButton></div>
    <p>전송 처리 완료는 메일 작업이 끝난 상태이며 수신함 도착을 확인한 결과는 아닙니다. 로컬 환경에서는 미리보기 파일만 생성됩니다.</p>
    {notices.loading && <p role="status">발송 이력을 불러오는 중입니다.</p>}
    {notices.error && <p role="alert">{notices.error.message}</p>}
    {notices.data && <><div className="cs-table-wrap"><table className="cs-table">
      <thead><tr>{["#", "요청일시", "수신인", "제목", "발송상태", "처리일시"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{notices.data.items.length ? notices.data.items.map((item, index) => <tr key={item.id}>
        <td>{(currentPage - 1) * pageSize + index + 1}</td><td>{new Date(item.createdAt).toLocaleString("ko-KR")}</td>
        <td>{item.email ?? "발송 당시 주소 확인 불가"}</td><td>{item.subject}</td><td>{noticeStatus[item.status] ?? noticeStatus.unknown}</td>
        <td>{item.completedAt ? new Date(item.completedAt).toLocaleString("ko-KR") : "—"}</td>
      </tr>) : <tr><td colSpan={6}><EmptyState text="발송 이력이 없습니다." /></td></tr>}</tbody>
    </table></div><nav className="cs-pagination" aria-label="재위탁 발송 이력 페이지">
      <select aria-label="페이지당 행 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}
      </select><div><button disabled={currentPage <= 1} aria-label="이전 페이지" onClick={() => setPage(currentPage - 1)}>‹</button>
        <span>{currentPage} / {pages}</span><button disabled={currentPage >= pages} aria-label="다음 페이지" onClick={() => setPage(currentPage + 1)}>›</button></div>
    </nav></>}
  </Panel>;
}
function Composer({ serviceId }: { serviceId: string }) {
  const [selectedId, setSelectedId] = useState("");
  const recipient = useResource<SubprocessorRecord>(selectedId ? `/services/${serviceId}/subprocessors/${selectedId}` : null);
  const [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState(""), [alert, setAlert] = useState("");
  const lock = useRef(false), request = useRef<{ body: string; key: string } | null>(null);
  function reloadRecipient() { recipient.reload(); setConflict(false); setAlert(""); }
  function selectRecipient(id: string) {
    setSelectedId(id); setConflict(false); setAlert(""); setMessage("");
    if (selectedId === id) recipient.reload();
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (lock.current || conflict || recipient.data?.status !== "active") return;
    lock.current = true; setBusy(true); setAlert(""); setMessage("");
    try {
      const payload = JSON.stringify({ subprocessorId: recipient.data.id, recipientVersion: recipient.data.version, subject, body });
      if (request.current?.body !== payload) request.current = { body: payload, key: crypto.randomUUID() };
      await api(`/services/${serviceId}/subprocessor-notices`, { method: "POST", headers: { "Idempotency-Key": request.current.key }, body: payload });
      setSubject(""); setBody(""); request.current = null;
      setMessage("재위탁 안내를 발송 대기열에 넣었습니다. 같은 내용은 다시 보내지 않습니다.");
    } catch (cause) {
      setAlert(errorText(cause));
      setConflict(cause instanceof ApiError && ["VERSION_CONFLICT", "SUBPROCESSOR_ARCHIVED"].includes(cause.code));
    } finally { lock.current = false; setBusy(false); }
  }
  return <>
    <p>수신자 목록에서 안내를 받을 담당자를 선택하세요. 같은 수신자에게 같은 제목과 본문은 한 번만 기록됩니다.</p>
    <SubprocessorRecipients serviceId={serviceId} selectedId={selectedId} onSelect={selectRecipient}
      onChanged={id => { if (id === selectedId) reloadRecipient(); }} />
    <Panel title="안내 메일">
      {message && <p role="status">{message}</p>}{alert && <p role="alert">{alert}</p>}
      {recipient.loading && <p role="status">선택한 수신자를 확인하는 중입니다.</p>}
      {recipient.error && <p role="alert">{recipient.error.message}</p>}
      {recipient.data ? <p>선택한 수신자: <strong>{recipient.data.name} · {recipient.data.email}</strong>{recipient.data.status === "archived" && " · 보관됨 (발송 불가)"}</p>
        : !selectedId && <p>수신자 목록의 선택 버튼을 눌러주세요.</p>}
      {selectedId && <ActionButton secondary type="button" disabled={busy || recipient.loading} onClick={reloadRecipient}>선택한 수신자 새로고침</ActionButton>}
      {conflict && <p>제목과 본문은 유지됩니다. 수신자를 새로고침한 뒤 최신 주소를 확인해주세요.</p>}
      <form className="mg-fields" onSubmit={send}><fieldset disabled={busy}>
        <label>제목<input className="cs-input" aria-label="재위탁 안내 제목" required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /></label>
        <label>본문<textarea className="cs-input mg-mail-body" aria-label="재위탁 안내 본문" required maxLength={20000} value={body} onChange={event => setBody(event.target.value)} /></label>
      </fieldset><ActionButton disabled={busy || conflict || recipient.loading || !!recipient.error || recipient.data?.status !== "active"}>{busy ? "발송 중…" : "메일 발송"}</ActionButton></form>
    </Panel>
  </>;
}
