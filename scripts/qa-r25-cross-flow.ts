// R25-T02 전 도메인 교차 흐름: 하나의 실제DB 흐름으로 조직→폼→승인게시→응답→동의→공유/열람자→예약발송→과금→철회파기→감사 통계 검증.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
import { runOneDestruction } from "../src/server/destruction-worker";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R25-T02/acceptance");
const TENANT = "10000000-0000-4000-8000-000000000001";
const SERVICE = "20000000-0000-4000-8000-000000000001";
const results: { step: string; detail: unknown }[] = [];
const step = (n: string, d: unknown) => { results.push({ step: n, detail: d }); console.log("PASS", n, JSON.stringify(d).slice(0, 220)); };

const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
async function signIn(email: string) {
  const r = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw[email] }) });
  assert.equal(r.status, 200, `sign-in ${email} → ${r.status}`);
  return r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { origin: base, "content-type": "application/json", ...headers };
  if (cookie) h.cookie = cookie;
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 204) return { status: 204, body: {}, headers: r.headers };
  let payload: unknown = null; try { payload = await r.json(); } catch { /* binary */ }
  return { status: r.status, body: payload as Record<string, unknown>, headers: r.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
async function drain(max = 40) { let n = 0; while (n < max && await runOneJob("r25-cross")) n++; return n; }
const mailBefore = new Set(await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[]));
async function localMail(to: string, needle: string, pattern: RegExp) {
  for (let i = 0; i < 12; i++) {
    await drain(12);
    for (const f of await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[])) {
      if (mailBefore.has(f)) continue;
      try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
        if (m?.to === to && typeof m.text === "string" && m.text.includes(needle)) {
          const code = pattern.exec(m.text)?.[1]; if (code) return code;
        }
      } catch { /* 다른 형식 */ }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

const stamp = Date.now();
const cookie = await signIn("owner@catchsecu.local.test");
await api(cookie, "/context", "POST", { serviceId: SERVICE });
await mkdir(outDir, { recursive: true });

// 1) 폼 생성 → 승인 → 게시 (조직→문서→폼→승인게시)
const qName = randomUUID(), qMail = randomUUID(), qSms = randomUUID();
const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R25 교차 폼 " + stamp,
  content: { body: "R25", consentPurpose: "R25 수용", consentRequired: true, retentionDays: 30, maxResponses: 10,
    questions: [{ id: qName, label: "이름", type: "단문형 답변", required: true, subjectRole: "name" },
      { id: qMail, label: "이메일", type: "이메일", required: true, subjectRole: "email" },
      { id: qSms, label: "문자 연락처", type: "연락처", required: true }],
    marketing: { purpose: "R25 소식", nameQuestionId: qName, smsQuestionId: qSms } } }, ik());
assert.equal(form.status, 201, JSON.stringify(form.body));
const fid = form.body.id as string;
const appr = await api(cookie, `/forms/${fid}/approvals`, "POST", { version: form.body.version, message: "R25", reference: "QA-R25-" + stamp }, ik());
assert.equal(appr.status, 201, JSON.stringify(appr.body));
await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R25" }, ik());
const pub = await api(cookie, `/forms/${fid}/publish`, "POST", { version: (await api(cookie, `/forms/${fid}`)).body.version as number }, ik());
assert.ok([200, 201].includes(pub.status) && pub.body.token, `publish → ${pub.status}`);
step("form-publish", { formId: fid, token: !!pub.body.token });

// 2) 공개 응답 제출 → SMS 마케팅 동의 생성 (응답/업로드→동의)
const phone = "010-5555-" + String(stamp % 10000).padStart(4, "0");
const sub = await fetch(`${base}/api/v1/public/forms/${pub.body.token}/submissions`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
  body: JSON.stringify({ consent: true, marketingChannels: ["sms"], answers: { [qName]: "R25 수신자", [qMail]: `r25-${stamp}@example.test`, [qSms]: phone } }) });
assert.equal(sub.status, 201, `public submit → ${sub.status}`);
const subBody = await sub.json() as { id: string };
const pref = await db.marketingPreference.findFirst({ where: { tenantId: TENANT, serviceId: SERVICE, channel: "sms", status: "granted" }, orderBy: { createdAt: "desc" } });
assert.ok(pref, "sms marketing preference granted");
step("submission-consent", { submissionId: subBody.id, preferenceId: pref!.id });

