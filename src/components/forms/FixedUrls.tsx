"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { CopyButton } from "../ux/copy-button";
import { QrButton } from "../ux/qr-button";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import type { FormRecord, Paged } from "@/contracts/forms";

type FixedUrl = { id: string; name: string; slug: string; status: string; version: number; createdAt: string; formId: string; formTitle: string; url: string };
export function FixedUrls() {
  const app = useApplication(), canWrite = app.data?.capabilities.includes("form.publish");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [status, setStatus] = useState("active");
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [edit, setEdit] = useState<FixedUrl | "new">();
  const [remove, setRemove] = useState<FixedUrl>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status });
  if (app.data?.serviceId) params.set("serviceId", app.data.serviceId);
  const result = useResource<Paged<FixedUrl>>(app.data ? "/fixed-urls?" + params : null);
  const shownPage=result.data?.page ?? page;
  return <><PageHeading title="고정URL 관리"><p>주소를 유지하면서 연결된 캐치폼을 변경할 수 있습니다. 같은 폼을 다시 게시하면 새 게시본으로 자동 연결됩니다.</p>
    {canWrite && <ActionButton onClick={() => setEdit("new")}>고정URL 생성</ActionButton>}</PageHeading>
    <Panel><form className="forms-filter" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
      <input className="cs-input" aria-label="URL명 검색" placeholder="URL명 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="고정URL 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">사용 중</option><option value="revoked">사용 종료</option></select><ActionButton secondary>검색</ActionButton></form>
      {error && <p role="alert">{error}</p>}
      <RemoteTable columns={["#", "URL 명", "URL", "연결된 캐치폼", "생성일", "관리"]} rows={(result.data?.items ?? []).map((row, index) => ({
        id: row.id, cells: [(shownPage - 1) * pageSize + index + 1, row.name,
          <span className="ux-url-cell" key="url"><Link href={row.url} target="_blank" rel="noopener noreferrer">{row.url}</Link>
            <CopyButton text={row.url} label="URL 복사" copied="URL이 복사됐습니다." />
            <QrButton url={row.url} name={row.name} filename={row.slug} /></span>,
          row.formTitle, new Date(row.createdAt).toLocaleDateString("ko-KR"), canWrite && row.status === "active" ?
            <div className="forms-row-actions" key="actions"><button onClick={() => setEdit(row)}>수정</button><button onClick={() => setRemove(row)}>사용 종료</button></div> : "종료"],
      }))} page={shownPage} pageSize={pageSize} total={result.data?.total ?? 0} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={result.loading} error={result.error?.message} />
    </Panel>
    {edit && <Modal title={edit === "new" ? "고정URL 생성" : "고정URL 수정"} onClose={() => setEdit(undefined)}><FixedUrlEditor initial={edit === "new" ? undefined : edit}
      onSaved={() => { setEdit(undefined); result.reload(); }} /></Modal>}
    {remove && <Modal title="고정URL 사용 종료" onClose={() => { if (!busy) setRemove(undefined); }}><p>“{remove.name}” 주소의 사용을 종료합니다. 종료한 주소는 다시 사용할 수 없습니다.</p>
      <ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try {
        await api("/fixed-urls/" + remove.id, { method: "DELETE", headers: { "If-Match": String(remove.version) } }); setRemove(undefined); result.reload();
      } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }}>사용 종료</ActionButton></Modal>}
  </>;
}
function FixedUrlEditor({ initial, onSaved }: { initial?: FixedUrl; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? ""), [slug, setSlug] = useState(initial?.slug ?? "");
  const [formId, setFormId] = useState(initial?.formId ?? ""), [search, setSearch] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<{ payload: string; key: string } | null>(null);
  const forms = useResource<Paged<FormRecord>>("/forms?status=published&pageSize=100&search=" + encodeURIComponent(search));
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = JSON.stringify({ name, formId, ...(initial ? { version: initial.version } : slug ? { slug } : {}) });
      if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
      await api("/fixed-urls" + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: payload, headers: { "Idempotency-Key": pending.current!.key } });
      onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className="cs-stack" onSubmit={save}><label className="cs-label">URL 명<input className="cs-input" required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="cs-label">주소<input className="cs-input" disabled={!!initial} value={slug} pattern="[a-z0-9][a-z0-9-]{2,63}" placeholder="비워두면 자동 생성됩니다" onChange={event => setSlug(event.target.value)} /></label>
    <label className="cs-label">연결할 캐치폼 검색<input className="cs-input" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <label className="cs-label">연결된 캐치폼<select className="cs-input" required value={formId} onChange={event => setFormId(event.target.value)}><option value="">선택해주세요</option>
      {initial && !forms.data?.items.some(form => form.id === initial.formId) && <option value={initial.formId}>{initial.formTitle}</option>}
      {forms.data?.items.map(form => <option key={form.id} value={form.id}>{form.title} ({form.serviceName})</option>)}</select></label>
    {(forms.data?.total ?? 0) > 100 && <p>검색 결과가 100개를 넘습니다. 제목으로 검색 범위를 줄여주세요.</p>}
    {forms.error && <p role="alert">{forms.error.message}</p>}{error && <p role="alert">{error}</p>}<ActionButton disabled={busy || forms.loading}>{busy ? "저장 중…" : "저장"}</ActionButton>
  </form>;
}
