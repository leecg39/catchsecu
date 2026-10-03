import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { fingerprint,versionInclude } from "../src/server/forms";
import { policySettings,type PolicyRecord } from "../src/contracts/security";
import type { FormRecord,Paged } from "../src/contracts/forms";

const database=new URL(env.DATABASE_URL),origin=new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname==="/catchsecu_dev" && ["localhost","127.0.0.1"].includes(database.hostname)); assert.equal(origin,"http://localhost:3100");
const phase=process.argv[2]; assert(["prepare","finish"].includes(phase));
const source=JSON.parse(await readFile(".local/p03-members-fixture.json","utf8")) as { people:{ id:string;email:string;password:string }[] };
const person=source.people[1]; assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const previous=JSON.parse(await readFile(".local/p05-catalog-checkpoint.json","utf8")) as { tenantId:string };
type Fixed={ id:string;name:string;slug:string;version:number;status:string;formId:string;url:string };
type Publication={ id:string;token:string;version:number };
type Approval={ id:string;version:number };
type Checkpoint={ tenantId:string;serviceId:string;formIds:string[];mainFixed:Fixed;revokedFixed:Fixed;expiredFixed:Fixed;
  tokens:{ old:string;main:string;target:string;expired:string };publicationReplay:{ formId:string;key:string;input:{ version:number } };
  approvalIds:string[];submissionId:string;originalResponse:{ formVersionId:string;cipherHash:string };database:Snapshot };
