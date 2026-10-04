import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json","utf8"));
const res = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
const cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const routes = `access-requests activity-reviews analytics/closes analytics/collect-destruction analytics/dashboard analytics/exports
approvals assets audit-events billing-history billing/orders clause-templates companies context
destruction-certificates destruction-requests documents documents/options email-feedback email-suppressions
entitlements expert-assignments expert-assignments/options exports files fixed-urls forms forms/document-options
health imports invitations kakao/reviews ledger me me/audit-events me/password-policy me/sessions members
migration/legacy plans processing-purposes ready recipients security/policy security/status services
share-grants sms/receipts templates`.split(/\s+/);
const out = [];
for (const r of routes) {
  const anon = await fetch(`${base}/api/v1/${r}`,{redirect:"manual"});
  const auth = await fetch(`${base}/api/v1/${r}`,{headers:{cookie},redirect:"manual"});
  out.push({route:r, anon:anon.status, auth:auth.status});
}
const anomalies = out.filter(o => o.anon>=500||o.auth>=500||o.anon===0||o.auth===0);
const anonOpen = out.filter(o => o.anon===200);
console.log(JSON.stringify({total:out.length, anon401:out.filter(o=>o.anon===401).length,
  anon200:anonOpen.map(o=>o.route), authErrors:anomalies.length,
  authNot2xx:out.filter(o=>o.auth>=400&&o.auth!==404).map(o=>({r:o.route,s:o.auth}))}));
await writeFile("docs/qa/api-boundary-sweep.json", JSON.stringify(out,null,1));
await fetch(base+"/api/v1/auth/sign-out",{method:"POST",headers:{origin:base,cookie}});
