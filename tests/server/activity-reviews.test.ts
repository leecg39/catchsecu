import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { notifyActivityReview, createActivityReview, actOnActivityReview, readActivityReview, listActivityReviews } from "@/server/activity-reviews";
import { reviewQuery } from "@/contracts/activity-reviews";
import { runOneJob } from "@/server/jobs";
import * as mailJobs from "@/server/jobs";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { POST as notifyRoute } from "@/app/api/v1/activity-reviews/[id]/notifications/route";
import { decrypt } from "@/server/crypto";
import { POST as createRoute, GET as listRoute } from "@/app/api/v1/activity-reviews/route";
import { GET as detailRoute } from "@/app/api/v1/activity-reviews/[id]/route";
import { POST as actionRoute } from "@/app/api/v1/activity-reviews/[id]/actions/route";
const clock=vi.hoisted(()=>({advance:false}));
vi.mock("@/server/audit",async original=>{
  const actual=await original<typeof import("@/server/audit")>();
  return {...actual,audit:async(...args:Parameters<typeof actual.audit>)=>{await actual.audit(...args);if(clock.advance&&args[3].startsWith("activity_review."))vi.setSystemTime(Date.now()+120_000);}};
});
const database=new URL(env.DATABASE_URL),origin=new URL(env.BETTER_AUTH_URL).origin;
if(database.pathname!=="/catchsecu_test"||!["localhost","127.0.0.1"].includes(database.hostname))throw Error("Isolated test database required");
const users:Record<string,string>={},cookies:Record<string,string>={},actors:Record<string,Context>={};
const password="Activity-review!123";let tenantId:string,serviceId:string,eventId:string;
function req(path:string,who="owner",input?:unknown,key=randomUUID()) {return new Request(origin+"/api/v1"+path,{method:input?"POST":"GET",headers:{origin,cookie:cookies[who]??"",...(input?{"content-type":"application/json","idempotency-key":key}:{})},...(input?{body:JSON.stringify(input)}:{})});}
beforeAll(async()=>{
 await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
 for(const who of ["owner","recipient","stranger"]){
  const email=`activity-${who}@example.test`;expect((await auth.handler(req("/auth/sign-up/email",who,{email,password,name:"검토 "+who}))).status).toBe(200);
  users[who]=(await db.user.update({where:{email},data:{emailVerified:true}})).id;
 }
});
beforeEach(async()=>{
 clock.advance=false;vi.useRealTimers();await db.rateLimit.deleteMany();await db.apiRateLimit.deleteMany();
 const company=await db.company.create({data:{name:"검토 회사",publicName:"검토",services:{create:{name:"검토 서비스",externalName:"검토"}}},include:{services:true}});tenantId=company.id;serviceId=company.services[0].id;
 for(const who of ["owner","recipient","stranger"]){
  await db.membership.create({data:{tenantId,userId:users[who],role:who==="owner"?"owner":"viewer"}});
  const login=await auth.handler(req("/auth/sign-in/email",who,{email:`activity-${who}@example.test`,password}));expect(login.status).toBe(200);
  cookies[who]=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  const session=await db.session.findFirstOrThrow({where:{userId:users[who]},orderBy:{createdAt:"desc"}});
  await db.session.update({where:{id:session.id},data:{activeCompanyId:tenantId}});
  actors[who]=await requireContext(req("/context",who).headers,"service.read");
 }
 eventId=(await db.auditEvent.create({data:{tenantId,serviceId,actorId:users.recipient,action:"submission.read",resource:"submission",resourceId:randomUUID(),requestId:randomUUID(),detail:{}}})).id;
});
afterAll(async()=>{clock.advance=false;vi.useRealTimers();await db.$disconnect();});
const input=()=>({auditEventId:eventId,title:"열람 사유 확인",message:"업무상 열람 사유를 확인해주세요."});
const create=()=>createActivityReview(actors.owner,input(),randomUUID(),randomUUID());
async function counts(){return {reviews:await db.activityReview.count({where:{tenantId}}),messages:await db.activityReviewMessage.count({where:{tenantId}}),audits:await db.auditEvent.count({where:{tenantId,action:{startsWith:"activity_review."}}}),keys:await db.idempotencyRecord.count({where:{OR:[{scope:{startsWith:"activity-review:create:"+tenantId+":"}},{scope:{startsWith:"activity-review:action:"+tenantId+":"}},{scope:{startsWith:"activity-review:notify:"+tenantId+":"}}]}})};}

