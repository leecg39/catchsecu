"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { AssetOverview, BillingOverview, PlanRecord, SubscriptionRecord } from "@/contracts/subscriptions";
import type { BillingHistoryList } from "@/contracts/billing-history";
import type { LedgerOverview } from "@/contracts/ledger";
import type { PaymentMethodRecord } from "@/contracts/payment-methods";
import type { PaymentOrderListItem } from "@/server/payments";
import type { RefundRecord } from "@/contracts/billing-settlement";
import { ActionButton, DataTable, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";
import { Tabs } from "./ui";
import { ServiceGate } from "./gates";

const money = (value: number | null) => value === null ? "금액 확인 중" : `${value.toLocaleString("ko-KR")}원`;
const creditMoney = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }) : "-";
const statusName: Record<string, string> = { trialing: "무료 체험", active: "유료 이용 중", expired: "이용 만료", pending: "결제 대기", cancelled: "요청 취소" };

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
  const methods = useResource<PaymentMethodRecord[]>("/billing/methods");
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState("");
  async function cancel(row: SubscriptionRecord) {
    setBusy(row.id); setNotice("");
    try { await api(`/subscriptions/${row.id}/cancel`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ version: row.version }) });
      setNotice("구독 요청을 취소했습니다."); state.reload(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  async function createOrder(row: SubscriptionRecord) {
    setBusy(row.id); setNotice("");
    try {
      await api("/billing/orders", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ subscriptionId: row.id }) });
      setNotice("주문을 생성했습니다. 결제는 공급자 승인 콜백으로만 확정됩니다."); state.reload();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  async function changeCancel(row: SubscriptionRecord, undo: boolean, localValue?: string, reason?: string) {
    setBusy(row.id); setNotice("");
    try {
      const selected = localValue ? new Date(localValue) : null;
      const trial = row.status === "trialing";
      if (!undo && (!selected || Number.isNaN(selected.getTime()))) throw new Error("올바른 종료 시각을 선택해주세요.");
      const input = undo ? { version: row.version } : { version: row.version, effectiveAt: selected!.toISOString(), ...(reason ? { reason } : {}) };
      await api(`/subscriptions/${row.id}/${undo ? "undo-cancel" : "schedule-cancel"}`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(input),
      });
      setNotice(undo ? "종료 예약을 취소했습니다." : trial ? "체험 종료를 예약했습니다." : "구독 해지를 예약했습니다."); state.reload();
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
        {row.status === "pending" && <p><ActionButton type="button" secondary disabled={busy !== null} onClick={() => createOrder(row)}>주문 생성</ActionButton>{" "}
          <ActionButton type="button" secondary disabled={busy !== null} onClick={() => cancel(row)}>요청 취소</ActionButton></p>}
        {(row.status === "trialing" || row.status === "active") && (row.cancelAt
          ? <p>예약 종료: {dateTime(row.cancelAt)} <ActionButton type="button" secondary disabled={busy !== null} onClick={() => changeCancel(row, true)}>예약 취소</ActionButton></p>
          : <form className="svc-trial-cancel" onSubmit={event => { event.preventDefault(); const form = event.currentTarget;
              changeCancel(row, false, (form.elements.namedItem("effectiveAt") as HTMLInputElement).value,
                (form.elements.namedItem("reason") as HTMLInputElement | null)?.value || undefined); }}>
            <label>{row.status === "trialing" ? "체험 조기 종료 시각" : "해지 적용 시각"} <input className="cs-input" type="datetime-local" name="effectiveAt" required/></label>
            {row.status === "active" && <label>해지 사유 <input className="cs-input" type="text" name="reason" maxLength={300} placeholder="선택 입력"/></label>}
            <ActionButton type="submit" secondary disabled={busy !== null}>종료 예약</ActionButton>
          </form>)}
      </div>)}</Panel>
      <PaymentOrdersPanel onChanged={() => state.reload()}/>
      <PaymentMethodsPanel methods={methods}/>
      <Panel title="이용 한도"><p className="svc-muted">{entitlement?.active ? `이용 종료 시각: ${dateTime(entitlement.periodEnd)}` : "현재 이용 가능한 구독이 없습니다."}</p>
        {entitlement && <dl className="svc-usage-grid"><dt>서비스</dt><dd>{entitlement.usage.services} / {entitlement.limits.services ?? "무제한"}</dd>
          <dt>구성원</dt><dd>{entitlement.usage.members} / {entitlement.limits.members ?? "무제한"}</dd>
          <dt>개인정보 주체</dt><dd>{entitlement.usage.subjects} / {entitlement.limits.subjects ?? "무제한"}</dd>
          <dt>캐치폼</dt><dd>{entitlement.usage.forms} / {entitlement.limits.forms ?? "무제한"}</dd></dl>}
      </Panel><Panel title="크레딧"><p className="svc-muted">회사 공용 크레딧 잔액입니다. 충전은 서명된 결제 승인 후에만 반영됩니다.</p>
        {credit.loading && <p role="status">크레딧 잔액을 불러오는 중입니다.</p>}
        {credit.error && <p role="alert">{credit.error.message}</p>}
        {credit.data && <dl className="svc-usage-grid"><dt>사용 가능</dt><dd>{creditMoney(credit.data.available)}</dd>
          <dt>예약 중</dt><dd>{creditMoney(credit.data.held)}</dd></dl>}
      </Panel>
    </div></div>;
}

