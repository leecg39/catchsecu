"use client";

import { useState } from "react";
import { useResource } from "@/lib/api";
import type { AuditEventKind, AuditEventList, AuditEventRecord } from "@/contracts/audit-events";
import type { Application } from "../ApplicationContext";
import { ActionButton, EmptyState, PageHeading, Panel } from "../shared";

type AuditConfig = { title: string; kind: AuditEventKind; columns: string[]; scope?: "mine"; description?: string };
const generic = ["#", "서비스명", "처리자명", "처리일시", "처리내용", "처리대상"];
const configs: Record<string, AuditConfig> = {
  "/log/service": { title: "서비스 이용 로그", kind: "service", description: "현재 회사의 서비스 생성·변경·보관 이력을 확인합니다.",
    columns: ["#", "처리자명", "처리일시", "접속 IP", "처리대상", "처리내용", "비고"] },
  "/log/info-monitoring": { title: "개인정보 처리로그", kind: "info",
    columns: ["#", "서비스명", "캐치폼·개인정보 업로드명", "처리자명", "처리일시", "접속 IP", "고객번호", "처리내용", "사유"] },
  "/log/ad-monitoring": { title: "광고성 정보 수신동의 처리로그", kind: "marketing",
    columns: ["#", "서비스명", "처리자명", "처리일시", "접속 IP", "고객번호", "처리내용", "사유"] },
  "/log/customer": { title: "고객 이용 로그", kind: "customer",
    columns: ["#", "서비스 명", "캐치폼 명", "고객번호", "처리일시", "접속 IP", "수행내용"] },
  "/log/member": { title: "구성원 로그", kind: "member", columns: generic },
  "/log/authority": { title: "권한 변경 로그", kind: "authority", columns: generic },
  "/log/external-viewer": { title: "외부 열람자 로그", kind: "external", columns: generic },
  "/log/access-history": { title: "접속 이력", kind: "access", columns: generic },
  "/log/mail": { title: "이메일 발송현황", kind: "mail", columns: generic },
  "/my-page/activity-log": { title: "나의 활동 로그", kind: "all", scope: "mine",
    columns: ["#", "처리일시", "서비스명", "수행내용", "처리대상"] },
};
export function hasAuditLog(path: string) { return path in configs; }

type Filters = { start: string; end: string; serviceId: string; search: string; searchField: "action" | "resource" | "actor" };
const blank = (): Filters => ({ start: "", end: "", serviceId: "", search: "", searchField: "action" });
function iso(date: string, end: boolean) {
  const value = new Date(date + "T00:00:00");
  if (end) value.setDate(value.getDate() + 1);
  return value.toISOString();
}
function cell(column: string, row: AuditEventRecord, number: number) {
  if (column === "#") return number;
  if (["처리일시", "수신일시", "일자"].includes(column)) return new Date(row.createdAt).toLocaleString("ko-KR");
  if (["서비스명", "서비스 명"].includes(column)) return row.serviceName ?? "회사 공통";
  if (["처리자명", "발신자"].includes(column)) return row.actorName ?? "비공개";
  if (["처리내용", "수행내용", "내용"].includes(column)) return row.action;
  if (column === "처리대상") return row.resourceId ? row.resource + " · " + row.resourceId.slice(0, 8) : row.resource;
  return "-";
}

export function AuditLogs({ path }: { path: string }) {
  const config = configs[path];
  const context = useResource<Application>("/context");
  const [draft, setDraft] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const params = new URLSearchParams({ scope: config.scope ?? "company", kind: config.kind,
    page: String(page), pageSize: String(pageSize) });
  if (applied.start) params.set("from", iso(applied.start, false));
  if (applied.end) params.set("to", iso(applied.end, true));
  if (applied.serviceId) params.set("serviceId", applied.serviceId);
  if (applied.search.trim()) { params.set("search", applied.search.trim()); params.set("searchField", applied.searchField); }
  const result = useResource<AuditEventList>("/audit-events?" + params.toString());
  const companyWide = ["owner", "admin", "security", "auditor"].includes(context.data?.company?.role ?? "");
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));
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
      const response = await fetch("/api/v1/audit-events/export?" + exportParams.toString(),
        { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "감사 기록을 내려받지 못했습니다.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "audit-events.csv"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "감사 기록을 내려받지 못했습니다."); }
    finally { setExporting(false); }
  }
  return <><PageHeading title={config.title} />{config.description && <p className="mg-description">{config.description}</p>}
    <Panel><div className="mg-filters">
      <div className="mg-flex">
        <label>시작일 <input className="cs-input" type="date" value={draft.start}
          onChange={event => setDraft(previous => ({ ...previous, start: event.target.value }))} /></label>
        <label>종료일 <input className="cs-input" type="date" value={draft.end}
          onChange={event => setDraft(previous => ({ ...previous, end: event.target.value }))} /></label>
        {config.scope !== "mine" && <select className="cs-input" aria-label="서비스" value={draft.serviceId}
          onChange={event => setDraft(previous => ({ ...previous, serviceId: event.target.value }))}>
          <option value="">전체 서비스</option>
          {context.data?.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select>}
      </div>
      <div className="mg-flex">
        <select className="cs-input" aria-label="검색 조건" value={draft.searchField}
          onChange={event => setDraft(previous => ({ ...previous, searchField: event.target.value as Filters["searchField"] }))}>
          <option value="action">처리내용</option><option value="resource">처리대상</option>
          {companyWide && config.scope !== "mine" && <option value="actor">처리자명</option>}
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
        onClick={download}>{exporting ? "내보내는 중…" : "CSV 내려받기"}</ActionButton></div>
    {!!result.data && result.data.total > 5000 && <p>5,000건 이하가 되도록 기간이나 서비스를 좁히면 CSV로 내려받을 수 있습니다.</p>}
    {result.loading && <p role="status">실제 감사 기록을 불러오는 중입니다.</p>}
    {result.error && <p role="alert">{result.error.message}</p>}
    {result.data && <><div className="cs-table-wrap"><table className="cs-table"><thead><tr>
      {config.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>
      {result.data.items.length ? result.data.items.map((item, index) => <tr key={item.id}>
        {config.columns.map((column, columnIndex) => <td key={columnIndex}>{cell(column, item, (page - 1) * pageSize + index + 1)}</td>)}
      </tr>) : <tr><td colSpan={config.columns.length}><EmptyState text="조회된 감사 기록이 없습니다." /></td></tr>}
    </tbody></table></div><nav className="cs-pagination" aria-label="로그 페이지">
      <select aria-label="페이지당 행 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}
      </select><div><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="이전 페이지">‹</button>
        <span>{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="다음 페이지">›</button></div>
    </nav></>}
    <p className="mg-description">감사 원장에 저장되지 않은 접속 IP·고객번호·사유는 표시하지 않습니다.</p>
  </Panel></>;
}