test("HTTP 요청→본인 답변→담당자 처리 완료와 원문 암호화·감사 비노출",async()=>{
 const created=await createRoute(req("/activity-reviews","owner",input()));expect(created.status).toBe(201);const{id}=await created.json();
 expect(created.headers.get("Location")).toBe("/api/v1/activity-reviews/"+id);
 const received=await listRoute(req("/activity-reviews","recipient"));expect(received.status).toBe(200);expect((await received.json()).total).toBe(1);
 const detail=await detailRoute(req("/activity-reviews/"+id,"recipient"));expect((await detail.json()).canRespond).toBe(true);
 expect((await actionRoute(req(`/activity-reviews/${id}/actions`,"recipient",{version:1,action:"response",message:"담당 업무 처리 목적입니다."}))).status).toBe(200);
 expect((await actionRoute(req(`/activity-reviews/${id}/actions`,"owner",{version:2,action:"resolve",message:"답변을 확인했습니다."}))).status).toBe(200);
 const final=await readActivityReview(actors.recipient,id);expect(final).toMatchObject({status:"resolved",version:3,canRespond:false,canClose:false});expect(final.messages.map(m=>m.kind)).toEqual(["request","response","resolve"]);
 const stored=await db.activityReviewMessage.findMany({where:{tenantId,reviewId:id}});expect(stored).toHaveLength(3);expect(stored.every(m=>!m.bodyCipher.includes("확인"))).toBe(true);expect(stored.map(m=>decrypt<string>(m.bodyCipher))).toContain(input().message);
 const audit=await db.auditEvent.findMany({where:{tenantId,action:{startsWith:"activity_review."}}});expect(audit).toHaveLength(3);expect(JSON.stringify(audit)).not.toContain(input().message);
 expect((await db.auditEvent.findUniqueOrThrow({where:{id:eventId}})).action).toBe("submission.read");
});
test("타인 상세/목록·대리 답변·대상자 종결·일반회원 생성 차단",async()=>{
 const {body:{id}}=await create();
 expect((await listActivityReviews(actors.stranger,reviewQuery.parse({}))).total).toBe(0);
 await expect(readActivityReview(actors.stranger,id)).rejects.toMatchObject({status:404});
 await expect(actOnActivityReview(actors.owner,id,{version:1,action:"response",message:"대리"},randomUUID(),randomUUID())).rejects.toMatchObject({status:403});
 await expect(actOnActivityReview(actors.recipient,id,{version:1,action:"cancel",message:"취소"},randomUUID(),randomUUID())).rejects.toMatchObject({status:403});
 await expect(createActivityReview(actors.recipient,input(),randomUUID(),randomUUID())).rejects.toMatchObject({status:403});
 await expect(listActivityReviews(actors.recipient,reviewQuery.parse({scope:"company"}))).rejects.toMatchObject({status:403});
});
test("같은 생성 키는 한 번만 저장하고 다른 본문/같은 사건의 열린 요청은409",async()=>{
 const key=randomUUID();const call=()=>createActivityReview(actors.owner,input(),key,randomUUID());
 const [a,b]=await Promise.all([call(),call()]);expect(a.body.id).toBe(b.body.id);
 await expect(createActivityReview(actors.owner,{...input(),message:"다른 본문"},key,randomUUID())).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_MISMATCH"});
 await expect(create()).rejects.toMatchObject({status:409,code:"REVIEW_ALREADY_OPEN"});
 expect(await db.activityReview.count({where:{tenantId}})).toBe(1);expect(await db.activityReviewMessage.count({where:{tenantId}})).toBe(1);
});
test("서로 다른 키의 동시 생성도 열린 요청 한 건만 저장한다",async()=>{
 const result=await Promise.allSettled([create(),create()]);expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(result.find(r=>r.status==="rejected")).toMatchObject({reason:{status:409}});
 expect(await db.activityReview.count({where:{tenantId}})).toBe(1);
});
test("동시 답변 중 한 번만 저장하고 같은 키 재시도는 같은 메시지를 돌려준다",async()=>{
 const {body:{id}}=await create(),key=randomUUID(),data={version:1,action:"response" as const,message:"설명"};
 const first=await actOnActivityReview(actors.recipient,id,data,key,randomUUID());
 expect((await actOnActivityReview(actors.recipient,id,data,key,randomUUID())).body).toEqual(first.body);
 await expect(actOnActivityReview(actors.recipient,id,data,randomUUID(),randomUUID())).rejects.toMatchObject({status:409,code:"VERSION_CONFLICT"});
 expect(await db.activityReviewMessage.count({where:{reviewId:id}})).toBe(2);
});
test("실제 동시 답변은 version 잠금으로 한 번만 반영한다",async()=>{
 const{body:{id}}=await create(),data={version:1,action:"response" as const,message:"동시 답변"};
 const result=await Promise.allSettled([actOnActivityReview(actors.recipient,id,data,randomUUID(),randomUUID()),actOnActivityReview(actors.recipient,id,data,randomUUID(),randomUUID())]);
 expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(result.find(r=>r.status==="rejected")).toMatchObject({reason:{status:409,code:"VERSION_CONFLICT"}});
});
test("답변 전 처리 완료와 취소 후 답변을 거부한다",async()=>{
 const{body:{id}}=await create();
 await expect(actOnActivityReview(actors.owner,id,{version:1,action:"resolve",message:"종결"},randomUUID(),randomUUID())).rejects.toMatchObject({status:409,code:"INVALID_REVIEW_TRANSITION"});
 await actOnActivityReview(actors.owner,id,{version:1,action:"cancel",message:"잘못 요청"},randomUUID(),randomUUID());
 await expect(actOnActivityReview(actors.recipient,id,{version:2,action:"response",message:"설명"},randomUUID(),randomUUID())).rejects.toMatchObject({status:409,code:"INVALID_REVIEW_TRANSITION"});
 expect((await create()).status).toBe(201);
});
test("서비스 보관 후 변경과 성공 캐시 재사용을 거부한다",async()=>{
 const key=randomUUID(),first=await createActivityReview(actors.owner,input(),key,randomUUID());
 await db.service.update({where:{id:serviceId},data:{status:"archived"}});
 expect((await readActivityReview(actors.recipient,first.body.id)).canRespond).toBe(false);
 await expect(createActivityReview(actors.owner,input(),key,randomUUID())).rejects.toMatchObject({status:409,code:"SERVICE_ARCHIVED"});
 await expect(actOnActivityReview(actors.recipient,first.body.id,{version:1,action:"response",message:"설명"},randomUUID(),randomUUID())).rejects.toMatchObject({status:409});
});
test("세션 회수 후 상세·목록·캐시 요청을 모두 거부한다",async()=>{
 const key=randomUUID(),first=await createActivityReview(actors.owner,input(),key,randomUUID());
 await db.session.delete({where:{id:actors.owner.session.id}});
 for(const call of [()=>readActivityReview(actors.owner,first.body.id),()=>listActivityReviews(actors.owner,reviewQuery.parse({scope:"sent"})),()=>createActivityReview(actors.owner,input(),key,randomUUID())])await expect(call()).rejects.toMatchObject({status:401});
});
test("정책 변경과 다른 회사로 전환한 Context를 거부한다",async()=>{
 const{body:{id}}=await create();
 await db.securityPolicy.create({data:{tenantId,requireMfa:true,passwordMonths:0}});
 await expect(readActivityReview(actors.recipient,id)).rejects.toMatchObject({status:403,code:"MFA_REQUIRED"});
 await db.securityPolicy.update({where:{tenantId},data:{requireMfa:false}});
 const other=await db.company.create({data:{name:"다른",publicName:"다른"}});await db.session.update({where:{id:actors.recipient.session.id},data:{activeCompanyId:other.id}});
 await expect(readActivityReview(actors.recipient,id)).rejects.toMatchObject({status:403,code:"COMPANY_CHANGED"});
});
for(const operation of ["create","respond"] as const)test(`${operation}: 감사 이후 만료 시 요청·메시지·감사·요청키 롤백`,async()=>{
 const id=operation==="respond"?(await create()).body.id:"",actor=actors[operation==="create"?"owner":"recipient"];
 const before=await counts();await db.session.update({where:{id:actor.session.id},data:{expiresAt:new Date(Date.now()+60_000)}});
 vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
 const call=operation==="create"?create:()=>actOnActivityReview(actor,id,{version:1,action:"response",message:"만료 설명"},randomUUID(),randomUUID());
 await expect(call()).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});expect(await counts()).toEqual(before);
 if(id)expect((await db.activityReview.findUniqueOrThrow({where:{id}})).status).toBe("requested");
});
test("검색/상태/기간/페이지 보정과 본문 없는 목록",async()=>{
 const{body:{id}}=await create();
 const list=await listActivityReviews(actors.recipient,reviewQuery.parse({search:"사유",page:999,pageSize:1,status:"requested",from:new Date(Date.now()-60000).toISOString()}));
 expect(list).toMatchObject({total:1,page:1,pageSize:1});expect(list.items[0].id).toBe(id);expect(JSON.stringify(list)).not.toContain(input().message);
 expect((await listActivityReviews(actors.recipient,reviewQuery.parse({status:"resolved"}))).total).toBe(0);
});
test("타 회사 사건/본인 사건/활성 아닌 수신자/서비스 권한 누락을 거부한다",async()=>{
 const other=await db.company.create({data:{name:"타회사",publicName:"타회사"}});
 const event=await db.auditEvent.create({data:{tenantId:other.id,actorId:users.recipient,action:"submission.read",resource:"submission",requestId:randomUUID(),detail:{}}});
 await expect(createActivityReview(actors.owner,{...input(),auditEventId:event.id},randomUUID(),randomUUID())).rejects.toMatchObject({status:422});
 const self=await db.auditEvent.create({data:{tenantId,serviceId,actorId:users.owner,action:"submission.read",resource:"submission",requestId:randomUUID(),detail:{}}});
 await expect(createActivityReview(actors.owner,{...input(),auditEventId:self.id},randomUUID(),randomUUID())).rejects.toMatchObject({code:"REVIEW_SELF_REQUEST"});
 await db.membership.update({where:{id:actors.stranger.member.id},data:{role:"owner"}});
 await db.membership.update({where:{id:actors.owner.member.id},data:{role:"security"}});
 await expect(create()).rejects.toMatchObject({status:403});
 await db.serviceGrant.create({data:{tenantId,memberId:actors.owner.member.id,serviceId,capabilities:["service.read","audit.read","security.write"]}});
 await db.membership.update({where:{id:actors.recipient.member.id},data:{status:"suspended"}});
 await expect(create()).rejects.toMatchObject({code:"REVIEW_RECIPIENT_UNAVAILABLE"});
});
test("DB 교차 회사/처리자 참조·메시지 수정·불법 상태 전이를 거부한다",async()=>{
 const{body:{id}}=await create();const row=await db.activityReview.findUniqueOrThrow({where:{id}});
 await expect(db.activityReview.create({data:{...row,id:randomUUID(),status:"cancelled",closedAt:new Date(),recipientUserId:users.stranger}})).rejects.toMatchObject({code:"P2003"});
 const other=await db.company.create({data:{name:"FK 타회사",publicName:"FK 타회사"}});
 await expect(db.activityReview.create({data:{...row,id:randomUUID(),tenantId:other.id,status:"cancelled",closedAt:new Date()}})).rejects.toMatchObject({code:"P2003"});
 const second=await db.service.create({data:{tenantId,name:"FK 다른 서비스",externalName:"다른 서비스"}});
 await expect(db.activityReview.create({data:{...row,id:randomUUID(),serviceId:second.id,status:"cancelled",closedAt:new Date()}})).rejects.toMatchObject({code:"P2003"});
 const message=await db.activityReviewMessage.findFirstOrThrow({where:{reviewId:id}});
 await expect(db.activityReviewMessage.update({where:{id:message.id},data:{bodyCipher:"changed"}})).rejects.toThrow();
 await expect(db.activityReview.update({where:{id},data:{status:"resolved",version:2,respondedAt:new Date(),closedAt:new Date()}})).rejects.toThrow();
});

