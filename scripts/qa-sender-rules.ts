import { db } from "../src/server/db";
import { readFile } from "node:fs/promises";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json","utf8"));
const res = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
const cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const senders = await db.sender.findMany({where:{tenantId:"10000000-0000-4000-8000-000000000001"},select:{id:true,status:true,version:true,campaigns:{select:{id:true,status:true},take:2}}});
const out: Record<string,unknown> = {senders:senders.map(s=>({id:s.id.slice(0,8),status:s.status,campaigns:s.campaigns.length}))};
const s0 = senders[0];
if (s0) {
  // 버전 불일치 삭제 시도 → VERSION_CONFLICT
  const r1 = await fetch(`${base}/api/v1/senders/${s0.id}`,{method:"DELETE",headers:{origin:base,"content-type":"application/json",cookie,"Idempotency-Key":"qa-sd-"+Date.now()},body:JSON.stringify({version:s0.version+99})});
  out.versionMismatch = {s:r1.status, code:(await r1.json()).error?.code};
  // 이미 deleted 발신자 재삭제 → 상태 오류
  const r2 = await fetch(`${base}/api/v1/senders/${s0.id}`,{method:"DELETE",headers:{origin:base,"content-type":"application/json",cookie,"Idempotency-Key":"qa-sd2-"+Date.now()},body:JSON.stringify({version:s0.version})});
  out.deleteDeleted = {s:r2.status, code:(await r2.json()).error?.code};
}
console.log(JSON.stringify(out));
await fetch(base+"/api/v1/auth/sign-out",{method:"POST",headers:{origin:base,cookie}});
await db.$disconnect();
