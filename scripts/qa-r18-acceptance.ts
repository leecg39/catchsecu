// R18-T04 수용: 이메일 발신자 실DNS 검증→캠페인→로컬 메일함·unsubscribe·relay 반송→억제 재발송 차단→재시작 영속.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";
import { unsubscribeToken, unsubscribeUrl } from "../src/server/email-policy";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = process.env.QA_OUT ?? "docs/qa/R18-T04/acceptance";
const mode = process.argv[2] ?? "run";
const TENANT = "10000000-0000-4000-8000-000000000001", SERVICE = "20000000-0000-4000-8000-000000000001";
await mkdir(outDir, { recursive: true });
await db.rateLimit.deleteMany({}).catch(() => 0);
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const results: { step: string; detail: unknown }[] = [];
const step = (n: string, d: unknown) => { results.push({ step: n, detail: d }); console.log("PASS", n, JSON.stringify(d)); };

async function signIn(email: string) {
  let login: Response | null = null;
  for (let i = 0; i < 6; i++) {
    login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw[email] }) });
    if (login.status !== 429) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  assert.equal(login!.status, 200, `sign-in ${email} → ${login!.status}`);
  return login!.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", data?: unknown, hdrs: Record<string, string> = {}) {
  const r = await fetch(base + "/api/v1" + path, { method,
    headers: { cookie, origin: base, "content-type": "application/json", ...hdrs },
    body: data === undefined ? undefined : JSON.stringify(data) });
  let body: unknown = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: body as Record<string, unknown>, headers: r.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
async function drain(worker: string, max = 30) { let n = 0; while (n < max && await runOneJob(worker)) n++; return n; }
const mailFile = async (id: string) => { try { return JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, id + ".json"), "utf8")); } catch { return null; } };

