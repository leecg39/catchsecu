"use client";

import { useState } from "react";
import Link from "next/link";
import type { AnalyticsDashboard, ComplianceCloseRecord } from "@/contracts/analytics";
import { api, errorText, useResource } from "@/lib/api";
import { ActionButton, DataTable, PageHeading, Panel } from "./shared";
import { ComplianceExports } from "./ComplianceExports";
import { complianceEvidenceChecks, evidenceStatusLabels } from "@/contracts/compliance-evidence";
import { useApplication } from "./ApplicationContext";

const date = (value: string) => new Date(value).toLocaleDateString("ko-KR");
const boundary = (value: string, end: boolean) => {
  const day = new Date(value + "T00:00:00");
  if (end) day.setDate(day.getDate() + 1);
  return day.toISOString();
};

export function PrivacyStatistics({ path }: { path: string }) {
  const serviceId = /^\/privacy-detail\/([^/]+)$/.exec(path)?.[1];
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filterError, setFilterError] = useState("");
  const params = new URLSearchParams();
  if (serviceId) params.set("serviceId", serviceId);
  if (period.from) params.set("from", boundary(period.from, false));
  if (period.to) params.set("to", boundary(period.to, true));
  const result = useResource<AnalyticsDashboard>("/analytics/dashboard" + (params.size ? "?" + params : ""));
  const data = result.data;
  const rows = (data?.services ?? []).filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="public-statistics">
    <PageHeading title="개인정보 응답 보유 현황"><p>접근 가능한 서비스의 실제 응답과 파기 기록을 집계합니다.</p></PageHeading>
    <Panel title="조회 기간"><div className="public-stat-filters">
      <label>시작일 <input className="cs-input" type="date" value={draft.from}
        onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label>
      <label>종료일 <input className="cs-input" type="date" value={draft.to}
        onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label>
      <ActionButton onClick={() => { if (!!draft.from !== !!draft.to) {
        setFilterError("시작일과 종료일을 모두 선택해주세요."); return;
      } if (draft.from && draft.to && draft.from > draft.to) {
        setFilterError("종료일은 시작일 이후여야 합니다."); return;
      } setFilterError(""); setPeriod(draft); }}>기간 적용</ActionButton>
      <ActionButton secondary onClick={() => { setDraft({ from: "", to: "" }); setPeriod({ from: "", to: "" }); setFilterError(""); }}>기본 기간</ActionButton>
    </div>{filterError && <p role="alert">{filterError}</p>}
    {data && <p className="public-stat-note">집계 기준 {new Date(data.asOf).toLocaleString("ko-KR")} · 기간 {date(data.period.from)}부터 {date(data.period.to)} 전까지</p>}</Panel>
    {result.loading ? <Panel><p role="status">개인정보 현황을 집계 중입니다.</p></Panel>
      : result.error ? <Panel><p role="alert">{result.error.message}</p></Panel>
      : data && <><Panel title="응답 현황"><div className="public-stat-overview">
        <p>현재 보유 응답 <strong>{data.totals.retainedSubmissions}</strong>건</p>
        <p>선택 기간 접수·현재 보유 <strong>{data.totals.periodSubmissions}</strong>건</p>
        <p>선택 기간 파기 완료 <strong>{data.totals.periodDestructions}</strong>건</p>
      </div><p className="public-stat-note">파기 중·파기 완료·보유 기한 경과 응답은 현재 보유 건수에서 제외하고, 보존 조치 중인 응답은 포함합니다.</p></Panel>
      <Panel title="서비스별 응답 현황"><form className="public-stat-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
        <input className="cs-input" aria-label="서비스명 검색" placeholder="서비스명" value={query} onChange={event => setQuery(event.target.value)} />
        <ActionButton secondary>검색</ActionButton><ActionButton type="button" secondary onClick={result.reload}>새로고침</ActionButton>
      </form><DataTable columns={["서비스명", "캐치폼", "현재 보유 응답", "선택 기간 접수·현재 보유", "생성일"]}
        rows={rows.map(row => [<Link key={row.id} href={"/privacy-detail/" + row.id}>{row.name}</Link>, row.forms,
          row.retainedSubmissions, row.periodSubmissions, date(row.createdAt)])} />
        <p className="public-stat-note">원천 데이터에 개인정보·민감정보·고유식별정보 분류가 없으므로 유형별 수치는 표시하지 않습니다.</p>
      </Panel></>}
  </div>;
}

