"use client";

import Link from "next/link";
import { useResource } from "@/lib/api";
import { type AccessDenialReason } from "@/lib/access-denial";
import type { AccessRequestList } from "@/contracts/access-requests";
import type { Application } from "./ApplicationContext";
import { ActionButton, Panel } from "./shared";

const messages: Record<AccessDenialReason, { heading: string; help: string }> = {
  admin: { heading: "시스템 운영자 권한이 필요한 화면입니다.", help: "현재 계정으로 이 화면을 열 수 없습니다. 운영자 권한 담당자에게 문의해주세요." },
  role: { heading: "현재 역할로 사용할 수 없는 기능입니다.", help: "회사 관리자에게 구성원 역할과 기능 권한을 확인해주세요." },
  service: { heading: "서비스 접근 권한이 없습니다.", help: "현재 회사에서 요청 가능한 서비스가 있는지 확인하고 관리자에게 접근을 요청할 수 있습니다." },
  expert: { heading: "전문가 배정 범위에 없는 서비스입니다.", help: "전문가 배정 담당자에게 회사와 서비스 범위를 확인해주세요." },
  general: { heading: "접근 권한이 없는 메뉴입니다.", help: "구성원 관리 권한이 있는 사용자에게 권한을 요청해주세요." },
};

export function AccessDeniedPage({ reason }: { reason: AccessDenialReason }) {
  const context = useResource<Application>("/context");
  const company = context.data?.company;
  const expert = !!company && context.data?.memberships.some(item => item.tenantId === company.id && item.accessKind === "expert");
  const requests = useResource<AccessRequestList>(reason === "service" && company && !expert
    ? "/access-requests?scope=mine&pageSize=1" : null);
  const message = messages[reason];
  return <div className="cs-gate"><Panel title="권한이 없습니다.">
    <div className="cs-note"><strong>{message.heading}</strong><br />{message.help}</div>
    {context.loading && <p role="status">현재 계정과 회사 권한을 확인하는 중입니다.</p>}
    {context.error && <p role="alert">권한 상태를 불러오지 못했습니다. 다시 확인해주세요.</p>}
    {context.data && !company && <div className="public-actions">
      {context.data.expertAssignmentCount > 0
        ? <Link className="cs-button" href="/expert/select-company">배정된 회사 선택</Link>
        : <Link className="cs-button" href="/company-info">회사 등록·초대 확인</Link>}
    </div>}
    {reason === "expert" && !!company && <div className="public-actions">
      <Link className="cs-button" href="/expert/select-company">전문가 배정 확인</Link>
    </div>}
    {reason === "service" && !!company && !expert && <>
      {requests.loading && <p role="status">요청 가능한 서비스를 확인하는 중입니다.</p>}
      {requests.error && <p role="alert">서비스 권한을 확인하지 못했습니다. 다시 시도해주세요.</p>}
      {!!requests.data?.availableServices.length && <div className="public-actions">
        <Link className="cs-button" href="/service/none">서비스 접근 요청</Link>
      </div>}
      {requests.data && !requests.data.availableServices.length && <p>{requests.data.pendingCount
        ? "서비스 접근 요청을 관리자가 검토 중입니다."
        : "현재 요청 가능한 서비스가 없습니다. 회사 관리자에게 권한 상태를 확인해주세요."}</p>}
    </>}
    {reason === "service" && expert && <p>전문가 서비스 범위는 배정 담당자가 변경할 수 있습니다.</p>}
    <div className="public-actions">
      <ActionButton secondary onClick={() => { context.reload(); requests.reload(); }}>권한 상태 다시 확인</ActionButton>
      <Link className="cs-link" href="/dashboard">대시보드로 이동</Link>
    </div>
  </Panel></div>;
}
