"use client";
import { useState } from "react";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import type { AssetOverview, BillingOverview, PlanRecord, SubscriptionRecord } from "@/contracts/subscriptions";
import type { BillingHistoryList } from "@/contracts/billing-history";
import type { LedgerOverview } from "@/contracts/ledger";
import { ActionButton, DataTable, PageHeading, Panel } from "../shared";
import { Tabs } from "./ui";
import { ServiceGate } from "./gates";

const money = (value: number | null) => value === null ? "금액 확인 중" : `${value.toLocaleString("ko-KR")}원`;
const creditMoney = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }) : "-";
const statusName: Record<string, string> = { trialing: "무료 체험", expired: "체험 만료", pending: "결제 연동 대기", cancelled: "요청 취소" };

export function MembershipPage() {
  const [year, setYear] = useState(false), [saving, setSaving] = useState<string | null>(null), [notice, setNotice] = useState("");
  const catalog = useResource<PlanRecord[]>("/plans"), overview = useResource<BillingOverview>("/subscriptions");
  async function request(planVersionId: string) {
    setSaving(planVersionId); setNotice("");
    try { await api<SubscriptionRecord>("/subscriptions", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ planVersionId }) });
      setNotice("구독 요청을 기록했습니다. 결제 연동 전이므로 유료 이용은 시작되지 않습니다."); overview.reload(); }
    catch (error) { setNotice(errorText(error)); } finally { setSaving(null); }
  }
  return <><PageHeading title="전체 상품 안내"/><div className="svc-membership"><Panel>
    <div className="svc-toolbar"><h2 className="svc-heading">구독 서비스</h2><div className="svc-toggle">
      <button type="button" className={!year ? "active" : ""} onClick={() => setYear(false)}>월 구독</button>
      <button type="button" className={year ? "active" : ""} onClick={() => setYear(true)}>연 구독</button>
    </div></div>
    {catalog.loading && <p role="status">상품 정보를 불러오는 중입니다.</p>}
    {catalog.error && <p role="alert">{catalog.error.message}</p>}
    {notice && <p role="status" className="svc-warning">{notice}</p>}
    <div className="svc-products">{catalog.data?.filter(plan => plan.id !== "trial").map(plan => {
      const version = plan.versions.find(item => item.cycle === (year ? "year" : "month"));
      const pending = overview.data?.subscriptions.some(item => item.planId === plan.id && item.status === "pending");
      return <article className="svc-product" key={plan.id}><header><h3>{plan.name}</h3>
        <div className="svc-price"><strong>{money(version?.priceKrw ?? null)}</strong></div>
        <ActionButton type="button" disabled={!version?.orderable || !!pending || saving !== null} onClick={() => version && request(version.id)}>
          {pending ? "요청 대기 중" : version?.orderable ? "구독 요청" : "현재 구매 불가"}</ActionButton>
      </header><ul><li><span>✓</span>서비스 {version?.serviceLimit ?? "무제한"}개</li>
        <li><span>✓</span>구성원 {version?.memberLimit ?? "무제한"}명</li>
        <li><span>✓</span>개인정보 주체 {version?.subjectLimit ?? "무제한"}명</li>
        <li><span>✓</span>캐치폼 {version?.formLimit ?? "무제한"}개</li></ul></article>;
    })}</div>
    <p className="svc-muted">연간 최종 금액은 아직 확인되지 않았습니다. 구독 요청은 결제를 진행하거나 유료 기능을 활성화하지 않습니다.</p>
  </Panel></div></>;
}

