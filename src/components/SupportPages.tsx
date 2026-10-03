"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import type { SupportTicketKind, SupportTicketListResponse, SupportTicketRecord,
  SupportTicketSummary } from "@/contracts/support-tickets";
import { ActionButton, EmptyState, PageHeading, Panel } from "./shared";
import "./support.css";

type Created = { id: string; status: string; version: number };
const kindLabel = (kind: SupportTicketKind) => kind === "inquiry" ? "문의" : "개선 제안";
const statusLabel: Record<string, string> = { submitted: "접수", answered: "답변 완료", closed: "종료", archived: "삭제" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";

export function SupportCompose({ kind: initialKind = "inquiry", serviceId, onCreated }: {
  kind?: SupportTicketKind; serviceId?: string | null; onCreated?: (id: string) => void;
}) {
  const [kind, setKind] = useState<SupportTicketKind>(initialKind);
  const [subject, setSubject] = useState(""), [message, setMessage] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const row = await api<Created>("/support-tickets", { method: "POST", headers: { "Idempotency-Key": key },
        body: JSON.stringify({ kind, subject, body: message, serviceId: serviceId ?? null }) });
      setCreated(row.id); onCreated?.(row.id);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  if (created) return <div className="cs-stack" role="status"><p>요청이 접수되었습니다.</p>
    <Link className="cs-button" href={`/my-page/support/${created}`}>내 요청 보기</Link>
    <ActionButton secondary onClick={() => { setCreated(null); setSubject(""); setMessage(""); setKey(crypto.randomUUID()); }}>다른 요청 작성</ActionButton>
  </div>;
  return <form className="support-form" onSubmit={submit}>
    <label>구분<select className="cs-input" value={kind} onChange={event => setKind(event.target.value as SupportTicketKind)}>
      <option value="inquiry">문의</option><option value="suggestion">서비스 개선 제안</option></select></label>
    <label>제목<input className="cs-input" value={subject} onChange={event => setSubject(event.target.value)}
      required minLength={1} maxLength={200} placeholder="제목을 입력해주세요"/></label>
    <label>내용<textarea className="cs-input" value={message} onChange={event => setMessage(event.target.value)}
      required minLength={1} maxLength={10000} placeholder="내용을 입력해주세요" rows={7}/></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="public-actions"><ActionButton disabled={busy}>{busy ? "접수 중…" : "접수하기"}</ActionButton>
      {!onCreated && <Link className="cs-button secondary" href="/my-page/support">목록으로</Link>}</div>
  </form>;
}

function SupportList({ admin = false }: { admin?: boolean }) {
  const [kind, setKind] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(1);
  const query = `/support-tickets?scope=${admin ? "admin" : "mine"}&page=${page}&pageSize=20${kind ? `&kind=${kind}` : ""}${status ? `&status=${status}` : ""}`;
  const result = useResource<SupportTicketListResponse>(query);
  return <div className="support-page"><PageHeading title={admin ? "문의·개선 제안 관리" : "내 문의·개선 제안"}>
    {!admin && <Link href="/my-page/support/new" className="cs-button">새 요청</Link>}</PageHeading><Panel>
    <div className="support-filters"><label>구분<select className="cs-input" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}>
      <option value="">전체</option><option value="inquiry">문의</option><option value="suggestion">개선 제안</option></select></label>
      <label>상태<select className="cs-input" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
        <option value="">진행 중 전체</option><option value="submitted">접수</option><option value="answered">답변 완료</option>
        <option value="closed">종료</option><option value="archived">삭제</option></select></label></div>
    {result.loading && <p role="status">요청을 불러오는 중입니다.</p>}
    {result.error && <p role="alert" className="auth-error">{result.error.message}</p>}
    {!result.loading && !result.error && <div className="cs-table-wrap"><table className="cs-table">
      <thead><tr><th>구분</th><th>제목</th><th>상태</th>{admin && <><th>회사</th><th>작성자</th></>}<th>작성일</th></tr></thead>
      <tbody>{result.data?.items.map((row: SupportTicketSummary) => <tr key={row.id}>
        <td>{kindLabel(row.kind)}</td><td>{row.status === "archived" ? "삭제된 요청" :
          <Link href={`${admin ? "/admin/support" : "/my-page/support"}/${row.id}`}>{row.subject}</Link>}</td>
        <td>{statusLabel[row.status]}</td>{admin && <><td>{row.tenantName}</td><td>{row.authorName}</td></>}
        <td>{date(row.createdAt)}</td></tr>)}
      {!result.data?.items.length && <tr><td colSpan={admin ? 6 : 4}><EmptyState text="요청이 없습니다."/></td></tr>}</tbody>
    </table></div>}
    <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개</span><div>
      <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button>
      <span>{page} 페이지</span><button type="button" disabled={page * 20 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>다음</button>
    </div></div></Panel></div>;
}

function SupportDetail({ id, admin = false }: { id: string; admin?: boolean }) {
  const router = useRouter();
  const result = useResource<SupportTicketRecord>(`/support-tickets/${id}${admin ? "?scope=admin" : ""}`);
  const row = result.data;
  const [editing, setEditing] = useState(false), [subject, setSubject] = useState(""), [message, setMessage] = useState("");
  const [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function run(action: "edit" | "reply" | "close" | "reopen" | "archive") {
    if (!row) return;
    setBusy(true); setError("");
    try {
      if (action === "archive") {
        await api(`/support-tickets/${id}${admin ? "?scope=admin" : ""}`, { method: "DELETE", headers: { "If-Match": String(row.version) } });
        router.push(admin ? "/admin/support" : "/my-page/support");
      } else if (action === "edit") {
        await api(`/support-tickets/${id}`, { method: "PATCH", body: JSON.stringify({ version: row.version, subject, body: message }) });
        setEditing(false); result.reload();
      } else if (action === "reply") {
        await api(`/support-tickets/${id}/reply`, { method: "POST", body: JSON.stringify({ version: row.version, reply }) });
        setReply(""); result.reload();
      } else {
        await api(`/support-tickets/${id}/${action}${admin ? "?scope=admin" : ""}`, {
          method: "POST", body: JSON.stringify({ version: row.version }) }); result.reload();
      }
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <div className="support-page"><PageHeading title={admin ? "문의·개선 제안 상세" : "내 요청 상세"}/><Panel>
    {result.loading && <p role="status">요청을 불러오는 중입니다.</p>}
    {result.error && <p role="alert" className="auth-error">{result.error.message}</p>}
    {row && <><div className="support-meta"><span>{kindLabel(row.kind)}</span><span>{statusLabel[row.status]}</span>
      <span>{date(row.createdAt)}</span></div>
      <h2 className="support-title">{row.subject}</h2>
      <p className="cs-muted">{row.tenantName}{row.serviceName ? ` · ${row.serviceName}` : ""} · {row.authorName}
        {admin && ` (${row.authorEmail})`}</p>
      <div className="support-body">{row.body}</div>
      {row.reply && <section className="support-reply"><h3>운영자 답변</h3><p>{row.reply}</p>
        <small>{row.answeredByName} · {date(row.answeredAt)}</small></section>}
      {editing && <form className="support-form" onSubmit={event => { event.preventDefault(); run("edit"); }}>
        <label>제목<input className="cs-input" value={subject} required maxLength={200} onChange={event => setSubject(event.target.value)}/></label>
        <label>내용<textarea className="cs-input" value={message} required maxLength={10000} rows={7}
          onChange={event => setMessage(event.target.value)}/></label>
        <div className="public-actions"><ActionButton disabled={busy}>변경 저장</ActionButton>
          <ActionButton type="button" secondary onClick={() => setEditing(false)}>취소</ActionButton></div></form>}
      {admin && row.status !== "closed" && <form className="support-form support-answer" onSubmit={event => { event.preventDefault(); run("reply"); }}>
        <label>답변<textarea className="cs-input" rows={6} value={reply} onChange={event => setReply(event.target.value)}
          required maxLength={10000} placeholder="고객에게 보여줄 답변을 입력해주세요"/></label>
        <ActionButton disabled={busy}>{row.reply ? "답변 수정" : "답변 등록"}</ActionButton></form>}
      {error && <p role="alert" className="auth-error">{error} <button type="button" onClick={result.reload}>최신 내용 불러오기</button></p>}
      <div className="public-actions support-actions"><Link className="cs-button secondary" href={admin ? "/admin/support" : "/my-page/support"}>목록으로</Link>
        {!admin && row.status === "submitted" && !editing && <ActionButton secondary onClick={() => { setSubject(row.subject ?? ""); setMessage(row.body ?? ""); setEditing(true); }}>수정</ActionButton>}
        {((admin && row.status !== "closed") || (!admin && row.status === "answered")) && <ActionButton secondary disabled={busy} onClick={() => run("close")}>종료</ActionButton>}
        {admin && row.status === "closed" && <ActionButton secondary disabled={busy} onClick={() => run("reopen")}>다시 열기</ActionButton>}
        {!confirm ? <ActionButton secondary onClick={() => setConfirm(true)}>삭제</ActionButton> :
          <ActionButton disabled={busy} onClick={() => run("archive")}>삭제 확인</ActionButton>}</div></>}
  </Panel></div>;
}

export function SupportPages({ path }: { path: string }) {
  if (path === "/my-page/support") return <SupportList/>;
  if (path === "/my-page/support/new") return <div className="support-page"><PageHeading title="문의·개선 제안 작성"/><Panel><SupportCompose/></Panel></div>;
  if (path === "/admin/support") return <SupportList admin/>;
  const detail = /^\/(my-page|admin)\/support\/([0-9a-f-]{36})$/.exec(path);
  if (detail) return <SupportDetail id={detail[2]} admin={detail[1] === "admin"}/>;
  return <Panel><EmptyState text="요청을 찾을 수 없습니다."/></Panel>;
}