// 3) 공유 → 열람자 인증 → 공유 응답 조회 (공유/정보주체)
const viewerEmail = `r25-viewer-${stamp}@catchsecu.local.test`;
const fv = await db.formVersion.findFirstOrThrow({ where: { formId: fid, status: "published" } });
const grant = await api(cookie, "/share-grants", "POST", { formId: fid, formVersionId: fv.id, email: viewerEmail,
  questionIds: [qName], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 201].includes(grant.status), `share grant → ${grant.status} ${JSON.stringify(grant.body)}`);
const inviteCode = await localMail(viewerEmail, "열람자 인증코드:", /열람자 인증코드: ([A-Za-z0-9_-]{43})/);
assert.ok(inviteCode, "viewer invitation code mailed (local)");
const ch = await fetch(`${base}/api/v1/viewer/challenges`, { method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ formCode: fid, invitationCode: inviteCode, email: viewerEmail, consent: true }) });
const chText = await ch.text(); assert.equal(ch.status, 202, `challenge → ${ch.status} ${chText}`);
const chCookie = ch.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const chBody = JSON.parse(chText) as { challengeId?: string; id?: string };
const verifyCode = await localMail(viewerEmail, "이메일 인증코드:", /이메일 인증코드: (\d{6})/);
assert.ok(verifyCode, "viewer verify code mailed");
const ver = await fetch(`${base}/api/v1/viewer/challenges/${chBody.challengeId ?? chBody.id}/verify`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", cookie: chCookie }, body: JSON.stringify({ code: verifyCode }) });
const verText = await ver.text(); assert.equal(ver.status, 200, `verify → ${ver.status} ${verText}`);
const vCookie = ver.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const shared = await fetch(`${base}/api/v1/viewer/submissions/${subBody.id}`, { headers: { cookie: vCookie } });
assert.equal(shared.status, 200, `viewer shared read → ${shared.status}`);
step("share-viewer", { grant: grant.status, challenge: ch.status, verify: ver.status, sharedRead: shared.status });

// 4) SMS 캠페인 선택발송 → 로컬 영수증 (동의→예약발송)
const sender = await db.sender.findFirstOrThrow({ where: { tenantId: TENANT, channel: "sms", status: "verified" } });
const camp = await api(cookie, "/campaigns", "POST", { serviceId: SERVICE, channel: "sms", source: "form",
  title: "R25 캠페인 " + stamp, senderId: sender.id,
  content: { format: "text", subject: "R25 안내", text: "R25 {{name}} 안내드립니다" } }, ik());
assert.equal(camp.status, 201, JSON.stringify(camp.body));
const cid = camp.body.id as string;
const tgt = await api(cookie, `/campaigns/${cid}/recipients`, "POST", { mode: "selection", version: camp.body.version, preferenceIds: [pref!.id] }, ik());
assert.ok([200, 201].includes(tgt.status), `recipients → ${tgt.status} ${JSON.stringify(tgt.body)}`);
const cv = (await api(cookie, `/campaigns/${cid}`)).body as { version: number };
const sch = await api(cookie, `/campaigns/${cid}/schedule`, "POST", { version: cv.version, at: null, excludeInvalid: false }, ik());
assert.ok([200, 202].includes(sch.status), `schedule → ${sch.status} ${JSON.stringify(sch.body)}`);
await drain();
const done = await db.campaignDelivery.findMany({ where: { campaignId: cid } });
assert.ok(done.length === 1 && done[0].status === "local_delivered", `delivery → ${JSON.stringify(done.map(d => d.status))}`);
step("campaign-send", { campaignId: cid, delivered: done[0].status, senderId: sender.id });

// 5) 과금: 구독 → 주문 → 가상결제 승인 → 원장 (예약발송→과금)
const plan = await db.billingPlanVersion.findFirstOrThrow({ select: { id: true } });
const subs = await api(cookie, "/subscriptions", "POST", { planVersionId: plan.id }, ik());
assert.ok([200, 201, 202].includes(subs.status), `subscription → ${subs.status} ${JSON.stringify(subs.body)}`);
const order = await api(cookie, "/billing/orders", "POST", { subscriptionId: subs.body.id }, ik());
assert.equal(order.status, 201, `order → ${order.status} ${JSON.stringify(order.body)}`);
const pay = await api(cookie, `/billing/orders/${order.body.id}/virtual-checkout`, "POST", { outcome: "paid" }, ik());
assert.ok([200, 202].includes(pay.status), `virtual checkout → ${pay.status} ${JSON.stringify(pay.body)}`);
const settled = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.body.id as string } });
assert.equal(settled.status, "paid", `order status → ${settled.status}`);
const ledger = await db.ledgerTransaction.findFirst({ where: { tenantId: TENANT }, orderBy: { createdAt: "desc" }, include: { entries: true } });
assert.ok(ledger && ledger.entries.length >= 2, "ledger entries posted");
step("billing", { orderId: settled.id, status: settled.status, ledgerEntries: ledger!.entries.length });