export function LicenseManagement() {
  const state = useResource<BillingOverview>("/subscriptions");
  const credit = useResource<LedgerOverview>("/ledger");
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState("");
  async function cancel(row: SubscriptionRecord) {
    setBusy(row.id); setNotice("");
    try { await api(`/subscriptions/${row.id}/cancel`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ version: row.version }) });
      setNotice("구독 요청을 취소했습니다."); state.reload(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  async function changeTrial(row: SubscriptionRecord, undo: boolean, localValue?: string) {
    setBusy(row.id); setNotice("");
    try {
      const selected = localValue ? new Date(localValue) : null;
      if (!undo && (!selected || Number.isNaN(selected.getTime()))) throw new Error("올바른 체험 종료 시각을 선택해주세요.");
      const input = undo ? { version: row.version } : { version: row.version, effectiveAt: selected!.toISOString() };
      await api(`/subscriptions/${row.id}/${undo ? "undo-cancel" : "schedule-cancel"}`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(input),
      });
      setNotice(undo ? "체험 종료 예약을 취소했습니다." : "체험 종료를 예약했습니다."); state.reload();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  const entitlement = state.data?.entitlement;
  return <div className="svc-license"><PageHeading title="구독 및 결제수단 관리"><p>회사 구독과 사용량을 확인할 수 있습니다.</p></PageHeading>
    <div className="svc-stack"><Panel><div className="svc-toolbar"><h2 className="svc-heading">구독 정보</h2>
      <Link className="cs-button secondary" href="/pay/membership/detail">전체 상품 확인하기</Link></div>
      {state.loading && <p role="status">구독 정보를 불러오는 중입니다.</p>}
      {state.error && <p role="alert">{state.error.message}</p>}
      {notice && <p role="status" className="svc-warning">{notice}</p>}
      {state.data?.subscriptions.map(row => <div className="svc-license-card" key={row.id}><div className="svc-license-card-head">
        <strong>{row.planName}</strong><p><span className="svc-badge">{statusName[row.status] ?? row.status}</span></p>
        <p>{row.periodStart && row.periodEnd ? `${date(row.periodStart)} ~ ${date(row.periodEnd)}` : "이용 기간이 정해지지 않았습니다."}</p></div>
        <dl><dt>가격 기준</dt><dd>{money(row.priceKrw)}</dd></dl>
        {row.status === "pending" && <p><ActionButton type="button" secondary disabled={busy !== null} onClick={() => cancel(row)}>요청 취소</ActionButton></p>}
        {row.status === "trialing" && (row.cancelAt ? <p>예약 종료: {dateTime(row.cancelAt)} <ActionButton type="button" secondary disabled={busy !== null} onClick={() => changeTrial(row, true)}>예약 취소</ActionButton></p>
          : <form className="svc-trial-cancel" onSubmit={event => { event.preventDefault(); const value = (event.currentTarget.elements.namedItem("effectiveAt") as HTMLInputElement).value; changeTrial(row, false, value); }}>
            <label>체험 조기 종료 시각 <input className="cs-input" type="datetime-local" name="effectiveAt" required/></label>
            <ActionButton type="submit" secondary disabled={busy !== null}>종료 예약</ActionButton>
          </form>)}
      </div>)}</Panel>
      <Panel title="이용 한도"><p className="svc-muted">{entitlement?.active ? `무료 체험 종료 시각: ${dateTime(entitlement.periodEnd)}` : "현재 이용 가능한 구독이 없습니다."}</p>
        {entitlement && <dl className="svc-usage-grid"><dt>서비스</dt><dd>{entitlement.usage.services} / {entitlement.limits.services ?? "무제한"}</dd>
          <dt>구성원</dt><dd>{entitlement.usage.members} / {entitlement.limits.members ?? "무제한"}</dd>
          <dt>개인정보 주체</dt><dd>{entitlement.usage.subjects} / {entitlement.limits.subjects ?? "무제한"}</dd>
          <dt>캐치폼</dt><dd>{entitlement.usage.forms} / {entitlement.limits.forms ?? "무제한"}</dd></dl>}
      </Panel><Panel title="크레딧"><p className="svc-muted">회사 공용 크레딧 잔액입니다.</p>
        {credit.loading && <p role="status">크레딧 잔액을 불러오는 중입니다.</p>}
        {credit.error && <p role="alert">{credit.error.message}</p>}
        {credit.data && <dl className="svc-usage-grid"><dt>사용 가능</dt><dd>{creditMoney(credit.data.available)}</dd>
          <dt>예약 중</dt><dd>{creditMoney(credit.data.held)}</dd></dl>}
        <p className="svc-muted">충전과 사용은 결제·공급자 연동 후 제공됩니다.</p>
      </Panel><Panel title="결제 수단"><p>결제 연동 준비 중입니다. 등록된 결제수단이 없습니다.</p></Panel>
    </div></div>;
}

export function PaymentHistory({ usage = false }: { usage?: boolean }) {
  const [tab, setTab] = useState(usage ? 2 : 0);
  const [fromMonth, setFromMonth] = useState(""), [toMonth, setToMonth] = useState("");
  const [filter, setFilter] = useState({ fromMonth: "", toMonth: "" }), [page, setPage] = useState(1), [notice, setNotice] = useState("");
  const params = new URLSearchParams({ page: String(page), pageSize: "10", ...(filter.fromMonth ? { fromMonth: filter.fromMonth } : {}),
    ...(filter.toMonth ? { toMonth: filter.toMonth } : {}) });
  const history = useResource<BillingHistoryList>(tab === 0 ? "/billing-history?" + params : null);
  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fromMonth && toMonth && fromMonth > toMonth) { setNotice("조회 시작 월은 종료 월보다 늦을 수 없습니다."); return; }
    setNotice(""); setPage(1); setFilter({ fromMonth, toMonth });
  }
  const columns = tab === 1 ? ["결제일시", "발송 제목", "발송건수", "금액"] : ["사용일시", "서비스", "캐치폼", "사용 내역", "사용 금액"];
  return <div className="svc-history"><PageHeading title="자산 및 결제 내역"><p>결제, 부가서비스 이용 내역을 확인할 수 있습니다.</p></PageHeading>
    <Panel><Tabs items={["결제 및 환불 내역", "문자 결제 내역", "본인인증 사용 내역"]} value={tab} onChange={setTab}/>
      {tab === 0 ? <><p className="svc-muted">현재 확인 가능한 무료 체험 이력입니다. 유료 결제·환불은 결제 연동 후 표시됩니다.</p>
        <form className="svc-history-filter" onSubmit={search}>
          <label>조회 시작 월<input className="cs-input" type="month" value={fromMonth} onChange={event => setFromMonth(event.target.value)}/></label>
          <label>조회 종료 월<input className="cs-input" type="month" value={toMonth} onChange={event => setToMonth(event.target.value)}/></label>
          <ActionButton type="submit">검색</ActionButton>
          <ActionButton type="button" secondary onClick={() => { setFromMonth(""); setToMonth(""); setFilter({ fromMonth: "", toMonth: "" }); setPage(1); setNotice(""); }}>검색 조건 초기화</ActionButton>
        </form>
        {notice && <p role="alert">{notice}</p>}
        {history.loading && <p role="status">내역을 불러오는 중입니다.</p>}
        {history.error && <p role="alert">{history.error.message}</p>}
        {history.data && <><div className="cs-table-wrap"><table className="cs-table"><thead><tr>
          {["시작일시", "구분", "상태", "결제수단", "금액", "서비스(상품) 명", "이용 기간"].map(column => <th key={column}>{column}</th>)}
        </tr></thead><tbody>{history.data.items.length ? history.data.items.map(row => <tr key={row.id}>
          <td>{dateTime(row.occurredAt)}</td><td>무료 체험 시작</td><td>{row.status === "expired" ? "종료" : "이용 중"}</td>
          <td>-</td><td>{money(row.amountKrw)}</td><td>{row.planName}</td>
          <td>{date(row.periodStart)} ~ {date(row.periodEnd)}</td>
        </tr>) : <tr><td colSpan={7}>조회 조건에 맞는 이력이 없습니다.</td></tr>}</tbody></table></div>
          <div className="svc-history-pages"><span>총 {history.data.total}건</span>
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span>{page} / {Math.max(1, Math.ceil(history.data.total / history.data.pageSize))}</span>
            <button type="button" disabled={page * history.data.pageSize >= history.data.total} onClick={() => setPage(page + 1)}>다음</button>
          </div></>}
      </> : <><p className="svc-muted">{tab === 1 ? "문자 결제 기록은 문자 공급자 연동 후 표시됩니다." : "본인인증 사용 기록은 본인인증 연동 후 표시됩니다."}</p>
        <DataTable columns={columns} rows={[]} empty="확정된 내역이 없습니다"/></>}</Panel></div>;
}