if (mode === "run") {
  const stamp = Date.now(), cookie = await signIn("owner@catchsecu.local.test");
  await api(cookie, "/context", "POST", { serviceId: SERVICE });

  // 1) 이메일 발신자: 등록→request-email→로컬 메일 코드→dns→check(실제 DNS 프로토콜 fixture)→confirm→verified
  const domain = "r18-" + String(stamp).slice(-8) + ".test", address = "sender@" + domain;
  const sender = await api(cookie, "/senders", "POST", { serviceId: SERVICE, channel: "email", address, label: "R18 발신자 " + stamp, description: "R18 수용" }, ik());
  assert.equal(sender.status, 201, JSON.stringify(sender.body));
  const sid = sender.body.id as string;
  let rec = (await api(cookie, `/senders/${sid}`)).body as { version: number };
  const req = await api(cookie, `/senders/${sid}/request-email`, "POST", { version: rec.version }, ik());
  assert.equal(req.status, 202, JSON.stringify(req.body));
  const proof = await db.senderVerification.findFirstOrThrow({ where: { senderId: sid, method: "email" }, orderBy: { createdAt: "desc" } });
  const mailJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + proof.id } });
  await runOneJob("r18-verify", { tenantId: TENANT, jobId: mailJob.id });
  const vmail = await mailFile(mailJob.id); assert.ok(vmail, "verification mail file");
  const code = /인증번호: (\d{6})/.exec(vmail.text)![1];
  rec = (await api(cookie, `/senders/${sid}`)).body;
  const dns = await api(cookie, `/senders/${sid}/dns`, "POST", { version: rec.version }, ik());
  assert.ok([200, 201].includes(dns.status), `dns → ${dns.status}`);
  await new Promise(r => setTimeout(r, 700)); // DNS fixture 폴링 주기
  rec = (await api(cookie, `/senders/${sid}`)).body;
  const chk = await api(cookie, `/senders/${sid}/check`, "POST", { version: rec.version }, ik());
  assert.ok([200, 201, 202].includes(chk.status), `check → ${chk.status} ${JSON.stringify(chk.body)}`);
  rec = (await api(cookie, `/senders/${sid}`)).body;
  const cfm = await api(cookie, `/senders/${sid}/confirm-email`, "POST", { version: rec.version, verificationId: proof.id, code }, ik());
  assert.ok([200, 201].includes(cfm.status), `confirm → ${cfm.status} ${JSON.stringify(cfm.body)}`);
  rec = (await api(cookie, `/senders/${sid}`)).body as { version: number; status: string };
  assert.equal(rec.status, "verified", "sender verified via real local DNS + code");
  step("sender-verified", { senderId: sid, domain, status: rec.status });

  // 2) 동의 수신자 2명: 마케팅 매핑 폼 게시 → 명시적 email 동의 제출 2건 → selection 수신자
  const qName = randomUUID(), qMail = randomUUID(), c1 = "r18a-" + stamp + "@example.test", c2 = "r18b-" + stamp + "@example.test";
  const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R18 동의 폼 " + stamp,
    content: { body: "R18", consentPurpose: "R18 수용", consentRequired: true, retentionDays: 30, maxResponses: 10,
      questions: [{ id: qName, label: "이름", type: "단문형 답변", required: true, subjectRole: "name" }, { id: qMail, label: "이메일", type: "단문형 답변", required: true, subjectRole: "email" }],
      marketing: { purpose: "R18 소식", nameQuestionId: qName, emailQuestionId: qMail } } }, ik());
  assert.equal(form.status, 201, JSON.stringify(form.body));
  const appr = await api(cookie, `/forms/${form.body.id}/approvals`, "POST", { version: form.body.version, message: "R18", reference: "QA-R18-" + stamp }, ik());
  const dec = await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R18" }, ik());
  assert.ok([200, 201].includes(dec.status), `decision → ${dec.status}`);
  const pub = await api(cookie, `/forms/${form.body.id}/publish`, "POST", { version: (await api(cookie, `/forms/${form.body.id}`)).body.version as number }, ik());
  assert.ok([200, 201].includes(pub.status), `publish → ${pub.status}`);
  const ptoken = pub.body.token as string;
  for (const contact of [c1, c2]) {
    const sub = await fetch(`${base}/api/v1/public/forms/${ptoken}/submissions`, { method: "POST",
      headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ consent: true, marketingChannels: ["email"], answers: { [qName]: "R18 수신자", [qMail]: contact } }) });
    assert.equal(sub.status, 201, `submission → ${sub.status}`);
  }
  const prefs = await db.marketingPreference.findMany({ where: { tenantId: TENANT, serviceId: SERVICE, channel: "email", status: "granted" }, orderBy: { createdAt: "desc" }, take: 2 });
  assert.equal(prefs.length, 2, "two consenting recipients");
  const camp = await api(cookie, "/campaigns", "POST", { serviceId: SERVICE, channel: "email", source: "form",
    title: "R18 캠페인 " + stamp, senderId: sid,
    content: { format: "text", subject: "R18 안내 {{name}}", text: "R18 본문입니다. {{contact}}" } }, ik());
  assert.equal(camp.status, 201, JSON.stringify(camp.body));
  const cid = camp.body.id as string;
  let crec = (await api(cookie, `/campaigns/${cid}`)).body as { version: number };
  const tg = await api(cookie, `/campaigns/${cid}/recipients`, "POST", { version: crec.version, mode: "selection", preferenceIds: prefs.map(p => p.id) }, ik());
  assert.ok([200, 201].includes(tg.status), `recipients → ${tg.status} ${JSON.stringify(tg.body)}`);
  crec = (await api(cookie, `/campaigns/${cid}`)).body;
  const sch = await api(cookie, `/campaigns/${cid}/schedule`, "POST", { version: crec.version, at: null, excludeInvalid: false }, ik());
  assert.ok([200, 202].includes(sch.status), `schedule → ${sch.status} ${JSON.stringify(sch.body)}`);
  await drain("r18-campaign");
  const deliveries = await db.campaignDelivery.findMany({ where: { campaignId: cid }, orderBy: { position: "asc" } });
  assert.ok(deliveries.length >= 1);
  const done = deliveries.filter(d => d.status === "local_delivered");
  assert.ok(done.length >= 1, `deliveries: ${deliveries.map(d => d.status)}`);
  const job = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: done[0].id } });
  const mail = await mailFile(job.id); assert.ok(mail, "local mail file");
  const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"));
  assert.equal(mail.headers?.["List-Unsubscribe"], "<" + unsubscribeUrl(job.id) + ">");
  assert.ok(mail.text.includes(unsubscribeUrl(job.id)), "unsubscribe link in body");
  step("campaign-delivered", { campaignId: cid, deliveries: deliveries.map(d => d.status), mailSha256: createHash("sha256").update(bytes).digest("hex"), listUnsubscribe: true });

  // 3) unsubscribe: 토큰 페이지 → 확인 POST → EmailSuppression + delivery feedback
  const token = unsubscribeToken(job.id);
  const info = await api("", `/email-unsubscribe/${token}`);
  assert.equal(info.status, 200, `unsubscribe info → ${info.status} ${JSON.stringify(info.body)}`);
  const unsub = await api("", `/email-unsubscribe/${token}`, "POST", { confirm: true }, ik());
  assert.ok([200, 202].includes(unsub.status), `unsubscribe → ${unsub.status} ${JSON.stringify(unsub.body)}`);
  const sup = await db.emailSuppression.findFirstOrThrow({ where: { tenantId: TENANT, serviceId: SERVICE, reason: "unsubscribed" }, orderBy: { createdAt: "desc" } });
  const fb = await db.emailFeedback.findFirstOrThrow({ where: { deliveryId: done[0].id, kind: "unsubscribed" } });
  assert.ok(fb.id, "unsubscribed feedback recorded");
  step("unsubscribed", { suppressionId: sup.id, reason: sup.reason });

  // 4) 억제 후 재캠페인: 수신거부 수신자 + 동의 유지 수신자 혼합 → 억제 건만 제외·정상 건 발송
  const camp2 = await api(cookie, "/campaigns", "POST", { serviceId: SERVICE, channel: "email", source: "form",
    title: "R18 억제 검증 " + stamp, senderId: sid, content: { format: "text", subject: "두 번째", text: "차단 확인" } }, ik());
  const cid2 = camp2.body.id as string;
  let c2v = (await api(cookie, `/campaigns/${cid2}`)).body as { version: number };
  const unsubPref = (await db.campaignDelivery.findUniqueOrThrow({ where: { id: done[0].id } })).preferenceId!;
  const okPref = (await db.campaignDelivery.findUniqueOrThrow({ where: { id: done[1].id } })).preferenceId!;
  await api(cookie, `/campaigns/${cid2}/recipients`, "POST", { version: c2v.version, mode: "selection", preferenceIds: [unsubPref, okPref] }, ik());
  c2v = (await api(cookie, `/campaigns/${cid2}`)).body;
  const sch2 = await api(cookie, `/campaigns/${cid2}/schedule`, "POST", { version: c2v.version, at: null, excludeInvalid: true }, ik());
  assert.ok([200, 202].includes(sch2.status), `suppression schedule → ${sch2.status} ${JSON.stringify(sch2.body)}`);
  await drain("r18-campaign-2");
  const d2 = await db.campaignDelivery.findMany({ where: { campaignId: cid2 } });
  const suppressedRow = d2.find(d => d.preferenceId === unsubPref), okRow = d2.find(d => d.preferenceId === okPref);
  assert.equal(suppressedRow?.status, "excluded", `suppressed → ${suppressedRow?.status}`);
  assert.equal(okRow?.status, "local_delivered", `consented → ${okRow?.status}`);
  step("suppression-blocks-resend", { campaignId: cid2, suppressed: suppressedRow?.status, consented: okRow?.status });

  // 5) 서명된 relay 반송 이벤트 → feedback 기록 + 잘못된 서명 401
  const other = deliveries.find(d => d.id !== done[0].id && d.status === "local_delivered") ?? deliveries[0];
  const otherJob = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: other.id } });
  const payload = { eventId: "r18-" + stamp, jobId: otherJob.id, type: "hard_bounce", occurredAt: new Date().toISOString() };
  const bodyBytes = Buffer.from(JSON.stringify(payload));
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = "v1=" + createHmac("sha256", env.EMAIL_FEEDBACK_SECRET!).update(ts + ".").update(bodyBytes).digest("hex");
  const relay = await fetch(base + "/api/v1/email-feedback", { method: "POST",
    headers: { "content-type": "application/json", "x-email-timestamp": ts, "x-email-signature": sig }, body: bodyBytes });
  assert.equal(relay.status, 202, `relay → ${relay.status}`);
  const bad = await fetch(base + "/api/v1/email-feedback", { method: "POST",
    headers: { "content-type": "application/json", "x-email-timestamp": ts, "x-email-signature": "v1=" + "0".repeat(64) }, body: bodyBytes });
  assert.equal(bad.status, 401, "forged signature rejected");
  const dup = await fetch(base + "/api/v1/email-feedback", { method: "POST",
    headers: { "content-type": "application/json", "x-email-timestamp": ts, "x-email-signature": sig }, body: bodyBytes });
  const dupBody = await dup.json().catch(() => ({}));
  assert.ok([200, 202].includes(dup.status) && (dupBody as { duplicate?: boolean }).duplicate === true, `duplicate relay → ${dup.status} ${JSON.stringify(dupBody)}`);
  step("relay-feedback", { accepted: true, forged: 401, duplicate: true });

  await writeFile(resolve(outDir, "http-run.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), cases: results.length, results }, null, 2) + "\n");
  await writeFile(resolve(outDir, "fixture.json"), JSON.stringify({ senderId: sid, campaignId: cid, campaign2Id: cid2, jobId: job.id, suppressionId: sup.id }) + "\n");
  console.log("R18 acceptance: " + results.length + " cases passed");
} else if (mode === "restart") {
  const fx = JSON.parse(await readFile(resolve(outDir, "fixture.json"), "utf8"));
  const sender = await db.sender.findUniqueOrThrow({ where: { id: fx.senderId } });
  assert.equal(sender.status, "verified");
  const camp = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
  assert.ok(["completed", "partial_failed", "sent"].includes(camp.status));
  const sup = await db.emailSuppression.findUniqueOrThrow({ where: { id: fx.suppressionId } });
  assert.equal(sup.reason, "unsubscribed");
  const mail = await mailFile(fx.jobId); assert.ok(mail, "mail file persists");
  results.push({ step: "restart-persist", detail: { sender: sender.status, campaign: camp.status, suppression: sup.reason, mailFile: true } });
  await writeFile(resolve(outDir, "restart.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R18 restart check passed");
}
