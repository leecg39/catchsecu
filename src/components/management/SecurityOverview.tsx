"use client";
import { GuardedLink as Link } from "../ux/navigation-guard";
import { securityCapabilities, securityCapabilityLabels, type SecurityEntitlements } from "@/contracts/feature-entitlements";
import { SecurityEntitlementNotice } from "./SecurityEntitlementNotice";
import { useResource } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton,PageHeading,Panel } from "../shared";
export function SecurityOverview(){const app=useApplication();return <Overview key={(app.data?.company?.id??"none")+":"+(app.data?.company?.role??"")}/>;}
function Overview(){
 const result=useResource<{entitlements:SecurityEntitlements;checkedAt:string;attention:number;checks:{id:string;title:string;passed:boolean;detail:string;actionLabel:string;href:string}[]}>("/security/status");
 return <><PageHeading title="회사 보안 현황"><ActionButton secondary onClick={result.reload}>다시 점검</ActionButton></PageHeading>
 <p>현재 회사의 설정과 구성원 등록 상태를 확인합니다. 법적 준수 여부는 별도의 검토가 필요합니다.</p>
 {result.error?<Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>:!result.data?<Panel><p role="status">보안 설정을 확인하는 중입니다.</p></Panel>:<>
 <Panel><p>확인 시각: {new Date(result.data.checkedAt).toLocaleString("ko-KR")} · 확인이 필요한 항목 {result.data.attention}개</p></Panel>
 <Panel title="보안 설정 이용 권한">{securityCapabilities.map(capability=><section key={capability}><h3>{securityCapabilityLabels[capability]}</h3><SecurityEntitlementNotice access={result.data!.entitlements[capability]}/></section>)}</Panel>
 {result.data.checks.map(check=><Panel key={check.id}><PageHeading title={check.title}><strong>{check.passed?"설정 확인":"확인 필요"}</strong></PageHeading><p>{check.detail}</p><Link className="cs-button secondary" href={check.href}>{check.actionLabel}</Link></Panel>)}
 </>}</>;
}
