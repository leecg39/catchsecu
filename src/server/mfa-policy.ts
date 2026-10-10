import type { z } from "zod";
import type { MfaException } from "@/generated/prisma/client";
import type { mfaMemberQuery, mfaExceptionCreate, mfaExceptionPatch } from "@/contracts/mfa-policy";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { decrypt, encrypt } from "./crypto";
import { fail, requireVersion } from "./http";
import { audit } from "./audit";
import { idempotent } from "./idempotency";
import { lockSecurityEntitlements } from "./feature-entitlements";
const maxLifetime = 86400000;
function tenant(ctx: Context, tenantId: string) { if (tenantId !== ctx.tenantId) fail(409,"COMPANY_CHANGED","선택한 회사가 변경되었습니다."); }
function dto(row: MfaException) { return { id:row.id,tenantId:row.tenantId,memberId:row.memberId,reason:decrypt<string>(row.reasonCipher),expiresAt:row.expiresAt.toISOString(),createdAt:row.createdAt.toISOString(),version:row.version,active:row.expiresAt>new Date() }; }
async function locked(tx: Transaction, ctx: Context, write=false) {
  if (write) await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE',ctx.tenantId);
  const actor=await lockServiceActor(tx,ctx,write?"security.write":"security.read");
  if (actor.member.accessKind!=="direct") fail(403,"FORBIDDEN","직접 소속 구성원만 회사 2단계 인증 정책을 관리할 수 있습니다.");
  const user=await tx.user.findUniqueOrThrow({where:{id:ctx.user.id}});
  if(write&&actor.member.role!=="owner") fail(403,"FORBIDDEN","최상위 관리자만 변경할 수 있습니다.");
  if(write&&!user.twoFactorEnabled) fail(409,"MFA_SETUP_REQUIRED","관리자 본인의 2단계 인증을 먼저 등록해주세요.");
  const access=await lockSecurityEntitlements(tx,ctx.tenantId);
  if(write)access.assert("security.mfa_management");
  return {...actor,user,access};
}
function expiry(value:string,createdAt=new Date()) {
  const result=new Date(value),now=new Date();
  if(result<=now||result.getTime()>createdAt.getTime()+maxLifetime) fail(422,"MFA_EXCEPTION_EXPIRY","예외 기한은 미래이며 최초 등록부터 최대 24시간이어야 합니다.");
  return result;
}
async function target(tx:Transaction,ctx:Context,id:string) {
  const member=await tx.membership.findFirst({where:{id,tenantId:ctx.tenantId,status:"active",accessKind:"direct",user:{status:"active",emailVerified:true}},include:{user:true}});
  if(!member)fail(404,"NOT_FOUND","현재 회사의 활성 구성원을 찾을 수 없습니다.");
  if(member.user.twoFactorEnabled)fail(409,"MFA_ALREADY_ENABLED","이미 2단계 인증을 등록한 구성원입니다.");
  return member;
}
export async function listMfaMembers(ctx:Context,query:z.infer<typeof mfaMemberQuery>) {
  return db.$transaction(async tx=>{
    const actor=await locked(tx,ctx),now=new Date(),where={tenantId:ctx.tenantId,status:"active",accessKind:"direct",user:{status:"active",emailVerified:true}};
    const members=await tx.membership.findMany({where,include:{user:{select:{name:true,email:true,twoFactorEnabled:true}},mfaException:true},orderBy:[{createdAt:"asc"},{id:"asc"}]});
    const filtered=members.filter(m=>(!query.search||(m.user.name+" "+m.user.email).toLowerCase().includes(query.search.toLowerCase()))&&(query.status==="all"||(query.status==="enabled"?m.user.twoFactorEnabled:query.status==="exception"?!m.user.twoFactorEnabled&&!!m.mfaException&&m.mfaException.expiresAt>now:!m.user.twoFactorEnabled&&(!m.mfaException||m.mfaException.expiresAt<=now))));
    const total=filtered.length,page=Math.min(query.page,Math.max(1,Math.ceil(total/query.pageSize))),policy=await tx.securityPolicy.findUniqueOrThrow({where:{tenantId:ctx.tenantId}});
    const enrolled=members.filter(m=>m.user.twoFactorEnabled).length,exceptions=members.filter(m=>!m.user.twoFactorEnabled&&m.mfaException&&m.mfaException.expiresAt>now).length;
    const result={policy:{tenantId:ctx.tenantId,required:policy.requireMfa,version:policy.version,canManage:actor.member.role==="owner"&&actor.user.twoFactorEnabled&&actor.access.snapshot()["security.mfa_management"].available,actorEnrolled:actor.user.twoFactorEnabled,entitlement:actor.access.snapshot()["security.mfa_management"]},items:filtered.slice((page-1)*query.pageSize,page*query.pageSize).map(m=>({id:m.id,name:m.user.name,email:m.user.email,role:m.role,enrolled:m.user.twoFactorEnabled,exception:m.mfaException?dto(m.mfaException):null})),total,page,pageSize:query.pageSize,summary:{members:members.length,enrolled,exceptions,missing:members.length-enrolled-exceptions}};
    assertFileDeadlines(actor.deadlines);return result;
  },{timeout:15000});
}
export async function readMfaException(ctx:Context,id:string) {
  return db.$transaction(async tx=>{const actor=await locked(tx,ctx),row=await tx.mfaException.findFirst({where:{id,tenantId:ctx.tenantId}});if(!row)fail(404,"NOT_FOUND","임시 예외를 찾을 수 없습니다.");assertFileDeadlines(actor.deadlines);return dto(row);});
}
export async function changeMfaPolicy(ctx:Context,input:{tenantId:string;version:number;required:boolean},requestId:string) {
  tenant(ctx,input.tenantId);
  return db.$transaction(async tx=>{
    const actor=await locked(tx,ctx,true),policy=await tx.securityPolicy.findUniqueOrThrow({where:{tenantId:ctx.tenantId}});
    requireVersion(input,policy);
    const row=await tx.securityPolicy.update({where:{tenantId:ctx.tenantId},data:{requireMfa:input.required,version:{increment:1}}});
    await audit(tx,ctx,requestId,"mfa_policy.updated","securityPolicy",ctx.tenantId,["requireMfa"]);
    assertFileDeadlines(actor.deadlines);actor.access.assert("security.mfa_management");return {tenantId:ctx.tenantId,required:row.requireMfa,version:row.version};
  },{timeout:15000});
}
export async function createMfaException(ctx:Context,input:Omit<z.infer<typeof mfaExceptionCreate>,"password">,key:string|null,requestId:string) {
  tenant(ctx,input.tenantId);let featureCheck:(()=>void)|undefined;let deadlines:Awaited<ReturnType<typeof lockServiceActor>>["deadlines"]|undefined;
  return idempotent("mfa-exception:create:"+ctx.tenantId+":"+ctx.user.id,key,input,async tx=>{
    const actor=await locked(tx,ctx,true);deadlines=actor.deadlines;featureCheck=()=>actor.access.assert("security.mfa_management");await target(tx,ctx,input.memberId);
    if(input.memberId===ctx.member.id)fail(409,"MFA_SELF_EXCEPTION","본인의 예외는 다른 최상위 관리자가 등록해야 합니다.");
    if(await tx.mfaException.findUnique({where:{tenantId_memberId:{tenantId:ctx.tenantId,memberId:input.memberId}}}))fail(409,"MFA_EXCEPTION_EXISTS","기존 예외를 수정하거나 삭제해주세요.");
    const createdAt=new Date(),expiresAt=expiry(input.expiresAt,createdAt);
    const row=await tx.mfaException.create({data:{tenantId:ctx.tenantId,memberId:input.memberId,createdById:ctx.member.id,reasonCipher:encrypt(input.reason),expiresAt,createdAt}});
    await audit(tx,ctx,requestId,"mfa_exception.created","mfaException",row.id,["memberId","expiresAt"]);
    return {status:201,body:dto(row),resource:{tenantId:ctx.tenantId,resourceType:"mfa-exception" as const,resourceId:row.id}};
  },async tx=>{const actor=await locked(tx,ctx,true);deadlines=actor.deadlines;featureCheck=()=>actor.access.assert("security.mfa_management");},async(tx,cached)=>{
    const row=await tx.mfaException.findFirst({where:{id:cached.id,tenantId:ctx.tenantId}});
    if(!row||row.expiresAt<=new Date())fail(410,"MFA_EXCEPTION_EXPIRED","삭제되었거나 만료된 예외 요청입니다.");
    await target(tx,ctx,row.memberId);return dto(row);
  },async()=>{if(deadlines)assertFileDeadlines(deadlines);featureCheck?.();});
}
export async function updateMfaException(ctx:Context,id:string,input:Omit<z.infer<typeof mfaExceptionPatch>,"password">,requestId:string) {
  tenant(ctx,input.tenantId);return db.$transaction(async tx=>{
    const actor=await locked(tx,ctx,true),row=await tx.mfaException.findFirst({where:{id,tenantId:ctx.tenantId}});
    if(!row)fail(404,"NOT_FOUND","임시 예외를 찾을 수 없습니다.");requireVersion(input,row);await target(tx,ctx,row.memberId);
    const expiresAt=expiry(input.expiresAt,row.createdAt),saved=await tx.mfaException.update({where:{id},data:{reasonCipher:encrypt(input.reason),expiresAt,version:{increment:1}}});
    await audit(tx,ctx,requestId,"mfa_exception.updated","mfaException",id,["reason","expiresAt"]);
    assertFileDeadlines(actor.deadlines);actor.access.assert("security.mfa_management");return dto(saved);
  },{timeout:15000});
}
export async function deleteMfaException(ctx:Context,id:string,input:{tenantId:string;version:number},requestId:string) {
  tenant(ctx,input.tenantId);await db.$transaction(async tx=>{
    const actor=await locked(tx,ctx,true),row=await tx.mfaException.findFirst({where:{id,tenantId:ctx.tenantId}});
    if(!row)fail(404,"NOT_FOUND","임시 예외를 찾을 수 없습니다.");requireVersion(input,row);
    await tx.mfaException.delete({where:{id}});
    await tx.idempotencyRecord.updateMany({where:{tenantId:ctx.tenantId,resourceType:"mfa-exception",resourceId:id},data:{responseCipher:null,requestHash:null,invalidatedAt:new Date()}});
    await audit(tx,ctx,requestId,"mfa_exception.deleted","mfaException",id,[]);
    assertFileDeadlines(actor.deadlines);actor.access.assert("security.mfa_management");
  },{timeout:15000});
}