function PaymentMethodsPanel({ methods }: { methods: ReturnType<typeof useResource<PaymentMethodRecord[]>> }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const ask = useConfirm();
  const [editing, setEditing] = useState<{ id: string; label: string; version: number } | null>(null);
  async function act(path: string, init: RequestInit, done: string) {
    setBusy(true); setNotice("");
    try { await api(path, { ...init, headers: { "Idempotency-Key": crypto.randomUUID(), "content-type": "application/json", ...(init.headers ?? {}) } }); setNotice(done); methods.reload(); return true; }
    catch (error) {
      setNotice(errorText(error));
      if (error instanceof ApiError && error.status === 409) methods.reload();
      return false;
    } finally { setBusy(false); }
  }
  return <Panel title="결제 수단">
    {methods.loading && <p role="status">결제 수단을 불러오는 중입니다.</p>}
    {methods.error && <p role="alert">{methods.error.message}</p>}
    {notice && <p role="status" className="svc-warning">{notice}</p>}
    {methods.data && (methods.data.length ? <ul className="svc-methods">{methods.data.map(m => <li key={m.id}>
      <strong>{m.label}</strong> <span className="svc-badge">{m.kind === "card" ? "카드" : "계좌이체"}</span>
      {m.isDefault && <span className="svc-badge">대표</span>}
      {m.status === "revoked" && <span className="svc-badge">해지됨</span>}
      {m.status === "active" && <>
        <ActionButton type="button" secondary disabled={busy} onClick={() => setEditing({ id: m.id, label: m.label, version: m.version })}>이름 수정</ActionButton>
        {!m.isDefault && <ActionButton type="button" secondary disabled={busy} onClick={() => act(`/billing/methods/${m.id}`, { method: "PATCH", body: JSON.stringify({ version: m.version, setDefault: true }) }, "대표 결제수단으로 변경했습니다.")}>대표로 지정</ActionButton>}
        <ActionButton type="button" secondary disabled={busy} onClick={async () => {
          if (await ask({ title: "결제수단 해지", message: `“${m.label}” 결제수단을 해지합니다. 해지하면 이 결제수단으로 결제할 수 없습니다.`, confirmLabel: "해지" }))
            void act(`/billing/methods/${m.id}`, { method: "DELETE", body: JSON.stringify({ version: m.version }) }, "결제수단을 해지했습니다.");
        }}>해지</ActionButton>
      </>}
    </li>)}</ul> : <p className="svc-muted">등록된 결제수단이 없습니다.</p>)}
    {editing && <form className="svc-trial-cancel" onSubmit={async event => {
      event.preventDefault();
      const current = methods.data?.find(method => method.id === editing.id);
      if (!current) { setNotice("최신 결제수단 목록을 불러온 후 다시 시도해주세요."); return; }
      if (current.version !== editing.version) {
        setEditing({ ...editing, version: current.version });
        setNotice("결제수단이 변경되었습니다. 입력한 이름을 확인하고 다시 저장해주세요."); return;
      }
      if (await act(`/billing/methods/${editing.id}`, { method: "PATCH", body: JSON.stringify({ version: editing.version, label: editing.label.trim() }) }, "결제수단 이름을 변경했습니다.")) setEditing(null);
    }}>
      <label>결제수단 이름 <input className="cs-input" value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })} maxLength={40} required/></label>
      <ActionButton type="submit" disabled={busy || methods.loading || !editing.label.trim()}>저장</ActionButton>
      <ActionButton type="button" secondary disabled={busy} onClick={() => setEditing(null)}>취소</ActionButton>
    </form>}
    <form className="svc-trial-cancel" onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget;
      const token = (form.elements.namedItem("token") as HTMLInputElement).value.trim();
      const label = (form.elements.namedItem("label") as HTMLInputElement).value.trim();
      const kind = (form.elements.namedItem("kind") as HTMLSelectElement).value;
      act("/billing/methods", { method: "POST", body: JSON.stringify({ token, kind, label, setDefault: false }) }, "결제수단을 등록했습니다.")
        .then(saved => { if (saved) form.reset(); });
    }}>
      <label>PG 토큰 <input className="cs-input" type="text" name="token" placeholder="pm_..." pattern="pm_[A-Za-z0-9_\-]{8,64}" required/></label>
      <label>이름 <input className="cs-input" type="text" name="label" maxLength={40} required/></label>
      <label>종류 <select className="cs-input" name="kind"><option value="card">카드</option><option value="transfer">계좌이체</option></select></label>
      <ActionButton type="submit" disabled={busy}>등록</ActionButton>
      <p className="svc-muted">카드 번호가 아닌 PG가 발급한 결제수단 토큰(pm_…)만 등록됩니다. 카드 원문은 저장되지 않습니다.</p>
    </form>
  </Panel>;
}

