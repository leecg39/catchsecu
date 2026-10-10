import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { createForm, formInclude } from "@/server/forms";
import { formInput } from "@/contracts/domains";
import { approvalForForm, approvalQuery, getApproval, listApprovals } from "@/server/approvals";
import { createFixedUrl, listFixedUrls, requireFixedUrl, revokeFixedUrl, updateFixedUrl } from "@/server/fixed-urls";
import { POST as action, PATCH as draft } from "@/app/api/v1/forms/[...segments]/route";
import { POST as fixedCreate } from "@/app/api/v1/fixed-urls/route";
import { PATCH as fixedPatch } from "@/app/api/v1/fixed-urls/[id]/route";
import { GET as publicGet, POST as publicSubmit } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as selectCompany } from "@/app/api/v1/context/route";
import { listQuery } from "@/server/http";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost","127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Publication-gate!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin,cookie,
    ...(input === undefined ? {} : { "content-type":"application/json" }), ...(key ? { "idempotency-key":key } : {}) },
    ...(input === undefined ? {} : { body:JSON.stringify(input) }) });
}
async function person() {
  const email = "publication-gate-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email","","POST",{ name:"검증 사용자",email,password }))).status).toBe(200);
  const user = await db.user.update({ where:{ email },data:{ emailVerified:true } });
  const login = await auth.handler(req("/auth/sign-in/email","","POST",{ email,password })); expect(login.status).toBe(200);
  return { user,cookie:login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const company = await db.company.create({ data:{ name:"게시 검증",publicName:"게시 검증",policy:{ create:{} },
    services:{ create:[{ name:"연결 서비스",externalName:"연결" },{ name:"다른 서비스",externalName:"다른" }] } },include:{ services:true } });
  const owner = await person(), editor = await person(), serviceId = company.services[0].id, secondId = company.services[1].id;
  await db.membership.create({ data:{ tenantId:company.id,userId:owner.user.id,role:"owner" } });
  const member = await db.membership.create({ data:{ tenantId:company.id,userId:editor.user.id,role:"editor" } });
  const grant = await db.serviceGrant.create({ data:{ tenantId:company.id,memberId:member.id,serviceId,
    capabilities:["service.read","form.read","form.write","form.publish"] } });
  const ctx = await requireContext(req("/context",editor.cookie).headers,"form.publish"), ownerCtx = await requireContext(req("/context",owner.cookie).headers,"form.publish");
  const input = formInput.parse({ serviceId,title:"게시할 폼",content:{ body:"게시 원문",questions:[{ id:randomUUID(),label:"답변",type:"단문형 답변",required:true }],
    consentRequired:false,consentPurpose:"",retentionDays:30,maxResponses:1 } });
  const form = await db.$transaction(tx => createForm(ctx,input,randomUUID(),tx));
  return { company,serviceId,secondId,owner,editor,member,grant,ctx,ownerCtx,input,form };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function publish(f: Fixture, id = f.form.id, version = f.form.version, key = randomUUID(), expiresAt?: string) {
  const response = await action(req("/forms/" + id + "/publish",f.editor.cookie,"POST",{ version,...(expiresAt ? { expiresAt } : {}) },key));
  expect(response.status).toBe(201); return { result:await response.json(),key,input:{ version,...(expiresAt ? { expiresAt } : {}) } };
}
async function fixed(f: Fixture) {
  const live = await publish(f), key = randomUUID(), input = { name:"고정 주소",formId:f.form.id };
  const response = await fixedCreate(req("/fixed-urls",f.editor.cookie,"POST",input,key)); expect(response.status).toBe(201);
  return { live,key,input,row:await response.json() };
}
async function approval(f: Fixture) {
  await db.securityPolicy.update({ where:{ tenantId:f.company.id },data:{ requireApproval:true } });
  const input = { version:f.form.version,message:"합성 검토 메시지",reference:"QA" }, key=randomUUID();
  const response = await action(req("/forms/" + f.form.id + "/approvals",f.editor.cookie,"POST",input,key)); expect(response.status).toBe(201);
  return { row:await response.json(),input,key };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("게시 요청 재전송은 현재 서비스 게시 권한을 검사하며 회수 후 토큰을 반환하지 않는다",async () => {
  const f=await fixture(), p=await publish(f), before=await db.auditEvent.count();
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.write"] } });
  const replay=await action(req("/forms/" + f.form.id + "/publish",f.editor.cookie,"POST",p.input,p.key)); expect(replay.status).toBe(403);
  expect(await db.publication.count()).toBe(1); expect(await db.auditEvent.count()).toBe(before);
});
test("승인 요청 재전송은 현재 작성 권한을 검사하며 검토 메시지를 노출하지 않는다",async () => {
  const f=await fixture(), a=await approval(f);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.publish"] } });
  expect((await action(req("/forms/" + f.form.id + "/approvals",f.editor.cookie,"POST",a.input,a.key))).status).toBe(403);
  expect(await db.approvalRequest.count()).toBe(1);
});
test("고정 URL 생성 재전송도 현재 연결 서비스 게시 권한을 검사한다",async () => {
  const f=await fixture(), a=await fixed(f);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.write"] } });
  expect((await fixedCreate(req("/fixed-urls",f.editor.cookie,"POST",a.input,a.key))).status).toBe(403); expect(await db.fixedUrl.count()).toBe(1);
});
test("조회 권한을 회수한 이전 Context는 승인 이력과 고정 URL을 읽지 못한다",async () => {
  const f=await fixture(), a=await approval(f);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.write","form.publish"] } });
  for (const call of [() => getApproval(f.ctx,a.row.id),() => approvalForForm(f.ctx,f.form.id,1,20),
    () => listApprovals(f.ctx,approvalQuery.parse({ serviceId:f.serviceId }))]) await expect(call()).rejects.toMatchObject({ status:403 });
  expect((await listApprovals(f.ctx,approvalQuery.parse({}))).total).toBe(0);
});
test("세션이 종료된 이전 Context는 고정 URL 조회·생성·변경·종료와 승인 조회를 처리하지 못한다",async () => {
  const f=await fixture(), a=await fixed(f); await db.session.delete({ where:{ id:f.ctx.session.id } });
  for (const call of [() => requireFixedUrl(f.ctx,a.row.id),() => listFixedUrls(f.ctx,listQuery.parse({})),
    () => db.$transaction(tx => createFixedUrl(f.ctx,{ name:"새 주소",formId:f.form.id },randomUUID(),tx)),
    () => updateFixedUrl(f.ctx,a.row.id,{ version:1,name:"변경" },randomUUID()),() => revokeFixedUrl(f.ctx,a.row.id,1,randomUUID()),
    () => approvalForForm(f.ctx,f.form.id,1,20)]) await expect(call()).rejects.toMatchObject({ status:401 });
  expect((await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } })).version).toBe(1);
});
test("이메일 인증을 회수한 이전 Context는 고정 URL과 승인 목록을 읽지 못한다",async () => {
  const f=await fixture(), a=await fixed(f); await db.user.update({ where:{ id:f.editor.user.id },data:{ emailVerified:false } });
  await expect(requireFixedUrl(f.ctx,a.row.id)).rejects.toMatchObject({ status:401 });
  await expect(listApprovals(f.ctx,approvalQuery.parse({}))).rejects.toMatchObject({ status:401 });
});
test("고정 URL 변경·종료는 이전 Context의 회수된 게시 권한으로 수행할 수 없다",async () => {
  const f=await fixture(), a=await fixed(f);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.write"] } });
  await expect(updateFixedUrl(f.ctx,a.row.id,{ version:1,name:"변경" },randomUUID())).rejects.toMatchObject({ status:403 });
  await expect(revokeFixedUrl(f.ctx,a.row.id,1,randomUUID())).rejects.toMatchObject({ status:403 });
  expect((await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } })).version).toBe(1);
});
test("다른 서비스로 연결할 때 현재 원래 서비스와 대상 서비스의 게시 권한이 모두 필요하다",async () => {
  const f=await fixture(), a=await fixed(f);
  const second=await db.$transaction(tx => createForm(f.ownerCtx,{ ...f.input,serviceId:f.secondId,title:"다른 서비스 폼" },randomUUID(),tx));
  const response=await action(req("/forms/" + second.id + "/publish",f.owner.cookie,"POST",{ version:1 },randomUUID())); expect(response.status).toBe(201);
  const grant=await db.serviceGrant.create({ data:{ tenantId:f.company.id,memberId:f.member.id,serviceId:f.secondId,capabilities:["form.read","form.publish"] } });
  const ctx=await requireContext(req("/context",f.editor.cookie).headers,"form.publish"); await db.serviceGrant.delete({ where:{ id:grant.id } });
  await expect(updateFixedUrl(ctx,a.row.id,{ version:1,formId:second.id },randomUUID())).rejects.toMatchObject({ status:403 });
  expect((await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } })).publicationId).toBe(a.live.result.id);
});
test("전문가 배정 만료와 배정 외 여분 grant는 고정 URL·승인 조회를 허용하지 않는다",async () => {
  const f=await fixture(), a=await fixed(f), user=await person();
  const assigned=await db.expertAssignment.create({ data:{ tenantId:f.company.id,expertUserId:user.user.id,assignedById:f.owner.user.id,expiresAt:new Date(Date.now()+86400000) } });
  await db.expertAssignmentService.create({ data:{ tenantId:f.company.id,assignmentId:assigned.id,serviceId:f.secondId } });
  const member=await db.membership.create({ data:{ tenantId:f.company.id,userId:user.user.id,role:"viewer",accessKind:"expert",expertAssignmentId:assigned.id } });
  for (const serviceId of [f.serviceId,f.secondId]) await db.serviceGrant.create({ data:{ tenantId:f.company.id,memberId:member.id,serviceId,capabilities:["service.read","form.read"] } });
  expect((await selectCompany(req("/context",user.cookie,"POST",{ companyId:f.company.id }))).status).toBe(200);
  const ctx=await requireContext(req("/context",user.cookie).headers,"form.read");
  await expect(requireFixedUrl(ctx,a.row.id)).rejects.toMatchObject({ status:403 });
  expect((await listFixedUrls(ctx,listQuery.parse({}))).total).toBe(0);
  await db.expertAssignment.update({ where:{ id:assigned.id },data:{ expiresAt:new Date(Date.now()+100) } });
  await new Promise(resolve => setTimeout(resolve,180));
  await expect(listFixedUrls(ctx,listQuery.parse({}))).rejects.toMatchObject({ status:403 });
  await expect(listApprovals(ctx,approvalQuery.parse({}))).rejects.toMatchObject({ status:403 });
});
test("보관 서비스의 고정 URL 이력은 읽되 생성·변경·종료는 막는다",async () => {
  const f=await fixture(), a=await fixed(f); await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  expect((await requireFixedUrl(f.ctx,a.row.id)).id).toBe(a.row.id);
  await expect(updateFixedUrl(f.ctx,a.row.id,{ version:1,name:"변경" },randomUUID())).rejects.toMatchObject({ status:409 });
  await expect(revokeFixedUrl(f.ctx,a.row.id,1,randomUUID())).rejects.toMatchObject({ status:409 });
  await expect(db.$transaction(tx => createFixedUrl(f.ctx,{ name:"보관 중 새 주소",formId:f.form.id },randomUUID(),tx))).rejects.toMatchObject({ status:409 });
});
test("내용 없는 고정 URL PATCH는 version·감사를 변경하지 않는다",async () => {
  const f=await fixture(), a=await fixed(f), before=await db.auditEvent.count();
  expect((await fixedPatch(req("/fixed-urls/" + a.row.id,f.editor.cookie,"PATCH",{ version:1 }))).status).toBe(422);
  expect((await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } })).version).toBe(1); expect(await db.auditEvent.count()).toBe(before);
});
test("고정 URL과 승인 목록은 범위를 벗어난 페이지를 실제 마지막 페이지로 보정한다",async () => {
  const f=await fixture(); await fixed(f);
  expect((await listFixedUrls(f.ctx,listQuery.parse({ page:99,pageSize:1 }))).page).toBe(1);
  const updated=await draft(req("/forms/" + f.form.id + "/draft",f.editor.cookie,"PATCH",{ version:2,title:"검토할 새 초안" },randomUUID())); expect(updated.status).toBe(200);
  const a=await approval({ ...f,form:await db.form.findUniqueOrThrow({ where:{ id:f.form.id },include:formInclude }) });
  expect((await listApprovals(f.ctx,approvalQuery.parse({ page:99,pageSize:1 }))).page).toBe(1);
  const history=await approvalForForm(f.ctx,f.form.id,99,1); expect(history.page).toBe(1); expect(history.items[0].id).toBe(a.row.id);
});
test("새 게시본은 같은 고정 주소로 연결되고 기존 응답은 기존 게시 버전에 남는다",async () => {
  const f=await fixture(), a=await fixed(f), answer={ answers:{ [f.input.content.questions[0].id]:"첫 응답" },consent:true };
  const submit=await publicSubmit(req("/public/forms/" + a.live.result.token + "/submissions","","POST",answer,randomUUID())); expect(submit.status).toBe(201);
  const old=await db.submission.findFirstOrThrow(), oldVersion=old.formVersionId;
  const patch=await draft(req("/forms/" + f.form.id + "/draft",f.editor.cookie,"PATCH",{ version:2,title:"두 번째 제목" },randomUUID())); expect(patch.status).toBe(200);
  const second=await publish(f,f.form.id,3), row=await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } }); expect(row.publicationId).toBe(second.result.id); expect(row.slug).toBe(a.row.slug); expect(row.version).toBe(2);
  expect((await publicGet(req("/public/forms/" + a.live.result.token))).status).toBe(410);
  expect((await db.submission.findUniqueOrThrow({ where:{ id:old.id } })).formVersionId).toBe(oldVersion);
  expect((await publicGet(req("/public/forms/" + second.result.token))).status).toBe(200);
});
test("마지막 한 자리의 동시 공개 응답은 한 건만 저장하고 만료 뒤 마감 화면만 제공한다",async () => {
  const f=await fixture(), p=await publish(f), answer={ answers:{ [f.input.content.questions[0].id]:"경합 응답" },consent:true };
  const responses=await Promise.all([0,1].map(() => publicSubmit(req("/public/forms/" + p.result.token + "/submissions","","POST",answer,randomUUID()))));
  expect(responses.map(r => r.status).sort()).toEqual([201,409]); expect(await db.submission.count()).toBe(1);
  await db.publication.update({ where:{ id:p.result.id },data:{ expiresAt:new Date(Date.now()-1000) } });
  const closed=await publicGet(req("/public/forms/" + p.result.token)); expect(closed.status).toBe(200);
  const closedBody=await closed.json(); expect(closedBody.closed).toBe(true); expect(closedBody).not.toHaveProperty("content");
  expect((await publicSubmit(req("/public/forms/" + p.result.token + "/submissions","","POST",answer,randomUUID()))).status).toBe(410);
});
test("승인 화면의 작성 버튼 권한은 현재 grant를 반영한다",async () => {
  const f=await fixture(); await approval(f);
  expect((await approvalForForm(f.ctx,f.form.id,1,20)).canRequest).toBe(true);
  await db.serviceGrant.update({ where:{ id:f.grant.id },data:{ capabilities:["service.read","form.read","form.publish"] } });
  expect((await approvalForForm(f.ctx,f.form.id,1,20)).canRequest).toBe(false);
});
test("새 게시와 고정 URL 변경의 경합은 교착 없이 새 게시본 연결과 version 충돌을 유지한다",async () => {
  const f=await fixture(), a=await fixed(f);
  expect((await draft(req("/forms/" + f.form.id + "/draft",f.editor.cookie,"PATCH",{ version:2,title:"다시 게시" },randomUUID()))).status).toBe(200);
  const [publication,change]=await Promise.all([
    action(req("/forms/" + f.form.id + "/publish",f.editor.cookie,"POST",{ version:3 },randomUUID())),
    fixedPatch(req("/fixed-urls/" + a.row.id,f.editor.cookie,"PATCH",{ version:1,name:"변경한 이름" })),
  ]);
  expect(publication.status).toBe(201); expect([200,409].includes(change.status)).toBe(true);
  const live=await publication.json(), row=await db.fixedUrl.findUniqueOrThrow({ where:{ id:a.row.id } });
  expect(row.publicationId).toBe(live.id); expect(row.version).toBe(change.status===200 ? 3:2);
  expect((await fixedPatch(req("/fixed-urls/" + a.row.id,f.editor.cookie,"PATCH",{ version:row.version,name:"경합 후 저장" }))).status).toBe(200);
});
test("보관 서비스의 게시·고정 URL 생성 캐시는 재전송되지 않고 검색·정렬은 서버에서 처리한다",async () => {
  const f=await fixture(), a=await fixed(f);
  await updateFixedUrl(f.ctx,a.row.id,{ version:1,name:"A 주소" },randomUUID());
  const b=await db.$transaction(tx => createFixedUrl(f.ctx,{ name:"B 주소",formId:f.form.id },randomUUID(),tx));
  const ordered=await listFixedUrls(f.ctx,listQuery.parse({ sort:"name",direction:"asc",pageSize:1 })); expect(ordered.items[0].name).toBe("A 주소"); expect(ordered.total).toBe(2);
  const filtered=await listFixedUrls(f.ctx,listQuery.parse({ search:"B",page:99,pageSize:1 })); expect(filtered.page).toBe(1); expect(filtered.items[0].id).toBe(b.id); expect(filtered.total).toBe(1);
  await db.service.update({ where:{ id:f.serviceId },data:{ status:"archived" } });
  expect((await action(req("/forms/" + f.form.id + "/publish",f.editor.cookie,"POST",a.live.input,a.live.key))).status).toBe(409);
  expect((await fixedCreate(req("/fixed-urls",f.editor.cookie,"POST",a.input,a.key))).status).toBe(409);
});
