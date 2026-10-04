import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { createDocument, publishDocument, documentOptions } from "@/server/documents";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return { ...actual, db: actual.db.$extends({ query: { documentPublication: { async findMany({ args, query }) {
    const rows = await query(args);
    if (clock.advance) vi.setSystemTime(Date.now() + 120_000);
    return rows;
  } } } }) };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated local test DB required.");
const email = "document-options-authority@example.test", password = "Display-authority!123", origin = new URL(env.BETTER_AUTH_URL).origin;
let userId: string, ctx: Context, serviceId: string, cookie: string;
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
});
afterAll(async () => { clock.advance = false; vi.useRealTimers(); await db.$disconnect(); });
test("문서 선택 목록은 인증 이후 회사 변경을 거부한다",async()=>{
  const other=await db.company.create({data:{name:"다른회사",publicName:"다른회사"}});
  await db.session.update({where:{id:ctx.session.id},data:{activeCompanyId:other.id}});
  await expect(documentOptions(ctx,serviceId)).rejects.toMatchObject({status:403,code:"COMPANY_CHANGED"});
});
test("문서 선택 목록은 인증 이후 MFA 정책을 적용한다",async()=>{
  await db.securityPolicy.create({data:{tenantId:ctx.tenantId,requireMfa:true,passwordMonths:0}});
  await expect(documentOptions(ctx,serviceId)).rejects.toMatchObject({status:403,code:"MFA_REQUIRED"});
});
test("선택 목록의 마지막 DB 조회 중 세션 만료 시 내용을 반환하지 않는다",async()=>{
  await db.session.update({where:{id:ctx.session.id},data:{expiresAt:new Date(Date.now()+60_000)}});
  vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
  await expect(documentOptions(ctx,serviceId)).rejects.toMatchObject({status:401,code:"SESSION_EXPIRED"});
});
test("선택 목록 조회 중 만료된 처리방침은 선택지에서 제외한다",async()=>{
  const response=await createPurpose(request("/processing-purposes",{serviceId,name:"선택 목적",purpose:"시험 안내",lawfulBasis:"consent",basisReference:"",items:[{name:"이름",kind:"general",required:true}],retentionMode:"days",retentionDays:30,retentionReason:"",recipientIds:[]}));
  expect(response.status).toBe(201);const purpose=await response.json();
  const doc=await db.$transaction(tx=>createDocument(tx,ctx,{serviceId,type:"privacy_policy",title:"선택 처리방침",body:"시험",refusalNotice:"거부 가능",rightsContact:"시험 창구",effectiveDate:"2026-10-01",purposeIds:[purpose.id],recipientIds:[]},randomUUID()));
  const publication=await publishDocument(ctx,doc.id,{version:doc.version,expiresAt:new Date(Date.now()+90_000).toISOString()},randomUUID());
  expect((await documentOptions(ctx,serviceId)).policies.map(p=>p.publicationId)).toContain(publication.publicationId);
  vi.useFakeTimers({toFake:["Date"]});clock.advance=true;
  expect((await documentOptions(ctx,serviceId)).policies.map(p=>p.publicationId)).not.toContain(publication.publicationId);
});