function PaymentOrdersPanel({ onChanged }: { onChanged: () => void }) {
  const orders = useResource<{ items: PaymentOrderListItem[]; virtual?: boolean }>("/billing/orders");
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState(""), [refunds, setRefunds] = useState<Record<string, RefundRecord[]>>({});
  const orderStatus: Record<string, string> = { pending: "승인 대기", paid: "결제 완료", failed: "결제 실패" };
  async function refund(orderId: string, form: HTMLFormElement) {
    const amount = Number((form.elements.namedItem("amount") as HTMLInputElement).value);
    const reason = (form.elements.namedItem("reason") as HTMLInputElement).value.trim();
    setBusy(orderId); setNotice("");
    try {
      await api(`/billing/orders/${orderId}/refunds`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ amount, reason }) });
      setNotice("환불을 요청했습니다. 공급자 승인 후 환불이 확정됩니다."); orders.reload(); onChanged();
      const list = await api<{ items: RefundRecord[] }>(`/billing/orders/${orderId}/refunds`);
      setRefunds(prev => ({ ...prev, [orderId]: list.items }));
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  async function virtualCheckout(orderId: string, outcome: "paid" | "failed") {
    setBusy(orderId); setNotice("");
    try {
      await api(`/billing/orders/${orderId}/virtual-checkout`, { method: "POST", body: JSON.stringify({ outcome }) });
      setNotice(outcome === "paid" ? "가상 결제를 승인했습니다(실제 PG 아님)." : "가상 결제를 실패 처리했습니다."); orders.reload(); onChanged();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  async function virtualSettle(refundId: string, outcome: "refunded" | "refund_rejected") {
    setBusy(refundId); setNotice("");
    try {
      await api(`/billing/refunds/${refundId}/virtual-settle`, { method: "POST", body: JSON.stringify({ outcome }) });
      setNotice(outcome === "refunded" ? "가상 환불을 승인했습니다(실제 PG 아님)." : "가상 환불을 거절했습니다."); orders.reload(); onChanged();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(null); }
  }
  return <Panel title="결제 주문">
    {orders.loading && <p role="status">주문을 불러오는 중입니다.</p>}
    {orders.error && <p role="alert">{orders.error.message}</p>}
    {notice && <p role="status" className="svc-warning">{notice}</p>}
    {orders.data && (orders.data.items.length ? <ul className="svc-methods">{orders.data.items.map(row => <li key={row.id}>
      <strong>{row.planName}</strong> {money(row.amount)} <span className="svc-badge">{orderStatus[row.status] ?? row.status}</span>
      {row.refundedTotal > 0 && <span className="svc-badge">환불 {row.refundedTotal.toLocaleString("ko-KR")}원</span>}
      {row.status === "pending" && <span className="svc-muted">PG 승인 대기 — 승인은 공급자 콜백으로만 확정됩니다.</span>}
      {row.status === "pending" && orders.data?.virtual && <span className="mg-flex">
        <ActionButton type="button" secondary disabled={busy !== null} onClick={() => void virtualCheckout(row.id, "paid")}>가상 승인</ActionButton>
        <ActionButton type="button" secondary disabled={busy !== null} onClick={() => void virtualCheckout(row.id, "failed")}>가상 실패</ActionButton>
        <span className="svc-muted">mock — 실제 PG 아님</span></span>}
      {row.status === "paid" && <>
        <a className="cs-button secondary" href={`/api/v1/billing/orders/${row.id}/invoice`} target="_blank" rel="noreferrer">청구서</a>
        <form className="svc-trial-cancel" onSubmit={event => { event.preventDefault(); refund(row.id, event.currentTarget); }}>
          <label>환불 금액 <input className="cs-input" type="number" name="amount" min={1} max={row.amount - row.refundedTotal} required/></label>
          <label>사유 <input className="cs-input" type="text" name="reason" maxLength={500} required/></label>
          <ActionButton type="submit" secondary disabled={busy !== null}>환불 요청</ActionButton>
        </form>
        {refunds[row.id]?.map(r => <p key={r.id} className="svc-muted">환불 {r.amount.toLocaleString("ko-KR")}원 — {r.status === "requested" ? "공급자 승인 대기" : r.status === "refunded" ? "환불 완료" : "환불 거절"}
          {r.status === "requested" && orders.data?.virtual && <>
            {" "}<ActionButton type="button" secondary disabled={busy !== null} onClick={() => void virtualSettle(r.id, "refunded")}>가상 환불 승인</ActionButton>
            {" "}<ActionButton type="button" secondary disabled={busy !== null} onClick={() => void virtualSettle(r.id, "refund_rejected")}>가상 거절</ActionButton>
            {" "}<span className="svc-muted">mock</span></>}</p>)}
      </>}
    </li>)}</ul> : <p className="svc-muted">결제 주문이 없습니다.</p>)}
  </Panel>;
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
      {tab === 0 ? <><p className="svc-muted">무료 체험, 결제, 환불 이력입니다. 결제·환불 상태는 서명된 공급자 콜백으로만 확정됩니다.</p>
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
          <td>{dateTime(row.occurredAt)}</td>
          <td>{row.kind === "trial_started" ? "무료 체험 시작" : row.kind === "payment" ? "결제" : "환불"}</td>
          <td>{({ trialing: "이용 중", expired: "종료", paid: "결제 완료", pending: "승인 대기", failed: "결제 실패", cancelled: "취소", requested: "환불 대기", refunded: "환불 완료", rejected: "환불 거절" } as Record<string, string>)[row.status] ?? row.status}</td>
          <td>{row.method === "card" ? "카드" : row.method === "transfer" ? "계좌이체" : "-"}</td>
          <td>{row.kind === "trial_started" ? "-" : `${row.amountKrw.toLocaleString("ko-KR")}원`}{row.reason ? ` (${row.reason})` : ""}</td>
          <td>{row.planName}</td>
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

export function PaymentFailure({ orderId: pathOrderId }: { orderId?: string } = {}) {
  const params = useSearchParams();
  const orderId = pathOrderId ?? params.get("orderId") ?? params.get("purchaseId") ?? "";
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  const order = useResource<PaymentOrderListItem>(valid ? `/billing/orders/${orderId}` : null);
  const status = order.data?.status;
  return <section className="svc-payment-failure"><h1>결제 실패</h1><div className="svc-failure-content">
    <div className="svc-red-note"><b>주문이 완료되지 않았습니다.</b></div>
    {valid && order.loading && <div className="svc-neutral-note">주문 상태를 확인하는 중입니다.</div>}
    {valid && order.error && <div className="svc-neutral-note">{order.error.message}</div>}
    {status === "paid" && <div className="svc-neutral-note">결제는 이미 승인됐습니다. 청구서와 주문 내역에서 확인할 수 있습니다.</div>}
    {status === "pending" && <div className="svc-neutral-note">승인이 아직 확정되지 않았습니다. 잠시 후 주문 내역에서 상태를 확인해 주세요.</div>}
    {status === "failed" && <div className="svc-neutral-note">결제가 실패했습니다. 다른 결제수단으로 다시 시도해 주세요.</div>}
    <div className="svc-actions"><Link className="cs-button secondary" href="/dashboard">대시보드로 이동</Link>
      <Link className="cs-button" href="/pay/membership/detail">상품 확인하기</Link></div>
  </div></section>;
}

export function PaymentResult({ orderId: pathOrderId }: { orderId?: string } = {}) {
  const params = useSearchParams();
  const orderId = pathOrderId ?? params.get("orderId") ?? params.get("purchaseId") ?? "";
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  const order = useResource<PaymentOrderListItem>(valid ? `/billing/orders/${orderId}?result=${encodeURIComponent(params.get("result") ?? "")}` : null);
  const status = order.data?.status;
  return <section className="svc-payment-failure"><h1>결제 결과</h1><div className="svc-failure-content">
    {!valid && <div className="svc-red-note"><b>주문 정보를 확인할 수 없습니다.</b></div>}
    {valid && order.loading && <div className="svc-neutral-note">주문 상태를 확인하는 중입니다.</div>}
    {valid && order.error && <div className="svc-red-note"><b>{order.error.message}</b></div>}
    {status === "paid" && <><div className="svc-neutral-note"><b>결제가 확인됐습니다.</b></div>
      <p className="svc-muted">{order.data!.amount.toLocaleString("ko-KR")}원 — 서명된 공급자 승인으로 확정된 주문입니다.</p>
      <p><a className="cs-button secondary" href={`/api/v1/billing/orders/${orderId}/invoice`} target="_blank" rel="noreferrer">청구서 보기</a></p></>}
    {status === "pending" && <><div className="svc-neutral-note"><b>승인을 확인하는 중입니다.</b></div>
      <p className="svc-muted">결제 결과 URL만으로는 승인되지 않습니다. 공급자 콜백이 확인되면 상태가 갱신됩니다.</p></>}
    {status === "failed" && <><div className="svc-red-note"><b>결제가 실패했습니다.</b></div>
      <p className="svc-muted">결제가 확정되지 않았습니다. 다시 시도해주세요.</p></>}
    <div className="svc-actions"><Link className="cs-button secondary" href="/pay/license-service">구독 관리로 이동</Link>
      <Link className="cs-button" href="/pay/membership/detail">상품 확인하기</Link></div>
  </div></section>;
}
