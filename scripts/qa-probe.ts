import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await (await import("node:fs/promises")).readFile(".local/catchsecu_dev-accounts.json","utf8"));
const r = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
const cookie = r.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const month = new Date().toISOString().slice(0,7);
const res = await fetch(base+"/api/v1/analytics/closes",{method:"POST",headers:{cookie,origin:base,"content-type":"application/json"},body:JSON.stringify({month})});
console.log(res.status, JSON.stringify(await res.json()).slice(0,800));
