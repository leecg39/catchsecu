"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import type { NoticeListResponse, NoticeRecord } from "@/contracts/notices";
import { ActionButton, EmptyState, PageHeading, Panel } from "./shared";

const date = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}) : "-";
type PendingAttachment = { id: string; file: File };
const uploadMime: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", txt: "text/plain", csv: "text/csv" };
async function uploadAttachment(notice: NoticeRecord, item: PendingAttachment) {
  const { file } = item;
  if (!file.size || file.size > 10485760) throw new Error("첨부파일은 10MB 이하로 등록해주세요.");
  const mime = uploadMime[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime) throw new Error("PDF, PNG, JPG, TXT, CSV 파일만 첨부할 수 있습니다.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const response = await fetch(`/api/v1/notices/${encodeURIComponent(notice.id)}/attachments/${item.id}`, {
    method: "PUT", credentials: "same-origin", cache: "no-store", body: file,
    headers: { "Content-Type": mime, "If-Match": String(notice.version), "X-File-Name": encodeURIComponent(file.name),
      "X-File-Size": String(file.size), "X-File-Sha256": hash },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? "첨부파일을 등록하지 못했습니다.");
  return result as { attachment: NoticeRecord["attachments"][number]; noticeVersion: number };
}

function NoticeList({ admin = false }: { admin?: boolean }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [error, setError] = useState(""), [archiving, setArchiving] = useState<string | null>(null);
  const result = useResource<NoticeListResponse>(`/notices?scope=${admin ? "admin" : "published"}&page=${page}&pageSize=10&search=${encodeURIComponent(search)}`);
  async function archive(row: NoticeListResponse["items"][number]) {
    setArchiving(row.id); setError("");
    try { await api(`/notices/${row.id}`, { method: "DELETE", headers: { "If-Match": String(row.version) } }); result.reload(); }
    catch (reason) { setError(errorText(reason)); } finally { setArchiving(null); }
  }
  return <div className="public-notices"><PageHeading title={admin ? "공지 관리" : "공지사항"}>
    {admin && <Link className="cs-button" href="/admin/notices/new">새 공지</Link>}</PageHeading><Panel>
    <form className="public-notice-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
      <input className="cs-input" aria-label="공지 검색" placeholder="검색어를 입력해주세요" value={query} onChange={event => setQuery(event.target.value)}/>
      <ActionButton secondary>검색</ActionButton>
    </form>
    {(result.error || error) && <p role="alert" className="auth-error">{result.error?.message || error}</p>}
    {result.loading ? <p role="status">공지사항을 불러오는 중입니다.</p> : <div className="cs-table-wrap"><table className="cs-table">
      <thead><tr>{["#", "구분", "제목", "작성일", "글쓴이", ...(admin ? ["상태", "관리"] : [])].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.data?.items.map((row, index) => <tr key={row.id}>
        <td>{(page - 1) * 10 + index + 1}</td><td>{row.category}</td>
        <td><Link href={admin ? `/admin/notices/${row.id}` : `/notice/${row.id}`}>{row.title}</Link></td>
        <td>{date(row.publishedAt)}</td><td>{row.authorName}</td>
        {admin && <><td>{row.status === "published" ? "게시" : row.status === "draft" ? "초안" : "보관"}</td>
          <td>{row.status !== "archived" && <span className="public-notice-actions"><Link href={`/admin/notices/${row.id}/edit`}>수정</Link>
            <button type="button" disabled={archiving !== null} onClick={() => setArchiving(archiving === row.id ? null : row.id)}>삭제</button>
            {archiving === row.id && <button type="button" onClick={() => archive(row)}>삭제 확인</button>}</span>}</td></>}
      </tr>)}
      {!result.error && !result.data?.items.length && <tr><td colSpan={admin ? 7 : 5}><EmptyState text="공지사항이 없습니다."/></td></tr>}</tbody>
    </table></div>}
    <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개</span><div><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button>
      <span>{page} 페이지</span><button type="button" disabled={page * 10 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>다음</button></div></div>
  </Panel></div>;
}

function NoticeDetail({ id, admin = false }: { id: string; admin?: boolean }) {
  const result = useResource<NoticeRecord>(`/notices/${encodeURIComponent(id)}${admin ? "?preview=1" : ""}`);
  const row = result.data;
  return <div className="public-notices"><PageHeading title={admin ? "공지 미리보기" : "공지사항"}/><Panel>
    {result.loading && <p role="status">공지 내용을 불러오는 중입니다.</p>}
    {result.error && <p role="alert">{result.error.message}</p>}
    {row && <><header className="public-notice-header"><span className="public-notice-category">{row.category}</span>
      <h2>{row.title}</h2><p className="cs-muted">{date(row.publishedAt)} · {row.authorName}{admin && ` · ${row.status}`}</p></header>
      <article className="public-notice-content" dangerouslySetInnerHTML={{ __html: row.bodyHtml }}/>
      {!!row.attachments.length && <section className="public-notice-files"><h3>첨부파일</h3>
        {row.attachments.map(file => <a key={file.id} href={`/api/v1/notices/${encodeURIComponent(id)}/attachments/${file.id}${admin ? "?preview=1" : ""}`}
          download={file.fileName}>{file.fileName} ({file.fileSize.toLocaleString("ko-KR")}바이트) ↓</a>)}</section>}</>}
    <div className="public-actions"><Link className="cs-button secondary" href={admin ? "/admin/notices" : "/notice"}>목록으로</Link>
      {admin && row?.status !== "archived" && <Link className="cs-button" href={`/admin/notices/${id}/edit`}>수정</Link>}</div>
  </Panel></div>;
}

function NoticeEditor({ id }: { id?: string }) {
  const result = useResource<NoticeRecord>(id ? `/notices/${encodeURIComponent(id)}?preview=1` : null);
  const router = useRouter();
  return <div className="public-notices"><PageHeading title={id ? "공지 수정" : "공지 작성"}/><Panel>
    {result.error && <p role="alert">{result.error.message}</p>}
    {result.loading && <p role="status">공지 내용을 불러오는 중입니다.</p>}
    {(!id || result.data) && <NoticeForm key={result.data?.version ?? "new"} initial={result.data} onSaved={() => router.push("/admin/notices")}/>}
  </Panel></div>;
}

function NoticeForm({ initial, onSaved }: { initial?: NoticeRecord; onSaved: () => void }) {
  const [draft, setDraft] = useState<NoticeRecord | undefined>(initial);
  const [creationKey] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState(initial?.category ?? "일반공지"), [title, setTitle] = useState(initial?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? ""), [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 1000);
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(status?: "draft" | "published") {
    setBusy(true); setError("");
    try {
      const target = status ?? (draft?.status === "published" ? "published" : "draft");
      const fields = { category, title, bodyHtml, sortOrder };
      let saved: NoticeRecord;
      if (draft) saved = await api<NoticeRecord>(`/notices/${draft.id}`, { method: "PATCH",
        body: JSON.stringify({ ...fields, version: draft.version,
          ...(target === "draft" && draft.status === "published" ? { status: "draft" } : {}) }) });
      else saved = await api<NoticeRecord>("/notices", { method: "POST", headers: { "Idempotency-Key": creationKey },
        body: JSON.stringify({ ...fields, status: "draft" }) });
      setDraft(saved);
      for (const item of files) {
        const uploaded = await uploadAttachment(saved, item);
        saved = { ...saved, version: uploaded.noticeVersion, attachments: [...saved.attachments, uploaded.attachment] };
        setDraft(saved); setFiles(current => current.filter(value => value.id !== item.id));
      }
      if (target === "published" && saved.status !== "published") {
        saved = await api<NoticeRecord>(`/notices/${saved.id}`, { method: "PATCH",
          body: JSON.stringify({ version: saved.version, status: "published" }) });
        setDraft(saved);
      }
      onSaved();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function removeAttachment(id: string) {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      await api(`/notices/${draft.id}/attachments/${id}`, { method: "DELETE", headers: { "If-Match": String(draft.version) } });
      setDraft({ ...draft, version: draft.version + 1, attachments: draft.attachments.filter(file => file.id !== id) });
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); save(); }
  return <form className="public-notice-form" onSubmit={submit}>
    <label>구분<input className="cs-input" value={category} maxLength={30} required onChange={event => setCategory(event.target.value)}/></label>
    <label>제목<input className="cs-input" value={title} maxLength={200} required onChange={event => setTitle(event.target.value)}/></label>
    <label>정렬 순서<input className="cs-input" type="number" value={sortOrder} min={-1000000} max={1000000} onChange={event => setSortOrder(Number(event.target.value))}/></label>
    <label>본문 HTML<textarea className="cs-input" value={bodyHtml} minLength={1} maxLength={100000} required onChange={event => setBodyHtml(event.target.value)}/></label>
    <p className="cs-muted">허용 태그: p, br, strong, em, ul, ol, li, a. 링크는 http/https만 저장됩니다.</p>
    <label>첨부파일 (최대 10개, 각 10MB)<input className="cs-input" type="file" multiple
      accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" onChange={event => {
        const next = Array.from(event.target.files ?? []).map(file => ({ id: crypto.randomUUID(), file }));
        if (files.length + next.length + (draft?.attachments.length ?? 0) > 10)
          setError("공지는 최대 10개 파일을 첨부할 수 있습니다.");
        else if (next.some(item => !item.file.size || item.file.size > 10485760))
          setError("첨부파일은 각 10MB 이하로 등록해주세요.");
        else { setFiles(current => [...current, ...next]); setError(""); }
        event.target.value = "";
      }}/></label>
    {!!files.length && <div className="public-notice-file-list"><strong>등록 예정</strong>{files.map(item =>
      <div key={item.id}><span>{item.file.name}</span><button type="button" disabled={busy}
        onClick={() => setFiles(current => current.filter(value => value.id !== item.id))}>제외</button></div>)}</div>}
    {!!draft?.attachments.length && <div className="public-notice-file-list"><strong>등록된 첨부파일</strong>
      {draft.attachments.map(file => <div key={file.id}><a href={`/api/v1/notices/${draft.id}/attachments/${file.id}?preview=1`}
        download={file.fileName}>{file.fileName}</a><button type="button" disabled={busy} onClick={() => removeAttachment(file.id)}>삭제</button></div>)}</div>}
    {error && <p role="alert" className="auth-error">{error} <button type="button" onClick={() => window.location.reload()}>최신 내용 불러오기</button></p>}
    <div className="public-actions"><ActionButton disabled={busy}>{busy ? "저장 중…" : "저장"}</ActionButton>
      <ActionButton type="button" secondary disabled={busy} onClick={() => save("published")}>게시</ActionButton>
      {draft?.status === "published" && <ActionButton type="button" secondary disabled={busy} onClick={() => save("draft")}>게시 취소</ActionButton>}
      <Link className="cs-button secondary" href="/admin/notices">취소</Link></div>
  </form>;
}

export function NoticePages({ path }: { path: string }) {
  if (path === "/notice") return <NoticeList/>;
  if (path === "/admin/notices") return <NoticeList admin/>;
  if (path === "/admin/notices/new") return <NoticeEditor/>;
  if (path.startsWith("/admin/notices/")) {
    const part = path.slice("/admin/notices/".length);
    return part.endsWith("/edit") ? <NoticeEditor id={part.slice(0, -5)}/> : <NoticeDetail id={part} admin/>;
  }
  return <NoticeDetail id={path.slice("/notice/".length)}/>;
}
