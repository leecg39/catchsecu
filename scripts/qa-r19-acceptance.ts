// R19-T04 수용: 알림톡 채널 검증→템플릿 심사(반려/승인/재심사)→미리보기·발송 영수증→캠페인 알림톡·SMS 대체발송→재시작 영속.
// 로컬 공급자(KAKAO_PROVIDER=local)는 내부 서명 심사·LOCAL_KAKAO_DIR 영수증만 기록한다 — 실제 카카오 승인/수신 증거는 external_pending.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R19-T04/acceptance");
const TENANT = "10000000-0000-4000-8000-000000000001", SERVICE = "20000000-0000-4000-8000-000000000001";
const mode = process.argv[2] ?? "run";
const results: { step: string; detail: unknown }[] = [];
const step = (name: string, detail: unknown) => { results.push({ step: name, detail }); console.log("PASS", name, JSON.stringify(detail)); };

const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
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
async function api(cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { origin: base, "content-type": "application/json", ...headers };
  if (cookie) h.cookie = cookie;
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload: unknown = null; try { payload = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: payload as Record<string, unknown>, headers: r.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
async function drain(worker: string, max = 30) { let n = 0; while (n < max && await runOneJob(worker)) n++; return n; }
const localFile = async (dir: string, id: string) => { try { return JSON.parse(await readFile(resolve(dir, id + ".json"), "utf8")); } catch { return null; } };

if (mode === "run") {
  assert.equal(env.KAKAO_PROVIDER, "local", "KAKAO_PROVIDER=local 필요");
  const stamp = Date.now(), cookie = await signIn("owner@catchsecu.local.test");
  await mkdir(outDir, { recursive: true });

  // 1) 채널: 등록→로컬 서명 심사 검증→중복·보관 규칙
  const ch = await api(cookie, "/kakao/channels", "POST", { serviceId: SERVICE, name: "R19 채널 " + stamp, searchId: "@r19" + String(stamp).slice(-8) }, ik());
  assert.equal(ch.status, 201, JSON.stringify(ch.body));
  const chId = ch.body.id as string;
  const dup = await api(cookie, "/kakao/channels", "POST", { serviceId: SERVICE, name: "중복", searchId: ch.body.searchId }, ik());
  assert.equal(dup.status, 409, "same service+searchId must conflict");
  const ver = await api(cookie, `/kakao/channels/${chId}/verify`, "POST", {}, ik());
  assert.equal(ver.status, 200, `verify → ${ver.status} ${JSON.stringify(ver.body)}`);
  assert.equal(ver.body.status, "verified");
  const again = await api(cookie, `/kakao/channels/${chId}/verify`, "POST", {}, ik());
  assert.equal(again.status, 409, "already verified");
  step("channel-verified", { channelId: chId, status: ver.body.status, duplicate: dup.status, reverify: again.status });

  // 2) 템플릿: 등록→제출→로컬 승인, "#반려" 표지→반려→수정→재제출→승인, 구버전 제출 409
  const mkTemplate = async (name: string, body: string) => {
    const r = await api(cookie, "/kakao/templates", "POST", { serviceId: SERVICE, channelId: chId, name, body, buttons: [{ name: "자세히", type: "WL", link: "https://catchsecu.com/" }] }, ik());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const t1 = await mkTemplate("R19 승인형 " + stamp, "#{name}님께 안내드립니다. #{contact}");
  const sub1 = await api(cookie, `/kakao/templates/${t1.id}/submit`, "POST", { version: t1.version }, ik());
  assert.equal(sub1.status, 200, `submit → ${sub1.status}`);
  assert.equal(sub1.body.status, "approved", "local review auto-approves");
  const staleSub = await api(cookie, `/kakao/templates/${t1.id}/submit`, "POST", { version: t1.version }, ik());
  assert.equal(staleSub.status, 409, "stale version submit");

  const t2 = await mkTemplate("R19 반려형 " + stamp, "#반려 사유가 포함된 본문");
  const sub2 = await api(cookie, `/kakao/templates/${t2.id}/submit`, "POST", { version: t2.version }, ik());
  assert.equal(sub2.body.status, "rejected", "rejection marker → rejected");
  assert.ok(String(sub2.body.reviewNote).includes("반려"), "review note recorded");
  const patch2 = await api(cookie, `/kakao/templates/${t2.id}`, "PATCH", { name: t2.name, body: "#{name}님 정상 본문", buttons: [], version: sub2.body.version });
  assert.equal(patch2.status, 200);
  const sub3 = await api(cookie, `/kakao/templates/${t2.id}/submit`, "POST", { version: patch2.body.version }, ik());
  assert.equal(sub3.body.status, "approved", "rejected→edit→resubmit→approved");
  step("template-review", { approved: sub1.body.status, stale: staleSub.status, rejected: sub2.body.status, resubmitted: sub3.body.status });

  // 3) 미리보기: 변수 누락 422·치환 렌더, 발송: 영수증 버전핀·멱등키 동일영수증·승인템플릿 수정 시 재심사
  const miss = await api(cookie, "/kakao/templates/preview", "POST", { body: "#{name} #{contact}", buttons: [], values: { name: "김" } });
  assert.equal(miss.status, 422, "missing variable preview");
  const prev = await api(cookie, "/kakao/templates/preview", "POST", { body: "#{name} #{contact}", buttons: [], values: { name: "김", contact: "01012345678" } });
  assert.equal(prev.status, 200);
  assert.equal(prev.body.text, "김 01012345678");

  const key = randomUUID();
  const send = await api(cookie, `/kakao/templates/${t1.id}/send`, "POST", { version: t1.version + 1 }, { "idempotency-key": key });
  assert.equal(send.status, 409, `t1.version drifted — expected current version`);
  const t1r = (await api(cookie, `/kakao/templates/${t1.id}`)).body as { version: number };
  const send1 = await api(cookie, `/kakao/templates/${t1.id}/send`, "POST", { version: t1r.version }, { "idempotency-key": key });
  assert.equal(send1.status, 200, JSON.stringify(send1.body));
  assert.equal(send1.body.mock, true);
  assert.equal(send1.body.status, "local_delivered");
  const send1dup = await api(cookie, `/kakao/templates/${t1.id}/send`, "POST", { version: t1r.version }, { "idempotency-key": key });
  assert.equal(send1dup.body.receiptId, send1.body.receiptId, "idempotency → same receipt");
  const receipt = await db.kakaoMockReceipt.findUniqueOrThrow({ where: { id: send1.body.id as string } });
  assert.equal(receipt.templateVersion, send1.body.templateVersion);
  assert.equal(receipt.channelVersion, send1.body.channelVersion);
  assert.ok(receipt.contentHash.length >= 32, "content hash stored");

  const editApproved = await api(cookie, `/kakao/templates/${t1.id}`, "PATCH", { name: t1.name, body: "#{name}님 수정된 본문 #{contact}", buttons: [], version: t1r.version });
  assert.equal(editApproved.body.status, "draft", "approved edit → draft (re-review required)");
  const sendBlocked = await api(cookie, `/kakao/templates/${t1.id}/send`, "POST", { version: editApproved.body.version }, ik());
  assert.equal(sendBlocked.status, 409, "draft template cannot send");
  const resub = await api(cookie, `/kakao/templates/${t1.id}/submit`, "POST", { version: editApproved.body.version }, ik());
  assert.equal(resub.body.status, "approved");
  step("preview-send", { preview: prev.body.text, missing: miss.status, mock: send1.body.status, receiptPinned: true, dupReceipt: true, reReview: resub.body.status });

  // 4) 채널 searchId 변경 → 템플릿 심사 초기화 + 채널 재인증 필요, 보관 채널 차단
  const chCur = (await api(cookie, `/kakao/channels/${chId}`)).body as { version: number; searchId: string };
  const chPatch = await api(cookie, `/kakao/channels/${chId}`, "PATCH", { name: "R19 채널 " + stamp, searchId: "@r19x" + String(stamp).slice(-7), status: "pending", version: chCur.version });
  assert.equal(chPatch.status, 200, JSON.stringify(chPatch.body));
  assert.equal(chPatch.body.status, "pending", "searchId change revokes verification");
  const tReset = (await api(cookie, `/kakao/templates/${t1.id}`)).body as { status: string };
  assert.equal(tReset.status, "draft", "approved template reset on channel change");
  await api(cookie, `/kakao/channels/${chId}/verify`, "POST", {}, ik());
  const audits = await db.auditEvent.findMany({ where: { tenantId: TENANT, action: "kakao.template_review_reset" } });
  assert.ok(audits.length >= 1, "review_reset audit recorded");
  step("channel-reset", { channel: chPatch.body.status, templateReset: tReset.status, resetAudits: audits.length });

  // 5) 캠페인 알림톡 발송 + SMS 대체발송: 변수미치환 실패→fallback sms-local 영수증
  const ch2 = await api(cookie, "/kakao/channels", "POST", { serviceId: SERVICE, name: "R19 캠페인채널 " + stamp, searchId: "@r19c" + String(stamp).slice(-7) }, ik());
  const ch2Id = ch2.body.id as string;
  await api(cookie, `/kakao/channels/${ch2Id}/verify`, "POST", {}, ik());
  const tfail = await api(cookie, "/kakao/templates", "POST", { serviceId: SERVICE, channelId: ch2Id, name: "R19 변수부족 " + stamp, body: "#{company} 안내 #{name}", buttons: [] }, ik());
  const subF = await api(cookie, `/kakao/templates/${tfail.body.id}/submit`, "POST", { version: tfail.body.version }, ik());
  assert.equal(subF.body.status, "approved");
  const tok = await mkTemplate("R19 정상형 " + stamp, "#{name}님 캠페인 안내 #{contact}");
  const subK = await api(cookie, `/kakao/templates/${tok.id}/submit`, "POST", { version: tok.version }, ik());
  assert.equal(subK.body.status, "approved");

  const qName = randomUUID(), qMail = randomUUID(), qSms = randomUUID(), qKakao = randomUUID(), phone = "010-" + String(stamp).slice(-8).slice(0, 4) + "-" + String(stamp).slice(-4);
  const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R19 동의 폼 " + stamp,
    content: { body: "R19", consentPurpose: "R19 수용", consentRequired: true, retentionDays: 30, maxResponses: 10,
      questions: [{ id: qName, label: "이름", type: "단문형 답변", required: true, subjectRole: "name" }, { id: qMail, label: "이메일", type: "이메일", required: true, subjectRole: "email" }, { id: qSms, label: "문자 연락처", type: "연락처", required: true }, { id: qKakao, label: "카카오 연락처", type: "연락처", required: true }],
      marketing: { purpose: "R19 소식", nameQuestionId: qName, smsQuestionId: qSms, kakaoQuestionId: qKakao } } }, ik());
  assert.equal(form.status, 201, JSON.stringify(form.body));
  const appr = await api(cookie, `/forms/${form.body.id}/approvals`, "POST", { version: form.body.version, message: "R19", reference: "QA-R19-" + stamp }, ik());
  assert.ok([200, 201].includes(appr.status), `approval → ${appr.status} ${JSON.stringify(appr.body)}`);
  const dec = await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R19" }, ik());
  assert.ok([200, 201].includes(dec.status), `decision → ${dec.status} ${JSON.stringify(dec.body)}`);
  const pub = await api(cookie, `/forms/${form.body.id}/publish`, "POST", { version: (await api(cookie, `/forms/${form.body.id}`)).body.version as number }, ik());
  assert.ok([200, 201].includes(pub.status) && pub.body.token, `publish → ${pub.status} ${JSON.stringify(pub.body)}`);
  const sub = await fetch(`${base}/api/v1/public/forms/${pub.body.token}/submissions`, { method: "POST",
    headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify({ consent: true, marketingChannels: ["kakao", "sms"], answers: { [qName]: "R19 수신자", [qMail]: `r19-${stamp}@example.test`, [qSms]: phone, [qKakao]: phone } }) });
  assert.equal(sub.status, 201, `submission → ${sub.status} ${await sub.clone().text()}`);
  const prefs = await db.marketingPreference.findMany({ where: { tenantId: TENANT, serviceId: SERVICE, status: "granted", channel: { in: ["kakao", "sms"] } }, orderBy: { createdAt: "desc" }, take: 4 });
  const kakaoPref = prefs.find(p => p.channel === "kakao")!;
  assert.ok(kakaoPref, "kakao consent exists");

  const smsSender = (await db.sender.findFirstOrThrow({ where: { tenantId: TENANT, serviceId: SERVICE, channel: "sms", status: "verified" } })).id;
  const camp = await api(cookie, "/campaigns", "POST", { serviceId: SERVICE, channel: "kakao", source: "form",
    title: "R19 정상 알림톡 " + stamp, kakaoTemplateId: tok.id, fallbackSenderId: smsSender,
    content: { format: "text", subject: "R19", text: "템플릿이 본문을 대신합니다" } }, ik());
  assert.equal(camp.status, 201, JSON.stringify(camp.body));
  const cid = camp.body.id as string;
  let cv = (await api(cookie, `/campaigns/${cid}`)).body as { version: number };
  await api(cookie, `/campaigns/${cid}/recipients`, "POST", { version: cv.version, mode: "selection", preferenceIds: [kakaoPref.id] }, ik());
  cv = (await api(cookie, `/campaigns/${cid}`)).body;
  const sch = await api(cookie, `/campaigns/${cid}/schedule`, "POST", { version: cv.version, at: null, excludeInvalid: false }, ik());
  assert.ok([200, 202].includes(sch.status), `schedule → ${sch.status} ${JSON.stringify(sch.body)}`);
  await drain("r19-kakao");
  const d1 = await db.campaignDelivery.findMany({ where: { campaignId: cid } });
  assert.equal(d1[0].status, "local_delivered", `kakao delivery → ${d1[0].status}`);
  const kjob = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: d1[0].id } });
  const kfile = await localFile(env.LOCAL_KAKAO_DIR, kjob.id);
  assert.equal(kfile?.status, "local_delivered");
  assert.ok(kfile.body.includes("R19 수신자"), "name substituted in receipt body");
  step("campaign-kakao", { campaignId: cid, status: d1[0].status, receipt: kfile.status, sha256: createHash("sha256").update(JSON.stringify(kfile)).digest("hex").slice(0, 16) });

  const camp2 = await api(cookie, "/campaigns", "POST", { serviceId: SERVICE, channel: "kakao", source: "form",
    title: "R19 대체발송 검증 " + stamp, kakaoTemplateId: tfail.body.id, fallbackSenderId: smsSender,
    content: { format: "text", subject: "R19", text: "템플릿이 본문을 대신합니다" } }, ik());
  const cid2 = camp2.body.id as string;
  let c2 = (await api(cookie, `/campaigns/${cid2}`)).body as { version: number };
  await api(cookie, `/campaigns/${cid2}/recipients`, "POST", { version: c2.version, mode: "selection", preferenceIds: [kakaoPref.id] }, ik());
  c2 = (await api(cookie, `/campaigns/${cid2}`)).body;
  const sch2 = await api(cookie, `/campaigns/${cid2}/schedule`, "POST", { version: c2.version, at: null, excludeInvalid: false }, ik());
  assert.ok([200, 202].includes(sch2.status), `fallback schedule → ${sch2.status}`);
  await drain("r19-fallback");
  const d2 = await db.campaignDelivery.findMany({ where: { campaignId: cid2 } });
  assert.equal(d2[0].status, "local_delivered", `fallback delivery → ${d2[0].status}`);
  const jobs2 = await db.job.findMany({ where: { campaignDeliveryId: d2[0].id }, orderBy: { createdAt: "asc" } });
  const fbJob = jobs2.find(j => j.senderId === smsSender)!;
  assert.ok(fbJob, "fallback sms job created");
  const sfile = await localFile(env.LOCAL_SMS_DIR, fbJob.id);
  assert.equal(sfile?.status, "local_delivered", "sms fallback receipt");
  assert.ok(sfile.to.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-8)), `fallback to the consenting phone → ${sfile.to}`);
  const fbAudit = await db.auditEvent.findFirstOrThrow({ where: { tenantId: TENANT, action: "campaign.delivery_fallback", resourceId: d2[0].id } });
  const kReceipts2 = jobs2.filter(j => j.senderId !== smsSender).length;
  assert.equal(await db.job.count({ where: { campaignDeliveryId: d2[0].id, dedupeKey: { endsWith: ":" + d2[0].attempt } } }), 1, "fallback dedupe by attempt");
  step("sms-fallback", { campaignId: cid2, kakaoJobs: kReceipts2, fallbackStatus: sfile.status, audit: fbAudit.action });

  // 6) 보관 채널 차단 + 타테넌트 404
  const ch3 = await api(cookie, "/kakao/channels", "POST", { serviceId: SERVICE, name: "R19 보관채널 " + stamp, searchId: "@r19z" + String(stamp).slice(-7) }, ik());
  const ch3v = (await api(cookie, `/kakao/channels/${ch3.body.id}`)).body as { version: number };
  const del3 = await api(cookie, `/kakao/channels/${ch3.body.id}`, "DELETE", undefined, { "if-match": String(ch3v.version) });
  assert.equal(del3.status, 204, "empty channel deletes");
  const gone = await api(cookie, `/kakao/channels/${ch3.body.id}/verify`, "POST", {}, ik());
  assert.equal(gone.status, 404, "deleted channel → 404");
  const arch = await api(cookie, `/kakao/channels/${ch2Id}`, "PATCH", { name: "R19 캠페인채널 " + stamp, searchId: "@r19c" + String(stamp).slice(-7), status: "archived", version: (await api(cookie, `/kakao/channels/${ch2Id}`)).body.version });
  // 채널에 사용중 템플릿이 있으면 보관이 거절된다 — 템플릿을 먼저 보관할 수 없으면 거절 자체가 규칙 증거.
  assert.equal(arch.status, 409, "channel with live templates refuses archive");
  const other = await api(cookie, `/kakao/templates/${t1.id}`, "GET");
  assert.equal(other.status, 200);
  const foreign = await api(cookie, `/kakao/templates/00000000-0000-4000-8000-000000000099`, "GET");
  assert.equal(foreign.status, 404);
  step("channel-archive-guard", { deleted: del3.status, archivedBlocked: arch.status, foreign: foreign.status });

  await writeFile(resolve(outDir, "fixture.json"), JSON.stringify({ channelId: chId, templateId: t1.id, campaignId: cid, fallbackJobId: fbJob.id, receiptId: send1.body.id }, null, 2) + "\n", { mode: 0o600 });
  await writeFile(resolve(outDir, "http-run.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R19 acceptance:", results.length, "cases passed");
} else if (mode === "restart") {
  const fx = JSON.parse(await readFile(resolve(outDir, "fixture.json"), "utf8"));
  const channel = await db.kakaoChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
  const template = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: fx.templateId } });
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
  const receipt = await db.kakaoMockReceipt.findUniqueOrThrow({ where: { id: fx.receiptId } });
  const smsFile = await localFile(env.LOCAL_SMS_DIR, fx.fallbackJobId);
  assert.ok(["verified", "pending"].includes(channel.status) && ["approved", "draft", "submitted"].includes(template.status));
  assert.ok(["completed", "partial_failed", "sent"].includes(campaign.status) || campaign.status === "local_delivered");
  assert.ok(receipt.contentHash.length >= 32 && smsFile?.status === "local_delivered");
  results.push({ step: "restart-persist", detail: { channel: channel.status, template: template.status, campaign: campaign.status, receipt: true, smsFile: true } });
  await writeFile(resolve(outDir, "restart.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R19 restart check passed");
}
