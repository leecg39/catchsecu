import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const out: Record<string,unknown> = {};
// 무효 토큰으로 세션 생성
const bad = await fetch(`${base}/api/v1/subjects/sessions`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({token:"zzz-invalid-token"})});
out.invalidToken = {s:bad.status, code:(await bad.json()).error?.code};
// 미인증 보호 API
const noAuth = await fetch(`${base}/api/v1/subjects/submissions`,{headers:{origin:base}});
out.noSession = {s:noAuth.status, code:(await noAuth.json()).error?.code};
// 조작된 세션 ID
const fake = await fetch(`${base}/api/v1/subjects/submissions`,{headers:{origin:base,"x-subject-session":"99999999-9999-4999-8999-999999999999"}});
out.forgedSession = {s:fake.status, code:(await fake.json()).error?.code};
// 브루트포스: 동일 무효 토큰 반복 → 레이트리밋
let last = 0;
for (let i=0;i<12;i++) {
  const r = await fetch(`${base}/api/v1/subjects/sessions`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({token:"bf-token-"+Math.random()})});
  last = r.status;
  if (r.status===429) { out.bruteForceBlockedAt = i+1; break; }
}
out.lastAttempt = last;
console.log(JSON.stringify(out));
