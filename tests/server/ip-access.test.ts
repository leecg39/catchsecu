import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { containsAddress, parseAddress, parseNetwork } from "@/server/ip-network";
import { proxyNetworks, resolvePeerIp, signClientIp, stampClientIp, trustedClientIp } from "@/server/client-ip";
import { requireContext } from "@/server/context";
import { listSenders } from "@/server/senders";
import { GET,POST,PATCH,DELETE } from "@/app/api/v1/security/ip-rules/[[...segments]]/route";
import { GET as context, POST as select } from "@/app/api/v1/context/route";
import { GET as companies } from "@/app/api/v1/companies/route";
import { GET as company } from "@/app/api/v1/companies/[id]/route";
const database=new URL(env.DATABASE_URL);
if(database.pathname!=="/catchsecu_test"||!["localhost","127.0.0.1"].includes(database.hostname))throw new Error("Isolated local test DB only");
const origin=new URL(env.BETTER_AUTH_URL).origin,key=randomBytes(32).toString("hex"),priorKey=process.env.APP_IP_SIGNING_KEY;
const a=randomUUID(),b=randomUUID(),serviceId=randomUUID(),password="IP-access-test!12345";
const roles=["owner","admin","security","viewer"] as const;
const emails=roles.map(role=>"ip-"+role+"@example.test");const cookies:Record<string,string>={};
const peer="192.0.2.7";
function request(path:string,method="GET",value?:unknown,cookie=cookies.owner,ip:string|null=peer,extra:Record<string,string>={}) {
  return new Request(origin+"/api/v1"+path,{method,headers:{cookie,origin,...(value?{"content-type":"application/json"}:{}),...(ip?{"x-catchsecu-client-ip":ip,"x-catchsecu-ip-proof":signClientIp(ip,key)}:{}),...extra},...(value?{body:JSON.stringify(value)}:{})});
}
const cookieOf=(r:Response)=>r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
async function login(email=emails[0],ip:string|null=peer) {return auth.handler(request("/auth/sign-in/email","POST",{email,password},"",ip));}
async function list(cookie=cookies.owner,query="") {const r=await GET(request("/security/ip-rules"+query,"GET",undefined,cookie));expect(r.status).toBe(200);return r.json();}
async function add(cidr="192.0.2.0/24",enabled=true,description="테스트 규칙",id=randomUUID()) {
  const r=await POST(request("/security/ip-rules","POST",{tenantId:a,cidr,enabled,description},cookies.owner,peer,{"idempotency-key":id}));expect(r.status).toBe(201);return {row:await r.json(),key:id,input:{tenantId:a,cidr,enabled,description}};
}
async function toggle(enabled:boolean) {const p=(await list()).policy;return PATCH(request("/security/ip-rules/settings","PATCH",{tenantId:a,version:p.version,enabled,password}));}
beforeAll(async()=>{
  process.env.APP_IP_SIGNING_KEY=key;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company","User","Verification","RateLimit","IdempotencyRecord","ApiRateLimit" CASCADE');
  for(const id of [a,b])await db.company.create({data:{id,name:"IP 회사",publicName:"IP 회사",policy:{create:{passwordMonths:0}}}});
  await db.service.create({data:{id:serviceId,tenantId:a,name:"IP 서비스",externalName:"IP 서비스"}});
  for(let i=0;i<roles.length;i++){
    const r=await auth.handler(request("/auth/sign-up/email","POST",{name:roles[i],email:emails[i],password},""));expect(r.status).toBe(200);
    const user=await db.user.update({where:{email:emails[i]},data:{emailVerified:true}});
    await db.membership.create({data:{tenantId:a,userId:user.id,role:roles[i]}});
    if(i===0)await db.membership.create({data:{tenantId:b,userId:user.id,role:"owner"}});
    cookies[roles[i]]=cookieOf(await login(emails[i]));
  }
});
beforeEach(async()=>{
  for(const id of [a,b]){
    const p=await db.ipAccessPolicy.findUnique({where:{tenantId:id}});
    if(p)await db.ipAccessPolicy.update({where:{tenantId:id},data:{enabled:false,version:{increment:1}}});
  }
  await db.ipRule.deleteMany();await db.idempotencyRecord.deleteMany();await db.rateLimit.deleteMany();await db.apiRateLimit.deleteMany();
  const owner=await db.user.findUniqueOrThrow({where:{email:emails[0]}});await db.membership.updateMany({where:{tenantId:a,userId:owner.id},data:{role:"owner"}});
  const admin=await db.user.findUniqueOrThrow({where:{email:emails[1]}});await db.membership.updateMany({where:{tenantId:a,userId:admin.id},data:{role:"admin"}});
  cookies.owner=cookieOf(await login());
});
afterAll(async()=>{if(priorKey===undefined)delete process.env.APP_IP_SIGNING_KEY;else process.env.APP_IP_SIGNING_KEY=priorKey;await db.$disconnect();});
describe("IP network and trusted transport",()=>{
  test.each([
    ["192.0.2.7/24","192.0.2.0/24"],["192.0.2.7","192.0.2.7/32"],
    ["2001:0DB8:0000:1::abcd/64","2001:db8:0:1::/64"],["::1","::1/128"],
    ["::ffff:192.0.2.7/120","192.0.2.0/24"],["0.0.0.0/0","0.0.0.0/0"],
  ])("normalizes %s", (input,expected)=>{expect(parseNetwork(input)?.cidr).toBe(expected);});
  test.each(["localhost","192.0.2.1:80","192.168.001.1","fe80::1%eth0","[::1]","192.0.2.1/33","::1/129","::ffff:192.0.2.7/64","192.0.2.1/24/1"])("rejects malformed %s",v=>expect(parseNetwork(v)).toBeNull());
  test("IPv4, IPv6 and mapped addresses respect both ends and address families",()=>{
    expect(containsAddress("192.0.2.0/24","192.0.2.0")).toBe(true);expect(containsAddress("192.0.2.0/24","192.0.2.255")).toBe(true);
    expect(containsAddress("192.0.2.0/24","192.0.3.0")).toBe(false);expect(containsAddress("192.0.2.0/24","::ffff:192.0.2.7")).toBe(true);
    expect(containsAddress("2001:db8::/32","2001:db8:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(containsAddress("2001:db8::/32","2001:db9::")).toBe(false);expect(containsAddress("::/0","192.0.2.7")).toBe(false);
    expect(parseAddress("::ffff:192.0.2.7")?.address).toBe("192.0.2.7");
  });
  test("a direct peer ignores forged headers; proxy chains stop at the nearest untrusted hop",()=>{
    expect(resolvePeerIp("198.51.100.5","192.0.2.7",[])).toBe("198.51.100.5");
    const proxies=proxyNetworks("10.0.0.0/24");
    expect(resolvePeerIp("10.0.0.2","192.0.2.7, 198.51.100.5, 10.0.0.3",proxies)).toBe("198.51.100.5");
    expect(resolvePeerIp("10.0.0.2","192.0.2.7, 10.0.0.3",proxies)).toBe("192.0.2.7");
    expect(resolvePeerIp("10.0.0.2","bad, 10.0.0.3",proxies)).toBeNull();expect(resolvePeerIp("10.0.0.2",undefined,proxies)).toBeNull();
    expect(()=>proxyNetworks("0.0.0.0/0")).toThrow();
  });
  test("an attestation rejects tampering, expiry, future timestamps and missing signing key",()=>{
    const headers=new Headers({"x-catchsecu-client-ip":peer,"x-catchsecu-ip-proof":signClientIp(peer,key)});
    expect(trustedClientIp(headers)).toBe(peer);headers.set("x-catchsecu-client-ip","198.51.100.5");expect(trustedClientIp(headers)).toBeNull();
    headers.set("x-catchsecu-client-ip",peer);
    headers.set("x-catchsecu-ip-proof",signClientIp(peer,key,Date.now()-121000));expect(trustedClientIp(headers)).toBeNull();
    headers.set("x-catchsecu-ip-proof",signClientIp(peer,key,Date.now()+6000));expect(trustedClientIp(headers)).toBeNull();
    headers.set("x-catchsecu-ip-proof",signClientIp(peer,key));delete process.env.APP_IP_SIGNING_KEY;expect(trustedClientIp(headers)).toBeNull();process.env.APP_IP_SIGNING_KEY=key;
  });
  test.each(["127.0.0.1","::1"])("native TCP peer %s overwrites the attacker's original and raw headers",async host=>{
    const server=createServer((req,res)=>{stampClientIp(req,key,[]);const headers=new Headers(req.headers as Record<string,string>);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ip:trustedClientIp(headers),raw:req.rawHeaders.filter((v,i)=>i%2===1&&v===peer).length,forwarded:headers.get("forwarded")}));});
    await new Promise<void>(resolve=>server.listen(0,host,resolve));const address=server.address();if(!address||typeof address==="string")throw new Error("Missing TCP listener");
    try{const response=await fetch("http://"+(host.includes(":")?"["+host+"]":host)+":"+address.port,{headers:{"x-forwarded-for":peer,"x-real-ip":peer,"forwarded":"for="+peer,"x-catchsecu-client-ip":peer,"x-catchsecu-ip-proof":signClientIp(peer,key)}});
      expect(await response.json()).toEqual({ip:host,raw:0,forwarded:null});
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
});
describe("PostgreSQL IP CRUD and enforcement",()=>{
  test("owner CRUD normalizes ranges, preserves current replay and erases deleted request copies",async()=>{
    const created=await add("192.0.2.7/24");expect(created.row.cidr).toBe("192.0.2.0/24");
    expect((await GET(request("/security/ip-rules/"+created.row.id))).status).toBe(200);
    const update=await PATCH(request("/security/ip-rules/"+created.row.id,"PATCH",{...created.input,cidr:"192.0.2.8/24",description:"수정",version:1}));expect(update.status).toBe(200);
    const replay=await POST(request("/security/ip-rules","POST",created.input,cookies.owner,peer,{"idempotency-key":created.key}));expect(await replay.json()).toMatchObject({version:2,description:"수정"});
    const removed=await DELETE(request("/security/ip-rules/"+created.row.id,"DELETE",{tenantId:a,version:2}));expect(removed.status).toBe(204);
    expect((await GET(request("/security/ip-rules/"+created.row.id))).status).toBe(404);
    expect((await POST(request("/security/ip-rules","POST",created.input,cookies.owner,peer,{"idempotency-key":created.key}))).status).toBe(410);
    expect(await db.idempotencyRecord.findFirst({where:{resourceId:created.row.id}})).toMatchObject({responseCipher:null});
  });
  test("admin and security read; only current direct owner can mutate",async()=>{
    for(const role of ["admin","security"]) {
      expect((await list(cookies[role])).policy.canManage).toBe(false);
      expect((await POST(request("/security/ip-rules","POST",{tenantId:a,cidr:peer,description:"",enabled:true},cookies[role],peer,{"idempotency-key":randomUUID()}))).status).toBe(403);
    }
    expect((await GET(request("/security/ip-rules","GET",undefined,cookies.viewer))).status).toBe(403);
    const replacement=await db.user.findUniqueOrThrow({where:{email:emails[1]}});await db.membership.updateMany({where:{tenantId:a,userId:replacement.id},data:{role:"owner"}});
    const owner=await db.user.findUniqueOrThrow({where:{email:emails[0]}});await db.membership.updateMany({where:{tenantId:a,userId:owner.id},data:{role:"security"}});
    expect((await list()).policy.canManage).toBe(false);
    expect((await POST(request("/security/ip-rules","POST",{tenantId:a,cidr:peer},cookies.owner,peer,{"idempotency-key":randomUUID()}))).status).toBe(403);
  });
  test("foreign tenant IDs and stale versions cannot change rows",async()=>{
    const c=await add();expect((await PATCH(request("/security/ip-rules/"+c.row.id,"PATCH",{...c.input,tenantId:b,version:1}))).status).toBe(409);
    expect((await DELETE(request("/security/ip-rules/"+c.row.id,"DELETE",{tenantId:a,version:2}))).status).toBe(409);
    expect((await select(request("/context","POST",{companyId:b}))).status).toBe(200);
    expect((await GET(request("/security/ip-rules/"+c.row.id))).status).toBe(404);
  });
  test("strict queries, validation, duplicate canonical networks and page clamping",async()=>{
    await add();await add("2001:db8::/64",false,"IPv6");
    const sorted=await list(cookies.owner,"?page=999&sort=cidr&direction=asc");expect(sorted.page).toBe(1);expect(sorted.total).toBe(2);
    for(const suffix of ["?page=1&page=2","?extra=x","?%5F%5Fproto%5F%5F=x"])expect((await GET(request("/security/ip-rules"+suffix))).status).toBe(422);
    expect((await POST(request("/security/ip-rules","POST",{tenantId:a,cidr:"192.0.2.99/24"},cookies.owner,peer,{"idempotency-key":randomUUID()}))).status).toBe(409);
    expect((await POST(request("/security/ip-rules","POST",{tenantId:a,cidr:"localhost"},cookies.owner,peer,{"idempotency-key":randomUUID()}))).status).toBe(422);
  });
  test("policy activation requires a trusted matching IP and current password",async()=>{
    expect((await toggle(true)).status).toBe(409);await add();
    const p=(await list()).policy;
    expect((await PATCH(request("/security/ip-rules/settings","PATCH",{tenantId:a,version:p.version,enabled:true,password:"incorrect"}))).status).toBe(401);
    expect((await PATCH(request("/security/ip-rules/settings","PATCH",{tenantId:a,version:p.version,enabled:true,password},cookies.owner,null,{"x-forwarded-for":peer}))).status).toBe(409);
    expect((await toggle(true)).status).toBe(200);
    expect((await context(request("/context","GET",undefined,cookies.owner,peer))).status).toBe(200);
    expect((await context(request("/context","GET",undefined,cookies.owner,"198.51.100.5",{"x-forwarded-for":peer}))).status).toBe(403);
    expect((await company(request("/companies/"+a,"GET",undefined,cookies.owner,null,{"x-forwarded-for":peer}))).status).toBe(403);
  });
  test("editing, disabling and deleting the owner's last allowed network rolls back",async()=>{
    const c=await add();expect((await toggle(true)).status).toBe(200);
    for(const changes of [{cidr:"198.51.100.0/24"},{enabled:false}]) {
      const r=await PATCH(request("/security/ip-rules/"+c.row.id,"PATCH",{...c.input,version:1,...changes}));expect(r.status).toBe(409);expect((await r.json()).error.code).toBe("IP_LOCKOUT");
    }
    expect((await DELETE(request("/security/ip-rules/"+c.row.id,"DELETE",{tenantId:a,version:1}))).status).toBe(409);
    expect(await db.ipRule.findUnique({where:{id:c.row.id}})).toMatchObject({version:1,enabled:true,cidr:c.row.cidr});
    expect((await toggle(false)).status).toBe(200);expect((await DELETE(request("/security/ip-rules/"+c.row.id,"DELETE",{tenantId:a,version:1}))).status).toBe(204);
  });
  test("denied target-company selection does not mutate the current session",async()=>{
    await db.ipRule.create({data:{tenantId:b,cidr:"198.51.100.0/24"}});await db.ipAccessPolicy.upsert({where:{tenantId:b},create:{tenantId:b,enabled:true},update:{enabled:true,version:{increment:1}}});
    expect((await select(request("/context","POST",{companyId:b}))).status).toBe(403);expect((await context(request("/context"))).status).toBe(200);
    expect((await (await context(request("/context"))).json()).company.id).toBe(a);
  });
  test("login chooses an allowed company and refuses when every company is blocked",async()=>{
    await db.ipRule.create({data:{tenantId:a,cidr:"198.51.100.0/24"}});await db.ipAccessPolicy.upsert({where:{tenantId:a},create:{tenantId:a,enabled:true},update:{enabled:true,version:{increment:1}}});
    const permitted=await login();expect(permitted.status).toBe(200);expect((await auth.api.getSession({headers:new Headers({cookie:cookieOf(permitted)}),query:{disableRefresh:true}}))!.session.activeCompanyId).toBe(b);
    await db.ipRule.create({data:{tenantId:b,cidr:"198.51.100.0/24"}});await db.ipAccessPolicy.upsert({where:{tenantId:b},create:{tenantId:b,enabled:true},update:{enabled:true,version:{increment:1}}});
    const before=await db.session.count();expect((await login()).status).toBe(403);expect(await db.session.count()).toBe(before);
  });
  test("company enumeration hides protected fields and still returns another allowed company",async()=>{
    await db.ipRule.create({data:{tenantId:a,cidr:"198.51.100.0/24"}});await db.ipAccessPolicy.upsert({where:{tenantId:a},create:{tenantId:a,enabled:true},update:{enabled:true,version:{increment:1}}});
    const r=await companies(request("/companies?page=999"));expect(r.status).toBe(200);const result=await r.json();expect(result.total).toBe(1);expect(result.page).toBe(1);expect(result.blockedTotal).toBe(1);expect(result.items.map((row:{id:string})=>row.id)).toEqual([b]);
    expect((await select(request("/context","POST",{companyId:b}))).status).toBe(200);expect((await context(request("/context"))).status).toBe(200);
  });
  test("a stale authorized context is checked again inside a service transaction",async()=>{
    const c=await add();await add("198.51.100.0/24");expect((await toggle(true)).status).toBe(200);
    const ctx=await requireContext(request("/context").headers);
    await db.ipRule.update({where:{id:c.row.id},data:{enabled:false,version:{increment:1}}});
    await expect(listSenders(ctx,{serviceId,channel:"email",search:"",status:"all",page:1,pageSize:20,sort:"createdAt",direction:"desc"},randomUUID())).rejects.toMatchObject({status:403,code:"IP_NOT_ALLOWED"});
  });
  test("simultaneous owner changes preserve one current allowed network",async()=>{
    const first=await add(peer),second=await add("198.51.100.5");expect((await toggle(true)).status).toBe(200);
    const responses=await Promise.all([
      DELETE(request("/security/ip-rules/"+second.row.id,"DELETE",{tenantId:a,version:1},cookies.owner,peer)),
      DELETE(request("/security/ip-rules/"+first.row.id,"DELETE",{tenantId:a,version:1},cookies.owner,"198.51.100.5"))
    ]);
    expect(responses.filter(r=>r.status===204)).toHaveLength(1);expect(responses.some(r=>[403,409].includes(r.status))).toBe(true);
    expect(await db.ipRule.count({where:{tenantId:a,enabled:true}})).toBe(1);
  });
  test("database rejects malformed CIDR, stale versions, tenant moves and an empty active policy",async()=>{
    const c=await add();await expect(db.ipRule.update({where:{id:c.row.id},data:{description:"raw"}})).rejects.toBeDefined();
    await expect(db.ipRule.update({where:{id:c.row.id},data:{tenantId:b,version:{increment:1}}})).rejects.toBeDefined();
    await expect(db.ipRule.create({data:{tenantId:a,cidr:"bad"}})).rejects.toBeDefined();
    expect((await toggle(true)).status).toBe(200);await expect(db.ipRule.delete({where:{id:c.row.id}})).rejects.toBeDefined();
    await expect(db.ipAccessPolicy.update({where:{tenantId:a},data:{enabled:false}})).rejects.toBeDefined();
  });
});

beforeSecurityCase(grantSecurityTestTrials);
