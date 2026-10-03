"use client";

import { useState } from "react";
import Link from "next/link";
import type { AnalyticsDashboard } from "@/contracts/analytics";
import { useResource } from "@/lib/api";
import { ActionButton, DataTable, PageHeading, Panel } from "./shared";

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

export function CompliancePage() {
  const result = useResource<AnalyticsDashboard>("/analytics/dashboard");
  const data = result.data;
  return <div className="public-statistics"><PageHeading title="개인정보 보호현황 점검 결과" />
    <Panel title="점검 상태"><p role="status">검증된 준수 점검 결과가 아직 없습니다.</p>
      <p className="public-stat-note">점수와 과태료는 실제 점검 항목 및 근거가 확인된 뒤 산정합니다.</p></Panel>
    {result.loading ? <Panel><p role="status">현황을 불러오는 중입니다.</p></Panel>
      : result.error ? <Panel><p role="alert">{result.error.message}</p></Panel>
      : data && <Panel title="점검을 위한 현재 자료"><div className="public-stat-overview">
        <p>접근 가능한 서비스 <strong>{data.totals.services}</strong>개</p>
        <p>동의서 <strong>{data.totals.consentDocuments}</strong>개</p>
        <p>처리방침 <strong>{data.totals.policyDocuments}</strong>개</p>
        <p>현재 보유 응답 <strong>{data.totals.retainedSubmissions}</strong>건</p>
      </div><p className="public-stat-note">위 건수는 저장된 원천 데이터의 현황이며, 법적 준수 여부를 뜻하지 않습니다.</p>
        <Link className="cs-link" href="/privacy-detail">응답 보유 현황 보기</Link></Panel>}
  </div>;
}
