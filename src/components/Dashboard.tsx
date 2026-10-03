"use client";

import { useState } from "react";
import Link from "next/link";
import type { AnalyticsDashboard } from "@/contracts/analytics";
import type { MarketingSummary } from "@/contracts/marketing";
import type { EntitlementRecord } from "@/contracts/subscriptions";
import { useResource } from "@/lib/api";
import { useApplication } from "./ApplicationContext";
import { ActionButton, DataTable, EmptyState, Modal, Panel } from "./shared";
import "./dashboard.css";

const asset = "/assets/img/catchsecu/";
const localBoundary = (date: string, end: boolean) => {
  const value = new Date(date + "T00:00:00");
  if (end) value.setDate(value.getDate() + 1);
  return value.toISOString();
};
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("ko-KR") : "—";

function Welcome({ onCreate }: { onCreate: () => void }) {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return <section className="dash-welcome"><div className="dash-between"><h2>캐치시큐가 처음이신가요? 👋</h2>
    <button onClick={() => setShow(false)}>다시보지 않기 ×</button></div><div className="dash-welcome-grid">
    <article><p>처음이신 분들을 위해<br /><b>많이 쓰이는 폼을 준비했어요</b></p>
      <Link href="/form/template">캐치폼 템플릿 둘러보기</Link></article>
    <article><p>폼을 새로 만들어서<br /><b>개인정보를 수집하고 싶어요</b></p>
      <button onClick={onCreate}>캐치폼 직접 생성하기</button></article>
  </div></section>;
}