test("요청을 저장하는 동안 대상 전문가 배정이 만료되면 전체를 롤백한다",async()=>{
 const assignment=await db.expertAssignment.create({data:{tenantId,expertUserId:users.recipient,assignedById:users.owner,expiresAt:new Date(Date.now()+60_000),services:{create:{serviceId}}}});
 await db.membership.update({where:{id:actors.recipient.member.id},data:{accessKind:"expert",expertAssignmentId:assignment.id}});
 const before=await counts();vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
 await expect(create()).rejects.toMatchObject({status:422,code:"REVIEW_RECIPIENT_UNAVAILABLE"});expect(await counts()).toEqual(before);
});

test("타 회사의 같은 사용자도 다른 회사 검토 상세를 읽지 못한다",async()=>{
 const{body:{id}}=await create();
 const other=await db.company.create({data:{name:"별도회사",publicName:"별도",memberships:{create:{userId:users.owner,role:"owner"}}}});
 await db.session.update({where:{id:actors.owner.session.id},data:{activeCompanyId:other.id}});
 const ctx=await requireContext(req("/context").headers,"service.read");
 await expect(readActivityReview(ctx,id)).rejects.toMatchObject({status:404});
 expect((await listActivityReviews(ctx,reviewQuery.parse({scope:"company"}))).total).toBe(0);
});
test("보안 담당자의 서비스 권한 회수는 기존 요청 상세·처리도 차단한다",async()=>{
 await db.membership.update({where:{id:actors.stranger.member.id},data:{role:"owner"}});
 await db.membership.update({where:{id:actors.owner.member.id},data:{role:"security"}});
 await db.serviceGrant.create({data:{tenantId,memberId:actors.owner.member.id,serviceId,capabilities:["service.read","audit.read","security.write"]}});
 const{body:{id}}=await create();await db.serviceGrant.deleteMany({where:{memberId:actors.owner.member.id,serviceId}});
 await expect(readActivityReview(actors.owner,id)).rejects.toMatchObject({status:404});
 await expect(actOnActivityReview(actors.owner,id,{version:1,action:"cancel",message:"취소"},randomUUID(),randomUUID())).rejects.toMatchObject({status:404});
});
test("HTTP 인증·입력·요청키 계약을 검사한다",async()=>{
 expect((await listRoute(req("/activity-reviews","anonymous"))).status).toBe(401);
 expect((await createRoute(req("/activity-reviews","owner",{...input(),recipientId:users.stranger}))).status).toBe(422);
 const noKey=req("/activity-reviews","owner",input());noKey.headers.delete("idempotency-key");expect((await createRoute(noKey)).status).toBe(400);
 expect((await listRoute(req("/activity-reviews?pageSize=101","owner"))).status).toBe(422);
});

