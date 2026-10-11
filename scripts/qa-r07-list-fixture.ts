import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const origin=new URL(env.BETTER_AUTH_URL).origin,database=new URL(env.DATABASE_URL);
assert.equal(origin,"http://localhost:3121");assert.equal(database.pathname,"/catchsecu_dev");assert.ok(["localhost","127.0.0.1"].includes(database.hostname));
const file=".local/rea-fullstack/r07-list-fixture.json",out="docs/qa/R07-T03/current";
type Fixture={email:string;password:string;cookie:string;userId:string;tenantId:string;providerIds:string[]};
let fixture:Fixture;
const save=()=>writeFile(file,JSON.stringify(fixture,null,2)+"\n",{mode:0o600});
async function request(path:string,method="GET",body?:unknown,expected=200){const response=await fetch(origin+"/api/v1"+path,{method,headers:{origin,cookie:fixture.cookie,"content-type":"application/json","idempotency-key":randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,expected,path+" "+value.error?.code);return{response,value};}
try{
 const stored=await readFile(file,"utf8").catch(error=>{if(error.code!=="ENOENT")throw error;return null;});
 if(stored)fixture=JSON.parse(stored);else{fixture={email:"r07-list-"+randomUUID()+"@example.test",password:"R07-List!"+randomUUID(),cookie:"",userId:"",tenantId:"",providerIds:[]};await save();await request("/auth/sign-up/email","POST",{email:fixture.email,password:fixture.password,name:"R07 목록 검증 관리자"});fixture.userId=(await db.user.update({where:{email:fixture.email},data:{emailVerified:true}})).id;await save();}
 const signed=await request("/auth/sign-in/email","POST",{email:fixture.email,password:fixture.password});fixture.cookie=signed.response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");await save();
 if(!fixture.tenantId){fixture.tenantId=(await request("/companies","POST",{name:"R07 공급자 목록 검증",publicName:"R07 시험 회사"},201)).value.id;await save();}
 await request("/context","POST",{companyId:fixture.tenantId});
 for(let index=fixture.providerIds.length+1;index<=12;index++){const row=(await request("/security/sso","POST",{tenantId:fixture.tenantId,protocol:"gpki",name:"R07 목록 기관 "+String(index).padStart(2,"0")},201)).value;fixture.providerIds.push(row.id);await save();}
 const rows=await db.ssoProvider.findMany({where:{tenantId:fixture.tenantId},select:{id:true,name:true,enabled:true,version:true},orderBy:{name:"asc"}});assert.equal(rows.length,12);assert.ok(rows.every(row=>!row.enabled));const api=(await request("/security/sso")).value;assert.equal(api.items.length,12);assert.deepEqual(api.items.map((row:{id:string})=>row.id).sort(),rows.map(row=>row.id).sort());await mkdir(out,{recursive:true});await writeFile(out+"/list-fixture.json",JSON.stringify({result:"passed",checkedAt:new Date().toISOString(),emailVerificationFixtureOnly:true,companyAndProvidersCreatedByHttp:true,tenantId:fixture.tenantId,rows},null,2)+"\n");console.log({result:"passed",providers:rows.length});
}finally{await db.$disconnect();}
