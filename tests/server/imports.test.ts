import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, test, expect, vi } from "vitest";
import { db } from "@/server/db";
import { requestSubjectAccess, createSubjectSession, subjectConsents, subjectEvents, withSubject } from "@/server/subjects";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import type { Role } from "@/generated/prisma/client";
import type { PurposeInput, RecipientInput, PurposeRecord, RecipientRecord } from "@/contracts/processing-catalog";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import { PATCH as patchPurpose } from "@/app/api/v1/processing-purposes/[...segments]/route";
import { POST as createRecipient } from "@/app/api/v1/recipients/route";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), foreignService = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? (await response.clone().json()).error?.code : "").toBe(status);
  return response.json() as Promise<T>;
}
const purpose = (patch: Partial<PurposeInput> = {}): PurposeInput => ({ serviceId: service, name: "수집 목적 " + randomUUID(),
  purpose: "시험용 상담 신청 처리", lawfulBasis: "consent", basisReference: "시험 양식의 동의문",
  items: [{ name: "이름", kind: "general", required: true }, { name: "이메일", kind: "general", required: false }],
  retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [], ...patch });
const recipient = (patch: Partial<RecipientInput> = {}): RecipientInput => ({ serviceId: service, name: "제공자 " + randomUUID(),
  kind: "processor", countryCode: "KR", purpose: "시험용 메시지 전달", items: ["이메일"], retentionMode: "days", retentionDays: 7,
  retentionReason: "", contact: "test@imports.local.test", transferMethod: "", transferTiming: "", refusalNotice: "", ...patch });
