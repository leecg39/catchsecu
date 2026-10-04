"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { IntegrationPage } from "./Notifications";
import { SenderManagement } from "./Senders";
import { CampaignPage } from "./Campaigns";
import { LicenseManagement, MembershipPage, PaymentFailure, PaymentHistory, ServiceAssetPage } from "./payment";
import { ServiceGate } from "./gates";
import { KakaoPlayground } from "./kakao";
import { KakaoTemplates } from "./KakaoTemplates";
import "./services.css";
export function matchServices(path:string){return /^\/(sms|mail|alimtalk|integration|pay|bill|creditBill)(\/|$)/.test(path)||path==='/kakao-playground'}
function LocalRedirect({to}:{to:string}){const router=useRouter();useEffect(()=>router.replace(to),[router,to]);return null}
export function ServicesPages({path}:{path:string}){if(path==='/kakao-playground')return <KakaoPlayground/>;if(path==='/integration/message')return <IntegrationPage/>;if(path==='/sms'||path==='/mail')return null;if(path==='/alimtalk'||path.startsWith('/alimtalk/'))return <KakaoTemplates path={path}/>;if(['/mail/catchform','/mail/direct','/sms/catchform','/sms/direct'].includes(path))return <CampaignPage email={path.startsWith('/mail')} source={path.endsWith('/catchform')?'form':'direct'}/>;if(path==='/sms/nonumber')return <ServiceGate kind="sms"/>;if(path==='/mail/no-mail')return <ServiceGate kind="address"/>;if(path.endsWith('/number'))return <SenderManagement email={path.startsWith('/mail')}/>;if(path==='/mail/history'||path==='/sms/history')return <CampaignPage email={path.startsWith('/mail')} history/>;if(path==='/pay/membership/detail')return <MembershipPage/>;if(path==='/pay/license-service')return <LicenseManagement/>;if(path==='/pay/method'||path==='/pay/billing-policy')return <LocalRedirect to="/pay/license-service"/>;if(path==='/pay/history'||path==='/pay/usage/history')return <PaymentHistory usage={path.includes('/usage/')}/>;if(path==='/pay/service-asset')return <ServiceAssetPage/>;if(path==='/pay/result/fail')return <PaymentFailure/>;return <ServiceGate kind="unavailable"/>}
