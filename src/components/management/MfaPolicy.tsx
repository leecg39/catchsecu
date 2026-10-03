"use client";
import { useRef,useState } from "react";
import Link from "next/link";
import type { MfaExceptionRecord,MfaPolicyPage } from "@/contracts/mfa-policy";
import { api,errorText,useResource } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton,Modal,PageHeading,Panel } from "../shared";
export function MfaPolicy({settings=false}:{settings?:boolean}){const app=useApplication();return <MfaContent key={(app.data?.company?.id??"none")+":"+(app.data?.company?.role??"")} settings={settings}/>;}
function MfaContent({settings}:{settings:boolean}){
 const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[edit,setEdit]=useState<{memberId:string;name:string;row:MfaExceptionRecord|null}>(),[toggle,setToggle]=useState(false),[remove,setRemove]=useState<MfaExceptionRecord>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const result=useResource<MfaPolicyPage>("/security/mfa-policy?"+new URLSearchParams({search,status:filter,page:String(page)})),policy=result.data?.policy;
 async function confirm(password:string){
  if(!policy)return;setBusy(true);setError("");
  try{if(remove)await api("/security/mfa-policy/exceptions/"+remove.id,{method:"DELETE",body:JSON.stringify({tenantId:policy.tenantId,version:remove.version,password})});
   else await api("/security/mfa-policy",{method:"PATCH",body:JSON.stringify({tenantId:policy.tenantId,version:policy.version,required:!policy.required,password})});
   setRemove(undefined);setToggle(false);setNotice("저장했습니다. 다음 회사 요청부터 적용됩니다.");result.reload();
  }catch(cause){setError(errorText(cause));}finally{setBusy(false);}
 }
 return <><PageHeading title={settings?"회사 2단계 인증 설정":"회사 2단계 인증"}><Link className="cs-button secondary" href={settings?"/security/two-factor":"/security/two-factor/setting"}>{settings?"현황 보기":"정책 설정"}</Link></PageHeading>
 <p>인증 등록이 필요한 구성원과 임시 복구 예외를 관리합니다. 예외는 최초 등록부터 최대 24시간이며 만료 시 접근이 종료됩니다.</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {result.error?<Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>:!policy?<Panel><p role="status">인증 현황을 불러오는 중입니다.</p></Panel>:<>
 <Panel><PageHeading title={"회사 인증 강제 "+(policy.required?"사용 중":"꺼짐")}>{policy.canManage&&<ActionButton secondary disabled={busy} onClick={()=>setToggle(true)}>{policy.required?"인증 강제 해제":"인증 강제 활성화"}</ActionButton>}</PageHeading>
 <p>전체 {result.data!.summary.members}명 · 등록 {result.data!.summary.enrolled}명 · 임시 예외 {result.data!.summary.exceptions}명 · 미등록 {result.data!.summary.missing}명</p>
 {!policy.actorEnrolled&&<p>정책을 변경하려면 관리자 본인의 2단계 인증을 먼저 등록해주세요. <Link href="/two-step-setting?returnTo=%2Fsecurity%2Ftwo-factor">2단계 인증 등록</Link></p>}
 <p>복구코드는 개인 인증 등록 화면에서 발급합니다. 다른 최상위 관리자는 인증 기기를 잃은 구성원에게 기한이 있는 예외를 등록할 수 있습니다.</p></Panel>
 <Panel><div className="mg-flex"><label>이름·이메일 검색<input className="cs-input" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><label>등록 상태<select className="cs-input" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">전체</option><option value="enabled">등록 완료</option><option value="required">미등록·예외 없음</option><option value="exception">임시 예외</option></select></label></div>
 <div className="mg-table-wrap"><table className="cs-table"><thead><tr><th>구성원</th><th>역할</th><th>인증 상태</th><th>예외 기한·사유</th><th>관리</th></tr></thead><tbody>{result.data!.items.map(m=><tr key={m.id}><td>{m.name}<br/>{m.email}</td><td>{m.role}</td><td>{m.enrolled?"등록 완료":m.exception?.active?"임시 예외":"미등록"}</td><td>{m.exception?<>{new Date(m.exception.expiresAt).toLocaleString("ko-KR")} {!m.exception.active&&"(만료)"}<br/>{m.exception.reason}</>:"-"}</td><td>{policy.canManage&&<div className="mg-flex">{!m.enrolled&&<ActionButton secondary disabled={busy} onClick={()=>setEdit({memberId:m.id,name:m.name,row:m.exception})}>{m.exception?"예외 수정":"예외 등록"}</ActionButton>}{m.exception&&<ActionButton secondary disabled={busy} onClick={()=>setRemove(m.exception!)}>예외 삭제</ActionButton>}</div>}</td></tr>)}{!result.data!.items.length&&<tr><td colSpan={5}>검색 결과가 없습니다.</td></tr>}</tbody></table></div>
 <div className="mg-flex"><span>{result.data!.total}명 · {result.data!.page}페이지</span><ActionButton secondary disabled={busy||result.data!.page<=1} onClick={()=>setPage(result.data!.page-1)}>이전</ActionButton><ActionButton secondary disabled={busy||result.data!.page*result.data!.pageSize>=result.data!.total} onClick={()=>setPage(result.data!.page+1)}>다음</ActionButton></div></Panel>
 {edit&&<ExceptionEditor key={edit.row?.id??edit.memberId} tenantId={policy.tenantId} {...edit} onClose={()=>setEdit(undefined)} onSaved={()=>{setEdit(undefined);setNotice("임시 예외를 저장했습니다.");result.reload();}}/>}
 {(toggle||remove)&&<Modal title={remove?"임시 예외 삭제":"회사 인증 정책 변경"} onClose={()=>{if(!busy){setToggle(false);setRemove(undefined);}}}><form onSubmit={e=>{e.preventDefault();void confirm(String(new FormData(e.currentTarget).get("password")));}}><p>{remove?"삭제하면 미등록 구성원의 회사 접근은 즉시 제한됩니다.":policy.required?"인증 강제를 해제합니다.":"등록하지 않은 구성원은 회사 기능을 사용하기 전에 인증을 등록해야 합니다."}</p><label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password"/></label>{error&&<p role="alert">{error}</p>}<ActionButton disabled={busy} type="submit">저장</ActionButton></form></Modal>}
 </>}</>;
}
function ExceptionEditor({tenantId,memberId,name,row,onClose,onSaved}:{tenantId:string;memberId:string;name:string;row:MfaExceptionRecord|null;onClose:()=>void;onSaved:()=>void}){
 const key=useRef(crypto.randomUUID()),[reason,setReason]=useState(row?.reason??""),[hours,setHours]=useState("1"),[version,setVersion]=useState(row?.version),[busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(false),pending=useRef<{input:object;key:string}|undefined>(undefined);
 async function save(password:string){
  setBusy(true);setError("");
  try{
   if(row)await api("/security/mfa-policy/exceptions/"+row.id,{method:"PATCH",body:JSON.stringify({tenantId,version,reason,expiresAt:new Date(Date.now()+Number(hours)*3600000).toISOString(),password})});
   else{if(!pending.current){pending.current={input:{tenantId,memberId,reason,expiresAt:new Date(Date.now()+Number(hours)*3600000).toISOString()},key:key.current};setRetry(true);}await api("/security/mfa-policy/exceptions",{method:"POST",headers:{"Idempotency-Key":pending.current.key},body:JSON.stringify({...pending.current.input,password})});}
   onSaved();
  }catch(cause){setError(errorText(cause));}finally{setBusy(false);}
 }
 async function latest(){if(!row)return;setBusy(true);try{const x=await api<MfaExceptionRecord>("/security/mfa-policy/exceptions/"+row.id);setReason(x.reason);setVersion(x.version);setError("");}catch(cause){setError(errorText(cause));}finally{setBusy(false);}}
 return <Modal title={name+" 임시 예외 "+(row?"수정":"등록")} onClose={()=>{if(!busy)onClose();}}><form onSubmit={e=>{e.preventDefault();void save(String(new FormData(e.currentTarget).get("password")));}}>
 {error&&<p role="alert">{error}</p>}{row&&<p>최종 기한: {new Date(new Date(row.createdAt).getTime()+86400000).toLocaleString("ko-KR")}</p>}
 <label>예외 사유<textarea className="cs-input" required minLength={5} maxLength={500} value={reason} disabled={busy||retry} onChange={e=>setReason(e.target.value)}/></label>
 <label>현재부터 허용 시간<input className="cs-input" type="number" min="0.1" max="24" step="0.1" required value={hours} disabled={busy||retry} onChange={e=>setHours(e.target.value)}/></label>
 <label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password"/></label>
 {retry&&<p>같은 입력으로 처리 결과를 다시 확인합니다.</p>}<div className="mg-flex">{row&&<ActionButton secondary type="button" disabled={busy} onClick={()=>void latest()}>최신 예외 불러오기</ActionButton>}<ActionButton type="submit" disabled={busy}>{retry?"같은 요청 재확인":"저장"}</ActionButton></div>
 </form></Modal>;
}
