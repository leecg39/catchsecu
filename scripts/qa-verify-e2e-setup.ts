// P06-T06 브라우저 실측용 fixture: verify=true 폼 + enabled 연동 + 승인·게시 → 토큰 출력
import { randomUUID } from "node:crypto";
const base = "http://localhost:3100";
const pw = JSON.parse(await (await import("node:fs/promises")).readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
if (login.status !== 200) throw new Error("login " + login.status);
const cookie = login.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
const ctx = await (await fetch(base + "/api/v1/context", { headers: { cookie } })).json();
const service = ctx.serviceId ?? ctx.services?.[0]?.id;
const call = (path: string, method = "GET", body?: unknown) => fetch(base + "/api/v1" + path, { method,
  headers: { "content-type": "application/json", origin: base, cookie, "idempotency-key": randomUUID() },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
// 연동: 있으면 enabled로 PATCH, 없으면 생성
const state = await (await call(`/services/${service}/verification`)).json();
if (state.integration) {
  const up = await call(`/services/${service}/verification`, "PATCH", { identityProvider: "local", signatureProvider: null, environment: "sandbox", status: "enabled", version: state.integration.version });
  console.log("integration patch:", up.status, up.status !== 200 ? await up.text() : "");
} else {
  const created = await call(`/services/${service}/verification`, "POST", { identityProvider: "local", signatureProvider: null, environment: "sandbox", status: "enabled" });
  console.log("integration:", created.status, created.status !== 201 ? await created.text() : "");
}
const question = randomUUID();
const form = await call("/forms", "POST", { serviceId: service, title: "P06-T06 인증 실측 폼", content: { body: "본인인증 필요", consentRequired: true, consentPurpose: "인증 실측", retentionDays: 30, maxResponses: 50, verify: true,
  questions: [{ id: question, type: "단문형 답변", label: "메모", required: true }] } });
const formJson = await form.json(); console.log("form:", form.status, formJson.id ?? JSON.stringify(formJson));
// 승인 요청 → 승인 → 게시
const apReq = await call(`/forms/${formJson.id}/approvals`, "POST", { version: formJson.version, message: "P06-T06 브라우저 실측 승인", reference: "QA-P06T06-001" });
const apJson = await apReq.json(); console.log("approval request:", apReq.status, apReq.status !== 201 ? JSON.stringify(apJson) : apJson.id);
const apVersion = apJson.version ?? 1;
const decide = await call(`/approvals/${apJson.id}/decision`, "POST", { version: apVersion, decision: "approved", reason: "실측 승인" });
console.log("decision:", decide.status, decide.status !== 200 ? await decide.text() : "");
const fresh = await (await call(`/forms/${formJson.id}`)).json(); const pub = await call(`/forms/${formJson.id}/publish`, "POST", { version: fresh.version ?? formJson.version });
const pubJson = await pub.json(); console.log("publish:", pub.status, JSON.stringify(pubJson).slice(0, 300));
if (pubJson.token) console.log("PUBLIC_URL:", base + "/f/" + pubJson.token);
