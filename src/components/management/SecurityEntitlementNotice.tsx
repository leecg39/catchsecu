"use client";
import type { FeatureAccess } from "@/contracts/feature-entitlements";
import { GuardedLink } from "../ux/navigation-guard";
import { useApplication } from "../ApplicationContext";

const messages: Record<FeatureAccess["state"], string> = {
  included: "현재 구독에 포함된 기능입니다.",
  not_included: "현재 구독에는 이 설정을 변경하는 기능이 포함되어 있지 않습니다.",
  expired: "구독 이용 기간이 종료되어 설정을 변경할 수 없습니다.",
  pending: "구독이 아직 시작되지 않아 설정을 변경할 수 없습니다.",
  unsubscribed: "구독이 없어 설정을 변경할 수 없습니다.",
};
export function SecurityEntitlementNotice({ access }: { access: FeatureAccess }) {
  const app = useApplication();
  return <div className="mg-description" role="status" data-entitlement-state={access.state}>
    <p>{messages[access.state]}{access.available && access.expiresAt && <> 이용 기한: {new Date(access.expiresAt).toLocaleString("ko-KR")}</>}</p>
    {!access.available && <p>현재 설정은 조회할 수 있으며, 적용 중인 보안 보호는 계속 유지됩니다.
      {app.data?.company?.role === "owner" && <> <GuardedLink href="/pay/license-service">구독 확인</GuardedLink></>}</p>}
  </div>;
}
