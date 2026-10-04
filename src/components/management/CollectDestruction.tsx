"use client";

import { useState } from "react";
import { useResource } from "@/lib/api";
import type { CollectDestructionList, CollectDestructionRow } from "@/contracts/analytics";
import type { Application } from "../ApplicationContext";
import { ActionButton, EmptyState, PageHeading, Panel } from "../shared";

const columns = ["#", "일자", "서비스 명", "캐치폼·개인정보 업로드 명", "수집한 개인정보", "당일 수집", "당일 파기", "당일 잔여(수집-파기)"];
type Filters = { start: string; end: string; serviceId: string; sourceId: string; search: string; searchField: "all" | "service" | "source" };
const blank = (): Filters => ({ start: "", end: "", serviceId: "", sourceId: "", search: "", searchField: "all" });
function iso(date: string, end: boolean) {
  const value = new Date(date + "T00:00:00");
  if (end) value.setDate(value.getDate() + 1);
  return value.toISOString();
}
function cell(column: string, row: CollectDestructionRow, number: number) {
  if (column === "#") return number;
  if (column === "일자") return row.date;
  if (column === "서비스 명") return row.serviceName;
  if (column === "캐치폼·개인정보 업로드 명") return row.sourceName;
  if (column === "수집한 개인정보") return row.collectedTotal.toLocaleString("ko-KR");
  if (column === "당일 수집") return row.collected.toLocaleString("ko-KR");
  if (column === "당일 파기") return row.destroyed.toLocaleString("ko-KR");
  return row.remaining.toLocaleString("ko-KR");
}

export function CollectDestruction() {
  const context = useResource<Application>("/context");
  const [draft, setDraft] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (applied.start) params.set("from", iso(applied.start, false));
  if (applied.end) params.set("to", iso(applied.end, true));
  if (applied.serviceId) params.set("serviceId", applied.serviceId);
  if (applied.sourceId) params.set("sourceId", applied.sourceId);
  if (applied.search.trim()) { params.set("search", applied.search.trim()); params.set("searchField", applied.searchField); }
  const result = useResource<CollectDestructionList>("/analytics/collect-destruction?" + params.toString());
  const currentPage = result.data?.page ?? page;
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));
  const sources = (result.data?.sources ?? []).filter(source => !draft.serviceId || source.serviceId === draft.serviceId);
  function search() {
    if (draft.start && draft.end && draft.start > draft.end) { setError("종료일은 시작일 이후로 선택해주세요."); return; }
    setError(""); setPage(1); setApplied({ ...draft });
  }
  function reset() { setError(""); setDraft(blank()); setApplied(blank()); setPage(1); result.reload(); }
  async function download() {
    if (exporting) return;
    setError(""); setExporting(true);
    try {
      const exportParams = new URLSearchParams(params);
      exportParams.delete("page"); exportParams.delete("pageSize");
      const response = await fetch("/api/v1/analytics/collect-destruction/export?" + exportParams.toString(),
        { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "수집·파기 내역을 내려받지 못했습니다.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "collect-destruction.csv"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수집·파기 내역을 내려받지 못했습니다."); }
    finally { setExporting(false); }
  }
  return <><PageHeading title="개인정보 수집 및 파기 내역" />
    <p className="mg-description">서비스별/캐치폼·개인정보 업로드 항목 별 개인정보 수집, 잔여, 파기 내역을 하루 단위로 확인할 수 있습니다.</p>
    <Panel><div className="mg-filters">
      <div className="mg-flex">
        <label>시작일 <input className="cs-input" type="date" value={draft.start}
          onChange={event => setDraft(previous => ({ ...previous, start: event.target.value }))} /></label>
        <label>종료일 <input className="cs-input" type="date" value={draft.end}
          onChange={event => setDraft(previous => ({ ...previous, end: event.target.value }))} /></label>
        <select className="cs-input" aria-label="서비스" value={draft.serviceId}
          onChange={event => setDraft(previous => ({ ...previous, serviceId: event.target.value, sourceId: "" }))}>
          <option value="">전체</option>
          {context.data?.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select>
        <select className="cs-input" aria-label="캐치폼·개인정보 업로드" value={draft.sourceId}
          onChange={event => setDraft(previous => ({ ...previous, sourceId: event.target.value }))}>
          <option value="">전체</option>
          {sources.map(source => <option key={source.id} value={source.id}>
            {source.name}{source.kind === "import" ? " (업로드)" : ""}</option>)}
        </select>
      </div>
      <div className="mg-flex">
        <select className="cs-input" aria-label="검색 조건" value={draft.searchField}
          onChange={event => setDraft(previous => ({ ...previous, searchField: event.target.value as Filters["searchField"] }))}>
          <option value="all">전체</option><option value="service">서비스 명</option><option value="source">캐치폼·업로드 명</option>
        </select>
        <input className="cs-input" aria-label="검색어" value={draft.search} maxLength={100}
          onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} />
        <ActionButton secondary onClick={reset}>검색 조건 초기화</ActionButton>
        <ActionButton onClick={search}>검색</ActionButton>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="mg-toolbar"><span>전체 {result.data?.total ?? 0}개</span>
      <ActionButton secondary onClick={result.reload}>새로고침</ActionButton>
      <ActionButton secondary disabled={exporting || !result.data?.total || result.data.total > 5000}
        onClick={download}>{exporting ? "내보내는 중…" : "엑셀 다운로드"}</ActionButton></div>
    {!!result.data && result.data.total > 5000 && <p>5,000건 이하가 되도록 기간이나 서비스를 좁히면 내려받을 수 있습니다.</p>}
    {result.loading && <p role="status">수집·파기 내역을 불러오는 중입니다.</p>}
    {result.error && <p role="alert">{result.error.message}</p>}
    {result.data && <><div className="cs-table-wrap"><table className="cs-table"><thead><tr>
      {columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>
      {result.data.rows.length ? result.data.rows.map((row, index) => <tr key={row.date + row.sourceId}>
        {columns.map((column, columnIndex) => <td key={columnIndex}>{cell(column, row, (currentPage - 1) * pageSize + index + 1)}</td>)}
      </tr>) : <tr><td colSpan={columns.length}><EmptyState text="데이터가 없습니다." /></td></tr>}
      {!!result.data.rows.length && <tr><td>데이터 합계</td><td colSpan={3}></td>
        <td>{result.data.totals.collectedTotal.toLocaleString("ko-KR")}</td>
        <td>{result.data.totals.collected.toLocaleString("ko-KR")}</td>
        <td>{result.data.totals.destroyed.toLocaleString("ko-KR")}</td>
        <td>{result.data.totals.remaining.toLocaleString("ko-KR")}</td></tr>}
    </tbody></table></div><nav className="cs-pagination" aria-label="로그 페이지">
      <select aria-label="페이지당 행 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}
      </select><div><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="이전 페이지">‹</button>
        <span>{currentPage} / {pages}</span>
        <button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="다음 페이지">›</button></div>
    </nav></>}
    <p className="mg-description">잔여 개인정보는 당일 수집 수에서 당일 파기 수를 뺀 값으로, 이전에 수집한 개인정보를 파기하면 마이너스(-)로 표시될 수 있습니다.</p>
  </Panel></>;
}
