import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { createSubprocessorRequest, sendSubprocessorNoticeRequest, createSubprocessor, getSubprocessor, listSubprocessors, listSubprocessorNotices, sendSubprocessorNotice, updateSubprocessor } from "@/server/subprocessors";
import { listQuery } from "@/server/http";
import { POST as createPerson } from "@/app/api/v1/services/[id]/subprocessors/route";
import { POST as sendNotice } from "@/app/api/v1/services/[id]/subprocessor-notices/route";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advance && args[3].startsWith("subprocessor.")) vi.setSystemTime(Date.now() + 120_000);
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated local test DB required.");
const email = "subprocessor-authority@example.test", password = "Subprocessor-authority!123", origin = new URL(env.BETTER_AUTH_URL).origin;
let userId: string, ctx: Context, serviceId: string, cookie: string, recipientId: string;
const person={name:"권한 검증",email:"authority@example.test",changeSummary:"안내"};
function request(path: string, input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie: cookie ?? "",
    ...(input ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", { email, password, name: "표시 설정 검증" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  clock.advance = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "표시 설정 검증", publicName: "표시 설정 검증",
    memberships: { create: { userId, role: "owner" } }, services: { create: { name: "표시 서비스", externalName: "표시 서비스" } },
  }, include: { services: true } });
  serviceId = company.services[0].id;
  const signed = await auth.handler(request("/auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200); cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(request("/context").headers, "service.manage");
  recipientId=(await db.$transaction(tx=>createSubprocessor(tx,ctx,serviceId,person,randomUUID()))).id;
});
afterAll(async () => { clock.advance = false; vi.useRealTimers(); await db.$disconnect(); });
const operations = {
  list: () => listSubprocessors(ctx,serviceId,listQuery.parse({})),
  detail: () => getSubprocessor(ctx,serviceId,recipientId),
  history: () => listSubprocessorNotices(ctx,serviceId,listQuery.parse({})),
  create: () => db.$transaction(tx=>createSubprocessor(tx,ctx,serviceId,{...person,email:"new@example.test"},randomUUID())),
  update: () => updateSubprocessor(ctx,serviceId,recipientId,{...person,name:"수정",status:"active",version:1},randomUUID()),
  send: () => db.$transaction(tx=>sendSubprocessorNotice(tx,ctx,serviceId,{subprocessorId:recipientId,recipientVersion:1,subject:"검증",body:"검증 안내"},randomUUID())),
};
for (const operation of Object.keys(operations) as (keyof typeof operations)[]) {
  test(`${operation}: 인증 이후 회사 변경을 거부한다`,async()=>{
    const other=await db.company.create({data:{name:"다른 회사",publicName:"다른 회사"}});
    await db.session.update({where:{id:ctx.session.id},data:{activeCompanyId:other.id}});
    await expect(operations[operation]()).rejects.toMatchObject({status:403,code:"COMPANY_CHANGED"});
  });
  test(`${operation}: 인증 이후 MFA 정책을 적용한다`,async()=>{
    await db.securityPolicy.create({data:{tenantId:ctx.tenantId,requireMfa:true,passwordMonths:0}});
    await expect(operations[operation]()).rejects.toMatchObject({status:403,code:"MFA_REQUIRED"});
  });
}
for (const operation of ["create","update","send"] as const) {
  test(`${operation}: 감사 저장 후 세션 만료 시 업무·감사·메일 작업을 롤백한다`,async()=>{
    const before=await counts();
    await db.session.update({where:{id:ctx.session.id},data:{expiresAt:new Date(Date.now()+60_000)}});
    vi.useFakeTimers({toFake:["Date"]}); clock.advance=true;
    await expect(operations[operation]()).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});
    expect(await counts()).toEqual(before);
    expect((await db.subprocessor.findUniqueOrThrow({where:{id:recipientId}})).version).toBe(1);
  });
}
async function counts(){return {people:await db.subprocessor.count({where:{tenantId:ctx.tenantId}}),notices:await db.subprocessorNotice.count({where:{tenantId:ctx.tenantId}}),jobs:await db.job.count({where:{tenantId:ctx.tenantId}}),audits:await db.auditEvent.count({where:{tenantId:ctx.tenantId}}),keys:await db.idempotencyRecord.count({where:{tenantId:ctx.tenantId}})};}
for (const kind of ["create","send"] as const) {
  test(`${kind}: 성공 요청 재전송도 보관된 서비스에서 거부한다`,async()=>{
    const path=`/services/${serviceId}/${kind==="create"?"subprocessors":"subprocessor-notices"}`;
    const input=kind==="create"?{...person,email:"replay@example.test"}:{subprocessorId:recipientId,recipientVersion:1,subject:"재요청",body:"재요청 안내"};
    const handler=kind==="create"?createPerson:sendNotice;
    const key=randomUUID();
    const req=()=>{const r=request(path,input);r.headers.set("idempotency-key",key);return r;};
    expect((await handler(req())).status).toBe(201);
    const before=await counts();
    await db.service.update({where:{id:serviceId},data:{status:"archived"}});
    const result=await handler(req());
    expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("SERVICE_ARCHIVED");
    expect(await counts()).toEqual(before);
  });
}

