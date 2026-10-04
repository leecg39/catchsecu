import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const targets = [
  ["POST","/api/v1/members"],["POST","/api/v1/campaigns"],["POST","/api/v1/senders"],
  ["POST","/api/v1/notices"],["POST","/api/v1/forms"],["POST","/api/v1/services"],
  ["POST","/api/v1/invitations"],["POST","/api/v1/support-tickets"],["POST","/api/v1/exports"],
  ["PATCH","/api/v1/members/00000000-0000-4000-8000-000000000000"],
  ["DELETE","/api/v1/forms/00000000-0000-4000-8000-000000000000"],
  ["POST","/api/v1/security/policy"],["POST","/api/v1/subscriptions"],
  ["PUT","/api/v1/message-content"],["POST","/api/v1/billing/orders"]
];
const out = [];
for (const [m,p] of targets) {
  const r = await fetch(base+p,{method:m,redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:"{}"});
  out.push({m,p,s:r.status});
}
console.log(JSON.stringify({total:out.length, unauthBlocked:out.filter(o=>o.s===401||o.s===403).length,
  leaked:out.filter(o=>o.s<400&&o.s!==307&&o.s!==308), s5xx:out.filter(o=>o.s>=500)}));
