import { db } from "../src/server/db";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json","utf8"));
const res = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
const cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const svc = "20000000-0000-4000-8000-000000000001";
const form = await db.form.findFirst({where:{service:{tenantId:"10000000-0000-4000-8000-000000000001"}},select:{id:true}});
const notice = await db.notice.findFirst({select:{id:true}});
const alim = await db.kakaoTemplate.findFirst({select:{id:true}}).catch(()=>null);
const bill = await db.paymentOrder.findFirst({select:{id:true}}).catch(()=>null);
const targets: [string,string][] = [
 ["대시보드",`/dashboard/${svc}`],["개인정보",`/privacy-detail/${svc}`],["마케팅",`/marketing-detail/${svc}`],
 ["캐치폼목록",`/services/${svc}/catchforms`],["캐치폼수신자",`/services/${svc}/catchforms/recipients`],
 ["해외캐치폼",`/services/${svc}/oversea/catchforms`],
 ["수신자동의",`/services/${svc}/catchforms/recipients/agree/Y`],
 ["해외동의",`/services/${svc}/oversea/catchforms/agree/Y`],
 ["카테고리동의",`/services/${svc}/catchforms/category/all/agree/Y`],
 ["거주자동의",`/services/${svc}/catchforms/domestic/resident/agree/Y`],
];
if (form) { targets.push(["응답관리",`/form/manage/applicant/${form.id}`],["응답관리svc",`/form/manage/applicant/${svc}/${form.id}`],["응답로그",`/form/manage/applicant/log/${form.id}`]); }
if (notice) targets.push(["공지상세",`/notice/${notice.id}`]);
if (alim) targets.push(["알림톡템플릿",`/alimtalk/templates/${alim.id}`],["알림톡편집",`/alimtalk/templates/${alim.id}/edit`]);
if (bill) targets.push(["청구서",`/bill/${bill.id}`],["환불",`/bill/${bill.id}/refund`]);
const out = [];
for (const [name,path] of targets) {
  const r = await fetch(base+path,{headers:{cookie},redirect:"manual"});
  const loc = r.headers.get("location");
  out.push({name,path,s:r.status,loc:loc?new URL(loc,base).pathname:null});
}
console.log(JSON.stringify({fixture:{form:form?.id?.slice(0,8),notice:notice?.id?.slice(0,8),alim:alim?.id?.slice(0,8),bill:bill?.id?.slice(0,8)},
  results:out}));
await writeFile("docs/qa/P13-T04/dynamic-real-sweep.json",JSON.stringify(out,null,1));
await fetch(base+"/api/v1/auth/sign-out",{method:"POST",headers:{origin:base,cookie}});
await db.$disconnect();