test("전문가 뷰어의 추가 grant는 검토 생성 권한을 부여하지 않는다",async()=>{
 await db.membership.update({where:{id:actors.stranger.member.id},data:{role:"owner"}});
 const assignment=await db.expertAssignment.create({data:{tenantId,expertUserId:users.owner,assignedById:users.stranger,expiresAt:new Date(Date.now()+600000),services:{create:{serviceId}}}});
 await db.membership.update({where:{id:actors.owner.member.id},data:{role:"viewer",accessKind:"expert",expertAssignmentId:assignment.id}});
 const grant=await db.serviceGrant.create({data:{tenantId,memberId:actors.owner.member.id,serviceId,capabilities:["service.read"]}});
 await expect(create()).rejects.toMatchObject({status:403});
 await db.serviceGrant.update({where:{id:grant.id},data:{capabilities:["service.read","audit.read","security.write"]}});
 await expect(create()).rejects.toMatchObject({status:403});
});

const notify=(id:string,key=randomUUID())=>notifyActivityReview(actors.owner,id,{version:1},key,randomUUID());
test("알림은 명시적 요청 한 건만 생성하고 로컬 전달과 외부 수신을 구분한다",async()=>{
 const {body:{id}}=await create();expect((await readActivityReview(actors.owner,id)).notification).toBeNull();
 const key=randomUUID();const first=await notifyRoute(req(`/activity-reviews/${id}/notifications`,"owner",{version:1},key));expect(first.status).toBe(202);const receipt=await first.json();
 expect((await notify(id,key)).body).toEqual(receipt);await expect(notify(id)).rejects.toMatchObject({status:409,code:"REVIEW_NOTIFICATION_EXISTS"});
 expect((await readActivityReview(actors.owner,id))).toMatchObject({canNotify:false,notification:{status:"queued"}});
 expect(await runOneJob("review-mail-test",{tenantId,jobId:receipt.jobId})).toBe(true);
 expect((await readActivityReview(actors.owner,id)).notification?.status).toBe("local_delivered");
 const output=JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR,receipt.jobId+".json"),"utf8"));
 expect(output.to).toBe("activity-recipient@example.test");expect(output.text).toContain("reviewId="+id);expect(output.text).not.toContain(input().message);expect(output.subject).not.toContain(input().title);
 expect(await db.activityReviewMessage.count({where:{reviewId:id}})).toBe(1);expect((await db.activityReview.findUniqueOrThrow({where:{id}})).version).toBe(1);
});
test("알림은 대상자·타인·다른 회사·오래된 version·답변 후 요청을 거부한다",async()=>{
 const {body:{id}}=await create();
 await expect(notifyActivityReview(actors.recipient,id,{version:1},randomUUID(),randomUUID())).rejects.toMatchObject({status:403});
 await expect(notifyActivityReview(actors.stranger,id,{version:1},randomUUID(),randomUUID())).rejects.toMatchObject({status:404});
 await expect(notifyActivityReview(actors.owner,id,{version:2},randomUUID(),randomUUID())).rejects.toMatchObject({status:409});
 await actOnActivityReview(actors.recipient,id,{version:1,action:"response",message:"설명"},randomUUID(),randomUUID());
 await expect(notifyActivityReview(actors.owner,id,{version:2},randomUUID(),randomUUID())).rejects.toMatchObject({status:409,code:"REVIEW_NOTIFICATION_CLOSED"});
});
for(const mutation of ["answered","recipientSuspended","emailChanged","issuerRevoked","archived","transportChanged"] as const)test(`대기 알림 ${mutation} 변경 후 실제 전송 차단`,async()=>{
 const {body:{id}}=await create(),{body:{jobId}}=await notify(id);
 if(mutation==="answered")await actOnActivityReview(actors.recipient,id,{version:1,action:"response",message:"먼저 답변"},randomUUID(),randomUUID());
 if(mutation==="recipientSuspended")await db.membership.update({where:{id:actors.recipient.member.id},data:{status:"suspended"}});
 if(mutation==="emailChanged")await db.user.update({where:{id:users.recipient},data:{email:"changed@example.test"}});
 if(mutation==="issuerRevoked"){await db.membership.update({where:{id:actors.stranger.member.id},data:{role:"owner"}});await db.membership.update({where:{id:actors.owner.member.id},data:{role:"viewer"}});}
 if(mutation==="archived")await db.service.update({where:{id:serviceId},data:{status:"archived"}});
 const originalTransport=env.MAIL_TRANSPORT;if(mutation==="transportChanged")env.MAIL_TRANSPORT="smtp";
 try{expect(await runOneJob("review-mail-test",{tenantId,jobId})).toBe(true);}finally{env.MAIL_TRANSPORT=originalTransport;if(mutation==="emailChanged")await db.user.update({where:{id:users.recipient},data:{email:"activity-recipient@example.test"}});}
 expect((await db.job.findUniqueOrThrow({where:{id:jobId}})).status).toBe("cancelled");
 await expect(access(resolve(env.LOCAL_MAIL_DIR,jobId+".json"))).rejects.toBeDefined();
});
test("알림 요청의 최종 세션 기한은 Job·감사·요청 키를 원자 롤백한다",async()=>{
 const {body:{id}}=await create(),before=await counts();
 await db.session.update({where:{id:actors.owner.session.id},data:{expiresAt:new Date(Date.now()+60_000)}});vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
 await expect(notify(id)).rejects.toMatchObject({status:401});expect(await counts()).toEqual(before);expect(await db.job.count({where:{tenantId,type:"mail.activity-review.v1"}})).toBe(0);
});
test("성공 알림 재요청도 현재 세션/수신자와 삭제된 원문 상태를 확인한다",async()=>{
 const{body:{id}}=await create(),key=randomUUID(),{body:{jobId}}=await notify(id,key);
 await db.membership.update({where:{id:actors.recipient.member.id},data:{status:"suspended"}});await expect(notify(id,key)).rejects.toMatchObject({status:422});
 await db.membership.update({where:{id:actors.recipient.member.id},data:{status:"active"}});
 await db.job.update({where:{id:jobId},data:{status:"cancelled",payloadErasedAt:new Date(),payloadCipher:""}});
 await expect(notify(id,key)).rejects.toMatchObject({status:410});expect((await readActivityReview(actors.owner,id)).notification?.status).toBe("expired");
});

