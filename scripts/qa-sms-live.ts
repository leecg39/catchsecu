/** Solapi 라이브 SMS 캠페인 E2E: 폼 동의 → 수신자 선택 → 예약 → 워커 실발송 → 영수증 검증. */
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
const base = new URL(env.BETTER_AUTH_URL).origin;
const tenant = env.SOLAPI_TENANT_ID!;
const pw = JSON.parse(await (await import("node:fs/promises")).readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const signIn = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
if (signIn.status !== 200) throw new Error("login " + signIn.status);
const cookie = signIn.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function api(path: string, method = "GET", data?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(base + "/api/v1" + path, { method, headers: { cookie, origin: base, "content-type": "application/json", ...extra }, body: data ? JSON.stringify(data) : undefined });
  const text = await r.text(); let json: unknown = null; try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
  return { status: r.status, body: json as Record<string, unknown> };
}
const ctx = await api("/context");
const service = await db.service.findFirstOrThrow({ where: { tenantId: tenant }, select: { id: true, name: true } });
const sender = await db.sender.findFirstOrThrow({ where: { tenantId: tenant, channel: "sms", status: "verified" } });
console.log("ctx", ctx.status, "service", service.name, "sender", sender.id);
const phone = "01029062908";
// 1) 동의 폼 생성·게시·공개 제출
const qName = crypto.randomUUID(), qPhone = crypto.randomUUID();
const form = await api("/forms", "POST", { serviceId: service.id, title: "솔라피 라이브 동의 " + Date.now(), content: { body: "마케팅 수신 동의", consentPurpose: "SMS 안내", consentRequired: true, retentionDays: 30, maxResponses: 20, questions: [{ id: qName, label: "이름", type: "단문형 답변", required: true }, { id: qPhone, label: "전화번호", type: "단문형 답변", required: true }], marketing: { purpose: "SMS 안내", nameQuestionId: qName, smsQuestionId: qPhone } } }, { "idempotency-key": crypto.randomUUID() });
if (form.status !== 201) throw new Error("form " + JSON.stringify(form.body));
const reqAppr = await api("/forms/" + form.body.id + "/approvals", "POST", { version: form.body.version, message: "Solapi 라이브 검증 게시", reference: "QA-SMS-LIVE-" + Date.now() }, { "idempotency-key": crypto.randomUUID() });
if (reqAppr.status !== 201) throw new Error("approval request " + JSON.stringify(reqAppr.body));
const apprId = reqAppr.body.id as string, apprVer = reqAppr.body.version as number;
const decide = await api("/approvals/" + apprId + "/decision", "POST", { version: apprVer, decision: "approved", reason: "QA 실발송 검증" }, { "idempotency-key": crypto.randomUUID() });
if (decide.status !== 200 && decide.status !== 201) throw new Error("decision " + JSON.stringify(decide.body));
const formNow = await api("/forms/" + form.body.id);
const pub = await api("/forms/" + form.body.id + "/publish", "POST", { version: (formNow.body as { version: number }).version }, { "idempotency-key": crypto.randomUUID() });
if (pub.status !== 201) throw new Error("publish " + JSON.stringify(pub.body));
const sub = await fetch(base + "/api/v1/public/forms/" + (pub.body as { token: string }).token + "/submissions", { method: "POST", headers: { origin: base, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ answers: { [qName]: "QA 본인", [qPhone]: phone }, consent: true, marketingChannels: ["sms"] }) });
if (sub.status !== 201) throw new Error("submission " + sub.status + " " + await sub.text());
const subId = (await sub.json() as { id: string }).id;
const pref = await db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: subId, channel: "sms" } });
console.log("consent", pref.id, pref.status);
// 2) 캠페인 생성 → 수신자 선택 → 예약
const campaign = await api("/campaigns", "POST", { serviceId: service.id, channel: "sms", source: "form", title: "솔라피 라이브 " + Date.now(), senderId: sender.id, content: { format: "text", subject: "라이브 SMS 검증", text: "[캐챠시큐] {{name}} 님 SMS 캠페인 라이브 검증입니다." } }, { "idempotency-key": crypto.randomUUID() });
if (campaign.status !== 201) throw new Error("campaign " + JSON.stringify(campaign.body));
const cid = campaign.body.id as string;
const rec = await api("/campaigns/" + cid + "/recipients", "POST", { mode: "selection", version: 1, preferenceIds: [pref.id] });
if (rec.status !== 200) throw new Error("recipients " + JSON.stringify(rec.body));
const detail = await api("/campaigns/" + cid);
const sch = await api("/campaigns/" + cid + "/schedule", "POST", { version: (detail.body as { version: number }).version, at: null }, { "idempotency-key": crypto.randomUUID() });
if (sch.status !== 202) throw new Error("schedule " + JSON.stringify(sch.body));
console.log("scheduled", cid);
// 3) 워커 실행 (이 프로세스 env의 SMS_TRANSPORT)
console.log("SMS_TRANSPORT", env.SMS_TRANSPORT);
let job = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: cid } } });
for (let i = 0; i < 20 && !["done", "cancelled", "dead"].includes(job.status); i++) { await runOneJob("qa-live-" + crypto.randomUUID()); job = await db.job.findUniqueOrThrow({ where: { id: job.id } }); }
const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: cid } });
const receipt = await db.smsReceipt.findUnique({ where: { deliveryId: delivery.id } });
const row = await db.campaign.findUniqueOrThrow({ where: { id: cid } });
console.log(JSON.stringify({ campaign: row.status, delivery: delivery.status, reason: delivery.reason, job: job.status, lastError: job.lastError, receipt: receipt ? { receiptId: receipt.receiptId, status: receipt.status } : null }));
await writeFile("docs/qa/P08-T02/live-solapi-campaign.json", JSON.stringify({ checkedAt: new Date().toISOString(), campaignId: cid, campaign: row.status, delivery: { status: delivery.status, reason: delivery.reason, acceptedAt: delivery.acceptedAt }, job: { id: job.id, status: job.status }, receipt: receipt ? { receiptId: receipt.receiptId, status: receipt.status } : null }, null, 2));
