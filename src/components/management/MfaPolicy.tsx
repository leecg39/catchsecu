"use client";
import { SecurityEntitlementNotice } from "./SecurityEntitlementNotice";
import { useRef,useState } from "react";
import { GuardedLink as Link, useUnsavedChanges } from "../ux/navigation-guard";
import type { MfaExceptionRecord,MfaPolicyPage } from "@/contracts/mfa-policy";
import { api,ApiError,errorText,useResource } from "@/lib/api";
import { useConfirm } from "../ux/confirm";
import { useApplication } from "../ApplicationContext";
import { ActionButton,Modal,PageHeading,Panel } from "../shared";
export function MfaPolicy({settings=false}:{settings?:boolean}){const app=useApplication();return <MfaContent key={(app.data?.company?.id??"none")+":"+(app.data?.company?.role??"")} settings={settings}/>;}
function MfaContent({settings}:{settings:boolean}){
 const [searchInput,setSearchInput]=useState(""),[search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[edit,setEdit]=useState<{memberId:string;name:string;row:MfaExceptionRecord|null}>(),[toggle,setToggle]=useState(false),[remove,setRemove]=useState<MfaExceptionRecord>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const result=useResource<MfaPolicyPage>("/security/mfa-policy?"+new URLSearchParams({search,status:filter,page:String(page)})),policy=result.data?.policy;
 const lock=useRef(false),[conflict,setConflict]=useState(false);
 async function confirm(password:string){
  if(!policy||lock.current||conflict)return;lock.current=true;setBusy(true);setError("");
  try{if(remove)await api("/security/mfa-policy/exceptions/"+remove.id,{method:"DELETE",body:JSON.stringify({tenantId:policy.tenantId,version:remove.version,password})});
   else await api("/security/mfa-policy",{method:"PATCH",body:JSON.stringify({tenantId:policy.tenantId,version:policy.version,required:!policy.required,password})});
   setRemove(undefined);setToggle(false);setNotice("저장했습니다. 다음 회사 요청부터 적용됩니다.");result.reload();
  }catch(cause){setError(errorText(cause));setConflict(cause instanceof ApiError&&cause.code==="VERSION_CONFLICT");}finally{lock.current=false;setBusy(false);}
 }
 return <><PageHeading title={settings?"회사 2단계 인증 설정":"회사 2단계 인증"}><Link className="cs-button secondary" href={settings?"/security/two-factor":"/security/two-factor/setting"}>{settings?"현황 보기":"정책 설정"}</Link></PageHeading>
 <p>인증 등록이 필요한 구성원과 임시 복구 예외를 관리합니다. 예외는 최초 등록부터 최대 24시간이며 만료 시 접근이 종료됩니다.</p>
 {!toggle&&!remove&&error&&<p role="alert">{error}</p>}{!toggle&&!remove&&conflict&&<ActionButton secondary disabled={busy} onClick={()=>{setConflict(false);setError("");result.reload();}}>최신 현황 불러오기</ActionButton>}{notice&&<p role="status">{notice}</p>}
 {result.error?<Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>:!policy?<Panel><p role="status">인증 현황을 불러오는 중입니다.</p></Panel>:<><SecurityEntitlementNotice access={policy.entitlement}/>
 <Panel><PageHeading title={"회사 인증 강제 "+(policy.required?"사용 중":"꺼짐")}>{policy.canManage&&<ActionButton secondary disabled={busy||conflict} onClick={()=>{setError("");setToggle(true);}}>{policy.required?"인증 강제 해제":"인증 강제 활성화"}</ActionButton>}</PageHeading>
 <p>전체 {result.data!.summary.members}명 · 등록 {result.data!.summary.enrolled}명 · 임시 예외 {result.data!.summary.exceptions}명 · 미등록 {result.data!.summary.missing}명</p>
 {!policy.actorEnrolled&&<p>정책을 변경하려면 관리자 본인의 2단계 인증을 먼저 등록해주세요. <Link href="/two-step-setting?returnTo=%2Fsecurity%2Ftwo-factor">2단계 인증 등록</Link></p>}
 <p>복구코드는 개인 인증 등록 화면에서 발급합니다. 다른 최상위 관리자는 인증 기기를 잃은 구성원에게 기한이 있는 예외를 등록할 수 있습니다.</p></Panel>
 <Panel><form className="mg-flex" onSubmit={e=>{e.preventDefault();setSearch(searchInput);setPage(1);}}><label>이름·이메일 검색<input className="cs-input" aria-label="인증 구성원 검색" value={searchInput} onChange={e=>setSearchInput(e.target.value)}/></label><label>등록 상태<select className="cs-input" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">전체</option><option value="enabled">등록 완료</option><option value="required">미등록·예외 없음</option><option value="exception">임시 예외</option></select></label><ActionButton type="submit">검색</ActionButton></form>
 <div className="cs-table-wrap"><table className="cs-table"><thead><tr><th>구성원</th><th>역할</th><th>인증 상태</th><th>예외 기한·사유</th><th>관리</th></tr></thead><tbody>{result.data!.items.map(m=><tr key={m.id}><td>{m.name}<br/>{m.email}</td><td>{m.role}</td><td>{m.enrolled?"등록 완료":m.exception?.active?"임시 예외":"미등록"}</td><td>{m.exception?<>{new Date(m.exception.expiresAt).toLocaleString("ko-KR")} {!m.exception.active&&"(만료)"}<br/>{m.exception.reason}</>:"-"}</td><td>{policy.canManage&&<div className="mg-flex">{!m.enrolled&&<ActionButton secondary disabled={busy} onClick={()=>setEdit({memberId:m.id,name:m.name,row:m.exception})}>{m.exception?"예외 수정":"예외 등록"}</ActionButton>}{m.exception&&<ActionButton secondary disabled={busy} onClick={()=>{setError("");setRemove(m.exception!);}}>예외 삭제</ActionButton>}</div>}</td></tr>)}{!result.data!.items.length&&<tr><td colSpan={5}>검색 결과가 없습니다.</td></tr>}</tbody></table></div>
 <div className="mg-flex"><span>{result.data!.total}명 · {result.data!.page}페이지</span><ActionButton secondary disabled={busy||result.data!.page<=1} onClick={()=>setPage(result.data!.page-1)}>이전</ActionButton><ActionButton secondary disabled={busy||result.data!.page*result.data!.pageSize>=result.data!.total} onClick={()=>setPage(result.data!.page+1)}>다음</ActionButton></div></Panel>
 {edit&&<ExceptionEditor key={edit.row?.id??edit.memberId} tenantId={policy.tenantId} {...edit} onClose={()=>setEdit(undefined)} onSaved={()=>{setEdit(undefined);setNotice("임시 예외를 저장했습니다.");result.reload();}}/>}
 {(toggle||remove)&&<Modal title={remove?"임시 예외 삭제":"회사 인증 정책 변경"} onClose={()=>{if(!busy){setToggle(false);setRemove(undefined);}}}><form className="policy-fields" onSubmit={e=>{e.preventDefault();void confirm(String(new FormData(e.currentTarget).get("password")));}}><p>{remove?"삭제하면 미등록 구성원의 회사 접근은 즉시 제한됩니다.":policy.required?"인증 강제를 해제합니다.":"등록하지 않은 구성원은 회사 기능을 사용하기 전에 인증을 등록해야 합니다."}</p><label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password"/></label>{error&&<p role="alert">{error}</p>}{conflict&&<ActionButton secondary type="button" disabled={busy} onClick={()=>{setToggle(false);setRemove(undefined);setConflict(false);setError("");setNotice("최신 인증 현황을 확인한 뒤 다시 변경해주세요.");result.reload();}}>최신 현황 불러오기</ActionButton>}<ActionButton disabled={busy||conflict} type="submit">저장</ActionButton></form></Modal>}
 </>}</>;
}
function ExceptionEditor({tenantId,memberId,name,row,onClose,onSaved}:{tenantId:string;memberId:string;name:string;row:MfaExceptionRecord|null;onClose:()=>void;onSaved:()=>void}){
 const [reason,setReason]=useState(row?.reason??""),[expiresAt,setExpiresAt]=useState(()=>localTime(row?.expiresAt??new Date(Date.now()+3600000).toISOString())),[version,setVersion]=useState(row?.version);
 const [baseline,setBaseline]=useState(()=>({reason:row?.reason??"",expiresAt})),[busy,setBusy]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false),[password,setPassword]=useState("");
 const pending=useRef<{payload:string;key:string}|undefined>(undefined),lock=useRef(false),ask=useConfirm();
 const dirty=reason!==baseline.reason||expiresAt!==baseline.expiresAt||!!password;
 useUnsavedChanges(dirty||busy);
 async function discard(){return !dirty||await ask({title:"저장하지 않은 변경 사항",message:"작성한 임시 예외 입력을 버릴까요?",confirmLabel:"입력 버리기",cancelLabel:"계속 편집"});}
 async function close(){if(!lock.current&&await discard())onClose();}
 async function save(password:string){
  if(lock.current||conflict)return;lock.current=true;setBusy(true);setError("");
  try{
   const input={tenantId,reason,expiresAt:new Date(expiresAt).toISOString(),...(row?{version}:{memberId})},payload=JSON.stringify(input);
   if(pending.current?.payload!==payload)pending.current={payload,key:crypto.randomUUID()};
   await api("/security/mfa-policy/exceptions"+(row?"/"+row.id:""),{method:row?"PATCH":"POST",headers:row?{}:{"Idempotency-Key":pending.current.key},body:JSON.stringify({...input,password})});
   onSaved();
  }catch(cause){setError(errorText(cause));setConflict(cause instanceof ApiError&&cause.code==="VERSION_CONFLICT");}finally{lock.current=false;setBusy(false);}
 }
 async function latest(){if(!row||lock.current||!await discard()||lock.current)return;lock.current=true;setBusy(true);setError("");try{const x=await api<MfaExceptionRecord>("/security/mfa-policy/exceptions/"+row.id);const time=localTime(x.expiresAt);setReason(x.reason);setVersion(x.version);setExpiresAt(time);setBaseline({reason:x.reason,expiresAt:time});setPassword("");setConflict(false);}catch(cause){setError(errorText(cause));}finally{lock.current=false;setBusy(false);}}
 return <Modal title={name+" 임시 예외 "+(row?"수정":"등록")} onClose={()=>{void close();}}><form className="policy-fields security-exception-form" onSubmit={e=>{e.preventDefault();void save(password);}}>
 {error&&<p role="alert">{error}</p>}{row&&<p>최종 기한: {new Date(new Date(row.createdAt).getTime()+86400000).toLocaleString("ko-KR")}</p>}
 <label>예외 사유<textarea className="cs-input" rows={3} required minLength={5} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
 <label>예외 만료 일시<input className="cs-input" type="datetime-local" required step="1" value={expiresAt} disabled={busy} onChange={e=>setExpiresAt(e.target.value)}/></label>
 <p>이 기기의 현지 시간으로 표시합니다. 예외는 최초 등록부터 최대 24시간까지 허용되며 저장한 만료 일시에 종료됩니다.</p>
 <label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password" disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
 {conflict&&<p>입력은 유지했습니다. 최신 예외를 불러온 뒤 다시 편집해주세요.</p>}<div className="mg-flex">{row&&<ActionButton secondary type="button" disabled={busy} onClick={()=>void latest()}>최신 예외 불러오기</ActionButton>}<ActionButton type="submit" disabled={busy||conflict}>저장</ActionButton></div>
 </form></Modal>;
}
function localTime(value:string){const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);}