test("서로 다른 키의 동시 알림도 한 번만 접수한다",async()=>{
 const{body:{id}}=await create();const results=await Promise.allSettled([notify(id),notify(id)]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.find(r=>r.status==="rejected")).toMatchObject({reason:{status:409}});
 expect(await db.job.count({where:{tenantId,type:"mail.activity-review.v1"}})).toBe(1);
});
test("알림도 임의 이메일 입력·미인증·누락 요청 키를 거부한다",async()=>{
 const{body:{id}}=await create();
 expect((await notifyRoute(req(`/activity-reviews/${id}/notifications`,"owner",{version:1,to:"other@example.test"}))).status).toBe(422);
 expect((await notifyRoute(req(`/activity-reviews/${id}/notifications`,"anonymous",{version:1}))).status).toBe(401);
 const request=req(`/activity-reviews/${id}/notifications`,"owner",{version:1});request.headers.delete("idempotency-key");expect((await notifyRoute(request)).status).toBe(400);
});
test("실제 메일 공개 직전 전문가 기한 만료를 다시 검사한다",async()=>{
 const {body:{id}}=await create();
 const assignment=await db.expertAssignment.create({data:{tenantId,expertUserId:users.recipient,assignedById:users.owner,expiresAt:new Date(Date.now()+60_000),services:{create:{serviceId}}}});
 await db.membership.update({where:{id:actors.recipient.member.id},data:{accessKind:"expert",expertAssignmentId:assignment.id}});
 const {body:{jobId}}=await notify(id);
 const original=mailJobs.deliverMail;
 const spy=vi.spyOn(mailJobs,"deliverMail").mockImplementation(async(job,mail,sender,beforeDispatch)=>{
   vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+120_000);
   try{return await original(job,mail,sender,beforeDispatch);}finally{vi.useRealTimers();}
 });
 try {expect(await runOneJob("review-mail-test",{tenantId,jobId})).toBe(true);}finally{spy.mockRestore();}
 expect((await db.job.findUniqueOrThrow({where:{id:jobId}})).status).toBe("cancelled");
 await expect(access(resolve(env.LOCAL_MAIL_DIR,jobId+".json"))).rejects.toBeDefined();
});
