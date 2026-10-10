import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomUUID } from "node:crypto";
import { beforeAll,beforeEach,afterAll,describe,test,expect } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { encrypt,decrypt } from "@/server/crypto";
import { requireContext } from "@/server/context";
import { lockServiceActor } from "@/server/service-actor";
import { assertFileDeadlines,lockFileContext } from "@/server/file-access";
import { GET,POST,PATCH,DELETE } from "@/app/api/v1/security/mfa-policy/[[...segments]]/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as security } from "@/app/api/v1/security/status/route";
import { GET as context } from "@/app/api/v1/context/route";
const url=new URL(env.DATABASE_URL);
if(url.pathname!=="/catchsecu_test"||!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Isolated test DB required");
const a=randomUUID(),b=randomUUID(),origin=new URL(env.BETTER_AUTH_URL).origin,password="MFA-policy-test-1234!";
const roles=["owner","recovery","admin","security","editor","viewer","foreign"] as const;
const cookies:Record<string,string>={},members:Record<string,string>={},users:Record<string,string>={};let serviceId:string,backupCode:string;
function req(path:string,method="GET",data?:unknown,role="owner",extra:Record<string,string>={}){return new Request(origin+"/api/v1"+path,{method,headers:{cookie:cookies[role]??"",origin,...(data?{"content-type":"application/json"}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});}
const cookieOf=(r:Response)=>r.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");
async function status(role="owner",query=""){const r=await GET(req("/security/mfa-policy"+query,"GET",undefined,role));expect(r.status).toBe(200);return r.json();}
async function toggle(required:boolean){const p=(await status()).policy;return PATCH(req("/security/mfa-policy","PATCH",{tenantId:a,version:p.version,required,password}));}
async function create(memberId=members.admin,at=new Date(Date.now()+3600000).toISOString(),tenantId=a,key=randomUUID()){
 const input={tenantId,memberId,reason:"인증 기기 복구 중",expiresAt:at,password};
 const r=await POST(req("/security/mfa-policy/exceptions","POST",input,"owner",{"idempotency-key":key}));
 return {r,key,input};
}
beforeAll(async()=>{
 await db.$executeRawUnsafe('TRUNCATE TABLE "Company","User","Verification","RateLimit","IdempotencyRecord","ApiRateLimit" CASCADE');
 for(const id of[a,b])await db.company.create({data:{id,name:"MFA 회사",publicName:"MFA 회사",policy:{create:{passwordMonths:0}}}});
 serviceId=(await db.service.create({data:{tenantId:a,name:"MFA 서비스",externalName:"MFA 서비스"}})).id;
 for(const role of roles){
  await db.rateLimit.deleteMany();
  const email="mfa-"+role+"@example.test";expect((await auth.handler(req("/auth/sign-up/email","POST",{email,password,name:role},role))).status).toBe(200);
  const u=await db.user.update({where:{email},data:{emailVerified:true}});users[role]=u.id;
  members[role]=(await db.membership.create({data:{tenantId:role==="foreign"?b:a,userId:u.id,role:role==="recovery"?"owner":role==="foreign"?"owner":role}})).id;
  cookies[role]=cookieOf(await auth.handler(req("/auth/sign-in/email","POST",{email,password},role)));
 }
 await db.membership.create({data:{tenantId:b,userId:users.owner,role:"owner"}});
 const enabled=await auth.handler(req("/auth/two-factor/enable","POST",{password}));expect(enabled.status).toBe(200);const payload=await enabled.json();backupCode=payload.backupCodes[0];
 const secret=new TextDecoder().decode(base32.decode(new URL(payload.totpURI).searchParams.get("secret")!));
 const code=await createOTP(secret,{digits:6,period:30}).totp();
 const verified=await auth.handler(req("/auth/two-factor/verify-totp","POST",{code},"owner",{cookie:cookieOf(enabled)||cookies.owner}));
 expect(verified.status).toBe(200);cookies.owner=cookieOf(verified);
 expect((await db.user.findUniqueOrThrow({where:{id:users.owner}})).twoFactorEnabled).toBe(true);
});
beforeEach(async()=>{
 await db.securityPolicy.updateMany({data:{requireMfa:false}});
 await db.mfaException.deleteMany();await db.idempotencyRecord.deleteMany();await db.rateLimit.deleteMany();await db.apiRateLimit.deleteMany();
 await db.membership.updateMany({where:{id:members.admin},data:{status:"active",role:"admin"}});
 await db.user.update({where:{id:users.admin},data:{twoFactorEnabled:false}});
});
afterAll(async()=>{await db.$disconnect();});
describe("company MFA policy and recovery exceptions",()=>{
 test("reports actual enrollment counts without factor secrets, with search and page clamp",async()=>{
  const all=await status();expect(all.summary).toEqual({members:6,enrolled:1,exceptions:0,missing:5});expect(all.policy.canManage).toBe(true);
  const filtered=await status("owner","?search=admin&page=999");expect(filtered.total).toBe(1);expect(filtered.page).toBe(1);
  expect(JSON.stringify(all)).not.toMatch(/totpURI|backupCodes|reasonCipher|secret/);
  expect((await status("admin")).policy.canManage).toBe(false);
 });
 test("policy change is versioned and immediately requires unenrolled users to enroll",async()=>{
  expect((await toggle(true)).status).toBe(200);const denied=await services(req("/services","GET",undefined,"admin"));expect(denied.status).toBe(403);expect((await denied.json()).error.code).toBe("MFA_REQUIRED");
  expect((await (await context(req("/context","GET",undefined,"admin"))).json()).requireMfa).toBe(true);
  expect((await services(req("/services"))).status).toBe(200);expect((await toggle(false)).status).toBe(200);
  expect((await services(req("/services","GET",undefined,"admin"))).status).toBe(200);
 });
 test("policy mutation requires current password, version, tenant and enrolled direct owner",async()=>{
  const p=(await status()).policy;
  expect((await PATCH(req("/security/mfa-policy","PATCH",{tenantId:a,version:p.version,required:true,password:"wrong"}))).status).toBe(401);
  expect((await PATCH(req("/security/mfa-policy","PATCH",{tenantId:b,version:p.version,required:true,password}))).status).toBe(409);
  expect((await PATCH(req("/security/mfa-policy","PATCH",{tenantId:a,version:p.version,required:true,password},"admin"))).status).toBe(403);
  expect((await PATCH(req("/security/mfa-policy","PATCH",{tenantId:a,version:p.version,required:true,password},"recovery"))).status).toBe(409);
  expect((await toggle(true)).status).toBe(200);
  expect((await PATCH(req("/security/mfa-policy","PATCH",{tenantId:a,version:p.version,required:false,password}))).status).toBe(409);
 });
 test("create/read/update/delete are real, latest replay is current and deletion erases creation copies",async()=>{
  const {r,key,input}=await create();expect(r.status).toBe(201);const row=await r.json();
  expect(decrypt((await db.mfaException.findUniqueOrThrow({where:{id:row.id}})).reasonCipher)).toBe(input.reason);
  expect((await GET(req("/security/mfa-policy/exceptions/"+row.id))).status).toBe(200);
  expect((await PATCH(req("/security/mfa-policy/exceptions/"+row.id,"PATCH",{tenantId:a,version:row.version,reason:"새로운 복구 승인 사유",expiresAt:input.expiresAt,password}))).status).toBe(200);
  const replay=await POST(req("/security/mfa-policy/exceptions","POST",input,"owner",{"idempotency-key":key}));
  expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({id:row.id,version:2,reason:"새로운 복구 승인 사유"});
  expect((await DELETE(req("/security/mfa-policy/exceptions/"+row.id,"DELETE",{tenantId:a,version:2,password}))).status).toBe(204);
  expect((await db.mfaException.count({where:{id:row.id}}))).toBe(0);
  expect((await GET(req("/security/mfa-policy/exceptions/"+row.id))).status).toBe(404);
  expect((await POST(req("/security/mfa-policy/exceptions","POST",input,"owner",{"idempotency-key":key}))).status).toBe(410);
  expect(await db.idempotencyRecord.findFirst({where:{resourceId:row.id}})).toMatchObject({responseCipher:null,requestHash:null});
 });
 test("an active exception opens access and a natural clock boundary closes it without cleanup",async()=>{
  const x=await create();expect(x.r.status).toBe(201);const row=await x.r.json();expect((await toggle(true)).status).toBe(200);
  expect((await services(req("/services","GET",undefined,"admin"))).status).toBe(200);
  const created=await db.mfaException.findUniqueOrThrow({where:{id:row.id}});
  await db.mfaException.update({where:{id:row.id},data:{expiresAt:new Date(created.createdAt.getTime()+1),version:{increment:1}}});
  expect((await services(req("/services","GET",undefined,"admin"))).status).toBe(403);
  expect((await POST(req("/security/mfa-policy/exceptions","POST",x.input,"owner",{"idempotency-key":x.key}))).status).toBe(410);
 });
 test("an owner exception also expires and cannot grant management authority",async()=>{
  const x=await create(members.recovery);expect(x.r.status).toBe(201);const row=await x.r.json();expect((await toggle(true)).status).toBe(200);
  expect((await services(req("/services","GET",undefined,"recovery"))).status).toBe(200);
  expect((await POST(req("/security/mfa-policy/exceptions","POST",{...x.input,memberId:members.admin},"recovery",{"idempotency-key":randomUUID()}))).status).toBe(409);
  const saved=await db.mfaException.findUniqueOrThrow({where:{id:row.id}});
  await db.mfaException.update({where:{id:row.id},data:{expiresAt:new Date(saved.createdAt.getTime()+1),version:{increment:1}}});
  expect((await services(req("/services","GET",undefined,"recovery"))).status).toBe(403);
 });
 test("deleting an exception revokes existing password-only access on the next request",async()=>{
  const x=await create();const row=await x.r.json();expect((await toggle(true)).status).toBe(200);
  expect((await services(req("/services","GET",undefined,"admin"))).status).toBe(200);
  expect((await DELETE(req("/security/mfa-policy/exceptions/"+row.id,"DELETE",{tenantId:a,version:1,password}))).status).toBe(204);
  expect((await services(req("/services","GET",undefined,"admin"))).status).toBe(403);
 });
 test.each([new Date(Date.now()-1000).toISOString(),new Date(Date.now()+25*3600000).toISOString()])("rejects unsafe expiration %s",async at=>{expect((await create(members.admin,at)).r.status).toBe(422);});
 test("rejects foreign/enrolled targets and duplicate records",async()=>{
  expect((await create(members.foreign)).r.status).toBe(404);expect((await create(members.owner)).r.status).toBe(409);
  expect((await create()).r.status).toBe(201);expect((await create()).r.status).toBe(409);
 });
 test("conflicting updates keep the current reason and original maximum lifetime",async()=>{
  const x=await create();const row=await x.r.json(),data={tenantId:a,version:1,reason:"복구 승인 기한 변경",expiresAt:x.input.expiresAt,password};
  expect((await PATCH(req("/security/mfa-policy/exceptions/"+row.id,"PATCH",data))).status).toBe(200);
  expect((await PATCH(req("/security/mfa-policy/exceptions/"+row.id,"PATCH",data))).status).toBe(409);
  expect((await PATCH(req("/security/mfa-policy/exceptions/"+row.id,"PATCH",{...data,version:2,expiresAt:new Date(Date.now()+86400000).toISOString()}))).status).toBe(422);
 });
 test.each(["?search=x&search=y","?extra=x","?%5F%5Fproto%5F%5F=x","?page=0"])("strict query %s",async query=>{expect((await GET(req("/security/mfa-policy"+query))).status).toBe(422);});
 test("viewer and foreign company cannot read exception details",async()=>{
  const row=await (await create()).r.json();
  expect((await GET(req("/security/mfa-policy/exceptions/"+row.id,"GET",undefined,"viewer"))).status).toBe(403);
  expect((await GET(req("/security/mfa-policy/exceptions/"+row.id,"GET",undefined,"foreign"))).status).toBe(404);
 });
 test("cross-origin mutation cannot issue an exception",async()=>{
  const input={tenantId:a,memberId:members.admin,reason:"복구 기기 점검 중",expiresAt:new Date(Date.now()+3600000).toISOString(),password};
  expect((await POST(req("/security/mfa-policy/exceptions","POST",input,"owner",{origin:"https://evil.example","idempotency-key":randomUUID()}))).status).toBe(403);
  expect(await db.mfaException.count()).toBe(0);
 });
 test("the final deadline check rolls back late audit and data after exception expiry",async()=>{
  const x=await create(members.admin,new Date(Date.now()+1000).toISOString());expect(x.r.status).toBe(201);expect((await toggle(true)).status).toBe(200);
  const ctx=await requireContext(req("/context","GET",undefined,"admin").headers);
  await expect(db.$transaction(async tx=>{
    const actor=await lockServiceActor(tx,ctx,"security.read");
    await tx.auditEvent.create({data:{tenantId:a,actorId:users.admin,action:"mfa.expiry.rollback",resource:"security",requestId:randomUUID(),detail:{}}});
    await new Promise(resolve=>setTimeout(resolve,1200));assertFileDeadlines(actor.deadlines);
  })).rejects.toMatchObject({code:"MFA_REQUIRED"});
  expect(await db.auditEvent.count({where:{action:"mfa.expiry.rollback"}})).toBe(0);
 });
 test("a stale context cannot use revoked exceptions in a service transaction",async()=>{
  const x=await create();const row=await x.r.json();expect((await toggle(true)).status).toBe(200);
  const ctx=await requireContext(req("/context","GET",undefined,"admin").headers);
  expect((await DELETE(req("/security/mfa-policy/exceptions/"+row.id,"DELETE",{tenantId:a,version:1,password}))).status).toBe(204);
  await expect(db.$transaction(tx=>lockServiceActor(tx,ctx,"security.read"))).rejects.toMatchObject({code:"MFA_REQUIRED"});
  await expect(db.$transaction(tx=>lockFileContext(tx,ctx,serviceId,["file.read"]))).rejects.toMatchObject({code:"MFA_REQUIRED"});
 });
 test("required MFA cannot be disabled, and the last enrolled owner cannot be demoted",async()=>{
  expect((await toggle(true)).status).toBe(200);
  expect((await auth.handler(req("/auth/two-factor/disable","POST",{password}))).status).toBe(403);
  await expect(db.membership.update({where:{id:members.owner},data:{role:"admin"}})).rejects.toThrow(/LAST_MFA_OWNER_REQUIRED/);
 });
 test("native constraints reject tenant mismatch, unsafe lifetime, plaintext and unversioned updates",async()=>{
  await expect(db.mfaException.create({data:{tenantId:a,memberId:members.foreign,createdById:members.owner,reasonCipher:encrypt("복구 승인 사유"),expiresAt:new Date(Date.now()+3600000)}})).rejects.toThrow();
  await expect(db.mfaException.create({data:{tenantId:a,memberId:members.admin,createdById:members.owner,reasonCipher:"plaintext",expiresAt:new Date(Date.now()+3600000)}})).rejects.toThrow();
  await expect(db.mfaException.create({data:{tenantId:a,memberId:members.admin,createdById:members.owner,reasonCipher:encrypt("복구 승인 사유"),expiresAt:new Date(Date.now()+25*3600000)}})).rejects.toThrow();
  const row=await (await create()).r.json();
  await expect(db.mfaException.update({where:{id:row.id},data:{reasonCipher:encrypt("다른 승인 사유")}})).rejects.toThrow();
 });
 test("security results reflect live policy and enrollment with working improvement links",async()=>{
  const first=await security(req("/security/status"));expect(first.status).toBe(200);const before=await first.json();
  expect(before.checks.find((x:{id:string})=>x.id==="company-mfa").passed).toBe(false);
  expect(before.checks.find((x:{id:string})=>x.id==="owner-recovery").passed).toBe(true);
  expect((await toggle(true)).status).toBe(200);const after=await (await security(req("/security/status"))).json();
  expect(after.checks.find((x:{id:string})=>x.id==="company-mfa").passed).toBe(true);
  expect(after.checks.every((x:{href:string})=>x.href.startsWith("/"))).toBe(true);
  expect(JSON.stringify(after)).not.toMatch(/backupCodes|reasonCipher|totpURI/);
  expect((await security(req("/security/status?extra=x"))).status).toBe(422);
  expect((await security(req("/security/status","GET",undefined,"viewer"))).status).toBe(403);
 });
 test("the last enrolled owner account cannot lose its factor or active status",async()=>{
  expect((await toggle(true)).status).toBe(200);
  await expect(db.user.update({where:{id:users.owner},data:{twoFactorEnabled:false}})).rejects.toThrow(/LAST_MFA_OWNER_REQUIRED/);
  await expect(db.user.update({where:{id:users.owner},data:{status:"suspended"}})).rejects.toThrow(/LAST_MFA_OWNER_REQUIRED/);
 });
 test("an actual recovery code completes login once and reuse fails",async()=>{
  const signIn=()=>auth.handler(req("/auth/sign-in/email","POST",{email:"mfa-owner@example.test",password},"owner",{cookie:""}));
  const first=await signIn();expect(first.status).toBe(200);expect((await first.json()).twoFactorRedirect).toBe(true);
  const recovered=await auth.handler(req("/auth/two-factor/verify-backup-code","POST",{code:backupCode},"owner",{cookie:cookieOf(first)}));expect(recovered.status).toBe(200);
  const second=await signIn();expect(second.status).toBe(200);
  const reused=await auth.handler(req("/auth/two-factor/verify-backup-code","POST",{code:backupCode},"owner",{cookie:cookieOf(second)}));expect(reused.status).toBe(401);
 });
});

beforeSecurityCase(grantSecurityTestTrials);