// 6) 응답 철회 → 파기 요청→승인→워커 → 증명서 (철회파기)
const subDetail = await api(cookie, `/submissions/${subBody.id}`);
assert.equal(subDetail.status, 200, JSON.stringify(subDetail.body).slice(0, 200));
const wd = await api(cookie, `/submissions/${subBody.id}/withdraw`, "POST", { version: (subDetail.body as { version: number }).version, reason: "R25 철회" }, ik());
assert.equal(wd.status, 200, `withdraw → ${wd.status} ${JSON.stringify(wd.body)}`);
let srow = await db.submission.findUniqueOrThrow({ where: { id: subBody.id } });
assert.equal(srow.status, "withdrawn");
const afterWd = await api(cookie, `/submissions/${subBody.id}`);
const dr = await api(cookie, `/submissions/${subBody.id}/destruction-request`, "POST", { version: (afterWd.body as { version: number }).version, reason: "R25 파기" }, ik());
assert.ok([200, 201].includes(dr.status), `destruction-request → ${dr.status} ${JSON.stringify(dr.body)}`);
const dReqs = await api(cookie, "/destruction-requests");
const reqRow = ((dReqs.body as { items: { id: string; status: string; version: number; submissionId?: string }[] }).items ?? [])
  .find(i => i.submissionId === subBody.id || JSON.stringify(i).includes(subBody.id));
assert.ok(reqRow, "destruction request listed");
const appv = await api(cookie, `/destruction-requests/${reqRow!.id}/approve`, "POST", { version: reqRow!.version, reason: "R25 승인" }, ik());
assert.ok([200, 201].includes(appv.status), `approve → ${appv.status} ${JSON.stringify(appv.body)}`);
for (let i = 0; i < 15 && srow.status !== "destroyed"; i++) { await runOneDestruction("r25-cross-" + i); srow = await db.submission.findUniqueOrThrow({ where: { id: subBody.id } }); }
const cert = await db.destructionCertificate.findFirst({ where: { submissionId: subBody.id } });
assert.equal(srow.status, "destroyed", `destruction → ${srow.status}`);
assert.ok(cert?.digest, "destruction certificate issued");
step("withdraw-destroy", { status: srow.status, certificate: !!cert });

// 7) 감사/통계: 체인 전체에 audit 증가 + 도메인별 액션 존재
const events = await db.auditEvent.findMany({ where: { tenantId: TENANT }, orderBy: { createdAt: "desc" }, take: 400 });
const recent = events.filter(e => e.createdAt.getTime() > Date.now() - 600000);
const actions = new Set(recent.map(e => e.action));
const found = {
  form: [...actions].some(a => a.startsWith("form.")),
  submission: [...actions].some(a => a.startsWith("submission.")),
  share: [...actions].some(a => a.startsWith("share")),
  campaign: [...actions].some(a => a.startsWith("campaign.")),
  billing: [...actions].some(a => /billing|order|payment|subscription/.test(a)),
};
assert.ok(Object.values(found).every(Boolean), `audit chain → ${JSON.stringify(found)}`);
step("audit-stats", { newEvents: recent.length, domains: found });
await writeFile(resolve(outDir, "cross-flow.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(),
  ids: { formId: fid, submissionId: subBody.id, preferenceId: pref!.id, campaignId: cid, orderId: settled.id, subscriptionId: subs.body.id }, results }, null, 2) + "\n");
console.log("R25-T02 cross-flow:", results.length, "steps passed");