export default function Dashboard({ path = "/dashboard" }: { path?: string }) {
  const app = useApplication();
  const serviceId = /^\/dashboard\/([^/]+)$/.exec(path)?.[1];
  const [create, setCreate] = useState(false);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [filterError, setFilterError] = useState("");
  const params = new URLSearchParams();
  if (serviceId) params.set("serviceId", serviceId);
  if (period.from) params.set("from", localBoundary(period.from, false));
  if (period.to) params.set("to", localBoundary(period.to, true));
  const analytics = useResource<AnalyticsDashboard>("/analytics/dashboard" + (params.size ? "?" + params : ""));
  const marketingParams = params.size ? "?" + params : "";
  const marketing = useResource<MarketingSummary>(app.data?.capabilities.includes("marketing.read") ? "/marketing/summary" + marketingParams : null);
  const license = useResource<EntitlementRecord>(app.data?.capabilities.includes("billing.read") ? "/entitlements" : null);
  const data = analytics.data;
  const currentMarketing = (marketing.data?.items ?? []).filter(row => !serviceId || row.id === serviceId);
  const marketingTotals = currentMarketing.reduce((sum, row) => ({ granted: sum.granted + row.granted,
    withdrawn: sum.withdrawn + row.withdrawn, eligible: sum.eligible + row.eligible,
    suppressed: sum.suppressed + row.suppressed, periodGrants: sum.periodGrants + row.periodGrants,
    periodWithdrawals: sum.periodWithdrawals + row.periodWithdrawals }),
  { granted: 0, withdrawn: 0, eligible: 0, suppressed: 0, periodGrants: 0, periodWithdrawals: 0 });
  function applyPeriod() {
    if (!!draft.from !== !!draft.to) {
      setFilterError("시작일과 종료일을 모두 선택해주세요."); return;
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError("종료일은 시작일 이후여야 합니다."); return;
    }
    setFilterError(""); setPeriod(draft);
  }
  return <div className="dashboard">
    <Welcome onCreate={() => setCreate(true)} />
    <div className="dash-period cs-panel"><div className="dash-between"><div><h1>{serviceId ? "서비스 대시보드" : "대시보드"}</h1>
      <p>현재 보유 현황과 선택 기간의 변화를 실제 저장 데이터에서 계산합니다.</p></div>
      <ActionButton secondary onClick={() => { analytics.reload(); marketing.reload(); license.reload(); }}>새로고침</ActionButton></div>
      <div className="cs-row"><label>시작일 <input className="cs-input" type="date" value={draft.from}
        onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label>
        <label>종료일 <input className="cs-input" type="date" value={draft.to}
          onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label>
        <ActionButton onClick={applyPeriod}>기간 적용</ActionButton>
        <ActionButton secondary onClick={() => { setDraft({ from: "", to: "" }); setPeriod({ from: "", to: "" }); setFilterError(""); }}>기본 기간</ActionButton></div>
      {filterError && <p role="alert">{filterError}</p>}
      {data && <p>조회 기준 {new Date(data.asOf).toLocaleString("ko-KR")} · 기간 {date(data.period.from)}부터 {date(data.period.to)} 전까지</p>}
    </div>
    {analytics.loading ? <Panel><p role="status">대시보드 집계 중입니다.</p></Panel>
      : analytics.error ? <Panel><p role="alert">{analytics.error.message}</p></Panel>
      : data && <div className="dash-grid">
        <Panel className="dash-collect"><h2>개인정보를 수집하고 싶다면?</h2>
          <p>캐치폼으로 개인정보 수집부터 관리까지 한번에 해결하세요.</p>
          <div className="dash-between"><button className="cs-button" onClick={() => setCreate(true)}>캐치폼 생성</button>
            <img src={asset + "dashboard-catchform.svg"} width="80" height="80" alt="" /></div></Panel>
        <Panel><div className="dash-between"><h2>라이선스</h2><Link href="/pay/license-service">자세히 보기 ›</Link></div>
          {license.loading ? <p role="status">라이선스 조회 중입니다.</p> : license.error ? <p role="alert">{license.error.message}</p>
            : license.data ? <><div className="dash-license"><b>{license.data.active ? "이용 중" : "이용 기간 종료"}</b>
              <span>{license.data.status}</span></div><div className="dash-date"><div>종료일 <b>{date(license.data.periodEnd)}</b></div>
              <div>서비스 <b>{license.data.usage.services} / {license.data.limits.services ?? "제한 없음"}</b></div></div></>
              : <p>라이선스 정보는 결제 조회 권한이 있는 구성원에게 표시됩니다.</p>}</Panel>
        <Panel className="dash-wide" title="응답 정보 보관량"><p>파기 완료·파기 중인 자료와 보유 기간이 지난 자료는 제외합니다. 보존 조치 중인 자료는 포함합니다.</p>
          <div className="dash-usage"><div>현재 보유<p><b>{data.totals.retainedSubmissions}</b> 건</p></div>
            <div>선택 기간 접수·현재 보유<p><b>{data.totals.periodSubmissions}</b> 건</p></div>
            <div>선택 기간 파기 완료<p><b>{data.totals.periodDestructions}</b> 건</p></div></div></Panel>
        <Panel className="dash-subscription"><div className="cs-row"><img src={asset + "img-life.svg"} width="60" height="60" alt="" />
          <h2>개인정보 수명관리</h2></div><p>현재 보유 응답 {data.totals.retainedSubmissions}건 · 활성 서비스 {data.totals.services}개</p>
          <Link href="/privacy-detail">보유 현황 보기</Link></Panel>
        <Panel className="dash-subscription policy"><div className="cs-row"><img src={asset + "img-term.svg"} width="60" height="60" alt="" />
          <h2>처리방침 관리</h2></div><p>동의서 {data.totals.consentDocuments}개 · 처리방침 {data.totals.policyDocuments}개</p>
          <Link href="/basic/result/policy">문서 관리로 이동</Link></Panel>
        <Panel className="dash-wide" title="서비스 현황"><div className="dash-stats">{([
          ["서비스", "service", data.totals.services, "/set/service"],
          ["캐치폼", "catchform", data.totals.forms, "/form/manage"],
          ["동의서", "agreement", data.totals.consentDocuments, "/basic/result/consent"],
          ["처리방침", "shield", data.totals.policyDocuments, "/basic/result/policy"],
        ] as const).map(([label, icon, count, url]) => <Link key={label} href={url}>
          <img src={asset + `dashboard-${icon}.svg`} width="40" height="40" alt="" />
          <div>{label}<p><b>{count}</b>개</p></div></Link>)}</div></Panel>
        <Panel className="dash-wide" title="개인정보 응답 보유현황"><p>현재 열람 가능한 서비스에 보유 중인 응답을 집계합니다.</p>
          {data.services.length ? <DataTable columns={["서비스명", "현재 보유", "선택 기간 접수·현재 보유"]}
            rows={data.services.map(row => [<Link key={row.id} href={"/dashboard/" + row.id}>{row.name}</Link>,
              row.retainedSubmissions, row.periodSubmissions])} initialSize={5} />
            : <EmptyState border text="표시할 서비스가 없습니다." />}</Panel>
        <Panel className="dash-wide" title="마케팅 동의 현황 (광고성 정보)">
          {!app.data?.capabilities.includes("marketing.read") ? <p>마케팅 조회 권한이 필요합니다.</p>
            : marketing.loading ? <p role="status">마케팅 집계 중입니다.</p>
            : marketing.error ? <p role="alert">{marketing.error.message}</p>
            : <div className="dash-marketing"><p>현재 동의 <b>{marketingTotals.granted}</b></p><p>현재 철회 <b>{marketingTotals.withdrawn}</b></p>
              <p>현재 발송 차단 <b>{marketingTotals.suppressed}</b></p><p>현재 발송 가능 <b>{marketingTotals.eligible}</b></p>
              <p>기간 내 동의 기록 <b>{marketingTotals.periodGrants}</b></p><p>기간 내 철회 기록 <b>{marketingTotals.periodWithdrawals}</b></p>
              <Link href={serviceId ? "/marketing-detail/" + serviceId : "/marketing-detail"}>서비스별 현황 보기 ›</Link></div>}</Panel>
        <Panel className="dash-wide" title="서비스 응답 순위"><DataTable initialSize={5}
          columns={["순위", "서비스명", "캐치폼", "현재 보유 응답", "생성일"]}
          rows={data.services.map((row, index) => [index + 1, <Link key={row.id} href={"/dashboard/" + row.id}>{row.name}</Link>,
            row.forms, row.retainedSubmissions, date(row.createdAt)])} /></Panel>
        <Panel className="dash-wide" title="캐치폼 응답 순위"><DataTable initialSize={5}
          columns={["순위", "캐치폼", "서비스명", "현재 보유 응답", "생성일"]}
          rows={data.topForms.map((row, index) => [index + 1, row.title, row.serviceName,
            row.retainedSubmissions, date(row.createdAt)])} /></Panel>
      </div>}
    {create && <Modal title="캐치폼 생성" onClose={() => setCreate(false)}><div className="cs-stack">
      <Link className="cs-button" href="/form/ai/create?new=1">캐치폼 직접 생성하기</Link>
      <Link className="cs-button secondary" href="/form/template">캐치폼 템플릿 둘러보기</Link>
    </div></Modal>}
  </div>;
}
