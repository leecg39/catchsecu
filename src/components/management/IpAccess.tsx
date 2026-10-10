"use client";
import { SecurityEntitlementNotice } from "./SecurityEntitlementNotice";
import { useRef, useState } from "react";
import { GuardedLink as Link, useUnsavedChanges } from "../ux/navigation-guard";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { IpRulePage, IpRuleRecord } from "@/contracts/ip-access";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";
export function IpAccess({ settings=false }: {settings?:boolean}) {
  const app=useApplication();return <IpAccessContent key={(app.data?.company?.id??"none")+":"+(app.data?.company?.role??"")} settings={settings}/>;
}
function IpAccessContent({ settings=false }: {settings?:boolean}) {
  const [searchInput,setSearchInput]=useState(""),[search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[sort,setSort]=useState("createdAt:desc");
  const [edit,setEdit]=useState<IpRuleRecord|null|undefined>(),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [field,direction]=sort.split(":");
  const query=new URLSearchParams({search,status:filter,page:String(page),sort:field,direction});
  const result=useResource<IpRulePage>("/security/ip-rules?"+query),policy=result.data?.policy;
  const ask=useConfirm(),lock=useRef(false);
  const [conflict,setConflict]=useState(false);
  async function remove(row:IpRuleRecord) {
    if(lock.current||!await ask({title:"IP 규칙 삭제",message:<><p>“{row.cidr}” 규칙을 삭제합니다.</p><p>접근 제한이 켜져 있으면 이 범위에서의 접속이 차단될 수 있습니다.</p></>,confirmLabel:"삭제"})||lock.current) return; lock.current=true;setBusy(true);setError("");setNotice("");setConflict(false);
    try { await api("/security/ip-rules/"+row.id,{method:"DELETE",body:JSON.stringify({tenantId:row.tenantId,version:row.version})});setNotice("IP 규칙을 삭제했습니다.");result.reload(); }
    catch(cause){setError(errorText(cause));setConflict(cause instanceof ApiError&&cause.code==="VERSION_CONFLICT");}finally{lock.current=false;setBusy(false);}
  }
  async function toggle(password:string) {
    if(!policy||lock.current||conflict)return;lock.current=true;setBusy(true);setError("");
    try {await api("/security/ip-rules/settings",{method:"PATCH",body:JSON.stringify({tenantId:policy.tenantId,version:policy.version,enabled:!policy.enabled,password})});setConfirm(false);setNotice("접근 제한 설정을 저장했습니다. 다음 회사 요청부터 적용됩니다.");result.reload();}
    catch(cause){setError(errorText(cause));setConflict(cause instanceof ApiError&&cause.code==="VERSION_CONFLICT");}finally{lock.current=false;setBusy(false);}
  }
  return <><PageHeading title={settings?"IP 접근 규칙 설정":"IP 접근 관리"}>
    {!settings&&<Link className="cs-button" href="/security/ip/setting">접근 규칙 설정</Link>}
    {settings&&<Link className="cs-button" href="/security/ip">목록 보기</Link>}
  </PageHeading><p className="mg-description">허용한 IP 주소와 범위에서만 회사 기능을 사용할 수 있도록 설정합니다. 최상위 관리자만 규칙을 변경할 수 있습니다.</p>
    {!confirm&&error&&<p role="alert">{error}</p>}{!confirm&&conflict&&<ActionButton secondary disabled={busy} onClick={()=>{setConflict(false);setError("");result.reload();}}>최신 규칙 불러오기</ActionButton>}{notice&&<p role="status">{notice}</p>}
    {result.error?<Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>:!policy?<Panel><p role="status">IP 접근 설정을 불러오는 중입니다.</p></Panel>:<>
      <SecurityEntitlementNotice access={policy.entitlement}/><Panel><PageHeading title={"접근 제한 "+(policy.enabled?"사용 중":"꺼짐")}>
        {policy.canManage&&<ActionButton secondary disabled={busy||conflict} onClick={()=>{setError("");setConfirm(true);}}>{policy.enabled?"접근 제한 끄기":"접근 제한 켜기"}</ActionButton>}
      </PageHeading><p>현재 접속 IP: <strong>{policy.currentIp??"확인할 수 없음"}</strong></p>
        <p>제한을 켜기 전에 현재 접속 IP를 허용하는 규칙을 등록해주세요. 현재 관리자의 접속을 차단하는 변경은 저장할 수 없습니다.</p>
      </Panel>
      <Panel><form className="mg-flex" onSubmit={e=>{e.preventDefault();setSearch(searchInput);setPage(1);}}>
        <label>검색<input className="cs-input" value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="IP 또는 설명"/></label>
        <ActionButton type="submit">검색</ActionButton>
        <label>사용 상태<select className="cs-input" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">전체</option><option value="enabled">사용</option><option value="disabled">사용 안 함</option></select></label>
        <label>정렬<select className="cs-input" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="createdAt:desc">최근 등록순</option><option value="createdAt:asc">등록순</option><option value="cidr:asc">IP 오름차순</option><option value="cidr:desc">IP 내림차순</option></select></label>
        {policy.canManage&&<ActionButton type="button" disabled={busy} onClick={()=>setEdit(null)}>IP 규칙 등록</ActionButton>}
      </form><div className="cs-table-wrap"><table className="cs-table"><thead><tr><th>IP·CIDR 범위</th><th>설명</th><th>사용 상태</th><th>등록일</th><th>관리</th></tr></thead><tbody>
        {result.data!.items.map(row=><tr key={row.id}><td>{row.cidr}</td><td>{row.description||"-"}</td><td>{row.enabled?"사용":"사용 안 함"}</td><td>{new Date(row.createdAt).toLocaleDateString("ko-KR")}</td><td>{policy.canManage&&<div className="mg-flex"><ActionButton secondary disabled={busy} onClick={()=>setEdit(row)}>수정</ActionButton><ActionButton secondary disabled={busy} onClick={()=>void remove(row)}>삭제</ActionButton></div>}</td></tr>)}
        {!result.data!.items.length&&<tr><td colSpan={5}>등록한 IP 규칙이 없습니다.</td></tr>}
      </tbody></table></div>
      <div className="mg-flex"><span>총 {result.data!.total}개 · {result.data!.page}페이지</span><ActionButton secondary disabled={result.data!.page<=1||busy} onClick={()=>setPage(result.data!.page-1)}>이전</ActionButton><ActionButton secondary disabled={result.data!.page*result.data!.pageSize>=result.data!.total||busy} onClick={()=>setPage(result.data!.page+1)}>다음</ActionButton></div>
      </Panel>
      {edit!==undefined&&<RuleEditor key={edit?.id??"new"} row={edit} tenantId={policy.tenantId} currentIp={policy.currentIp} onClose={()=>setEdit(undefined)} onSaved={()=>{setEdit(undefined);setNotice("IP 규칙을 저장했습니다.");result.reload();}}/>}
      {confirm&&<Modal title={policy.enabled?"IP 접근 제한 끄기":"IP 접근 제한 켜기"} onClose={()=>{if(!busy)setConfirm(false);}}><form onSubmit={e=>{e.preventDefault();void toggle(String(new FormData(e.currentTarget).get("password")));}}>
        <p>{policy.enabled?"모든 접속 IP에서 회사 기능을 사용할 수 있게 됩니다.":"사용 중인 IP 규칙에 포함된 주소에서만 회사 기능을 사용할 수 있습니다."}</p>
        <label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password"/></label>
        {error&&<p role="alert">{error}</p>}{conflict&&<ActionButton secondary type="button" disabled={busy} onClick={()=>{setConfirm(false);setConflict(false);setError("");setNotice("최신 접근 제한 상태를 확인한 뒤 다시 변경해주세요.");result.reload();}}>최신 설정 불러오기</ActionButton>}
        <ActionButton disabled={busy||conflict} type="submit">설정 저장</ActionButton>
      </form></Modal>}
    </>}</>;
}
function RuleEditor({row,tenantId,currentIp,onClose,onSaved}:{row:IpRuleRecord|null;tenantId:string;currentIp:string|null;onClose:()=>void;onSaved:()=>void}) {
  const [cidr,setCidr]=useState(row?.cidr??""),[description,setDescription]=useState(row?.description??""),[enabled,setEnabled]=useState(row?.enabled??true),[version,setVersion]=useState(row?.version);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false);
  const [baseline,setBaseline]=useState({cidr:row?.cidr??"",description:row?.description??"",enabled:row?.enabled??true});
  const key=useRef<{payload:string;key:string}|undefined>(undefined),lock=useRef(false),ask=useConfirm();
  const dirty=cidr!==baseline.cidr||description!==baseline.description||enabled!==baseline.enabled;
  useUnsavedChanges(dirty||busy);
  async function discard(){return !dirty||await ask({title:"저장하지 않은 변경 사항",message:"작성한 IP 규칙 변경 내용을 버릴까요?",confirmLabel:"입력 버리기",cancelLabel:"계속 편집"});}
  async function close(){if(!lock.current&&await discard())onClose();}
  async function save() {
    if(lock.current||conflict)return;lock.current=true;setBusy(true);setError("");
    const payload=JSON.stringify({tenantId,cidr,description,enabled,...(row?{version}:{})});
    if(key.current?.payload!==payload)key.current={payload,key:crypto.randomUUID()};
    try {await api("/security/ip-rules"+(row?"/"+row.id:""),{method:row?"PATCH":"POST",headers:row?{}:{"Idempotency-Key":key.current.key},body:payload});onSaved();}
    catch(cause){setError(errorText(cause));setConflict(cause instanceof ApiError&&cause.code==="VERSION_CONFLICT");}finally{lock.current=false;setBusy(false);}
  }
  async function refresh() {
    if(!row||lock.current||!await discard()||lock.current)return;lock.current=true;setBusy(true);setError("");
    try {const latest=await api<IpRuleRecord>("/security/ip-rules/"+row.id);setCidr(latest.cidr);setDescription(latest.description);setEnabled(latest.enabled);setVersion(latest.version);setBaseline(latest);setConflict(false);}
    catch(cause){setError(errorText(cause));}finally{lock.current=false;setBusy(false);}
  }
  return <Modal title={row?"IP 규칙 수정":"IP 규칙 등록"} onClose={()=>{void close();}}><form onSubmit={e=>{e.preventDefault();void save();}}>
    {error&&<p role="alert">{error}</p>}
    <fieldset disabled={busy} className="policy-fields">
      <label>IP 주소 또는 CIDR 범위<input className="cs-input" required maxLength={80} value={cidr} onChange={e=>setCidr(e.target.value)} placeholder="192.0.2.1 또는 2001:db8::/64"/></label>
      {!row&&currentIp&&<ActionButton type="button" secondary onClick={()=>setCidr(currentIp)}>현재 접속 IP 입력</ActionButton>}
      <label>설명<textarea className="cs-input" maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>이 규칙 사용</label>
    </fieldset>{conflict&&<p>입력은 유지했습니다. 최신 규칙을 불러온 뒤 다시 편집해주세요.</p>}<div className="mg-flex">{row&&<ActionButton type="button" secondary disabled={busy} onClick={()=>void refresh()}>최신 규칙 불러오기</ActionButton>}<ActionButton type="submit" disabled={busy||conflict}>저장</ActionButton></div>
  </form></Modal>;
}
