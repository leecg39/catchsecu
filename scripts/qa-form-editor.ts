import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { fingerprint, versionInclude } from "../src/server/forms";
import { formInput } from "../src/contracts/domains";
import { FormDraftSession, draftValue, type FormDraftValue } from "../src/lib/form-draft";
import type { FormRecord, Paged } from "../src/contracts/forms";
import type { FormDocumentOption, FormConsentBundle } from "../src/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const phase = process.argv[2]; assert(["prepare","finish"].includes(phase));
const people = JSON.parse(await readFile(".local/p03-members-fixture.json","utf8")) as { people: { id: string; email: string; password: string }[] };
const catalog = JSON.parse(await readFile(".local/p05-catalog-checkpoint.json","utf8")) as { tenantId: string; serviceId: string };
const docs = JSON.parse(await readFile(".local/p05-document-checkpoint.json","utf8")) as { documentIds: string[] };
const person = people.people[1]; assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
type Checkpoint = { formId: string; token: string; current: FormRecord; publishedHash: string; bundle: FormConsentBundle; lostKey: string; lostInput: { version: number; title: string; content: FormDraftValue["content"] };
  creation: { current: FormRecord; key: string; input: unknown } };
const cases: { label: string; status: number }[] = [], cookies = new Set<string>(), sessions: FormDraftSession[] = [];
async function request(label: string, path: string, cookie = "", method = "GET", input?: unknown, expected = 200, key?: string) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie,
    ...(method === "GET" ? {} : { origin }), ...(input === undefined ? {} : { "content-type":"application/json" }),
    ...(key || method === "POST" ? { "idempotency-key": key ?? randomUUID() } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(response.status,expected,label); cases.push({ label,status:response.status }); return response;
}
async function data<T>(label: string, path: string, cookie = "", method = "GET", input?: unknown, expected = 200, key?: string) {
  return await (await request(label,path,cookie,method,input,expected,key)).json() as T;
}
function draftSession(cookie: string, label: string, seed: FormDraftValue, initial?: FormRecord, lose?: { enabled: boolean; key?: string; input?: Checkpoint["lostInput"] }) {
  let calls = 0;
  const s = new FormDraftSession({ initial, seed, validate: value => formInput.parse(value), persist: async (record,value,key) => {
    const input = record ? { version:record.version, title:value.title, content:value.content } : value;
    const response = await fetch(origin + "/api/v1/forms" + (record ? "/" + record.id + "/draft" : ""), { method: record ? "PATCH":"POST",
      headers: { cookie,origin,"content-type":"application/json","idempotency-key":key },body:JSON.stringify(input) });
    cases.push({ label:label + " 서버 저장 " + ++calls,status:response.status });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "저장 실패"),{ status:response.status });
    assert.equal(response.status,record ? 200 : 201,label);
    assert.equal(result.publication?.token,undefined,"초안 저장 응답은 게시 토큰을 포함하지 않음");
    if (lose?.enabled) { lose.enabled=false; lose.key=key; lose.input=input as Checkpoint["lostInput"]; throw new TypeError("시험용 성공 응답 유실"); }
    return result as FormRecord;
  } });
  sessions.push(s); s.start(); return s;
}
async function verify(checkpoint: Checkpoint,cookie: string) {
  const current = await data<FormRecord>("현재 초안 서버 복원","/forms/" + checkpoint.formId,cookie);
  assert.equal(current.version,9); assert.deepEqual(current.content,checkpoint.current.content); assert.equal(current.title,checkpoint.current.title);
  const published = await data<{ title: string; content: FormDraftValue["content"]; consentBundle: FormConsentBundle }>("기존 공개본·동의 문서 유지","/public/forms/" + checkpoint.token);
  assert.notEqual(published.content.body,current.content.body); assert.deepEqual(published.consentBundle,checkpoint.bundle);
  const replay = await data<FormRecord>("응답 유실 저장 키의 재전송","/forms/" + checkpoint.formId + "/draft",cookie,"PATCH",checkpoint.lostInput,200,checkpoint.lostKey);
  assert.equal(replay.version,2); assert.equal(replay.content.body,"응답 유실 전에 반영한 본문");
  const versions = await db.formVersion.findMany({ where:{ formId:checkpoint.formId },include:versionInclude,orderBy:{ number:"asc" } });
  assert.equal(versions.length,2); assert.equal(versions[0].status,"published"); assert.equal(versions[1].status,"draft"); assert.equal(fingerprint(versions[0]),checkpoint.publishedHash);
  assert.equal(versions[1].body,current.content.body); assert.equal(versions[0].maxResponses,4); assert.equal(versions[0].showSubmitNotice,false);
  assert.deepEqual(versions[0].questions.map(q => q.stableKey),versions[1].questions.map(q => q.stableKey));
  assert.equal(new Set(versions.flatMap(v => v.questions.map(q => q.id))).size,4);
  assert.equal(versions[0].documentBindings.length,2); assert.equal(versions[1].documentBindings.length,2);
  const row = await db.form.findUniqueOrThrow({ where:{ id:checkpoint.formId } }); assert.equal(row.version,9); assert.equal(row.title,current.title);
  const auditCount = await db.auditEvent.count({ where:{ resourceId:checkpoint.formId } }); assert.equal(auditCount,9);
  const saveKeys = await db.idempotencyRecord.count({ where:{ scope:{ endsWith:":" + checkpoint.formId } } }); assert.equal(saveKeys,8);
  const creation = await data<FormRecord>("생성 응답 유실 후 같은 서비스·추가 입력 유지","/forms/" + checkpoint.creation.current.id,cookie);
  assert.equal(creation.version,2); assert.equal(creation.serviceId,catalog.serviceId); assert.deepEqual(creation.content,checkpoint.creation.current.content);
  const createReplay = await data<FormRecord>("최초 생성 키의 재전송은 같은 ID 유지","/forms",cookie,"POST",checkpoint.creation.input,201,checkpoint.creation.key);
  assert.equal(createReplay.id,creation.id); assert.equal(createReplay.version,1);
  assert.equal(await db.form.count({ where:{ tenantId:catalog.tenantId,title:creation.title } }),1);
  assert.equal(await db.auditEvent.count({ where:{ resourceId:creation.id } }),2);
  return { formVersion:9,storedVersions:2,publishedVersions:1,drafts:1,questionRows:4,stableQuestionIds:2,documentBindings:4,auditCount,idempotencyKeysForForm:saveKeys,
    publishedHashMatches:true,publishedBodyAndBundleFrozen:true,currentStateMatchesHttp:true,replayAddsNoWrite:true,
    creationReplay:{ formVersion:2,formsForMarker:1,auditCount:2,sameServicePreserved:true,extraInputPreserved:true } };
}
async function main() {
  const user = await db.user.findUniqueOrThrow({ where:{ id:person.id } }); assert.equal(user.status,"active"); assert.equal(user.platformAdmin,false);
  const login = await request("합성 소유자 로그인","/auth/sign-in/email","","POST",{ email:person.email,password:person.password });
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie); cookies.add(cookie);
  await request("시험 회사 선택","/context",cookie,"POST",{ companyId:catalog.tenantId });
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const seed: FormDraftValue = { serviceId:catalog.serviceId,title:"",content:{ body:"처음 작성한 본문",questions:[
      { id:randomUUID(),type:"단문형 답변",label:"이름",required:true,subjectRole:"name" },
      { id:randomUUID(),type:"단문형 답변",label:"이메일",required:true,subjectRole:"email" }],consentRequired:false,consentPurpose:"",retentionDays:30,maxResponses:10 } };
    const lost = { enabled:false } as { enabled:boolean;key?:string;input?:Checkpoint["lostInput"] };
    const a = draftSession(cookie,"기기 A",seed,undefined,lost); a.edit({ ...seed,title:"편집기 QA " + randomUUID() });
    const deadline = Date.now()+10000;
    while (a.getSnapshot().phase !== "saved" && Date.now() < deadline) { assert(!["error","invalid","conflict"].includes(a.getSnapshot().phase)); await new Promise(done => setTimeout(done,25)); }
    assert.equal(a.getSnapshot().phase,"saved"); const created = a.getSnapshot().record!; assert.equal(created.version,1);
    const b = draftSession(cookie,"기기 B",draftValue(created),created);
    lost.enabled=true; a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,body:"응답 유실 전에 반영한 본문" } });
    assert.equal(await a.save(),undefined); assert.equal(a.getSnapshot().phase,"error");
    a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,body:"재시도 중 추가한 본문" } }); assert.equal((await a.save())?.version,3);
    const options = await data<Paged<FormDocumentOption>>("현재 제공·수집 동의 문서 목록","/forms/document-options?serviceId=" + catalog.serviceId + "&pageSize=100",cookie);
    const collection = options.items.find(x => x.documentId===docs.documentIds[0] && x.number===3), recipient = options.items.find(x => x.documentId===docs.documentIds[2]); assert(collection && recipient);
    a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,documentConsents:[{ documentVersionId:recipient.documentVersionId,kind:"third_party",required:true }] } }); assert.equal((await a.save())?.version,4);
    a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,consentRequired:true,consentPurpose:"합성 문의 처리",documentConsents:[...a.getSnapshot().value.content.documentConsents!,{ documentVersionId:collection.documentVersionId,kind:"collection",required:true }] } }); assert.equal((await a.save())?.version,5);
    a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,maxResponses:4,showSubmitNotice:false } }); assert.equal((await a.save())?.version,6);
    b.edit({ ...b.getSnapshot().value,content:{ ...b.getSnapshot().value.content,body:"다른 기기의 오래된 수정" } }); assert.equal(await b.save(),undefined); assert.equal(b.getSnapshot().phase,"conflict");
    assert.equal(b.getSnapshot().value.content.body,"다른 기기의 오래된 수정");
    const fresh = await data<FormRecord>("409 뒤 최신본 복원","/forms/" + created.id,cookie); assert.equal(fresh.content.body,"재시도 중 추가한 본문"); b.load(fresh);
    b.edit({ ...b.getSnapshot().value,content:{ ...b.getSnapshot().value.content,bold:true } }); const beforePublish = (await b.save())!; assert.equal(beforePublish.version,7); a.load(beforePublish);
    const requestCount = cases.length; a.edit({ ...a.getSnapshot().value,content:{ ...a.getSnapshot().value.content,retentionDays:0 } }); assert.equal(await a.save(),undefined); assert.equal(a.getSnapshot().phase,"invalid"); assert.equal(cases.length,requestCount); a.load(beforePublish);
    await request("무효 설정 서버 거부","/forms/" + created.id + "/draft",cookie,"PATCH",{ version:7,content:{ ...beforePublish.content,retentionDays:0 } },422,randomUUID());
    const live = await data<{ token:string }>("저장 완료한 초안 게시","/forms/" + created.id + "/publish",cookie,"POST",{ version:7 },201);
    const publishedRecord = await data<FormRecord>("게시 후 최신 version 조회","/forms/" + created.id,cookie); assert.equal(publishedRecord.version,8); a.load(publishedRecord);
    const publicForm = await data<{ consentBundle:FormConsentBundle }>("두 종류의 당시 동의 문서 조회","/public/forms/" + live.token); assert.equal(publicForm.consentBundle.documents.length,2);
    const version = await db.formVersion.findFirstOrThrow({ where:{ formId:created.id,status:"published" },include:versionInclude }); const publishedHash=fingerprint(version);
    a.edit({ ...a.getSnapshot().value,title:"새 초안의 제목",content:{ ...a.getSnapshot().value.content,body:"공개하지 않은 새 본문" } }); const current=(await a.save())!; assert.equal(current.version,9);
    const creationLoss = { enabled:true } as { enabled:boolean;key?:string;input?:Checkpoint["lostInput"] };
    const creationSeed = { ...seed,content:{ ...seed.content,questions:seed.content.questions.map(question => ({ ...question,id:randomUUID() })) } };
    const creationSession = draftSession(cookie,"최초 생성 응답 유실",creationSeed,undefined,creationLoss);
    creationSession.edit({ ...creationSeed,title:"생성 유실 QA " + randomUUID() }); assert.equal(await creationSession.save(),undefined); assert.equal(creationSession.hasPendingCreation(),true);
    creationSession.edit({ ...creationSession.getSnapshot().value,serviceId:randomUUID(),content:{ ...creationSession.getSnapshot().value.content,body:"생성 유실 뒤 추가 입력" } });
    assert.equal(creationSession.getSnapshot().value.serviceId,catalog.serviceId);
    const recoveredCreation=(await creationSession.save())!; assert.equal(recoveredCreation.version,2); assert.equal(creationSession.hasPendingCreation(),false);
    checkpoint={ formId:created.id,token:live.token,current,publishedHash,bundle:publicForm.consentBundle,lostKey:lost.key!,lostInput:lost.input!,
      creation:{ current:recoveredCreation,key:creationLoss.key!,input:creationLoss.input } };
    await writeFile(".local/p04-editor-checkpoint.json",JSON.stringify(checkpoint,null,2)+"\n",{ mode:0o600 });
    for (const path of ["create","basic-frame","basic-frame/v3","recipient","agreement","set","setting","share"]) {
      const url="/form/ai/"+path+"?formId="+created.id;
      const response=await fetch(origin+url,{ headers:{ cookie },redirect:"manual" }); assert.equal(response.status,200,"편집 경로 "+path); cases.push({ label:"편집 경로 HTTP "+path,status:response.status });
      assert(response.headers.get("content-type")?.includes("text/html"));
    }
  } else checkpoint=JSON.parse(await readFile(".local/p04-editor-checkpoint.json","utf8"));
  const databaseEvidence=await verify(checkpoint,cookie);
  await request("합성 세션 로그아웃","/auth/sign-out",cookie,"POST",{}); cookies.delete(cookie);
  await request("로그아웃 후 저장 재전송 차단","/forms/"+checkpoint.formId+"/draft",cookie,"PATCH",checkpoint.lostInput,401,checkpoint.lostKey);
  const report={ phase,result:"passed",checkedAt:new Date().toISOString(),cases,database:databaseEvidence,matchesBeforeRestart:phase==="finish",actualUiVerified:false,syntheticSessionsClosed:true,userAdminAccountUntouched:true };
  await writeFile("docs/qa/P04-T02/http-"+phase+".json",JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report));
}
try { await main(); } finally {
  sessions.forEach(session => session.stop());
  for (const cookie of cookies) await fetch(origin+"/api/v1/auth/sign-out",{ method:"POST",headers:{ cookie,origin,"content-type":"application/json" },body:"{}" });
  await db.$disconnect();
}
