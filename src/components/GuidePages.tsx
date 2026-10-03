"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import type { GuideListResponse, GuideRecord } from "@/contracts/guides";
import { ActionButton, EmptyState, PageHeading, Panel } from "./shared";

async function uploadPdf(guide: GuideRecord, file: File) {
  if (file.size > 10485760) throw new Error("PDF는 10MB 이하로 등록해주세요.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const response = await fetch(`/api/v1/guides/${encodeURIComponent(guide.id)}/file`, {
    method: "PUT", credentials: "same-origin", cache: "no-store", body: file,
    headers: { "Content-Type": "application/pdf", "If-Match": String(guide.version),
      "X-File-Name": encodeURIComponent(file.name), "X-File-Size": String(file.size), "X-File-Sha256": hash },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error?.message ?? "PDF를 등록하지 못했습니다.");
  }
  return response.json() as Promise<GuideRecord>;
}

function GuideList({ admin = false }: { admin?: boolean }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<string | null>(null), [error, setError] = useState("");
  const result = useResource<GuideListResponse>(`/guides?scope=${admin ? "admin" : "published"}&page=${page}&pageSize=100&search=${encodeURIComponent(search)}`);
  const groups = new Map<string, GuideRecord[]>();
  for (const guide of result.data?.items ?? []) {
    const key = `${guide.categoryOrder}:${guide.category}`;
    groups.set(key, [...(groups.get(key) ?? []), guide]);
  }
  async function archive(guide: GuideRecord) {
    setError("");
    try { await api(`/guides/${guide.id}`, { method: "DELETE", headers: { "If-Match": String(guide.version) } });
      setConfirm(null); result.reload(); }
    catch (reason) { setError(errorText(reason)); }
  }
  return <div className="public-guides"><PageHeading title={admin ? "가이드 관리" : "캐치시큐 헬프센터"}>
    {admin && <Link className="cs-button" href="/admin/guides/new">새 가이드</Link>}</PageHeading>
    <p className="public-subtitle">캐치시큐 사용에 도움이 되는 가이드 문서를 확인할 수 있습니다. (pdf)</p>
    <form className="public-notice-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
      <input className="cs-input" aria-label="가이드 검색" placeholder="가이드를 검색해주세요" value={query}
        onChange={event => setQuery(event.target.value)}/><ActionButton secondary>검색</ActionButton>
    </form>
    {(result.error || error) && <p role="alert" className="auth-error">{result.error?.message || error}</p>}
    {result.loading && <p role="status">가이드를 불러오는 중입니다.</p>}
    {!result.loading && !result.error && !result.data?.items.length && <Panel><EmptyState text="가이드가 없습니다."/></Panel>}
    <div className="help-grid">{[...groups].map(([key, guides]) => <Panel key={key} title={guides[0].category}>
      <div className="help-files">{guides.map(guide => <div key={guide.id} className="help-file-row"><span>{guide.title}</span>
        <span className="help-file-actions">{guide.status === "published" && <a href={`/api/v1/guides/${encodeURIComponent(guide.id)}/download`} download={guide.fileName ?? undefined}>다운로드 ↓</a>}
          {admin && <><small>{guide.status === "published" ? "게시" : guide.status === "draft" ? "초안" : "보관"}</small>
            {guide.status !== "archived" && <><Link href={`/admin/guides/${guide.id}/edit`}>수정</Link>
              <button type="button" onClick={() => setConfirm(confirm === guide.id ? null : guide.id)}>삭제</button>
              {confirm === guide.id && <button type="button" onClick={() => archive(guide)}>삭제 확인</button>}</>}</>}</span>
      </div>)}</div></Panel>)}</div>
    <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개</span><div>
      <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button>
      <span>{page} 페이지</span><button type="button" disabled={page * 100 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>다음</button>
    </div></div>
  </div>;
}

function GuideEditor({ id }: { id?: string }) {
  const result = useResource<GuideRecord>(id ? `/guides/${encodeURIComponent(id)}?preview=1` : null);
  const router = useRouter();
  return <div className="public-guides"><PageHeading title={id ? "가이드 수정" : "가이드 작성"}/><Panel>
    {result.loading && <p role="status">가이드를 불러오는 중입니다.</p>}
    {result.error && <p role="alert">{result.error.message}</p>}
    {(!id || result.data) && <GuideForm key={result.data?.version ?? "new"} initial={result.data} onSaved={() => router.push("/admin/guides")}/>}
  </Panel></div>;
}
function GuideForm({ initial, onSaved }: { initial?: GuideRecord; onSaved: () => void }) {
  const [draft, setDraft] = useState<GuideRecord | undefined>(initial);
  const [creationKey] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState(initial?.category ?? "새 가이드");
  const [categoryOrder, setCategoryOrder] = useState(initial?.categoryOrder ?? 100);
  const [title, setTitle] = useState(initial?.title ?? ""), [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 100);
  const [status, setStatus] = useState<"draft" | "published">(initial?.status === "published" ? "published" : "draft");
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const fields = { category, categoryOrder, title, sortOrder };
      let guide: GuideRecord;
      if (draft) {
        guide = await api<GuideRecord>(`/guides/${draft.id}`, { method: "PATCH", body: JSON.stringify({
          ...fields, version: draft.version, ...(status === "draft" && draft.status === "published" ? { status: "draft" } : {}),
        }) });
      } else guide = await api<GuideRecord>("/guides", { method: "POST", headers: { "Idempotency-Key": creationKey }, body: JSON.stringify(fields) });
      setDraft(guide);
      if (file) { guide = await uploadPdf(guide, file); setDraft(guide); }
      if (status === "published" && guide.status !== "published")
        guide = await api<GuideRecord>(`/guides/${guide.id}`, { method: "PATCH", body: JSON.stringify({ version: guide.version, status }) });
      setDraft(guide);
      onSaved();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <form className="public-notice-form" onSubmit={save}>
    <label>분류<input className="cs-input" value={category} required maxLength={100} onChange={event => setCategory(event.target.value)}/></label>
    <label>분류 순서<input className="cs-input" type="number" value={categoryOrder} onChange={event => setCategoryOrder(Number(event.target.value))}/></label>
    <label>제목<input className="cs-input" value={title} required maxLength={200} onChange={event => setTitle(event.target.value)}/></label>
    <label>문서 순서<input className="cs-input" type="number" value={sortOrder} onChange={event => setSortOrder(Number(event.target.value))}/></label>
    <label>PDF 파일<input className="cs-input" type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)}/></label>
    {draft?.fileName && <p className="cs-muted">현재 파일: {draft.fileName} ({draft.fileSize?.toLocaleString("ko-KR")}바이트)
      <a className="cs-link" href={`/api/v1/guides/${draft.id}/download?preview=1`}> 미리보기 다운로드</a></p>}
    <label>상태<select className="cs-input" value={status} onChange={event => setStatus(event.target.value as "draft" | "published")}>
      <option value="draft">초안</option><option value="published">게시</option></select></label>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <div className="public-actions"><ActionButton disabled={busy}>{busy ? "저장 중..." : "저장"}</ActionButton>
      <Link className="cs-button secondary" href="/admin/guides">취소</Link></div>
  </form>;
}
export function GuidePages({ path }: { path: string }) {
  if (path === "/help-center") return <GuideList/>;
  if (path === "/admin/guides") return <GuideList admin/>;
  if (path === "/admin/guides/new") return <GuideEditor/>;
  const match = /^\/admin\/guides\/([A-Za-z0-9-]+)\/edit$/.exec(path);
  if (match) return <GuideEditor id={match[1]}/>;
  return <Panel><EmptyState text="가이드를 찾을 수 없습니다."/></Panel>;
}
