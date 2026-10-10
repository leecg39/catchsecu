import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { closeComplianceMonth, complianceCloseCsv } from "@/server/compliance-close";
import { createComplianceExport, getComplianceExport, listComplianceExports, changeComplianceExport, downloadComplianceExport,
  claimComplianceExport, processComplianceExport, runOneComplianceExport, cleanupComplianceExports } from "@/server/compliance-exports";
import { sha256 } from "@/server/pdf-renderer";
import { POST as createRoute } from "@/app/api/v1/analytics/exports/route";
import { GET as getRoute, POST as cancelRoute, DELETE as deleteRoute } from "@/app/api/v1/analytics/exports/[...segments]/route";
const faults = vi.hoisted(() => ({ action: "", advance: false, render: false, afterRender: null as null | (() => Promise<void>) }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (args[3] === faults.action) {
      if (faults.advance) vi.setSystemTime(Date.now() + 120_000);
      else throw new Error("synthetic audit failure");
    }
  } };
});
vi.mock("@/server/pdf-renderer", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/pdf-renderer")>();
  return { ...actual, renderPdf: async (...args: Parameters<typeof actual.renderPdf>) => {
    if (faults.render) throw new Error("synthetic render failure");
    const result = await actual.renderPdf(...args); await faults.afterRender?.(); return result;
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const email = "close-export@example.test", password = "Close-export!123", month = "2026-09";
let userId: string, ctx: Context, serviceId: string, currentCookie: string;
function request(path: string, input?: unknown, cookie = "") {
  return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie,
    ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", { email, password, name: "마감 권한 검증" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  vi.useRealTimers(); faults.action = ""; faults.advance = false; faults.render = false; faults.afterRender = null;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "마감 권한 검증", publicName: "검증",
    memberships: { create: { userId, role: "owner" } }, services: { create: [{ name: "A", externalName: "A" }, { name: "B", externalName: "B" }] },
  }, include: { services: true } });
  serviceId = company.services[0].id;
  const signed = await auth.handler(request("/auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  currentCookie = cookie;
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(request("/context", undefined, cookie).headers, "service.read");
});
afterAll(async () => { faults.action = ""; faults.advance = false; faults.render = false; faults.afterRender = null; vi.useRealTimers(); await db.$disconnect(); });
const makeClose = async () => (await closeComplianceMonth(ctx, { month, serviceId }, randomUUID())).close;
async function queued(format: "pdf" | "csv" = "csv") {
  const close = await makeClose(); return createComplianceExport(ctx, { closeId: close.id, format }, randomUUID(), randomUUID());
}
async function ready(format: "pdf" | "csv" = "csv") {
  const row = await queued(format); expect(await runOneComplianceExport("test-worker", new Date(), row.id)).toBe(true); return getComplianceExport(ctx, row.id);
}
async function revoke() {
  const backup = await db.user.create({ data: { id: randomUUID(), name: "합성 소유자", email: randomUUID() + "@example.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: backup.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
}
test("CSV 작업은 고정 마감과 동일한 실제 파일을 반환하고 다운로드를 감사한다", async () => {
  const row = await ready(); expect(row.status).toBe("ready");
  const result = await downloadComplianceExport(ctx, row.id, randomUUID());
  expect(Buffer.from(result.bytes!).toString()).toBe(await complianceCloseCsv(ctx, row.closeId));
  expect(result.hash).toBe(sha256(result.bytes!));
  const stored = await db.complianceExportJob.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.resultCipher).not.toContain("미판정");
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "compliance.export_downloaded" } })).toBe(1);
});
test("출력 상세·다운로드·취소·삭제 route가 실제 작업 상태를 처리한다", async () => {
  const close = await makeClose();
  const created = await createRoute(new Request(origin + "/api/v1/analytics/exports", { method: "POST", headers: {
    origin, cookie: currentCookie, "content-type": "application/json", "idempotency-key": randomUUID(),
  }, body: JSON.stringify({ closeId: close.id, format: "csv" }) }));
  expect(created.status).toBe(202);
  const completed = await ready();
  expect((await getRoute(request("/analytics/exports/" + completed.id, undefined, currentCookie))).status).toBe(200);
  expect((await getRoute(request("/analytics/exports/" + completed.id + "/download", undefined, currentCookie))).status).toBe(200);
  const pending = await queued();
  const cancelledResponse = await cancelRoute(request("/analytics/exports/" + pending.id + "/cancel", { version: pending.version }, currentCookie));
  expect(cancelledResponse.status).toBe(200);
  const cancelled = await cancelledResponse.json();
  const deletion = await deleteRoute(new Request(origin + "/api/v1/analytics/exports/" + pending.id, { method: "DELETE", headers: {
    origin, cookie: currentCookie, "content-type": "application/json" }, body: JSON.stringify({ version: cancelled.version }) }));
  expect(deletion.status).toBe(204);
});
test("PDF는 한글·미판정·고정 합계와 원천 해시를 포함하며 활성 콘텐츠가 없다", async () => {
  const row = await ready("pdf"); expect(row.status).toBe("ready");
  const result = await downloadComplianceExport(ctx, row.id, randomUUID());
  expect(Buffer.from(result.bytes!).subarray(0,5).toString()).toBe("%PDF-");
  const task = getDocument({ data: new Uint8Array(result.bytes!), useSystemFonts: false }); const pdf = await task.promise;
  try {
    let text = "";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      text += content.items.map(item => "str" in item ? item.str : "").join(" ");
    }
    expect(text.replace(/\s/g," ")).toContain("미판정"); expect(text).toContain(month); expect(text).toContain(result.sourceHash);
    expect(text).toContain("보유 0건"); expect(await pdf.getJSActions()).toBeNull(); expect(await pdf.getAttachments()).toBeNull();
    expect(pdf.numPages).toBe(row.pageCount);
  } finally { await task.destroy(); }
});
test("같은 요청 키 동시 생성은 단일 작업이고 다른 형식은 409다", async () => {
  const close = await makeClose(), key = randomUUID();
  const rows = await Promise.all([1,2,3].map(()=>createComplianceExport(ctx,{closeId:close.id,format:"csv"},key,randomUUID())));
  expect(new Set(rows.map(row=>row.id)).size).toBe(1);
  expect(await db.auditEvent.count({where:{resourceId:rows[0].id,action:"compliance.export_requested"}})).toBe(1);
  await expect(createComplianceExport(ctx,{closeId:close.id,format:"pdf"},key,randomUUID())).rejects.toMatchObject({status:409});
});
test("요청 키 필수·대기 5개 제한·목록 페이지 보정", async () => {
  const close = await makeClose();
  await expect(createComplianceExport(ctx,{closeId:close.id,format:"csv"},null,randomUUID())).rejects.toMatchObject({status:400});
  for(let i=0;i<5;i++)await queued();
  await expect(queued()).rejects.toMatchObject({status:409,code:"EXPORT_QUEUE_LIMIT"});
  const list=await listComplianceExports(ctx,{closeId:close.id,page:10,pageSize:2});expect(list.total).toBe(5);expect(list.page).toBe(3);expect(list.items).toHaveLength(1);
});
test("감사 실패 시 출력 작업도 생성되지 않는다",async()=>{
  faults.action="compliance.export_requested";await expect(queued()).rejects.toThrow("synthetic audit failure");
  expect(await db.complianceExportJob.count({where:{tenantId:ctx.tenantId}})).toBe(0);
});
test("요청 감사 중 세션 만료는 작업을 롤백한다",async()=>{
  await db.session.update({where:{id:ctx.session.id},data:{expiresAt:new Date(Date.now()+60000)}});
  vi.useFakeTimers({toFake:["Date"]});faults.action="compliance.export_requested";faults.advance=true;
  await expect(queued()).rejects.toMatchObject({status:401});expect(await db.complianceExportJob.count({where:{tenantId:ctx.tenantId}})).toBe(0);
});
test("요청 권한이 회수되면 worker는 결과를 게시하지 않는다",async()=>{
  const row=await queued();await revoke();await runOneComplianceExport("revoked",new Date(),row.id);
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("failed");expect(stored.resultCipher).toBeNull();
});
test("PDF 렌더링 도중 권한 회수도 최종 게시를 거부한다",async()=>{
  const row=await queued("pdf");faults.afterRender=revoke;await runOneComplianceExport("revoked-after-render",new Date(),row.id);
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("failed");expect(stored.resultCipher).toBeNull();
});
for(const operation of ["get","list","download","replay"] as const)test(`${operation}: 현재 권한 회수 후 저장된 출력도 차단한다`,async()=>{
  const close=await makeClose(),key=randomUUID(),row=await createComplianceExport(ctx,{closeId:close.id,format:"csv"},key,randomUUID());
  await runOneComplianceExport("prepare",new Date(),row.id);await revoke();
  const action=operation==="get"?()=>getComplianceExport(ctx,row.id):operation==="list"?()=>listComplianceExports(ctx,{closeId:close.id,page:1,pageSize:10}):operation==="download"?()=>downloadComplianceExport(ctx,row.id,randomUUID()):()=>createComplianceExport(ctx,{closeId:close.id,format:"csv"},key,randomUUID());
  await expect(action()).rejects.toMatchObject({status:404});
});
test("만료된 결과는 410이며 암호문을 지우고 재사용하지 않는다",async()=>{
  const row=await ready();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(row.expiresAt).getTime()+1);
  await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:410});
  // Cleanup is session-independent and erases only the selected synthetic job.
  expect(await cleanupComplianceExports(new Date(),row.id)).toBe(0);
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("expired");expect(stored.resultCipher).toBeNull();expect(stored.resultHash).toBeNull();
  vi.useRealTimers();await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:410});
});
test("취소·삭제·stale version을 처리하고 늦은 worker는 파일을 복구하지 못한다",async()=>{
  const row=await queued(),claim=await claimComplianceExport("slow",new Date(),row.id);expect(claim).not.toBeNull();
  await expect(changeComplianceExport(ctx,row.id,row.version,false,randomUUID())).rejects.toMatchObject({status:409});
  const cancelled=await changeComplianceExport(ctx,row.id,claim!.version,false,randomUUID());expect(cancelled.status).toBe("cancelled");
  await processComplianceExport(claim!,"slow");expect((await getComplianceExport(ctx,row.id)).status).toBe("cancelled");
  expect((await changeComplianceExport(ctx,row.id,cancelled.version,true,randomUUID())).status).toBe("deleted");
});
test("완료 파일 삭제는 암호문을 제거한다",async()=>{
  const row=await ready();await changeComplianceExport(ctx,row.id,row.version,true,randomUUID());
  expect((await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}})).resultCipher).toBeNull();
  await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:410});
});
test("만료 임대는 새 worker가 인계하며 이전 worker 결과는 버린다",async()=>{
  const row=await queued(),first=await claimComplianceExport("old",new Date(),row.id);
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+61000);
  const second=await claimComplianceExport("new",new Date(),row.id);expect(second!.version).toBeGreaterThan(first!.version);
  await processComplianceExport(first!,"old");expect((await getComplianceExport(ctx,row.id)).status).toBe("processing");
  await processComplianceExport(second!,"new");expect((await getComplianceExport(ctx,row.id)).status).toBe("ready");
});
test("일시적 renderer 오류 후 재시도로 실제 PDF를 완성한다",async()=>{
  const row=await queued("pdf");faults.render=true;await runOneComplianceExport("fault",new Date(),row.id);
  const failed=await getComplianceExport(ctx,row.id);expect(failed.status).toBe("processing");expect(failed.errorCode).toBe("EXPORT_WORKER_RETRY");
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+5000);faults.render=false;
  await runOneComplianceExport("retry",new Date(),row.id);expect((await getComplianceExport(ctx,row.id)).status).toBe("ready");
});
test("동시 claim은 하나만 성공한다",async()=>{
  const row=await queued();const claims=await Promise.all(["a","b","c"].map(w=>claimComplianceExport(w,new Date(),row.id)));
  expect(claims.filter(Boolean)).toHaveLength(1);
});
test("다른 요청자는 같은 회사에서도 작업 ID로 다운로드하지 못한다",async()=>{
  const row=await ready(),other={...ctx,user:{...ctx.user,id:randomUUID()}};
  await expect(getComplianceExport(other,row.id)).rejects.toMatchObject({status:404});await expect(downloadComplianceExport(other,row.id,randomUUID())).rejects.toMatchObject({status:404});
});
test("DB는 출력 범위 변경·기한 연장·다른 회사 FK를 거부한다",async()=>{
  const row=await queued();await expect(db.complianceExportJob.update({where:{id:row.id},data:{format:"pdf",version:{increment:1}}})).rejects.toMatchObject({code:"P2039"});
  await expect(db.complianceExportJob.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()+48*3600000),version:{increment:1}}})).rejects.toMatchObject({code:"P2039"});
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});
  await expect(db.complianceExportJob.create({data:{...stored,id:randomUUID(),tenantId:randomUUID(),requestKeyHash:randomUUID()}})).rejects.toMatchObject({code:"P2003"});
});
test("HTTP 인증 없는 출력 요청·다운로드는 401이다",async()=>{
  expect((await createRoute(request("/analytics/exports",{closeId:randomUUID(),format:"pdf"}))).status).toBe(401);
  expect((await getRoute(request("/analytics/exports/"+randomUUID()+"/download"))).status).toBe(401);
});
test("원 요청 세션이 종료되어도 worker는 처리하고 다운로드는 새 인증을 요구한다",async()=>{
  const row=await queued();await db.session.delete({where:{id:ctx.session.id}});
  await runOneComplianceExport("session-independent",new Date(),row.id);
  expect((await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}})).status).toBe("ready");
  await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:401});
});
test("회사 전체 출력도 변경된 MFA 정책을 worker에서 적용한다",async()=>{
  const close=(await closeComplianceMonth(ctx,{month},randomUUID())).close;
  const row=await createComplianceExport(ctx,{closeId:close.id,format:"csv"},randomUUID(),randomUUID());
  await db.securityPolicy.create({data:{tenantId:ctx.tenantId,requireMfa:true,passwordMonths:0}});
  await runOneComplianceExport("mfa",new Date(),row.id);
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("failed");expect(stored.lastError).toBe("MFA_REQUIRED");
});
test("worker 완료 감사 실패는 파일 게시를 롤백하고 다음 시도에서 완료한다",async()=>{
  const row=await queued();faults.action="compliance.export_completed";
  await runOneComplianceExport("audit-fault",new Date(),row.id);
  let stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("processing");expect(stored.resultCipher).toBeNull();
  expect(await db.auditEvent.count({where:{resourceId:row.id,action:faults.action}})).toBe(0);
  faults.action="";vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+5000);
  await runOneComplianceExport("audit-retry",new Date(),row.id);
  stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.status).toBe("ready");
});
test("완료 감사 중 임대 만료 시 파일을 게시하지 않는다",async()=>{
  const row=await queued();faults.action="compliance.export_completed";faults.advance=true;vi.useFakeTimers({toFake:["Date"]});
  await runOneComplianceExport("late",new Date(),row.id);
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});expect(stored.resultCipher).toBeNull();expect(stored.status).toBe("failed");
  expect(await db.auditEvent.count({where:{resourceId:row.id,action:faults.action}})).toBe(0);
});
test("다운로드 감사 도중 세션 만료 시 성공 감사를 롤백한다",async()=>{
  const row=await ready();await db.session.update({where:{id:ctx.session.id},data:{expiresAt:new Date(Date.now()+60000)}});
  faults.action="compliance.export_downloaded";faults.advance=true;vi.useFakeTimers({toFake:["Date"]});
  await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:401});
  expect(await db.auditEvent.count({where:{resourceId:row.id,action:faults.action}})).toBe(0);
});
test("작업을 24시간 뒤 정리하면 파일과 활성 상태가 사라진다",async()=>{
  const row=await ready();expect(await cleanupComplianceExports(new Date(new Date(row.expiresAt).getTime()+1),row.id)).toBe(1);
  expect((await getComplianceExport(ctx,row.id)).status).toBe("expired");expect((await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}})).resultCipher).toBeNull();
});
test("다운로드 감사 중 파일 기한이 지나면 성공 감사를 남기지 않는다",async()=>{
  const row=await ready();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(row.expiresAt).getTime()-60000);
  faults.action="compliance.export_downloaded";faults.advance=true;
  await expect(downloadComplianceExport(ctx,row.id,randomUUID())).rejects.toMatchObject({status:410});
  expect(await db.auditEvent.count({where:{resourceId:row.id,action:faults.action}})).toBe(0);
  expect(await cleanupComplianceExports(new Date(),row.id)).toBe(1);
});
test("반복 렌더링 실패는 5회 뒤 종료되어 무한 재시도하지 않는다",async()=>{
  const row=await queued("pdf");faults.render=true;vi.useFakeTimers({toFake:["Date"]});
  for(let i=0;i<5;i++){await runOneComplianceExport("exhaust",new Date(),row.id);vi.setSystemTime(Date.now()+65000);}
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:row.id}});
  expect(stored.status).toBe("failed");expect(stored.attempts).toBe(5);expect(stored.resultCipher).toBeNull();
  expect(await runOneComplianceExport("again",new Date(),row.id)).toBe(false);
});
test("0·1·11·100건 목록은 서버 페이지와 끝 페이지를 정확히 반환한다",async()=>{
  const close=await makeClose();expect((await listComplianceExports(ctx,{closeId:close.id,page:1,pageSize:10})).total).toBe(0);
  const original=await queued();await changeComplianceExport(ctx,original.id,original.version,false,randomUUID());
  const stored=await db.complianceExportJob.findUniqueOrThrow({where:{id:original.id}});
  expect((await listComplianceExports(ctx,{closeId:close.id,page:1,pageSize:10})).items).toHaveLength(1);
  for(const target of [11,100]){
    const count=await db.complianceExportJob.count({where:{tenantId:ctx.tenantId}});
    await db.complianceExportJob.createMany({data:Array.from({length:target-count},()=>({...stored,id:randomUUID(),requestKeyHash:randomUUID()}))});
    const last=await listComplianceExports(ctx,{closeId:close.id,page:100,pageSize:10});expect(last.total).toBe(target);expect(last.page).toBe(Math.ceil(target/10));expect(last.items).toHaveLength(target===11?1:10);
    const ids:string[]=[];for(let page=1;page<=last.page;page++)ids.push(...(await listComplianceExports(ctx,{closeId:close.id,page,pageSize:10})).items.map(r=>r.id));
    expect(new Set(ids).size).toBe(target);
  }
});
test("여러 페이지 PDF도 모든 서비스와 미판정을 보존한다",async()=>{
  await db.service.createMany({data:Array.from({length:40},(_,i)=>({tenantId:ctx.tenantId,name:`합성 서비스 ${String(i).padStart(2,"0")}`,externalName:"합성"}))});
  const close=(await closeComplianceMonth(ctx,{month},randomUUID())).close;
  const row=await createComplianceExport(ctx,{closeId:close.id,format:"pdf"},randomUUID(),randomUUID());
  await runOneComplianceExport("multi-page",new Date(),row.id);
  const output=await downloadComplianceExport(ctx,row.id,randomUUID()),task=getDocument({data:new Uint8Array(output.bytes!),useSystemFonts:false}),pdf=await task.promise;
  try {expect(pdf.numPages).toBeGreaterThan(1);let text="";for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i),c=await p.getTextContent();text+=c.items.map(item=>"str"in item?item.str:"").join(" ");}
    expect(text).toContain("미판정");expect(text).toContain("서비스 42개");expect(text).toContain("합성 서비스 39");expect(text).toContain(output.sourceHash);
  }finally{await task.destroy();}
});