async function addPurpose(input = purpose(), who = "owner", key = randomUUID()) {
  return ok<PurposeRecord>(await createPurpose(req("/processing-purposes", "POST", who, input, { "idempotency-key": key })), 201);
}
async function addRecipient(input = recipient(), who = "owner", key = randomUUID()) {
  return ok<RecipientRecord>(await createRecipient(req("/recipients", "POST", who, input, { "idempotency-key": key })), 201);
}
async function signup(name: string, role: Role, company = tenant) {
  await db.rateLimit.deleteMany();
  const email = name + "@imports.local.test", password = "Catalog-testing-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  if (company === tenant) await db.serviceGrant.create({ data: { tenantId: tenant, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password }));
  expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [foreignService, foreign]])
    await db.service.create({ data: { id, tenantId, name: "수집 근거 시험 " + id, externalName: "수집 근거 시험" } });
  await signup("owner", "owner"); await signup("editor", "editor"); await signup("viewer", "viewer"); await signup("privacy", "privacy"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

import { parseImportCsv, validateImportRows, safeCsvCell } from "@/server/import-csv";
import { claimImport, runOneImport, cleanupExpiredImports } from "@/server/import-worker";
import { cleanupExpiredFiles } from "@/server/files";
import { privateFiles } from "@/server/file-storage";
import { decrypt, encrypt } from "@/server/crypto";
import { sha256 } from "@/server/file-validation";
import type { ImportJobRecord, ImportMapping, ImportSnapshot, ImportPreview } from "@/contracts/imports";
import { POST as newImport, GET as listImports } from "@/app/api/v1/imports/route";
import { GET as getImport, PATCH as patchImport, POST as actImport, DELETE as deleteImport } from "@/app/api/v1/imports/[...segments]/route";
import { POST as uploadPost, PUT as uploadPut } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as getSub, PATCH as patchSub, POST as actSub } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as actDestruction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { runOneDestruction } from "@/server/destruction-worker";
const today = new Date().toISOString().slice(0,10);
const sample = '이름,이메일,수집일,동의\n"시험,가",a@example.test,'+today+',yes\n잘못된 행,wrong,'+today+',yes\n"시험,가",a@example.test,'+today+',yes\n';
function mapping(p: PurposeRecord, patch: Partial<ImportMapping> = {}): ImportMapping {
  return { purposeId:p.id,fields:[{name:"이름",column:0,type:"text"},{name:"이메일",column:1,type:"email"}],collectedAt:{mode:"column",column:2},retentionUntil:null,consentColumn:3,evidenceColumn:null,sourceStatement:"합성 CSV 수집 증거",source:"internal",sourceRecipientId:null,...patch };
}
async function upload(csv=sample,who="owner",encoding="utf-8",bytes=Buffer.from(csv),serviceId=service){
 const row=await ok<ImportJobRecord>(await newImport(req('/imports','POST',who,{serviceId,title:'CSV QA '+randomUUID(),name:'수집.csv',mime:'text/csv',size:bytes.length,sha256:sha256(bytes),encoding},{'idempotency-key':randomUUID()})),201);
 await ok(await uploadPut(new Request(origin+'/api/v1/uploads/'+row.fileId+'/content',{method:'PUT',body:new Uint8Array(bytes),headers:{origin,cookie:cookies[who],'content-type':'text/csv'}})));
 await ok(await uploadPost(req('/uploads/'+row.fileId+'/complete','POST',who)));
 return ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/inspect','POST',who,{version:row.version})));
}
async function configured(csv=sample,who="owner",input=purpose(),custom?:Partial<ImportMapping>){
 const p=await addPurpose(input),row=await upload(csv,who);
 return {p,row:await ok<ImportJobRecord>(await patchImport(req('/imports/'+row.id,'PATCH',who,{version:row.version,mapping:mapping(p,custom)})))};
}
async function validated(csv=sample,who="owner",input=purpose(),custom?:Partial<ImportMapping>){
 const {p,row}=await configured(csv,who,input,custom);
 return {p,row:await ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/validate','POST',who,{version:row.version})))};
}
async function start(row:ImportJobRecord,who="owner") {return ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/commit','POST',who,{version:row.version})),202)}
async function readJob(id:string){return ok<ImportJobRecord>(await getImport(req('/imports/'+id)))}

describe('CSV parser and real PostgreSQL import lifecycle',()=>{
 test('BOM, quoted commas, embedded newline, blank rows and EUC-KR are parsed',()=>{
  const csv=parseImportCsv(Buffer.from('\ufeff이름,내용\r\n"시험,가","첫줄\n둘째줄"\r\n,\r\n'),'utf-8');
  expect(csv.headers).toEqual(['이름','내용']);expect(csv.rows).toHaveLength(1);expect(csv.rows[0]).toMatchObject({raw:['시험,가','첫줄\n둘째줄'],rowNo:2,lineNo:3});
  // EUC-KR bytes for 가, 나; decoder is exercised without an encoding mock.
  expect(parseImportCsv(Buffer.from([0xb0,0xa1,0x0a,0xb3,0xaa,0x0a]),'euc-kr').rows[0].raw).toEqual(['나']);
  expect(()=>parseImportCsv(Buffer.from([0xb0,0xa1,0x0a,0xb3,0xaa]),'utf-8')).toThrow();
 });
 test('duplicate headers, malformed CSV, limits and row validation are enforced',async()=>{
  for(const text of ['Ａ,a\nx,y','a,b\n"unclosed','a\n','a'.repeat(201)+'\nx','a\n'+Array(10001).fill('x').join('\n')])expect(()=>parseImportCsv(Buffer.from(text),'utf-8')).toThrow();
  expect(()=>parseImportCsv(Buffer.alloc(10485761),'utf-8')).toThrow();
  const p=await addPurpose();const snap:ImportSnapshot={purpose:p,recipient:null};const m=mapping(p);
  const result=validateImportRows(parseImportCsv(Buffer.from('이름,이메일,수집일,동의\n,bad,2026-02-30,no\n테스트,a@example.test,'+today+',yes,extra\n'),'utf-8'),m,snap);
  expect(result[0].errors.map(e=>e.code)).toEqual(expect.arrayContaining(['REQUIRED','EMAIL','COLLECTED_AT','RETENTION','CONSENT']));
  expect(result[1].errors.map(e=>e.code)).toContain('COLUMN_COUNT');
  expect(()=>validateImportRows(parseImportCsv(Buffer.from(sample),'utf-8'),{...m,consentColumn:null},snap)).toThrow();
 });
 test('validation creates zero responses, stages encrypted values and classifies duplicates',async()=>{
  const {row}=await validated();expect(row).toMatchObject({status:'validated',totalRows:3,validRows:1,invalidRows:1,skippedRows:1});
  expect(await db.submission.count({where:{importJobId:row.id}})).toBe(0);
  const staged=await db.importRow.findMany({where:{jobId:row.id},orderBy:{rowNo:'asc'}});expect(staged.map(r=>r.status)).toEqual(['valid','error','duplicate']);
  expect(staged[0].payloadCipher).not.toContain('a@example.test');expect(decrypt<{raw:string[]}>(staged[0].payloadCipher!).raw[0]).toBe('시험,가');
  expect(staged[2].duplicateOf).toBe(2);
  const preview=await ok<ImportPreview>(await getImport(req('/imports/'+row.id+'/rows?pageSize=1&page=2')));expect(preview.total).toBe(3);expect(preview.items[0].rowNo).toBe(3);
 });
 test('CSV import 목록과 상세의 민감한 열람은 감사 원장에 기록된다',async()=>{
  const row=await upload();
  const listed=await listImports(req('/imports?serviceId='+service));expect(listed.status).toBe(200);
  const listEvent=await db.auditEvent.findFirstOrThrow({where:{requestId:listed.headers.get('x-request-id')!}});
  expect(listEvent).toMatchObject({tenantId:tenant,serviceId:service,action:'import.list_viewed',resource:'import'});
  const detail=await getImport(req('/imports/'+row.id));expect(detail.status).toBe(200);
  const detailEvent=await db.auditEvent.findFirstOrThrow({where:{requestId:detail.headers.get('x-request-id')!}});
  expect(detailEvent).toMatchObject({tenantId:tenant,serviceId:service,action:'import.viewed',resourceId:row.id});
  const denied=await getImport(req('/imports/'+row.id,'GET','foreign'));expect(denied.status).toBe(404);
  expect(await db.auditEvent.count({where:{requestId:denied.headers.get('x-request-id')!}})).toBe(0);
 });
 test('partial import erases original before writing and handles concurrent workers without duplicates',async()=>{
  const {row}=await validated();const file=await db.fileObject.findUniqueOrThrow({where:{id:row.fileId}});await start(row);
  expect((await actImport(req('/imports/'+row.id+'/commit','POST','owner',{version:row.version}))).status).toBe(409);
  await Promise.all([runOneImport('worker-a'),runOneImport('worker-b')]);
  // Other validated jobs are not picked up; only explicit commit starts work.
  const saved=await readJob(row.id);expect(saved).toMatchObject({status:'partialFailed',importedRows:1});
  expect(await db.submission.count({where:{importJobId:row.id}})).toBe(1);
  expect((await db.fileObject.findUniqueOrThrow({where:{id:row.fileId}})).status).toBe('deleted');await expect(privateFiles.read(file.storageKey)).rejects.toThrow();
  const sub=await db.submission.findFirstOrThrow({where:{importJobId:row.id}});expect(sub.publicationId).toBeNull();expect(sub.subjectId).toBeNull();
  expect(await db.publication.count({where:{formId:saved.formId!}})).toBe(0);
  const detail=await ok<{values:Record<string,string>;version:number}>(await getSub(req('/submissions/'+sub.id)));expect(Object.values(detail.values)).toContain('a@example.test');
  const emailKey=Object.entries(detail.values).find(([,v])=>v==='a@example.test')![0];
  expect((await patchSub(req('/submissions/'+sub.id,'PATCH','privacy',{version:detail.version,reason:'잘못된 이메일 시험',answers:{[emailKey]:'invalid'}}))).status).toBe(422);
  const nameKey=Object.entries(detail.values).find(([,v])=>v==='시험,가')![0];
  await ok(await patchSub(req('/submissions/'+sub.id,'PATCH','privacy',{version:detail.version,reason:'시험 정정',answers:{[nameKey]:'정정 이름'}})));
  const rows=await db.importRow.findMany({where:{jobId:row.id},orderBy:{rowNo:'asc'}});expect(rows[0].payloadCipher).toBeNull();expect(rows[2].submissionId).toBe(sub.id);
  expect(await db.importEvidence.count({where:{submissionId:sub.id}})).toBe(1);expect(await db.consentReceipt.count({where:{submissionId:sub.id}})).toBe(1);
 });

 test('explicit identity columns survive scan, validation and worker import and normalize one subject',async()=>{
  const email=randomUUID()+'@subjects.imports.test', name='가 나';
  const fields:ImportMapping['fields']=[{name:'이름',column:0,type:'text',subjectRole:'name'},{name:'이메일',column:1,type:'email',subjectRole:'email'}];
  const csv='이름,이메일,수집일,동의\n'+name+','+email+','+today+',yes\n'+name.normalize('NFD')+','+email.toUpperCase()+','+today+',yes\n';
  const input=purpose({items:[{name:'이름',kind:'general',required:true},{name:'이메일',kind:'general',required:true}]});
  const {row}=await validated(csv,'owner',input,{fields});expect(row.validRows).toBe(2);await start(row);await runOneImport('subject-mapping');
  const saved=await readJob(row.id);expect(saved.status).toBe('completed');
  const subs=await db.submission.findMany({where:{importJobId:row.id}});expect(subs).toHaveLength(2);expect(subs[0].subjectId).toBeTruthy();expect(subs[1].subjectId).toBe(subs[0].subjectId);
  const subject=await db.dataSubject.findUniqueOrThrow({where:{id:subs[0].subjectId!}});expect(decrypt(subject.contactCipher)).toEqual({name,email});
  const qs=await db.question.findMany({where:{formVersionId:subs[0].formVersionId},orderBy:{order:'asc'}});expect(qs.map(q=>q.subjectRole)).toEqual(['name','email']);
  expect(qs.every(q=>q.required&&q.type==='단문형 답변')).toBe(true);
  const browser=await requestSubjectAccess({name,email,consent:true},null,randomUUID());
  const grant=await db.subjectAccessRequest.findFirstOrThrow({where:{scopes:{some:{subjectId:subject.id}}}});
  const mail=await db.job.findUniqueOrThrow({where:{dedupeKey:'mail:subject-access:'+grant.id}});const text=decrypt<{text:string}>(mail.payloadCipher).text;
  const token=/agree-history\/([A-Za-z0-9_-]{43})/.exec(text)![1],session=await createSubjectSession(token,browser.browser);
  const consentRows=await withSubject(session.token,session.id,(tx,current)=>subjectConsents(tx,current,1,20,randomUUID()));expect(consentRows.total).toBe(2);
  const historyRows=await withSubject(session.token,session.id,(tx,current)=>subjectEvents(tx,current,1,20,randomUUID()));expect(historyRows.items.map(e=>e.type)).toEqual(['imported','imported']);
  const key=qs[1].stableKey;await ok(await patchSub(req('/submissions/'+subs[0].id,'PATCH','owner',{version:1,reason:'CSV 정보주체 정정',answers:{[key]:'changed-'+email}})));
  expect((await db.submission.findUniqueOrThrow({where:{id:subs[0].id}})).subjectId).not.toBe(subs[1].subjectId);
 });
 test('identity mappings require both required columns and reject oversized identity values before committing',async()=>{
  const input=purpose({items:[{name:'이름',kind:'general',required:true},{name:'이메일',kind:'general',required:true}]});
  const fields:ImportMapping['fields']=[{name:'이름',column:0,type:'text',subjectRole:'name'},{name:'이메일',column:1,type:'email',subjectRole:'email'}];
  const {p,row}=await configured('이름,이메일,수집일,동의\n'+('가'.repeat(101))+',qa@example.test,'+today+',yes\n','owner',input);
  for(const bad of [fields.slice(0,1).concat([{name:'이메일',column:1,type:'email'}]),fields.map(f=>({...f,subjectRole:'name' as const})),fields.map(f=>f.name==='이름'?{...f,type:'phone' as const}:f)]){
   expect((await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:mapping(p,{fields:bad})}))).status).toBe(422);
  }
  const set=await ok<ImportJobRecord>(await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:mapping(p,{fields})})));
  const checked=await ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/validate','POST','owner',{version:set.version})));expect(checked.validRows).toBe(0);expect(checked.invalidRows).toBe(1);
  const rows=await db.importRow.findMany({where:{jobId:row.id}});expect(JSON.stringify(rows[0].errors)).toContain('SUBJECT_NAME');expect(await db.submission.count({where:{importJobId:row.id}})).toBe(0);
  const optional=await addPurpose();const snap:ImportSnapshot={purpose:optional,recipient:null};expect(()=>validateImportRows(parseImportCsv(Buffer.from(sample),'utf-8'),mapping(optional,{fields}),snap)).toThrow();
 });
 test('source deletion failure creates no submissions and retry succeeds',async()=>{
  const {row}=await validated();await start(row);const remove=vi.spyOn(privateFiles,'remove').mockRejectedValueOnce(new Error('storage unavailable'));
  await runOneImport('delete-fail');remove.mockRestore();expect(await db.submission.count({where:{importJobId:row.id}})).toBe(0);
  expect((await readJob(row.id)).status).toBe('retry');await runOneImport('delete-retry',new Date(Date.now()+300000));expect((await readJob(row.id)).status).toBe('partialFailed');
 });
 test('expired worker leases recover and repeat processing never adds another response',async()=>{
  const {row}=await validated();await start(row);const claimed=await claimImport('crashed');expect(claimed?.id).toBe(row.id);
  expect(await claimImport('too-early')).toBeNull();await runOneImport('recovered',new Date(Date.now()+180000));
  expect((await readJob(row.id)).importedRows).toBe(1);await runOneImport('again');expect(await db.submission.count({where:{importJobId:row.id}})).toBe(1);
 });
 test('roles, fresh service grants, tenant boundaries and origins protect every surface',async()=>{
  const {row}=await validated(sample,'editor');
  for(const suffix of ['', '/rows','/errors.csv']){expect((await getImport(req('/imports/'+row.id+suffix,'GET','viewer'))).status).toBe(403);expect((await getImport(req('/imports/'+row.id+suffix,'GET','foreign'))).status).toBe(404)}
  expect((await listImports(req('/imports?serviceId='+service,'GET','anonymous'))).status).toBe(401);
  expect((await getImport(req('/imports/options?serviceId='+service,'GET','privacy'))).status).toBe(200);
  expect((await getImport(req('/imports/options?serviceId='+second,'GET','editor'))).status).toBe(403);
  expect((await actImport(req('/imports/'+row.id+'/commit','POST','editor',{version:row.version},{origin:'https://example.invalid'}))).status).toBe(403);
  await start(row,'editor');const grant=await db.serviceGrant.findFirstOrThrow({where:{memberId:members.editor,serviceId:service}});
  await db.serviceGrant.update({where:{id:grant.id},data:{capabilities:[]}});
  try{await runOneImport('revoked');expect((await readJob(row.id)).status).toBe('failed');expect(await db.submission.count({where:{importJobId:row.id}})).toBe(0);expect((await getImport(req('/imports/'+row.id,'GET','editor'))).status).toBe(403)}
  finally{await db.serviceGrant.update({where:{id:grant.id},data:{capabilities:grant.capabilities}})}
  const fresh=await readJob(row.id);await ok(await actImport(req('/imports/'+row.id+'/retry','POST','editor',{version:fresh.version})),202);await runOneImport('restored');expect((await readJob(row.id)).importedRows).toBe(1);
 });
 test('stale config and catalog changes require revalidation',async()=>{
  const {row,p}=await validated();expect((await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version-1,mapping:mapping(p)}))).status).toBe(409);
  const input=purpose({name:p.name});await ok(await patchPurpose(req('/processing-purposes/'+p.id,'PATCH','owner',{...input,version:p.version,retentionDays:60})));
  expect((await actImport(req('/imports/'+row.id+'/commit','POST','owner',{version:row.version}))).status).toBe(409);
  const next=await ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/validate','POST','owner',{version:row.version})));await start(next);await runOneImport('new-catalog');expect((await readJob(row.id)).importedRows).toBe(1);
 });
 test('contract basis has no fabricated consent, explicit end date and source provider required',async()=>{
  const input=purpose({lawfulBasis:'contract',basisReference:'합성 계약 1조',retentionMode:'statutory',retentionDays:null,retentionReason:'계약 종료일'});
  const p=await addPurpose(input),row=await upload();let m=mapping(p,{consentColumn:null});
  expect((await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:m}))).status).toBe(422);
  m={...m,retentionUntil:{mode:'fixed',value:new Date(Date.now()+10*86400000).toISOString().slice(0,10)}};
  const updated=await ok<ImportJobRecord>(await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:m})));
  const checked=await ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/validate','POST','owner',{version:updated.version})));await start(checked);await runOneImport('contract');
  const sub=await db.submission.findFirstOrThrow({where:{importJobId:row.id}});expect(await db.consentReceipt.count({where:{submissionId:sub.id}})).toBe(0);
 });
 test('cancel and expiry remove staging payloads and private source bytes',async()=>{
  const {row}=await validated();await ok(await deleteImport(req('/imports/'+row.id,'DELETE','owner',undefined,{'if-match':String(row.version)})));
  expect((await readJob(row.id)).status).toBe('cancelled');expect(await db.importRow.count({where:{jobId:row.id,payloadCipher:{not:null}}})).toBe(0);
  expect((await getImport(req('/imports/'+row.id+'/rows'))).status).toBe(410);await cleanupExpiredFiles();expect((await db.fileObject.findUniqueOrThrow({where:{id:row.fileId}})).status).toBe('deleted');
  const exp=await validated();await cleanupExpiredImports(new Date(Date.now()+2*86400000));expect((await readJob(exp.row.id)).status).toBe('expired');expect(await db.importRow.count({where:{jobId:exp.row.id,payloadCipher:{not:null}}})).toBe(0);
 });
 test('failure CSV escapes formulas, quotes and newlines',async()=>{
  for(const value of ['=1+1',' +CMD','@SUM(1)','-4','\ttext','＝SUM(1)'])expect(safeCsvCell(value).startsWith('"\'')).toBe(true);
  const {row}=await validated('이름,이메일,수집일,동의\n"=1+1",wrong,'+today+',yes\n');
  const response=await getImport(req('/imports/'+row.id+'/errors.csv'));expect(response.headers.get('content-disposition')).toContain('attachment');expect(await response.text()).toContain('"\'=1+1"');
  expect((await actImport(req('/imports/'+row.id+'/commit','POST','owner',{version:row.version}))).status).toBe(409);
 });
 test('import evidence and duplicate raw rows are removed by actual destruction',async()=>{
  const {row}=await validated();await start(row);await runOneImport('destroy-case');const sub=await db.submission.findFirstOrThrow({where:{importJobId:row.id}});
  const change=await ok<{destructionId:string}>(await actSub(req('/submissions/'+sub.id+'/destruction-request','POST','owner',{version:sub.version,reason:'CSV 시험 종료'})));
  const request=await db.destructionRequest.findUniqueOrThrow({where:{id:change.destructionId}});
  await ok(await actDestruction(req('/destruction-requests/'+request.id+'/approve','POST','owner',{version:request.version,reason:'검증 후 파기 승인'})));
  await runOneDestruction('import-destruction');expect((await db.submission.findUniqueOrThrow({where:{id:sub.id}})).status).toBe('destroyed');
  expect(await db.importEvidence.count({where:{submissionId:sub.id}})).toBe(0);expect(await db.importRow.count({where:{submissionId:sub.id,payloadCipher:{not:null}}})).toBe(0);
  const cert=await db.destructionCertificate.findFirstOrThrow({where:{submissionId:sub.id}});expect(cert.counts).toMatchObject({importEvidence:1,importRows:1});
  await expect(db.importEvidence.create({data:{tenantId:tenant,jobId:row.id,submissionId:sub.id,payloadCipher:encrypt('cannot restore')}})).rejects.toThrow();
 });
 test('database rejects cross-service binding, unvalidated writes and modifying erased payloads',async()=>{
  const {row}=await validated();const stored=await db.importJob.findUniqueOrThrow({where:{id:row.id}});
  await expect(db.importJob.update({where:{id:row.id},data:{serviceId:second,version:{increment:1}}})).rejects.toThrow();
  await expect(db.importJob.update({where:{id:row.id},data:{status:'completed',version:{increment:1}}})).rejects.toThrow();
  await start(row);await runOneImport('guards');const sub=await db.submission.findFirstOrThrow({where:{importJobId:row.id}});
  await expect(db.submission.create({data:{tenantId:tenant,importJobId:row.id,importRowNo:99,formVersionId:sub.formVersionId,retentionUntil:sub.retentionUntil,originalRetentionUntil:sub.retentionUntil}})).rejects.toThrow();
  const r=await db.importRow.findFirstOrThrow({where:{jobId:row.id,status:'imported'}});await expect(db.importRow.update({where:{id:r.id},data:{payloadCipher:encrypt('restore')}})).rejects.toThrow();
  expect(stored.importedRows).toBe(0);
 });
 test('large input is committed in bounded batches with stable retry counts',async()=>{
  const data='이름,이메일,수집일,동의\n'+Array.from({length:101},(_,i)=>`사람${i},person${i}@example.test,${today},yes`).join('\n');
  const {row}=await validated(data);await start(row);await runOneImport('batch-one');expect((await readJob(row.id))).toMatchObject({status:'committing',importedRows:50});
  await Promise.all([runOneImport('batch-two-a'),runOneImport('batch-two-b')]);
  for(let i=0;i<3&&(await readJob(row.id)).status==='committing';i++)await runOneImport('batch-tail');
  expect((await readJob(row.id))).toMatchObject({status:'completed',importedRows:101});expect(await db.submission.count({where:{importJobId:row.id}})).toBe(101);
 });
 test('EUC-KR bytes pass actual upload and scanning with explicit encoding',async()=>{
  const bytes=Buffer.from([0xb0,0xa1,0x0a,0xb3,0xaa,0x0a]);const row=await upload('', 'owner','euc-kr',bytes);expect(row.headers).toEqual(['가']);expect(row.totalRows).toBe(1);
 });
 test('source providers must be active and in the same service; snapshot preserves the selected source',async()=>{
  const p=await addPurpose(),row=await upload(),good=await addRecipient(recipient({kind:'source'}));
  const wrong=await addRecipient(),elsewhere=await addRecipient(recipient({kind:'source',serviceId:second}));
  for(const sourceRecipientId of [wrong.id,elsewhere.id,randomUUID()]) expect((await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:mapping(p,{source:'third_party',sourceRecipientId})}))).status).toBe(422);
  const saved=await ok<ImportJobRecord>(await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:row.version,mapping:mapping(p,{source:'third_party',sourceRecipientId:good.id})})));
  const checked=await ok<ImportJobRecord>(await actImport(req('/imports/'+row.id+'/validate','POST','owner',{version:saved.version})));
  const stored=await db.importJob.findUniqueOrThrow({where:{id:row.id}});expect(decrypt<ImportSnapshot>(stored.snapshotCipher!).recipient).toMatchObject({id:good.id,version:1});
  const changed=await ok<ImportJobRecord>(await patchImport(req('/imports/'+row.id,'PATCH','owner',{version:checked.version,mapping:mapping(p)})));expect(changed.status).toBe('draft');expect(await db.importRow.count({where:{jobId:row.id}})).toBe(0);
 });
 test('creation replay is stable and does not duplicate file reservations',async()=>{
  const key=randomUUID(),bytes=Buffer.from(sample),input={serviceId:service,title:'중복 요청 시험',name:'수집.csv',mime:'text/csv',size:bytes.length,sha256:sha256(bytes),encoding:'utf-8'};
  const responses=await Promise.all([1,2].map(()=>newImport(req('/imports','POST','owner',input,{'idempotency-key':key}))));
  const a=await ok<ImportJobRecord>(responses[0],201),b=await ok<ImportJobRecord>(responses[1],201);expect(a.id).toBe(b.id);expect(a.fileId).toBe(b.fileId);
  expect((await newImport(req('/imports','POST','owner',{...input,title:'changed'},{'idempotency-key':key}))).status).toBe(409);
 });

 test('phone, numeric, calendar, mapping and cell/column limits are checked',async()=>{
  const p=await addPurpose(purpose({lawfulBasis:'contract',basisReference:'합성 계약',items:[{name:'전화',kind:'general',required:true},{name:'수량',kind:'general',required:true},{name:'생일',kind:'general',required:true},{name:'비고',kind:'general',required:false}]}));
  const m:ImportMapping={purposeId:p.id,fields:[{name:'전화',column:0,type:'phone'},{name:'수량',column:1,type:'number'},{name:'생일',column:2,type:'date'},{name:'비고',column:3,type:'text'}],collectedAt:{mode:'fixed',value:today},retentionUntil:null,consentColumn:null,evidenceColumn:null,source:'internal',sourceRecipientId:null,sourceStatement:'합성 자료'};
  const snap:ImportSnapshot={purpose:p,recipient:null};const read=(text:string)=>parseImportCsv(Buffer.from('전화,수량,생일,비고\n'+text),'utf-8');
  expect(validateImportRows(read('010 1234 5678,3.5,2020-02-29,\n'),m,snap)[0]).toMatchObject({status:'valid',payload:{values:['01012345678','3.5','2020-02-29','']}});
  expect(validateImportRows(read('abc,NaN,2021-02-29,\n'),m,snap)[0].errors.map(e=>e.code)).toEqual(expect.arrayContaining(['PHONE','NUMBER','DATE']));
  expect(validateImportRows(read('01012345678,2,2020-01-01,'+'x'.repeat(10001)+'\n'),m,snap)[0].errors.map(e=>e.code)).toContain('CELL_LENGTH');
  expect(()=>parseImportCsv(Buffer.from(Array.from({length:101},(_,i)=>'h'+i).join(',')+'\nx'),'utf-8')).toThrow();
  expect(()=>validateImportRows(read('01012345678,2,2020-01-01,\n'),{...m,fields:m.fields.map((f,i)=>i===1?{...f,column:0}:f)},snap)).toThrow();
  expect(()=>validateImportRows(read('01012345678,2,2020-01-01,\n'),{...m,fields:m.fields.map((f,i)=>i===0?{...f,column:null}:f)},snap)).toThrow();
 });

});