export function CompliancePage({ monthly = false }: { monthly?: boolean } = {}) {
  const result = useResource<AnalyticsDashboard>("/analytics/dashboard");
  const data = result.data;
  const app = useApplication();
  const canCloseCompany = !!app.data?.company && ["owner", "admin"].includes(app.data.company.role) &&
    app.data.memberships.some(member => member.tenantId === app.data?.company?.id && member.accessKind === "direct");
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()));
  const [scope, setScope] = useState<string | null>(null);
  const selected = scope ?? (canCloseCompany ? "" : null);
  const selectedService = data?.services.find(service => service.id === selected);
  const validScope = selected === "" ? canCloseCompany : !!selectedService;
  const selectedDashboard = useResource<AnalyticsDashboard>(validScope && selected ? "/analytics/dashboard?serviceId=" + selected : null);
  const current = selected ? selectedDashboard : result;
  const closeQuery = "/analytics/closes?" + new URLSearchParams({ month, ...(selected ? { serviceId: selected } : {}) });
  const closed = useResource<{ close: ComplianceCloseRecord | null }>(validScope && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? closeQuery : null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function closeMonth() {
    if (busy || !validScope || !month) return; setBusy(true); setError(""); setMessage("");
    try { await api("/analytics/closes", { method: "POST", body: JSON.stringify({ month, ...(selected ? { serviceId: selected } : {}) }) }); setMessage("선택한 월과 범위의 집계를 마감했습니다. 준수 통과로 판정하지 않습니다."); closed.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="public-statistics"><PageHeading title={monthly ? "마감 데이터 조회" : "개인정보 보호현황 점검 결과"} />
    <Panel title="점검 상태"><p role="status">법적 준수 여부는 미판정입니다.</p>
      <p className="public-stat-note">월마감에 실제 등록·게시·보유 기한과 회사 인증 설정의 점검 근거를 저장합니다. 조건 확인은 준수 통과를 뜻하지 않으며 점수나 과태료를 산정하지 않습니다.</p>
      <div className="public-stat-filters">
        <label>마감 월 <input className="cs-input" type="month" aria-label="마감 월" value={month} disabled={busy}
          onChange={event => { setMonth(event.target.value); setMessage(""); setError(""); }} /></label>
        <label>마감 범위 <select className="cs-select" aria-label="마감 범위" value={selected ?? "select"} disabled={busy || result.loading}
          onChange={event => { setScope(event.target.value); setMessage(""); setError(""); }}>
          <option value="select" disabled>서비스를 선택해주세요</option>
          {canCloseCompany && <option value="">회사 전체</option>}
          {(data?.services ?? []).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select></label>
        <ActionButton disabled={busy || !validScope || !month || closed.loading || !!closed.error || !!closed.data?.close}
          onClick={() => { void closeMonth(); }}>{busy ? "마감 중…" : closed.data?.close ? "마감된 집계" : month + " 집계 마감"}</ActionButton>
        <ActionButton secondary disabled={busy || !validScope || !month} onClick={closed.reload}>마감 새로고침</ActionButton>
      </div>
      {!canCloseCompany && <p className="public-stat-note">권한이 있는 서비스를 선택해 마감할 수 있습니다. 회사 전체 마감은 소유자와 관리자만 이용할 수 있습니다.</p>}
      {closed.loading && <p role="status">선택한 범위의 마감을 확인하고 있습니다.</p>}
      {closed.error && <p role="alert">{closed.error.message}</p>}
      {closed.data?.close && <p><a href={"/api/v1/analytics/closes/" + closed.data.close.id + "/export"}>마감 CSV 내려받기</a> · 보유 응답 {closed.data.close.totals.retainedSubmissions}건 · 판정 없음</p>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </Panel>
    {closed.data?.close && <Panel title="마감에 저장된 점검 근거">
      {closed.data.close.evidence ? <>
        <p className="public-stat-note">점검 시각 {new Date(closed.data.close.evidence.checkedAt).toLocaleString("ko-KR")} · 마감 저장 당시의 데이터입니다. 과거 월말 상태를 복원한 값이 아닙니다.</p>
        <DataTable columns={["분류", "점검 항목", "상태", "근거와 확인 범위"]}
          rows={complianceEvidenceChecks(closed.data.close.evidence).map(check => [check.category, check.title, evidenceStatusLabels[check.status], <div className="compliance-evidence-detail" key={check.id}>{check.detail}<p className="public-stat-note">원천: {check.source}</p></div>])} />
        <p className="public-stat-note" style={{ overflowWrap: "anywhere" }}>저장된 근거의 무결성 해시: {closed.data.close.evidence.hash}</p>
      </> : <p role="status">점검 근거 저장 기능이 추가되기 전의 마감입니다. 당시 집계만 보관되어 있으며 새 점검 결과를 소급해서 채우지 않습니다.</p>}
    </Panel>}
    {closed.data?.close && <ComplianceExports key={closed.data.close.id} closeId={closed.data.close.id} />}
    {current.loading ? <Panel><p role="status">현황을 불러오는 중입니다.</p></Panel>
      : current.error ? <Panel><p role="alert">{current.error.message}</p></Panel>
      : validScope && current.data && <Panel title="선택 범위의 현재 자료"><div className="public-stat-overview">
        <p>서비스 <strong>{current.data.totals.services}</strong>개</p>
        <p>동의서 <strong>{current.data.totals.consentDocuments}</strong>개</p>
        <p>처리방침 <strong>{current.data.totals.policyDocuments}</strong>개</p>
        <p>현재 보유 응답 <strong>{current.data.totals.retainedSubmissions}</strong>건</p>
      </div><p className="public-stat-note">위 건수는 저장된 원천 데이터의 현황이며, 법적 준수 여부를 뜻하지 않습니다.</p>
        <Link className="cs-link" href="/privacy-detail">응답 보유 현황 보기</Link></Panel>}
  </div>;
}