const cases:{ label:string;status:number }[]=[],hash=(value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let cookie="";
async function request(label:string,path:string,method="GET",input?:unknown,expected:number|number[]=200,key?:string,anonymous=false,extra:Record<string,string>={}) {
  const response=await fetch(origin+"/api/v1"+path,{ method,redirect:"manual",headers:{ cookie:anonymous ? "":cookie,
    ...(method==="GET" ? {}:{ origin }),...(input===undefined ? {}:{ "content-type":"application/json" }),
    ...(key || method==="POST" ? { "idempotency-key":key ?? randomUUID() }:{}),...extra },...(input===undefined ? {}:{ body:JSON.stringify(input) }) });
  assert((Array.isArray(expected) ? expected:[expected]).includes(response.status),label+": HTTP "+response.status); cases.push({ label,status:response.status }); return response;
}
async function data<T>(label:string,path:string,method="GET",input?:unknown,expected=200,key?:string,anonymous=false) {
  return await (await request(label,path,method,input,expected,key,anonymous)).json() as T;
}
async function form(id:string) { return data<FormRecord>("폼 최신 version 조회","/forms/"+id); }
async function create(title:string,serviceId:string) {
  return data<FormRecord>("승인 대상 폼 생성","/forms","POST",{ title,serviceId,content:{ body:"독립 검증 본문",questions:[{ id:randomUUID(),label:"합성 답변",type:"단문형 답변",required:true }],
    consentRequired:false,consentPurpose:"",retentionDays:30,maxResponses:1 } },201);
}
async function approval(id:string,approve=true) {
  const current=await form(id),input={ version:current.version,message:"합성 검토 요청",reference:"P04-QA" },key=randomUUID();
  const row=await data<Approval>("현재 초안 승인 요청","/forms/"+id+"/approvals","POST",input,201,key);
  if (approve) await data("검토본 승인","/approvals/"+row.id+"/decision","POST",{ version:row.version,decision:"approved",reason:"합성 검토 완료" });
  return { row,input,key };
}
async function publish(id:string,expiresAt?:string) {
  const current=await form(id),key=randomUUID(),input={ version:current.version,...(expiresAt ? { expiresAt }:{}) };
  const result=await data<Publication>("승인된 초안 게시","/forms/"+id+"/publish","POST",input,201,key); return { result,key,input };
}
async function snapshot(tenantId:string) {
  const forms=await db.form.findMany({ where:{ tenantId },select:{ id:true,version:true,status:true,publishedVersionId:true },orderBy:{ id:"asc" } });
  const versions=await db.formVersion.findMany({ where:{ tenantId },include:versionInclude,orderBy:{ id:"asc" } });
  const fixed=await db.fixedUrl.findMany({ where:{ tenantId },select:{ id:true,version:true,status:true,publicationId:true,slug:true,name:true },orderBy:{ id:"asc" } });
  const approvals=await db.approvalRequest.findMany({ where:{ tenantId },select:{ id:true,status:true,version:true,formVersionId:true,contentHash:true,snapshot:true },orderBy:{ id:"asc" } });
  const submissions=await db.submission.findMany({ where:{ tenantId },select:{ id:true,formVersionId:true,publicationId:true,answers:{ select:{ id:true,questionId:true,valueCipher:true },orderBy:{ id:"asc" } } },orderBy:{ id:"asc" } });
  const auditCount=await db.auditEvent.count({ where:{ tenantId,resource:{ in:["form","approval","fixedUrl","submission"] } } });
  const publications=await db.publication.findMany({ where:{ tenantId },select:{ id:true,status:true,formId:true,formVersionId:true,responseCount:true,maxResponses:true },orderBy:{ id:"asc" } });
  return { forms,versions:versions.map(v => ({ id:v.id,number:v.number,status:v.status,hash:fingerprint(v),questionIds:v.questions.map(q => q.id) })),fixed,
    approvals:approvals.map(a => ({ ...a,snapshot:hash(a.snapshot) })),submissions:submissions.map(s => ({ ...s,answers:s.answers.map(a => ({ id:a.id,questionId:a.questionId,hash:hash(a.valueCipher) })) })),auditCount,publications };
}
type Snapshot=Awaited<ReturnType<typeof snapshot>>;
async function verify(c:Checkpoint) {
  const current=await form(c.formIds[0]),target=await form(c.formIds[1]); assert.equal(current.version,8); assert.equal(target.version,5);
  const row=await data<Fixed>("고정 주소의 최종 연결 유지","/fixed-urls/"+c.mainFixed.id); assert.equal(row.formId,c.formIds[1]); assert.equal(row.version,5); assert.equal(row.slug,c.mainFixed.slug);
  const publicForm=await data<{ title:string }>("고정 주소는 대상 폼 공개본 조회","/public/urls/"+row.slug,"GET",undefined,200,undefined,true); assert.equal(publicForm.title,target.title);
  await request("이전 공개 토큰은 새 게시 후 종료","/public/forms/"+c.tokens.old,"GET",undefined,410,undefined,true);
  await request("실제 만료된 폼은 재시작 후에도 종료","/public/forms/"+c.tokens.expired,"GET",undefined,410,undefined,true);
  await request("사용 종료한 고정 주소는 재시작 후에도 종료","/public/urls/"+c.revokedFixed.slug,"GET",undefined,410,undefined,true);
  await request("만료된 게시본의 고정 주소도 종료","/public/urls/"+c.expiredFixed.slug,"GET",undefined,410,undefined,true);
  const replay=await data<Publication>("게시 키 재전송은 같은 게시 ID","/forms/"+c.publicationReplay.formId+"/publish","POST",c.publicationReplay.input,201,c.publicationReplay.key); assert.equal(replay.token===c.tokens.main,true);
  const found=await data<Paged<Fixed>>("고정 주소 검색·범위 밖 페이지 복원","/fixed-urls?search=P04&page=999&pageSize=1&sort=name&direction=asc"); assert.equal(found.total,2); assert.equal(found.page,2);
  const actual=await snapshot(c.tenantId); assert.deepEqual(actual,c.database);
  assert.equal(actual.forms.length,3); assert.equal(actual.versions.length,4); assert.equal(actual.publications.length,4); assert.equal(actual.approvals.length,5); assert.equal(actual.submissions.length,1); assert.equal(actual.fixed.length,3);
  assert.equal(actual.submissions[0].id,c.submissionId); assert.equal(new Set(actual.versions.flatMap(v => v.questionIds)).size,4);
  assert.equal(actual.submissions[0].formVersionId,c.originalResponse.formVersionId); assert.equal(actual.submissions[0].answers[0].hash,c.originalResponse.cipherHash);
  return { formVersions:actual.forms.map(f => f.version).sort((a,b) => a-b),formCount:3,storedVersions:4,publications:4,approvalEvidence:5,fixedUrls:3,oldSubmissions:1,independentQuestionRows:4,
    auditCount:actual.auditCount,originalResponseCipherMatches:true,approvalSnapshotsMatch:true,publicationHashesMatch:true,retargetAndRestartMatch:true,replayAddsNoWrite:true };
}
try {
  const user=await db.user.findUniqueOrThrow({ where:{ id:person.id } }); assert.equal(user.status,"active"); assert.equal(user.platformAdmin,false);
  const login=await request("합성 소유자 로그인","/auth/sign-in/email","POST",{ email:person.email,password:person.password }); cookie=login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie);
  let checkpoint:Checkpoint;
  if (phase==="prepare") {
    const company=await data<{ id:string }>("독립 시험 회사 생성","/companies","POST",{ name:"P04 게시 검증 "+randomUUID(),publicName:"P04 게시 검증" },201);
    const tenantId=company.id,services=await data<Paged<{ id:string }>>("생성된 시험 서비스 조회","/services"); assert.equal(services.total,1); const serviceId=services.items[0].id;
    const policy=await data<PolicyRecord>("시험 회사 보안 정책 조회","/security/policy"),settings=Object.fromEntries(Object.keys(policySettings.shape).map(key => [key,policy[key as keyof PolicyRecord]]));
    await data("게시 승인과 증빙 정책 설정","/security/policy","PATCH",{ ...settings,tenantId,version:policy.version,password:person.password,requireApproval:true,approvalReferenceRequired:true });
    const main=await create("P04 주 폼",serviceId); await request("승인 전 공개 차단","/forms/"+main.id+"/publish","POST",{ version:main.version },409);
    await request("필수 승인 증빙 검사","/forms/"+main.id+"/approvals","POST",{ version:main.version,message:"합성 요청",reference:"" },422);
    const rejected=await approval(main.id,false),repeat=await data<Approval>("승인 키 재전송은 같은 요청","/forms/"+main.id+"/approvals","POST",rejected.input,201,rejected.key); assert.equal(repeat.id,rejected.row.id);
    await request("같은 승인 키의 다른 본문 거부","/forms/"+main.id+"/approvals","POST",{ ...rejected.input,message:"다른 합성 요청" },409,rejected.key);
    await data("승인 요청 반려","/approvals/"+rejected.row.id+"/decision","POST",{ version:1,decision:"rejected",reason:"합성 검토 보완" });
    const firstApproval=await approval(main.id),first=await publish(main.id),key=randomUUID(),fixedInput={ name:"P04 A 주소",formId:main.id,slug:"p04-"+randomUUID().replaceAll("-","") };
    const mainFixed=await data<Fixed>("게시 폼 고정 URL 생성","/fixed-urls","POST",fixedInput,201,key),fixedReplay=await data<Fixed>("고정 URL 생성 키 재전송","/fixed-urls","POST",fixedInput,201,key); assert.equal(mainFixed.id,fixedReplay.id);
    const answer={ answers:{ [main.content.questions[0].id]:"합성 최초 응답" },consent:true };
    const concurrent=await Promise.all([0,1].map(() => request("마지막 응답 한도의 동시 제출","/public/forms/"+first.result.token+"/submissions","POST",answer,[201,409],randomUUID(),true))); assert.deepEqual(concurrent.map(r => r.status).sort(),[201,409]);
    const submission=await db.submission.findFirstOrThrow({ where:{ tenantId },include:{ answers:true } }); assert.equal(submission.answers.length,1);
    const originalResponse={ formVersionId:submission.formVersionId,cipherHash:hash(submission.answers[0].valueCipher) };
    await data("게시 후 독립 새 초안 저장","/forms/"+main.id+"/draft","PATCH",{ version:first.result.version,title:"P04 새 게시본" });
    await request("새 초안은 기존 승인 재사용 불가","/forms/"+main.id+"/publish","POST",{ version:6 },409);
    const secondApproval=await approval(main.id),second=await publish(main.id),auto=await data<Fixed>("같은 고정 주소의 새 게시본 자동 연결","/fixed-urls/"+mainFixed.id); assert.equal(auto.version,2); assert.equal(auto.slug,mainFixed.slug);
    const target=await create("P04 대상 폼",serviceId),targetApproval=await approval(target.id); await publish(target.id);
    let linked=await data<Fixed>("고정 주소를 다른 폼에 연결","/fixed-urls/"+auto.id,"PATCH",{ version:auto.version,formId:target.id,name:"P04 B 주소" }); assert.equal(linked.version,3);
    await request("version-only 고정 주소 저장 차단","/fixed-urls/"+linked.id,"PATCH",{ version:linked.version },422);
    await request("고정 주소의 오래된 version 거부","/fixed-urls/"+linked.id,"PATCH",{ version:1,name:"오래된 변경" },409);
    await request("없는 연결 대상 거부","/fixed-urls/"+linked.id,"PATCH",{ version:linked.version,formId:randomUUID() },404);
    linked=await data<Fixed>("고정 주소 이름 변경","/fixed-urls/"+linked.id,"PATCH",{ version:linked.version,name:"P04 수정 주소" }); assert.equal(linked.version,4);
    const edits=await Promise.all(["P04 경합 A","P04 경합 B"].map(name => request("고정 주소 동일 version의 동시 변경","/fixed-urls/"+linked.id,"PATCH",{ version:linked.version,name },[200,409]))); assert.deepEqual(edits.map(r => r.status).sort(),[200,409]);
    linked=await data<Fixed>("경합 후 최신 고정 주소 조회","/fixed-urls/"+linked.id); assert.equal(linked.version,5);
    const history=await data<Paged<Approval>>("승인 이력 마지막 페이지 보정","/forms/"+main.id+"/approvals?page=999&pageSize=1"); assert.equal(history.total,3); assert.equal(history.page,3);
    const allHistory=await data<Paged<Approval>>("승인 목록 필터와 페이지 보정","/approvals?search=P04&page=999&pageSize=1"); assert.equal(allHistory.total,4); assert.equal(allHistory.page,4);
    const revoke=await data<Fixed>("종료용 고정 주소 생성","/fixed-urls","POST",{ name:"P04 종료 주소",formId:main.id },201);
    await request("고정 주소 사용 종료","/fixed-urls/"+revoke.id,"DELETE",undefined,204,undefined,false,{ "If-Match":String(revoke.version) });
    await data("공개 폼 중단","/forms/"+target.id+"/pause","POST",{ version:3 }); await request("중단한 폼의 고정 주소 차단","/public/urls/"+linked.slug,"GET",undefined,410,undefined,true);
    await data("공개 폼 재개","/forms/"+target.id+"/resume","POST",{ version:4 });
    const expired=await create("P04 만료 폼",serviceId),expiredApproval=await approval(expired.id),expiresAt=new Date(Date.now()+4000).toISOString(),exp=await publish(expired.id,expiresAt);
    const expiredFixed=await data<Fixed>("만료 검증 고정 주소 생성","/fixed-urls","POST",{ name:"P04 만료 주소",formId:expired.id },201);
    await request("만료 전 공개본 접근","/public/forms/"+exp.result.token,"GET",undefined,200,undefined,true);
    const wait=Math.max(0,new Date(expiresAt).getTime()-Date.now()+120); assert(wait<5000); await new Promise(done => setTimeout(done,wait));
    await request("실제 시각 경과 후 공개본 종료","/public/forms/"+exp.result.token,"GET",undefined,410,undefined,true);
    await request("만료된 게시본의 고정 주소 생성 거부","/fixed-urls","POST",{ name:"만료 후 주소",formId:expired.id },409);
    await data("다른 합성 회사로 전환","/context","POST",{ companyId:previous.tenantId });
    await request("회사 간 고정 주소 상세 차단","/fixed-urls/"+linked.id,"GET",undefined,404);
    await request("회사 간 승인 상세 차단","/approvals/"+firstApproval.row.id,"GET",undefined,404);
    await data("독립 시험 회사로 복귀","/context","POST",{ companyId:tenantId });
    await request("미인증 고정 주소 관리 차단","/fixed-urls","GET",undefined,401,undefined,true);
    await request("미인증 승인 관리 차단","/approvals","GET",undefined,401,undefined,true);
    checkpoint={ tenantId,serviceId,formIds:[main.id,target.id,expired.id],mainFixed:linked,revokedFixed:revoke,expiredFixed,tokens:{ old:first.result.token,main:second.result.token,target:"",expired:exp.result.token },
      publicationReplay:{ formId:main.id,key:second.key,input:{ version:second.input.version } },approvalIds:[rejected.row.id,firstApproval.row.id,secondApproval.row.id,targetApproval.row.id,expiredApproval.row.id],submissionId:submission.id,originalResponse,database:await snapshot(tenantId) };
    await writeFile(".local/p04-publication-checkpoint.json",JSON.stringify(checkpoint,null,2)+"\n",{ mode:0o600 });
  } else {
    checkpoint=JSON.parse(await readFile(".local/p04-publication-checkpoint.json","utf8"));
    assert((await db.company.findUniqueOrThrow({ where:{ id:checkpoint.tenantId } })).name.startsWith("P04 게시 검증 "));
    await data("재시작 후 시험 회사 선택","/context","POST",{ companyId:checkpoint.tenantId });
  }
  const independentDatabase=await verify(checkpoint);
  const report={ phase,result:"passed",checkedAt:new Date().toISOString(),cases,independentDatabase,actualUiVerified:false,syntheticSessionsClosed:true,userAdminAccountUntouched:true,matchesBeforeRestart:phase==="finish",expiryMeasuredWithRealClock:true };
  await request("시험 세션 종료","/auth/sign-out","POST",{}); cookie="";
  await writeFile("docs/qa/P04-T03/http-"+phase+".json",JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify({ phase,result:"passed",cases:cases.length,independentDatabase }));
} finally {
  if (cookie) await fetch(origin+"/api/v1/auth/sign-out",{ method:"POST",headers:{ cookie,origin,"content-type":"application/json" },body:"{}" }).catch(() => undefined);
  await db.$disconnect();
}