test("수신자 등록 재전송은 최신 정보를 반환하고 보관 후 캐시 개인정보를 노출하지 않는다",async()=>{
  const key=randomUUID(),input={...person,email:"replay-current@example.test"};
  const first=await createSubprocessorRequest(ctx,serviceId,input,key,randomUUID());
  await updateSubprocessor(ctx,serviceId,first.body.id,{...input,email:"updated@example.test",status:"active",version:1},randomUUID());
  const replay=await createSubprocessorRequest(ctx,serviceId,input,key,randomUUID());
  expect(replay.body).toMatchObject({id:first.body.id,email:"updated@example.test",version:2});
  await updateSubprocessor(ctx,serviceId,first.body.id,{...input,email:"updated@example.test",status:"archived",version:2},randomUUID());
  await expect(createSubprocessorRequest(ctx,serviceId,input,key,randomUUID())).rejects.toMatchObject({status:410,code:"SUBPROCESSOR_UNAVAILABLE"});
});
test("발송 재전송은 주소 변경 뒤에도 추가 발송 없이 원래 접수 결과를 반환하고 페이로드 삭제 후에는 거부한다",async()=>{
  const key=randomUUID(),input={subprocessorId:recipientId,recipientVersion:1,subject:"원래 발송",body:"보관 검사"};
  const first=await sendSubprocessorNoticeRequest(ctx,serviceId,input,key,randomUUID());
  await updateSubprocessor(ctx,serviceId,recipientId,{...person,email:"changed@example.test",status:"archived",version:1},randomUUID());
  const before=await counts();
  expect((await sendSubprocessorNoticeRequest(ctx,serviceId,input,key,randomUUID())).body).toMatchObject({id:first.body.id,email:person.email});
  expect(await counts()).toEqual(before);
  const notice=await db.subprocessorNotice.findUniqueOrThrow({where:{id:first.body.id}});
  await db.job.update({where:{id:notice.jobId!},data:{status:"cancelled",payloadErasedAt:new Date(),payloadCipher:"erased"}});
  await expect(sendSubprocessorNoticeRequest(ctx,serviceId,input,key,randomUUID())).rejects.toMatchObject({status:410,code:"NOTICE_UNAVAILABLE"});
  expect(await counts()).toEqual(before);
});
for (const kind of ["create","send"] as const) {
  test(`${kind}: 인증 후 삭제된 세션은 성공 캐시 재사용도 거부한다`,async()=>{
    const key=randomUUID();
    const call=kind==="create"?()=>createSubprocessorRequest(ctx,serviceId,{...person,email:"cache@example.test"},key,randomUUID()):()=>sendSubprocessorNoticeRequest(ctx,serviceId,{subprocessorId:recipientId,recipientVersion:1,subject:"캐시",body:"안내"},key,randomUUID());
    await call(); const before=await counts();
    await db.session.delete({where:{id:ctx.session.id}});
    await expect(call()).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});
    expect(await counts()).toEqual(before);
  });
  test(`${kind}: 만료된 신규 요청은 재요청 캐시도 남기지 않는다`,async()=>{
    const before=await counts();
    await db.session.update({where:{id:ctx.session.id},data:{expiresAt:new Date(Date.now()+60_000)}});
    vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
    const call=kind==="create"?()=>createSubprocessorRequest(ctx,serviceId,{...person,email:"expired@example.test"},randomUUID(),randomUUID()):()=>sendSubprocessorNoticeRequest(ctx,serviceId,{subprocessorId:recipientId,recipientVersion:1,subject:"만료",body:"안내"},randomUUID(),randomUUID());
    await expect(call()).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});
    expect(await counts()).toEqual(before);
  });
}
