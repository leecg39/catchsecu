import { db } from "../src/server/db";
import { readFile } from "node:fs/promises";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json","utf8"));
const res = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
const cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const form = await db.form.findFirst({where:{tenantId:"10000000-0000-4000-8000-000000000001",status:"published"},select:{id:true,version:true,title:true,publishedVersionId:true}});
const before = await db.formVersion.findUniqueOrThrow({where:{id:form!.publishedVersionId!},select:{id:true,number:true,status:true,title:true,publishedAt:true}});
const out: Record<string,unknown> = {form:form!.id.slice(0,8), publishedVersion:{number:before.number,status:before.status}};
// 게시 폼에 PATCH — draft 경로만 수정 가능해야
const p = await fetch(`${base}/api/v1/forms/${form!.id}`,{method:"PATCH",headers:{origin:base,"content-type":"application/json",cookie,"Idempotency-Key":"qa-fv-"+Date.now()},body:JSON.stringify({version:form!.version,title:before.title+" (QA 수정)"})});
out.patch = {s:p.status};
const pb = await p.json(); out.patchTitle = pb.title;
const after = await db.formVersion.findUniqueOrThrow({where:{id:before.id},select:{status:true,title:true}});
out.publishedAfter = {status:after.status, title:after.title};
const newDraft = await db.formVersion.findFirst({where:{formId:form!.id,status:"draft"},select:{number:true,title:true}});
out.newDraft = newDraft;
// 롤백: 제목 원복 (draft이므로 안전)
if (newDraft) {
  const cur = await db.form.findUniqueOrThrow({where:{id:form!.id},select:{version:true}});
  await fetch(`${base}/api/v1/forms/${form!.id}`,{method:"PATCH",headers:{origin:base,"content-type":"application/json",cookie,"Idempotency-Key":"qa-fv-rev-"+Date.now()},body:JSON.stringify({version:cur.version,title:before.title})});
  out.restored = true;
}
console.log(JSON.stringify(out));
await fetch(base+"/api/v1/auth/sign-out",{method:"POST",headers:{origin:base,cookie}});
await db.$disconnect();
