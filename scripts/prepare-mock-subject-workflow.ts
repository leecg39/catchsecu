import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
import { POST as formPost } from "../src/app/api/v1/forms/route";
import { POST as formAction } from "../src/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "../src/app/api/v1/public/forms/[...segments]/route";
const database=new URL(env.DATABASE_URL),fixture=JSON.parse(await readFile('.local/mock-page-fixtures.json','utf8'));
assert.equal(database.pathname,'/catchsecu_mock_admin');assert.ok(['localhost','127.0.0.1'].includes(database.hostname));
assert.equal(fixture.origin,'http://catchsecu-mock.localhost:3189');assert.equal(new URL(env.BETTER_AUTH_URL).origin,fixture.origin);assert.equal(env.MAIL_TRANSPORT,'local');assert.equal(resolve(env.PRIVATE_STORAGE_DIR),resolve(fixture.storage));
const path='.local/mock-subject-workflow.json';
async function save(value:unknown){await writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);}
async function checked<T>(response:Response,status:number):Promise<T>{assert.equal(response.status,status);return response.json();}
const request=(path:string,value:object,cookie='')=>new Request(fixture.origin+'/api/v1'+path,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json',cookie,'idempotency-key':randomUUID()},body:JSON.stringify(value)});
try {
 if(process.argv[2]==='link') {
  const privateFixture=JSON.parse(await readFile(path,'utf8'));
  assert.equal(privateFixture.origin,fixture.origin);
  const jobs=await db.job.findMany({where:{dedupeKey:{startsWith:'mail:subject-access:'},payloadErasedAt:null},orderBy:{createdAt:'desc'},take:100});
  const job=jobs.find(row=>decrypt<{to:string}>(row.payloadCipher).to===privateFixture.email);assert.ok(job);
  await runOneJob('mock-subject-browser-mail',{tenantId:job.tenantId,jobId:job.id});
  assert.equal((await db.job.findUniqueOrThrow({where:{id:job.id}})).status,'done');
  const mail=JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR,job.id+'.json'),'utf8'));
  const token=/\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];assert.ok(token);
  await save({...privateFixture,link:'/infoOwner/agree-history/'+token});console.log({localMailDelivered:true});
 }else {
  const login=await auth.handler(request('/auth/sign-in/email',{email:fixture.email,password:fixture.password}));assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(row=>row.split(';')[0]).join('; '),nameId=randomUUID(),emailId=randomUUID();
  const form=await checked<{id:string;version:number}>(await formPost(request('/forms',{serviceId:fixture.serviceId,title:'Mock 철회 화면 전용 '+randomUUID(),content:{body:'독립 Mock 동의 철회 검증',consentPurpose:'화면 검증',consentRequired:true,retentionDays:30,maxResponses:10,questions:[{id:nameId,label:'이름',type:'단문형 답변',required:true,subjectRole:'name'},{id:emailId,label:'이메일',type:'단문형 답변',required:true,subjectRole:'email'}]}},cookie)),201);
  const publication=await checked<{token:string}>(await formAction(request('/forms/'+form.id+'/publish',{version:form.version},cookie)),201);
  const contact={name:'Mock 철회 정보주체',email:'withdrawal-'+randomUUID()+'@catchsecu.test'};
  const submission=await checked<{id:string}>(await publicPost(request('/public/forms/'+publication.token+'/submissions',{answers:{[nameId]:contact.name,[emailId]:contact.email},consent:true})),201);
  await save({origin:fixture.origin,companyId:fixture.companyId,serviceId:fixture.serviceId,formId:form.id,submissionId:submission.id,...contact});
  console.log({dedicatedFormCreated:true,submissionCreated:true});
 }
}finally{await db.$disconnect();}