export function ServiceAssetPage() {
  const state = useResource<AssetOverview>("/assets");
  if (state.error?.status === 403) return <ServiceGate kind="permission"/>;
  const current = state.data?.entitlement;
  return <div className="svc-assets"><PageHeading title="서비스 자산"><p>회사 서비스별 개인정보 주체와 캐치폼 사용량을 확인할 수 있습니다.</p></PageHeading>
    <div className="svc-stack"><Panel title="이용 한도">
      {state.loading && <p role="status">사용량을 불러오는 중입니다.</p>}
      {state.error && <p role="alert">{state.error.message}</p>}
      {current && <dl className="svc-usage-grid"><dt>서비스</dt><dd>{current.usage.services} / {current.limits.services ?? "무제한"}</dd>
        <dt>개인정보 주체</dt><dd>{current.usage.subjects} / {current.limits.subjects ?? "무제한"}</dd>
        <dt>캐치폼</dt><dd>{current.usage.forms} / {current.limits.forms ?? "무제한"}</dd></dl>}
    </Panel><Panel title="서비스별 사용량"><DataTable columns={["서비스", "상태", "개인정보 주체", "캐치폼"]}
      rows={state.data?.services.map(service => [service.name, service.status === "active" ? "사용 중" : "보관", service.subjects, service.forms]) ?? []}
      empty="등록된 서비스가 없습니다"/></Panel></div></div>;
}

export function PaymentFailure() {
  return <section className="svc-payment-failure"><h1>결제 실패</h1><div className="svc-failure-content">
    <div className="svc-red-note"><b>주문이 완료되지 않았습니다.</b></div><div className="svc-neutral-note">현재 결제 연동을 준비 중입니다.</div>
    <div className="svc-actions"><Link className="cs-button secondary" href="/dashboard">대시보드로 이동</Link>
      <Link className="cs-button" href="/pay/membership/detail">상품 확인하기</Link></div>
  </div></section>;
}
