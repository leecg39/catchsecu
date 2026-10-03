"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import { formStatus, type FormRecord, type Paged } from "@/contracts/forms";
import { Marketing } from "./Marketing";
import { FixedUrls } from "./FixedUrls";

export function FormLists({ kind }: { kind: "manage" | "marketing" | "fixed" }) {
  if (kind === "fixed") return <FixedUrls />;
  if (kind === "marketing") return <Marketing />;
  return <ManageForms />;
}
function ManageForms() {
  const app = useApplication(), canWrite = app.data?.capabilities.includes("form.write"), canPublish = app.data?.capabilities.includes("form.publish");
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [expanded, setExpanded] = useState(false);
  const [favorite, setFavorite] = useState(false), [status, setStatus] = useState(""), [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [archive, setArchive] = useState<FormRecord>();
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState("");
  const copyKey = useRef<{ id: string; key: string } | null>(null);
  const params = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize), favorite: String(favorite) });
  if (status) params.set("status", status);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (app.data?.serviceId) params.set("serviceId", app.data.serviceId);
  const result = useResource<Paged<FormRecord>>(app.data ? "/forms?" + params : null);
  async function perform(id: string, action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(id); setError(""); setMessage("");
    try { await action(); setMessage(message); result.reload(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(""); }
  }
  return <><PageHeading title="캐치폼·업로드 목록"><p>캐치폼과 수집한 응답을 관리할 수 있습니다.</p>
    {app.data?.capabilities.includes("import.read") && <Link href="/form/info-upload" className="cs-button secondary">업로드 작업 목록</Link>}
    {canWrite && <div className="forms-actions"><Link href="/form/ai/create?new=1" className="cs-button">캐치폼 생성</Link>
      <Link href="/form/info-upload" className="cs-button secondary">개인정보 업로드</Link></div>}</PageHeading>
    <Panel><form className="forms-filter" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
      <input className="cs-input" aria-label="캐치폼 검색" placeholder="캐치폼명 또는 생성자명을 입력해주세요." value={query} onChange={event => setQuery(event.target.value)} />
      <ActionButton>검색</ActionButton><ActionButton type="button" secondary onClick={() => setExpanded(!expanded)}>상세 검색 {expanded ? "닫기" : "열기"}</ActionButton></form>
      {expanded && <div className="forms-expanded"><div className="forms-filter"><label>생성 시작일<input type="date" aria-label="시작일" value={start} onChange={event => { setStart(event.target.value); setPage(1); }} /></label>
        <label>생성 종료일<input type="date" aria-label="종료일" value={end} onChange={event => { setEnd(event.target.value); setPage(1); }} /></label>
        <label>공개상태 <select aria-label="공개상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">보관 제외</option><option value="all">전체</option>
          {Object.entries(formStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <ActionButton secondary onClick={() => { setQuery(""); setSearch(""); setStart(""); setEnd(""); setStatus(""); setFavorite(false); setPage(1); }}>검색 조건 초기화</ActionButton>
      </div></div>}
      <div className="forms-between"><p>{app.data?.services.find(service => service.id === app.data?.serviceId)?.name ?? "접근 가능한 서비스"}</p>
        <label><input type="checkbox" checked={favorite} onChange={event => { setFavorite(event.target.checked); setPage(1); }} /> 즐겨찾기만 보기</label></div>
      {error && <p role="alert">{error}</p>}<p role="status">{message}</p>
      <RemoteTable columns={["#", "즐겨찾기", "공개상태", "서비스 명", "캐치폼 명", "생성자", "현재 게시 응답", "생성일", "보유 기간", "설정"]}
        page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} total={result.data?.total ?? 0}
        loading={result.loading} error={result.error?.message} rows={(result.data?.items ?? []).map((form, index) => ({ id: form.id, cells: [
          (page - 1) * pageSize + index + 1,
          <button key="favorite" disabled={!!busy} aria-label={form.title + " 즐겨찾기"} aria-pressed={form.favorite} onClick={() => perform(form.id,
            () => api("/forms/" + form.id + "/favorite", { method: form.favorite ? "DELETE" : "PUT" }), "즐겨찾기를 변경했습니다.")}>{form.favorite ? "★" : "☆"}</button>,
          formStatus[form.status], form.serviceName,
          <Link key="responses" href={"/form/manage/applicant/" + form.id}>{form.title}</Link>, form.ownerName,
          form.publication ? form.publication.responseCount + " / " + form.publication.maxResponses : "-",
          new Date(form.createdAt).toLocaleDateString("ko-KR"), form.content.retentionDays + "일",
          <div key="actions" className="forms-row-actions">
            {canWrite && <><Link className="cs-link" href={"/form/ai/create?edit=" + form.id}>편집</Link>
              {form.status !== "archived" && <Link className="cs-link" href={"/form/ai/create?templateEdit=new&edit=" + form.id}>템플릿 등록</Link>}
              <button disabled={!!busy} onClick={() => {
                if (copyKey.current?.id !== form.id) copyKey.current = { id: form.id, key: crypto.randomUUID() };
                perform(form.id, async () => { await api("/forms/" + form.id + "/copy", { method: "POST", body: "{}", headers: { "Idempotency-Key": copyKey.current!.key } }); copyKey.current = null; }, "캐치폼을 복사했습니다.");
              }}>복사</button></>}
            {canPublish && form.publication && <><Link className="cs-link" href={"/form/ai/share?formId=" + form.id}>공유</Link>
              {["published", "paused"].includes(form.status) && <button disabled={!!busy} onClick={() => perform(form.id,
                () => api("/forms/" + form.id + (form.status === "published" ? "/pause" : "/resume"), { method: "POST", body: JSON.stringify({ version: form.version }) }),
                form.status === "published" ? "공개를 중지했습니다." : "공개를 재개했습니다.")}>{form.status === "published" ? "일시 중지" : "공개 재개"}</button>}</>}
            {canWrite && form.status !== "archived" && <button disabled={!!busy} onClick={() => setArchive(form)}>보관</button>}
          </div>,
        ] }))} />
    </Panel>{archive && <Modal title="캐치폼 보관" onClose={() => { if (!busy) setArchive(undefined); }}>
      <p>“{archive.title}” 캐치폼의 공개를 종료하고 보관합니다. 기존 응답 기록은 유지됩니다.</p>
      <ActionButton disabled={!!busy} onClick={() => perform(archive.id, async () => {
        await api("/forms/" + archive.id, { method: "DELETE", headers: { "If-Match": String(archive.version) } }); setArchive(undefined);
      }, "캐치폼을 보관했습니다.")}>보관</ActionButton></Modal>}
  </>;
}