export async function securityStatus(ctx:Context) {
  return db.$transaction(async tx=>{
    const actor=await locked(tx,ctx),now=new Date();
    const policy=await tx.securityPolicy.findUniqueOrThrow({where:{tenantId:ctx.tenantId}});
    const members=await tx.membership.findMany({where:{tenantId:ctx.tenantId,status:"active",accessKind:"direct",user:{status:"active",emailVerified:true}},include:{user:{select:{twoFactorEnabled:true,twoFactors:{where:{verified:true},select:{id:true}}}},mfaException:true}});
    const ip=await tx.ipAccessPolicy.findUnique({where:{tenantId:ctx.tenantId}}),rules=await tx.ipRule.count({where:{tenantId:ctx.tenantId,enabled:true}});
    const missing=members.filter(m=>!m.user.twoFactorEnabled&&(!m.mfaException||m.mfaException.expiresAt<=now)).length;
    const recoverableOwners=members.filter(m=>m.role==="owner"&&m.user.twoFactorEnabled&&m.user.twoFactors.length>0).length;
    const activeExceptions=members.filter(m=>!m.user.twoFactorEnabled&&m.mfaException&&m.mfaException.expiresAt>now).length;
    const checks=[
      {id:"company-mfa",title:"회사 2단계 인증 강제",passed:policy.requireMfa,detail:policy.requireMfa?"회사 요청에서 인증 등록을 검사합니다.":"인증 강제가 꺼져 있습니다.",actionLabel:"회사 인증 정책",href:"/security/two-factor/setting"},
      {id:"member-mfa",title:"구성원 인증 등록",passed:missing===0,detail:"미등록·예외 없는 구성원 "+missing+"명, 유효 예외 "+activeExceptions+"명",actionLabel:"등록 현황과 예외",href:"/security/two-factor"},
      {id:"owner-recovery",title:"인증 관리자의 복구 수단",passed:recoverableOwners>0,detail:"검증된 인증을 등록한 최상위 관리자 "+recoverableOwners+"명. 본인 복구코드는 개인 인증 화면에서 관리합니다.",actionLabel:"개인 인증·복구코드",href:"/two-step-setting"},
      {id:"additional-owner",title:"추가 복구 관리자",passed:recoverableOwners>=2,detail:recoverableOwners>=2?"다른 인증 관리자에게 임시 복구 예외를 요청할 수 있습니다.":"인증 관리자 1명의 복구코드를 잃으면 추가 관리자에게 복구를 요청할 수 없습니다.",actionLabel:"구성원과 소유권 관리",href:"/set/member"},
      {id:"ip-access",title:"IP 접근 제한",passed:!!ip?.enabled&&rules>0,detail:ip?.enabled?"사용 중인 허용 범위 "+rules+"개":"IP 접근 제한이 꺼져 있습니다.",actionLabel:"IP 접근 설정",href:"/security/ip/setting"},
      {id:"password",title:"최소 비밀번호 길이",passed:policy.minPassword>=12,detail:"현재 회사의 최소 길이는 "+policy.minPassword+"자입니다.",actionLabel:"회사 보안 정책",href:"/set/company/policy"},
      {id:"session",title:"세션 유지 정책",passed:policy.sessionMinutes>=30&&policy.sessionMinutes<=120,detail:"미사용 세션 기한 "+policy.sessionMinutes+"분, 절대 로그인 만료 7일",actionLabel:"회사 보안 정책",href:"/set/company/policy"}
    ];
    assertFileDeadlines(actor.deadlines);
    return {tenantId:ctx.tenantId,entitlements:actor.access.snapshot(),checkedAt:now.toISOString(),checks,attention:checks.filter(c=>!c.passed).length,scope:"현재 회사의 실제 설정과 등록 상태"};
  },{timeout:15000});
}
