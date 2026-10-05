import { randomUUID } from "node:crypto";
import { afterAll,beforeEach,expect,test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { createForm,listForms,readForm,requireForm } from "@/server/forms";
import { formInput } from "@/contracts/domains";
import { listQuery } from "@/server/http";
import { POST as create, GET as list } from "@/app/api/v1/forms/route";
import { POST as templateUse } from "@/app/api/v1/templates/[...segments]/route";
import { POST as purposeCreate } from "@/app/api/v1/processing-purposes/route";
import { POST as documentCreate } from "@/app/api/v1/documents/route";
import { POST as documentAction } from "@/app/api/v1/documents/[...segments]/route";
import { GET,PATCH,POST as action,DELETE,PUT } from "@/app/api/v1/forms/[...segments]/route";
import { DELETE as cancelApproval } from "@/app/api/v1/approvals/[...segments]/route";
import { encrypt } from "@/server/crypto";

const database=new URL(env.DATABASE_URL);
if (database.pathname!=="/catchsecu_test" || !["localhost","127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin=new URL(env.BETTER_AUTH_URL).origin,password="Form-list-delete!123";
function req(path:string,cookie="",method="GET",input?:unknown,key?:string,version?:number) {
  return new Request(origin+"/api/v1"+path,{ method,headers:{ origin,cookie,...(input===undefined ? {}:{ "content-type":"application/json" }),
    ...(key ? { "idempotency-key":key }:{}),...(version ? { "if-match":String(version) }:{} ) },...(input===undefined ? {}:{ body:JSON.stringify(input) }) });
}
async function account(tenantId:string,role:"owner"|"editor") {
  const email="list-delete-"+randomUUID()+"@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email","","POST",{ name:"목록 검증 "+role,email,password }))).status).toBe(200);
  const user=await db.user.update({ where:{ email },data:{ emailVerified:true } }),member=await db.membership.create({ data:{ tenantId,userId:user.id,role } });
  const login=await auth.handler(req("/auth/sign-in/email","","POST",{ email,password })); expect(login.status).toBe(200);
  return { user,member,cookie:login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ") };
}
async function fixture() {
  const company=await db.company.create({ data:{ name:"목록·삭제 시험",publicName:"목록 시험",policy:{ create:{} },services:{ create:{ name:"폼 서비스",externalName:"폼" } } },include:{ services:true } });
  const owner=await account(company.id,"owner"),editor=await account(company.id,"editor"),serviceId=company.services[0].id;
  const grant=await db.serviceGrant.create({ data:{ tenantId:company.id,memberId:editor.member.id,serviceId,capabilities:["service.read","form.read","form.write","form.publish"] } });
  const ctx=await requireContext(req("/context",editor.cookie).headers,"form.read");
  const input=formInput.parse({ serviceId,title:"A 초안",content:{ body:"초안 본문",questions:[{ id:randomUUID(),type:"객관식 답변",label:"선택",required:true,options:["첫째","둘째"] }],consentRequired:false,consentPurpose:"",retentionDays:30,maxResponses:5 } });
  const form=await db.$transaction(tx => createForm(ctx,input,randomUUID(),tx));
  return { company,owner,editor,serviceId,grant,ctx,input,form };
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function publish(f:Fixture) {
  const response=await action(req("/forms/"+f.form.id+"/publish",f.editor.cookie,"POST",{ version:1 },randomUUID())); expect(response.status).toBe(201); return response.json();
}
const purge=(f:Fixture,id=f.form.id,version=1) => DELETE(req("/forms/"+id+"/purge",f.editor.cookie,"DELETE",undefined,undefined,version));
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("목록과 상세는 회수된 조회 권한의 이전 Context를 거부한다",async () => {
  const f=await fixture(); await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.write","form.publish"] } });
  await expect(requireForm(f.ctx,f.form.id)).rejects.toMatchObject({ status:403 });
  await expect(listForms(f.ctx,{ ...listQuery.parse({}),serviceId:f.serviceId })).rejects.toMatchObject({ status:403 });
  expect((await listForms(f.ctx,listQuery.parse({}))).total).toBe(0);
});
test("세션 종료와 이메일 인증 회수 뒤 이전 Context로 목록·상세를 읽지 못한다",async () => {
  const f=await fixture(); await db.user.update({ where:{ id:f.editor.user.id },data:{ emailVerified:false } });
  await expect(readForm(f.ctx,f.form.id)).rejects.toMatchObject({ status:401 });
  await expect(listForms(f.ctx,listQuery.parse({}))).rejects.toMatchObject({ status:401 });
  await db.user.update({ where:{ id:f.editor.user.id },data:{ emailVerified:true } }); await db.session.delete({ where:{ id:f.ctx.session.id } });
  await expect(requireForm(f.ctx,f.form.id)).rejects.toMatchObject({ status:401 });
});
test("현재 게시 권한을 회수하면 목록과 상세 DTO에서 토큰을 제외한다",async () => {
  const f=await fixture(); await publish(f);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.write"] } });
  expect((await readForm(f.ctx,f.form.id)).publication?.token!==undefined).toBe(false);
  expect((await listForms(f.ctx,listQuery.parse({}))).items[0].publication?.token!==undefined).toBe(false);
});
test("두 페이지의 제목 정렬·검색·범위 밖 페이지를 서버에서 보정한다",async () => {
  const f=await fixture();
  for (let n=0;n<11;n++) await db.$transaction(tx => createForm(f.ctx,{ ...f.input,title:"B 초안 "+String(n).padStart(2,"0") },randomUUID(),tx));
  const first=await listForms(f.ctx,listQuery.parse({ page:1,pageSize:10,sort:"name",direction:"asc" })); expect(first.total).toBe(12); expect(first.items[0].title).toBe("A 초안"); expect(first.items).toHaveLength(10);
  const last=await listForms(f.ctx,listQuery.parse({ page:999,pageSize:10,sort:"name",direction:"asc" })); expect(last.page).toBe(2); expect(last.items).toHaveLength(2);
  const search=await listForms(f.ctx,listQuery.parse({ search:"B 초안 10",page:2 })); expect(search.page).toBe(1); expect(search.total).toBe(1);
  const none=await listForms(f.ctx,listQuery.parse({ search:"일치하지 않음",page:999 })); expect(none.page).toBe(1); expect(none.items).toEqual([]);
});
test("한국 날짜의 생성 기간과 사용자별 즐겨찾기 필터를 보존한다",async () => {
  const f=await fixture(),second=await db.$transaction(tx => createForm(f.ctx,{ ...f.input,title:"B 초안" },randomUUID(),tx));
  await db.form.update({ where:{ id:f.form.id },data:{ createdAt:new Date("2026-10-02T14:59:59.999Z") } });
  await db.form.update({ where:{ id:second.id },data:{ createdAt:new Date("2026-10-02T15:00:00.000Z") } });
  const dates=await listForms(f.ctx,{ ...listQuery.parse({}),start:"2026-10-03",end:"2026-10-03" }); expect(dates.items.map(f => f.id)).toEqual([second.id]);
  await db.formFavorite.create({ data:{ tenantId:f.company.id,memberId:f.editor.member.id,formId:second.id } });
  expect((await listForms(f.ctx,{ ...listQuery.parse({}),favorite:true })).items.map(f => f.id)).toEqual([second.id]);
  const ownerCtx=await requireContext(req("/context",f.owner.cookie).headers,"form.read"); expect((await listForms(ownerCtx,{ ...listQuery.parse({}),favorite:true })).total).toBe(0);
});
test("미참조 초안은 질문·선택지·즐겨찾기까지 완전 삭제하고 감사만 남긴다",async () => {
  const f=await fixture(); await db.formFavorite.create({ data:{ tenantId:f.company.id,memberId:f.editor.member.id,formId:f.form.id } });
  const eligibility=await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie)); expect(eligibility.status).toBe(200); expect((await eligibility.json()).canPurge).toBe(true);
  expect((await purge(f)).status).toBe(204);
  expect(await db.form.count()).toBe(0); expect(await db.formVersion.count()).toBe(0); expect(await db.question.count()).toBe(0); expect(await db.questionOption.count()).toBe(0); expect(await db.formFavorite.count()).toBe(0);
  expect(await db.auditEvent.count({ where:{ resourceId:f.form.id,action:"form.purged" } })).toBe(1);
});
test("완전 삭제는 If-Match와 현재 작성 권한을 요구하고 실패 시 그대로 둔다",async () => {
  const f=await fixture(); expect((await purge(f,f.form.id,9)).status).toBe(409);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.publish"] } });
  expect((await purge(f)).status).toBe(403); expect(await db.form.count()).toBe(1);
});
test("게시 이력이 있는 폼은 보관해도 완전 삭제를 막고 사유를 반환한다",async () => {
  const f=await fixture(); await publish(f);
  expect((await DELETE(req("/forms/"+f.form.id,f.editor.cookie,"DELETE",undefined,undefined,2))).status).toBe(204);
  const response=await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie)); expect(response.status).toBe(200);
  const data=await response.json(); expect(data.canPurge).toBe(false); expect(data.reasons.some((r:{ code:string }) => r.code==="PUBLISHED_EVIDENCE")).toBe(true);
  expect((await purge(f,f.form.id,3)).status).toBe(409); expect(await db.formVersion.count()).toBe(1); expect(await db.publication.count()).toBe(1);
});
test("취소된 승인 검토 증거도 완전 삭제하지 않고 유지한다",async () => {
  const f=await fixture(); await db.securityPolicy.update({ where:{ tenantId:f.company.id },data:{ requireApproval:true } });
  const response=await action(req("/forms/"+f.form.id+"/approvals",f.editor.cookie,"POST",{ version:1,message:"합성 검토",reference:"" },randomUUID())); expect(response.status).toBe(201);
  const approval=await response.json(); expect((await cancelApproval(req("/approvals/"+approval.id,f.editor.cookie,"DELETE",{ version:1 }))).status).toBe(200);
  expect((await purge(f,f.form.id,3)).status).toBe(409); expect(await db.approvalRequest.count()).toBe(1); expect(await db.form.count()).toBe(1);
});
test("초안 삭제 후 생성·저장 캐시의 암호문을 제거하고 재전송은 410이다",async () => {
  const f=await fixture(),key=randomUUID(),value={ ...f.input,title:"캐시 초안" };
  const created=await create(req("/forms",f.editor.cookie,"POST",value,key)); expect(created.status).toBe(201); const form=await created.json();
  const saveKey=randomUUID(),saved=await PATCH(req("/forms/"+form.id+"/draft",f.editor.cookie,"PATCH",{ version:1,title:"캐시 수정" },saveKey)); expect(saved.status).toBe(200);
  expect((await purge(f,form.id,2)).status).toBe(204);
  const cache=await db.idempotencyRecord.findMany({ where:{ key:{ in:[key,saveKey] } } }); expect(cache).toHaveLength(2); expect(cache.every(c => !c.responseCipher && !c.requestHash && c.invalidatedAt)).toBe(true);
  expect((await create(req("/forms",f.editor.cookie,"POST",value,key))).status).toBe(410); expect(await db.form.count()).toBe(1);
});
test("이전 형식의 생성 캐시도 삭제 시 비우고 독립 복사본은 유지한다",async () => {
  const f=await fixture(),copy=await action(req("/forms/"+f.form.id+"/copy",f.editor.cookie,"POST",{},randomUUID())); expect(copy.status).toBe(201); const independent=await copy.json();
  const key=randomUUID(); await db.idempotencyRecord.create({ data:{ scope:"form:create:"+f.editor.member.id,key,requestHash:"legacy",statusCode:201,responseCipher:encrypt({ id:f.form.id,content:f.input.content }),expiresAt:new Date(Date.now()+86400000) } });
  expect((await purge(f)).status).toBe(204); expect(await db.form.findUnique({ where:{ id:independent.id } })).not.toBeNull();
  expect((await db.idempotencyRecord.findUniqueOrThrow({ where:{ scope_key:{ scope:"form:create:"+f.editor.member.id,key } } })).responseCipher).toBeNull();
});
test("동일 version의 초안 변경·완전 삭제 경합은 한 번만 성공한다",async () => {
  const f=await fixture();
  const [remove,change]=await Promise.all([purge(f),PATCH(req("/forms/"+f.form.id+"/draft",f.editor.cookie,"PATCH",{ version:1,title:"경합 저장" },randomUUID()))]);
  expect([204,409,404].includes(remove.status)).toBe(true); expect([200,404].includes(change.status)).toBe(true);
  expect(Number(remove.status===204)+Number(change.status===200)).toBe(1);
});
test("목록은 잘못된 날짜·역순 기간·필터·추가 파라미터를 거부한다",async () => {
  const f=await fixture();
  for (const query of ["start=2026-02-30","start=2026-10-03&end=2026-10-02","favorite=anything","status=unknown","extra=true"])
    expect((await list(req("/forms?"+query,f.editor.cookie))).status).toBe(422);
});
test("완전 삭제는 version 헤더 없이는 실패하고 보관된 미참조 초안은 삭제한다",async () => {
  const f=await fixture(); expect((await DELETE(req("/forms/"+f.form.id+"/purge",f.editor.cookie,"DELETE"))).status).toBe(422);
  expect((await DELETE(req("/forms/"+f.form.id,f.editor.cookie,"DELETE",undefined,undefined,1))).status).toBe(204);
  expect((await purge(f,f.form.id,2)).status).toBe(204); expect(await db.form.count()).toBe(0);
});
test("다른 회사·조회 전용·보관 서비스의 삭제 조건과 실제 삭제를 일치시킨다",async () => {
  const f=await fixture(),foreign=await db.company.create({ data:{ name:"다른 회사",publicName:"다른 회사",policy:{ create:{} } } }),outsider=await account(foreign.id,"owner");
  expect((await GET(req("/forms/"+f.form.id+"/deletion",outsider.cookie))).status).toBe(404);
  expect((await DELETE(req("/forms/"+f.form.id+"/purge",outsider.cookie,"DELETE",undefined,undefined,1))).status).toBe(404);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read"] } });
  const readOnly=await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie)); expect(readOnly.status).toBe(200); expect((await readOnly.json()).reasons[0].code).toBe("WRITE_REQUIRED");
  expect((await purge(f)).status).toBe(403);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read","form.write"] } });
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  const archived=await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie)); expect(archived.status).toBe(200); expect((await archived.json()).canPurge).toBe(false); expect((await purge(f)).status).toBe(409);
});
test("템플릿 사용으로 생성한 초안 삭제는 새 캐시와 이전 템플릿 캐시도 지운다",async () => {
  const f=await fixture(),template=await db.formTemplate.create({ data:{ tenantId:f.company.id,serviceId:f.serviceId,title:"템플릿",category:"시험",content:f.input.content } });
  const key=randomUUID(),input={ version:1,serviceId:f.serviceId };
  const used=await templateUse(req("/templates/"+template.id+"/use",f.editor.cookie,"POST",input,key)); expect(used.status).toBe(201); const copy=await used.json();
  const legacyKey=randomUUID(); await db.idempotencyRecord.create({ data:{ scope:"template:use:"+f.editor.member.id+":"+template.id,key:legacyKey,requestHash:"legacy",statusCode:201,responseCipher:encrypt({ id:copy.id }),expiresAt:new Date(Date.now()+86400000) } });
  expect((await purge(f,copy.id)).status).toBe(204); expect((await templateUse(req("/templates/"+template.id+"/use",f.editor.cookie,"POST",input,key))).status).toBe(410);
  const records=await db.idempotencyRecord.findMany({ where:{ key:{ in:[key,legacyKey] } } }); expect(records.every(row => row.invalidatedAt && !row.responseCipher && !row.requestHash)).toBe(true);
  expect(await db.formTemplate.count()).toBe(1); expect(await db.form.count()).toBe(1);
});
test("문서가 연결된 미게시 초안 삭제는 문서·게시 문서 이력은 유지한다",async () => {
  const f=await fixture();
  const purposeResponse=await purposeCreate(req("/processing-purposes",f.owner.cookie,"POST",{ serviceId:f.serviceId,name:"동의 목적",purpose:"합성 상담",lawfulBasis:"consent",basisReference:"",items:[{ name:"이름",kind:"general",required:true }],retentionMode:"days",retentionDays:30,retentionReason:"",recipientIds:[] },randomUUID())); expect(purposeResponse.status).toBe(201); const purpose=await purposeResponse.json();
  const documentResponse=await documentCreate(req("/documents",f.owner.cookie,"POST",{ serviceId:f.serviceId,title:"동의 문서",type:"consent",body:"합성 본문",refusalNotice:"거부 가능",rightsContact:"QA 문의",effectiveDate:"2026-10-03",recipientIds:[],purposeIds:[purpose.id] },randomUUID())); expect(documentResponse.status).toBe(201); const document=await documentResponse.json();
  expect((await documentAction(req("/documents/"+document.id+"/publish",f.owner.cookie,"POST",{ version:document.version,expiresAt:null }))).status).toBe(201);
  const version=await db.documentVersion.findFirstOrThrow({ where:{ documentId:document.id } });
  const created=await create(req("/forms",f.owner.cookie,"POST",{ ...f.input,content:{ ...f.input.content,documentConsents:[{ documentVersionId:version.id,required:true,kind:"collection" }] } },randomUUID())); expect(created.status).toBe(201); const form=await created.json();
  expect(await db.formDocumentBinding.count()).toBe(1);
  expect((await purge(f,form.id)).status).toBe(204); expect(await db.formDocumentBinding.count()).toBe(0);
  expect(await db.documentVersion.count({ where:{ documentId:document.id } })).toBe(1); expect(await db.documentPublication.count({ where:{ documentId:document.id } })).toBe(1);
});
test("전문가의 배정 외 여분 grant와 실제 배정 만료는 상세·목록을 허용하지 않는다",async () => {
  const f=await fixture(),second=await db.service.create({ data:{ tenantId:f.company.id,name:"배정 서비스",externalName:"배정 서비스" } });
  const assignment=await db.expertAssignment.create({ data:{ tenantId:f.company.id,expertUserId:f.editor.user.id,assignedById:f.owner.user.id,expiresAt:new Date(Date.now()+86400000) } });
  await db.expertAssignmentService.create({ data:{ tenantId:f.company.id,assignmentId:assignment.id,serviceId:second.id } });
  await db.membership.update({ where:{ id:f.editor.member.id },data:{ role:"viewer",accessKind:"expert",expertAssignmentId:assignment.id } });
  const ctx=await requireContext(req("/context",f.editor.cookie).headers,"form.read");
  await expect(readForm(ctx,f.form.id)).rejects.toMatchObject({ status:403 }); expect((await listForms(ctx,listQuery.parse({}))).total).toBe(0);
  await db.expertAssignmentService.create({ data:{ tenantId:f.company.id,assignmentId:assignment.id,serviceId:f.serviceId } });
  expect((await readForm(ctx,f.form.id)).id).toBe(f.form.id);
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  await expect(readForm(ctx,f.form.id)).rejects.toMatchObject({ status:404 });
  await expect(listForms(ctx,{ ...listQuery.parse({}),serviceId:f.serviceId })).rejects.toMatchObject({ status:404 });
  expect((await listForms(ctx,listQuery.parse({}))).total).toBe(0);
  expect((await PUT(req("/forms/"+f.form.id+"/favorite",f.editor.cookie,"PUT"))).status).toBe(404);
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"active" } });
  await db.expertAssignment.update({ where:{ id:assignment.id },data:{ expiresAt:new Date(Date.now()+100) } });
  await new Promise(resolve => setTimeout(resolve,180));
  await expect(readForm(ctx,f.form.id)).rejects.toMatchObject({ status:403 }); await expect(listForms(ctx,listQuery.parse({}))).rejects.toMatchObject({ status:403 });
});
test("조회 전용 서비스의 목록·상세 작업과 생성/업로드 메뉴는 현재 권한으로 계산한다",async () => {
  const f=await fixture(); await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read"] } });
  const row=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json();
  expect(row.actions).toMatchObject({ preview:true,responses:false,edit:false,copy:false,registerTemplate:false,share:false,pause:false,resume:false,archive:false,checkDeletion:false });
  const page=await (await list(req("/forms?serviceId="+f.serviceId,f.editor.cookie))).json();
  expect(page.items[0].actions).toEqual(row.actions); expect(page.permissions).toEqual({ canCreate:false,canImport:false,canViewImports:false,canDesignateRetention:false });
  expect((await action(req("/forms/"+f.form.id+"/copy",f.editor.cookie,"POST",{},randomUUID()))).status).toBe(403);
});
test("게시 전용 grant는 초안의 게시만 안내하고 저장 권한을 요구하지 않는다",async () => {
  const f=await fixture(); await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read","form.publish"] } });
  const row=await readForm(f.ctx,f.form.id); expect(row.actions).toMatchObject({ edit:false,publish:true,share:false });
  const page=await listForms(f.ctx,listQuery.parse({})); expect(page.items[0].actions.publish).toBe(true);
  expect((await PATCH(req("/forms/"+f.form.id+"/draft",f.editor.cookie,"PATCH",{ version:1,title:"저장 거부" },randomUUID()))).status).toBe(403);
  const publication=await publish(f); expect(publication).not.toHaveProperty("actions");
  expect((await readForm(f.ctx,f.form.id)).actions).toMatchObject({ edit:false,publish:false,share:true });
});
test("현재 작성과 게시 grant는 별도이고 역할 회수 시 게시 API와 안내를 함께 거부한다",async () => {
  const f=await fixture(); await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read","form.write"] } });
  expect((await readForm(f.ctx,f.form.id)).actions).toMatchObject({ edit:true,publish:false });
  expect((await action(req("/forms/"+f.form.id+"/publish",f.editor.cookie,"POST",{ version:1 },randomUUID()))).status).toBe(403);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read","form.publish"] } });
  await db.membership.update({ where:{ id:f.editor.member.id },data:{ role:"viewer" } });
  expect((await readForm(f.ctx,f.form.id)).actions.publish).toBe(false);
  expect((await action(req("/forms/"+f.form.id+"/publish",f.editor.cookie,"POST",{ version:1 },randomUUID()))).status).toBe(403);
  expect(await db.publication.count({ where:{ formId:f.form.id } })).toBe(0);
});
test("게시 작업 권한은 초안 유무를 따르고 승인 정책은 실제 게시에서 재검증한다",async () => {
  const f=await fixture(); await db.securityPolicy.update({ where:{ tenantId:f.company.id },data:{ requireApproval:true } });
  expect((await readForm(f.ctx,f.form.id)).actions.publish).toBe(true);
  const denied=await action(req("/forms/"+f.form.id+"/publish",f.editor.cookie,"POST",{ version:1 },randomUUID()));
  expect(denied.status).toBe(409); expect((await denied.json()).error.code).toBe("APPROVAL_REQUIRED");
  await db.securityPolicy.update({ where:{ tenantId:f.company.id },data:{ requireApproval:false } }); await publish(f);
  expect((await readForm(f.ctx,f.form.id)).actions.publish).toBe(false);
  const saved=await PATCH(req("/forms/"+f.form.id+"/draft",f.owner.cookie,"PATCH",{ version:2,title:"새 초안" },randomUUID())); expect(saved.status).toBe(200); expect(await saved.json()).not.toHaveProperty("actions");
  expect((await readForm(f.ctx,f.form.id)).actions.publish).toBe(true);
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  expect((await readForm(f.ctx,f.form.id)).actions.publish).toBe(false);
});
test("이전 Context의 작성/게시 권한 회수는 작업 DTO와 실제 API에 동시에 반영한다",async () => {
  const f=await fixture(); await publish(f);
  const initial=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json(); expect(initial.actions).toMatchObject({ edit:true,copy:true,share:true,pause:true,resume:false,checkDeletion:true });
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read"] } });
  const row=await readForm(f.ctx,f.form.id) as unknown as { actions:typeof initial.actions }; expect(row.actions).toMatchObject({ edit:false,copy:false,share:false,pause:false,archive:false,checkDeletion:false });
  expect((await action(req("/forms/"+f.form.id+"/pause",f.editor.cookie,"POST",{ version:2 }))).status).toBe(403);
});
test("서비스별 생성/업로드 권한과 보관 상태를 목록 메타데이터에 반영한다",async () => {
  const f=await fixture(),second=await db.service.create({ data:{ tenantId:f.company.id,name:"작성 가능 서비스",externalName:"작성 가능" } });
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read"] } });
  await db.serviceGrant.create({ data:{ tenantId:f.company.id,memberId:f.editor.member.id,serviceId:second.id,capabilities:["form.read","form.write","import.read","import.write"] } });
  const get=async (serviceId?:string) => (await list(req("/forms"+(serviceId ? "?serviceId="+serviceId:""),f.editor.cookie))).json();
  expect((await get(f.serviceId)).permissions).toEqual({ canCreate:false,canImport:false,canViewImports:false,canDesignateRetention:false });
  expect((await get(second.id)).permissions).toEqual({ canCreate:true,canImport:true,canViewImports:true,canDesignateRetention:false }); expect((await get()).permissions.canCreate).toBe(true);
  await db.service.update({ where:{ id:second.id },data:{ status:"archived" } });
  expect((await get(second.id)).permissions).toEqual({ canCreate:false,canImport:false,canViewImports:true,canDesignateRetention:false }); expect((await get()).permissions.canCreate).toBe(false);
});
test("응답 링크는 현재 역할·서비스 submission.read 권한이 모두 있을 때만 안내한다",async () => {
  const f=await fixture(); await db.membership.update({ where:{ id:f.editor.member.id },data:{ role:"privacy" } });
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read","submission.read","form.write","form.publish"] } });
  const row=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json(); expect(row.actions).toMatchObject({ responses:true,edit:false,copy:false,share:false });
  expect((await GET(req("/forms/"+f.form.id+"/submissions",f.editor.cookie))).status).toBe(200);
  expect((await (await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie))).json()).canReadResponses).toBe(true);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["form.read"] } });
  expect((await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json()).actions.responses).toBe(false);
  expect((await GET(req("/forms/"+f.form.id+"/submissions",f.editor.cookie))).status).toBe(403);
  expect((await (await GET(req("/forms/"+f.form.id+"/deletion",f.editor.cookie))).json()).canReadResponses).toBe(false);
});
test("공개 중/중단/만료 상태와 보관 서비스의 작업은 실행 가능한 상태를 따른다",async () => {
  const f=await fixture(),publication=await publish(f);
  expect((await action(req("/forms/"+f.form.id+"/pause",f.editor.cookie,"POST",{ version:2 }))).status).toBe(200);
  const paused=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json(); expect(paused.actions).toMatchObject({ pause:false,resume:true,share:true });
  await db.publication.update({ where:{ id:publication.id },data:{ expiresAt:new Date(Date.now()-1000) } });
  const expired=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json(); expect(expired.actions).toMatchObject({ resume:false,share:false });
  expect((await action(req("/forms/"+f.form.id+"/resume",f.editor.cookie,"POST",{ version:3 }))).status).toBe(409);
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  const archived=await (await GET(req("/forms/"+f.form.id,f.owner.cookie))).json(); expect(archived.actions).toMatchObject({ preview:true,responses:true,edit:false,copy:false,registerTemplate:false,share:false,pause:false,resume:false,archive:false,checkDeletion:false });
});
test("보관 폼은 독립 복사/삭제 조건 조회를 허용하고 가져오기 양식은 변경 작업을 안내하지 않는다",async () => {
  const f=await fixture(); expect((await DELETE(req("/forms/"+f.form.id,f.editor.cookie,"DELETE",undefined,undefined,1))).status).toBe(204);
  const archived=await (await GET(req("/forms/"+f.form.id,f.editor.cookie))).json(); expect(archived.actions).toMatchObject({ edit:false,copy:true,registerTemplate:false,archive:false,checkDeletion:true });
  const importedForm=await db.form.create({ data:{ tenantId:f.company.id,serviceId:f.serviceId,ownerId:f.owner.user.id,title:"가져오기 양식",sourceType:"import",status:"archived" } });
  const version=await db.formVersion.create({ data:{ tenantId:f.company.id,formId:importedForm.id,number:1,title:"가져오기 양식",consentRequired:false } });
  await db.question.create({ data:{ tenantId:f.company.id,formVersionId:version.id,stableKey:randomUUID(),label:"가져오기 항목",type:"단문형 답변",required:true,order:0 } });
  await db.formVersion.update({ where:{ id:version.id },data:{ status:"published",publishedAt:new Date() } });
  const imported=await (await GET(req("/forms/"+importedForm.id,f.owner.cookie))).json(); expect(imported.actions).toMatchObject({ preview:true,responses:true,edit:false,copy:false,registerTemplate:false,share:false,pause:false,resume:false,archive:false,checkDeletion:false });
});
