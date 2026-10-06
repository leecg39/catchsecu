"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { api, errorText, useResource } from "@/lib/api";
import { refundRequest, type RefundRecord } from "@/contracts/billing-settlement";
import type { BillingOverview } from "@/contracts/subscriptions";
import type { PaymentOrderRecord } from "@/server/payments";
import { useApplication } from "@/components/ApplicationContext";
import { ActionButton, PageHeading, Panel } from "@/components/shared";
import { PdfDownload } from "@/components/PdfDownload";
import "./InvoiceDetail.css";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("ko-KR") : "확인되지 않음";
type Refunds = { items: RefundRecord[]; refundedTotal: number; refundable: number };
export function InvoiceDetail({ id, refundMode = false }: { id: string; refundMode?: boolean }) {
  const app = useApplication();
  if (!z.uuid().safeParse(id).success) return <Panel><p role="alert">청구서 주소를 확인해주세요.</p><Link href="/pay/history">결제 내역으로</Link></Panel>;
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("billing.read")) return <Panel><p role="alert">청구서를 조회할 권한이 없습니다.</p></Panel>;
  return <InvoiceData key={id} id={id} refundMode={refundMode} canRefund={app.data.capabilities.includes("billing.write")} />;
}
function InvoiceData({ id, refundMode, canRefund }: { id: string; refundMode: boolean; canRefund: boolean }) {
  const order = useResource<PaymentOrderRecord>("/billing/orders/" + id);
  const refunds = useResource<Refunds>("/billing/orders/" + id + "/refunds");
  const billing = useResource<BillingOverview>("/subscriptions");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const reload = () => { order.reload(); refunds.reload(); billing.reload(); };
  const failure = order.error ?? refunds.error ?? billing.error;
  if (failure) return <Panel><p role="alert">{failure.message}</p><ActionButton secondary onClick={reload}>다시 시도</ActionButton><Link href="/pay/history">결제 내역으로</Link></Panel>;
  if (!order.data || !refunds.data || !billing.data) return <Panel><p role="status">청구서를 불러오는 중입니다.</p></Panel>;
  const row = order.data, history = refunds.data;
  const subscription = billing.data.subscriptions.find(item => item.id === row.subscriptionId);
  const requested = history.items.filter(item => item.status === "requested").reduce((sum, item) => sum + item.amount, 0);
  const available = row.status === "paid" ? Math.max(0, row.amount - history.refundedTotal - requested) : 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !canRefund) return;
    const form = event.currentTarget, fields = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      const input = refundRequest.parse({ amount: Number(fields.get("amount")), reason: fields.get("reason") });
      if (input.amount > available) throw new Error("요청할 수 있는 환불 금액을 확인해주세요.");
      const signature = JSON.stringify(input);
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      await api("/billing/orders/" + id + "/refunds", { method: "POST", headers: { "Idempotency-Key": pending.current.key }, body: signature });
      pending.current = null; form.reset(); setNotice("환불 요청을 접수했습니다. 실제 환불 완료 여부는 처리 내역에서 확인해주세요."); reload();
    } catch (cause) { setError(errorText(cause)); reload(); } finally { setBusy(false); }
  }
  return <div className="invoice-detail cs-stack"><PageHeading title={refundMode ? "환불 요청" : "청구서 상세"}><div className="cs-row"><ActionButton secondary disabled={busy} onClick={reload}>새로고침</ActionButton><Link href="/pay/history">결제 내역으로</Link></div></PageHeading>
    <Panel title="결제 정보"><dl>
      <dt>주문 번호</dt><dd style={{ overflowWrap: "anywhere" }}>{row.id}</dd>
      <dt>상품</dt><dd>{subscription?.planName ?? "상품 정보를 확인할 수 없습니다."}</dd>
      <dt>이용 기간</dt><dd>{date(subscription?.periodStart ?? null)} ~ {date(subscription?.cancelAt ?? subscription?.periodEnd ?? null)}</dd>
      <dt>결제 상태</dt><dd>{{ paid: "결제 완료", pending: "승인 대기", failed: "결제 실패" }[row.status]}</dd>
      <dt>결제 금액</dt><dd>{won(row.amount)} ({row.currency})</dd>
      <dt>환불 완료</dt><dd>{won(history.refundedTotal)}</dd>
      <dt>환불 처리 대기</dt><dd>{won(requested)}</dd>
      <dt>추가 환불 요청 가능 금액</dt><dd>{won(available)}</dd>
    </dl>{row.status === "paid" && <PdfDownload path={"/billing/orders/" + id + "/invoice"} label="청구서 PDF 다운로드" />}</Panel>
    <Panel title="환불 처리 내역">{history.items.length ? <ul>{history.items.map(item => <li key={item.id} style={{ overflowWrap: "anywhere" }}>{won(item.amount)} · {{ requested: "처리 대기", refunded: "환불 완료", rejected: "환불 거절" }[item.status]} · {date(item.createdAt)}<p>{item.reason}</p></li>)}</ul> : <p>환불 요청 내역이 없습니다.</p>}</Panel>
    {refundMode ? <Panel title="환불 요청">{!canRefund ? <p role="alert">환불을 요청할 권한이 없습니다.</p> : available <= 0 ? <p>현재 요청할 수 있는 환불 금액이 없습니다.</p> : <form className="cs-stack" onSubmit={submit}><label>환불 금액<input className="cs-input" name="amount" type="number" min={1} max={available} step={1} required disabled={busy} /></label><label>환불 사유<textarea className="cs-input" name="reason" maxLength={500} required disabled={busy} /></label><ActionButton disabled={busy}>{busy ? "접수 중…" : "환불 요청 접수"}</ActionButton></form>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</Panel> : canRefund && available > 0 && <Link className="cs-button" href={"/bill/" + id + "/refund"}>환불 요청하기</Link>}
  </div>;
}
