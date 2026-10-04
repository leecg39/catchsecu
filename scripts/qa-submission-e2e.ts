/** P06-T07 응답 흐름 E2E: 게시→외부제출→관리자확인→공유인증→정정→철회→파기→증명서 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneDestruction } from "../src/server/destruction-worker";
import { runOneJob } from "../src/server/jobs";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), steps: [] as unknown[] };
const step = (name: string, data: unknown) => { (evidence.steps as unknown[]).push({ name, data }); console.log("STEP", name, JSON.stringify(data).slice(0, 200)); };
const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
if (login.status !== 200) throw new Error("login " + login.status);
const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function api(path: string, method = "GET", data?: unknown, hdrs: Record<string, string> = {}) {
  const r = await fetch(base + "/api/v1" + path, { method, headers: { cookie, origin: base, "content-type": "application/json", ...hdrs }, body: data ? JSON.stringify(data) : undefined });
  let body: unknown = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: body as Record<string, unknown>, setCookie: r.headers.getSetCookie() };
}
const ik = () => ({ "idempotency-key": crypto.randomUUID() });
const tenant = env.SOLAPI_TENANT_ID!;
const service = await db.service.findFirstOrThrow({ where: { tenantId: tenant } });
// 1) 폼 생성·승인·게시
const qName = crypto.randomUUID(), qMemo = crypto.randomUUID();
const form = await api("/forms", "POST", { serviceId: service.id, title: "E2E 응답 " + Date.now(), content: { body: "본문", consentPurpose: "수집", consentRequired: true, retentionDays: 7, maxResponses: 50, questions: [{ id: qName, label: "이름", type: "단문형 답변", required: true }, { id: qMemo, label: "메모", type: "단문형 답변", required: false }] } }, ik());
if (form.status !== 201) throw new Error("form " + JSON.stringify(form.body));
const fid = form.body.id as string;
const appr = await api(`/forms/${fid}/approvals`, "POST", { version: form.body.version, message: "E2E", reference: "QA-E2E-" + Date.now() }, ik());
if (appr.status !== 201) throw new Error("approval " + JSON.stringify(appr.body));
const dec = await api(`/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "E2E" }, ik());
if (![200, 201].includes(dec.status)) throw new Error("decision " + JSON.stringify(dec.body));
const now = await api(`/forms/${fid}`);
const pub = await api(`/forms/${fid}/publish`, "POST", { version: (now.body as { version: number }).version }, ik());
if (pub.status !== 201) throw new Error("publish " + JSON.stringify(pub.body));
step("published", { formId: fid, token: !!pub.body.token });
// 2) 익명 외부 제출 (쿠키 없음)
const sub = await fetch(`${base}/api/v1/public/forms/${pub.body.token}/submissions`, { method: "POST", headers: { origin: base, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ answers: { [qName]: "외부 제출자", [qMemo]: "원본 메모" }, consent: true }) });
if (sub.status !== 201) throw new Error("submit " + sub.status + " " + await sub.text());
const subId = ((await sub.json()) as { id: string }).id;
step("public-submission", { id: subId, anonymous: true });
// 3) 관리자 목록·상세 확인
const list = await api(`/forms/${fid}/submissions`);
const detail = await api(`/submissions/${subId}`);
const answers = (detail.body as { values: Record<string, unknown> }).values;
step("admin-read", { listed: JSON.stringify(list.body).includes(subId), answerName: answers[qName] ?? answers["이름"] ?? Object.values(answers)[0] });
// 4) 공유 열람자 → viewer 인증 → 공유 응답 조회
const viewerEmail = "viewer-e2e-" + Date.now() + "@catchsecu.local.test";
const mailBefore = new Set(await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[]));
const grant = await api("/share-grants", "POST", { formId: fid, formVersionId: (await db.formVersion.findFirstOrThrow({ where: { formId: fid, status: "published" } })).id, email: viewerEmail, questionIds: [qName, qMemo], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
if (![200, 201].includes(grant.status)) throw new Error("share " + JSON.stringify(grant.body));
for (let i = 0; i < 10; i++) await runOneJob("qa-mail-" + i);
const mails = (await readdir(env.LOCAL_MAIL_DIR)).filter(f => !mailBefore.has(f));
let inviteCode = "", verifyCode = "";
for (const f of mails) {
  const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
  if (m.to === viewerEmail && m.text.includes("열람자 인증코드:")) inviteCode = /열람자 인증코드: ([A-Za-z0-9_-]{43})/.exec(m.text)?.[1] ?? "";
}
if (!inviteCode) throw new Error("invite mail missing: " + mails.join(","));
const ch = await fetch(base + "/api/v1/viewer/challenges", { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ formCode: fid, invitationCode: inviteCode, email: viewerEmail, consent: true }) });
if (ch.status !== 202) throw new Error("challenge " + ch.status + " " + await ch.text());
const chCookie = ch.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const chBody = await ch.json() as { challengeId?: string; id?: string };
for (let i = 0; i < 10; i++) await runOneJob("qa-mail2-" + i);
for (const f of await readdir(env.LOCAL_MAIL_DIR)) {
  if (mailBefore.has(f)) continue;
  try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
    if (m?.to === viewerEmail && m.text.includes("이메일 인증코드:")) verifyCode = /이메일 인증코드: (\d{6})/.exec(m.text)?.[1] ?? "";
  } catch { /* 다른 형식 파일 무시 */ }
}
if (!verifyCode) throw new Error("verify code mail missing");
const chId = chBody.challengeId ?? chBody.id;
const ver = await fetch(`${base}/api/v1/viewer/challenges/${chId}/verify`, { method: "POST", headers: { origin: base, "content-type": "application/json", cookie: chCookie }, body: JSON.stringify({ code: verifyCode }) });
if (ver.status !== 200) throw new Error("verify " + ver.status + " " + await ver.text());
const vCookie = ver.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const vList = await fetch(base + "/api/v1/viewer/submissions", { headers: { cookie: vCookie } });
const vOne = await fetch(`${base}/api/v1/viewer/submissions/${subId}`, { headers: { cookie: vCookie } });
step("viewer-shared", { challenge: ch.status, verify: ver.status, list: vList.status, detail: vOne.status });
// 5) 정정
const dNow = await api(`/submissions/${subId}`);
const corr = await api(`/submissions/${subId}`, "PATCH", { version: (dNow.body as { version: number }).version, reason: "E2E 정정", answers: { [qMemo]: "정정된 메모" } }, ik());
if (corr.status !== 200) throw new Error("correct " + JSON.stringify(corr.body));
const afterCorr = await api(`/submissions/${subId}`);
step("corrected", { status: (afterCorr.body as { status: string }).status, memo: Object.values((afterCorr.body as { answers: Record<string, string> }).values).includes("정정된 메모") });
// 6) 철회
const wd = await api(`/submissions/${subId}/withdraw`, "POST", { version: (afterCorr.body as { version: number }).version, reason: "E2E 철회" }, ik());
if (wd.status !== 200) throw new Error("withdraw " + JSON.stringify(wd.body));
const afterWd = await api(`/submissions/${subId}`);
step("withdrawn", { status: (afterWd.body as { status: string }).status });
// 7) 파기 요청→승인→워커→증명서
const dr = await api(`/submissions/${subId}/destruction-request`, "POST", { version: (afterWd.body as { version: number }).version, reason: "E2E 파기" }, ik());
if (![200, 201].includes(dr.status)) throw new Error("destruction-request " + JSON.stringify(dr.body));
const dReqs = await api(`/destruction-requests`);
const reqRow = ((dReqs.body as { items: { id: string; status: string; version: number }[] }).items ?? []).find(i => JSON.stringify(i).includes(""));
const reqId = reqRow?.id;
const appv = await api(`/destruction-requests/${reqId}/approve`, "POST", { version: reqRow!.version, reason: "E2E 승인" }, ik());
if (![200, 201].includes(appv.status)) throw new Error("approve " + JSON.stringify(appv.body));
let srow = await db.submission.findUniqueOrThrow({ where: { id: subId } });
for (let i = 0; i < 15 && !["destroyed"].includes(srow.status); i++) { await runOneDestruction("qa-e2e-" + i); srow = await db.submission.findUniqueOrThrow({ where: { id: subId } }); }
const cert = await db.destructionCertificate.findFirst({ where: { submissionId: subId } });
const filesLeft = await db.fileObject.count({ where: { submissionId: subId, status: { not: "deleted" } } });
step("destroyed", { status: srow.status, certificate: !!cert, certIntegrity: cert ? cert.digest.length > 0 : false, filesLeft });
await writeFile("docs/qa/P06-T07/e2e-flow.json", JSON.stringify(evidence, null, 2));
console.log("DONE");
