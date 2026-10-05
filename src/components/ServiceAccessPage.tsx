"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import type { Application } from "./ApplicationContext";
import type { AccessRequestList, AccessRequestRecord } from "@/contracts/access-requests";
import { accessStatusLabels } from "@/contracts/access-requests";
import { ActionButton, Panel } from "./shared";
import { useConfirm } from "./ux/confirm";

export function ServiceAccessPage() {
  const context = useResource<Application>("/context");
  const requests = useResource<AccessRequestList>(context.data?.company ? "/access-requests?scope=mine&pageSize=50" : null);
  const [serviceId, setServiceId] = useState(""), [reason, setReason] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const ask = useConfirm();
  const options = requests.data?.availableServices ?? [];
  const expert = !!context.data?.company && context.data.memberships.some(item =>
    item.tenantId === context.data?.company?.id && item.accessKind === "expert");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const selected = serviceId || options[0]?.id;
      if (!selected) throw new Error("요청할 서비스를 선택해주세요.");
      await api("/access-requests", { method: "POST", body: JSON.stringify({ serviceId: selected, reason: reason.trim() }) });
      setNotice("서비스 접근 요청을 등록했습니다."); setReason(""); setServiceId(""); requests.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function cancel(item: AccessRequestRecord) {
    if (!await ask({ title: "서비스 접근 요청 취소", message: "보낸 접근 요청을 취소합니다. 필요하면 다시 요청할 수 있습니다.", confirmLabel: "요청 취소", cancelLabel: "닫기" })) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      await api("/access-requests/" + item.id, { method: "DELETE", headers: { "If-Match": String(item.version) } });
      setNotice("요청을 취소했습니다."); requests.reload();
    } catch (cause) { setError(errorText(cause)); requests.reload(); } finally { setBusy(false); }
  }
  return <div className="public-standalone"><Panel title="서비스 접근 권한">
    {context.loading && <p role="status">회사와 서비스 권한을 확인하는 중입니다.</p>}
    {context.error && <><p role="alert">{context.error.message}</p><ActionButton secondary onClick={context.reload}>다시 시도</ActionButton></>}
    {context.data && !context.data.company && <><p>{context.data.expertAssignmentCount > 0
      ? "배정된 회사를 선택해주세요." : "소속된 회사가 없습니다. 회사를 등록하거나 초대를 수락해주세요."}</p>
      <Link className="cs-button" href={context.data.expertAssignmentCount > 0 ? "/expert/select-company" : "/company-info"}>
        {context.data.expertAssignmentCount > 0 ? "전문가 배정 확인" : "회사 등록"}
      </Link></>}
    {context.data?.company && <>
      <p><strong>{context.data.company.name}</strong>의 서비스 접근 상태입니다.</p>
      <ActionButton secondary onClick={() => { context.reload(); requests.reload(); }}>권한 상태 새로고침</ActionButton>
      {!!context.data.services.length && <div className="public-actions"><p>사용 가능한 서비스가 있습니다.</p><Link className="cs-button" href="/dashboard">대시보드로 이동</Link></div>}
      {requests.loading && <p role="status">요청 내역을 불러오는 중입니다.</p>}
      {requests.error && <><p role="alert">{requests.error.message}</p><ActionButton secondary onClick={requests.reload}>요청 내역 다시 시도</ActionButton></>}
      {requests.data && <>
        {!context.data.services.length && <p>현재 접근할 수 있는 서비스가 없습니다.</p>}
        {options.length > 0 && <form className="service-access-form" onSubmit={submit}>
          <label>요청할 서비스<select className="cs-input" required value={serviceId} onChange={event => setServiceId(event.target.value)}>
            <option value="">서비스 선택</option>{options.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <label>요청 사유<textarea className="cs-input" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="관리자에게 전달할 사유 (선택)" /></label>
          <ActionButton disabled={busy}>{busy ? "처리 중…" : "관리자에게 권한 요청"}</ActionButton>
        </form>}
        {!options.length && !context.data.services.length && <p>{expert
          ? "전문가 서비스 범위는 배정 담당자가 변경할 수 있습니다. 배정된 회사를 다시 확인해주세요."
          : requests.data.pendingCount ? "요청한 서비스 권한을 관리자가 검토 중입니다."
            : "요청 가능한 서비스가 없습니다. 회사 관리자에게 서비스 등록이나 권한 상태를 확인해주세요."}</p>}
        {expert && !context.data.services.length && <Link className="cs-button" href="/expert/select-company">전문가 배정 확인</Link>}
        {requests.data.items.length > 0 && <div className="service-access-history"><h2>내 요청 내역</h2>
          {requests.data.items.map(item => <div className="service-access-item" key={item.id}>
            <div><strong>{item.serviceName}</strong> · {accessStatusLabels[item.status]}<br />
              <small>{new Date(item.createdAt).toLocaleString("ko-KR")}</small>
              {item.decisionNote && <p>관리자 답변: {item.decisionNote}</p>}</div>
            {item.status === "pending" && <ActionButton secondary disabled={busy} onClick={() => cancel(item)}>요청 취소</ActionButton>}
          </div>)}</div>}
      </>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="auth-error">{error}</p>}
    </>}
    <div className="public-actions"><Link className="cs-link" href="/logout">로그아웃</Link></div>
  </Panel></div>;
}
