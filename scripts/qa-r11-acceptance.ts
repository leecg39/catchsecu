/** R11-T04 잔여 수용: 멱등 재제출·필수동의·만료게시·철회·첨부 해시·공유범위·타회사·내보내기 권한·지문 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneJob } from "../src/server/jobs";

const base = process.env.QA_ORIGIN ?? new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const mode = process.argv[2] ?? "run";
assert.ok(["run", "fingerprint", "check-fingerprint"].includes(mode));
const directory = "docs/qa/R11-T04/acceptance";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const TENANT = "10000000-0000-4000-8000-000000000001";
const SERVICE = "20000000-0000-4000-8000-000000000001";

async function signIn(email: string) {
  let login: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw[email] }) });
    if (login.status !== 429) break;
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  assert.equal(login!.status, 200, `sign-in ${email} → ${login!.status}`);
  return login!.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", data?: unknown, hdrs: Record<string, string> = {}) {
  const response = await fetch(base + "/api/v1" + path, { method,
    headers: { cookie, origin: base, "content-type": "application/json", ...hdrs },
    body: data === undefined ? undefined : JSON.stringify(data) });
  let body: unknown = null; try { body = await response.json(); } catch { /* empty */ }
  return { status: response.status, body: body as Record<string, unknown>, headers: response.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
async function publicPost(token: string, action: string, data: unknown, key = randomUUID()) {
  const response = await fetch(`${base}/api/v1/public/forms/${token}/${action}`, { method: "POST",
    headers: { origin: base, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(data) });
  let body: unknown = null; try { body = await response.json(); } catch { /* empty */ }
  return { status: response.status, body: body as Record<string, unknown> };
}

async function fingerprint() {
  const scope = { tenantId: TENANT };
  const [submissions, answers, corrections, notes, files, receipts, publications, grants, sessions] = await Promise.all([
    db.submission.findMany({ where: scope, select: { id: true, status: true, version: true, retentionVersion: true, terminationKind: true }, orderBy: { id: "asc" } }),
    db.answer.count({ where: scope }),
    db.correction.count({ where: scope }),
    db.submissionNote.count({ where: scope }),
    db.fileObject.findMany({ where: scope, select: { id: true, status: true, scanStatus: true, sha256: true, submissionId: true, questionId: true }, orderBy: { id: "asc" } }),
    db.consentReceipt.count({ where: scope }),
    db.publication.findMany({ where: scope, select: { id: true, status: true, responseCount: true, expiresAt: true }, orderBy: { id: "asc" } }),
    db.shareGrant.count({ where: scope }),
    db.subjectSession.count(),
  ]);
  const digest = sha256(JSON.stringify({ submissions, answers, corrections, notes, files, receipts, publications, grants, sessions }));
  return { checkedAt: new Date().toISOString(), digest, counts: {
    submissions: submissions.length, answers, corrections, notes, files: files.length, receipts, publications: publications.length, grants, sessions } };
}

if (mode === "fingerprint" || mode === "check-fingerprint") {
  const current = await fingerprint();
  if (mode === "fingerprint") {
    await mkdir(directory, { recursive: true });
    await writeFile(directory + "/fingerprint.json", JSON.stringify(current, null, 2));
    console.log("fingerprint", current.digest, JSON.stringify(current.counts));
  } else {
    const prior = JSON.parse(await readFile(directory + "/fingerprint.json", "utf8")) as { digest: string };
    assert.equal(current.digest, prior.digest, `restart drift: ${current.digest} != ${prior.digest}`);
    console.log("restart-fingerprint-stable", current.digest);
  }
  process.exit(0);
}

const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), steps: [] as unknown[] };
const step = (name: string, data: unknown) => { (evidence.steps as unknown[]).push({ name, data }); console.log("STEP", name, JSON.stringify(data).slice(0, 300)); };

const cookie = await signIn("owner@catchsecu.local.test");
await api(cookie, "/context", "POST", { serviceId: SERVICE });

// 1) 동의 필수 + 파일 문항이 있는 폼 생성→승인→게시
const qText = randomUUID(), qFile = randomUUID();
const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R11 수용 폼 " + Date.now(),
  content: { body: "R11-T04 수용 검증", consentPurpose: "R11 수용 검증 목적", consentRequired: true, retentionDays: 30, maxResponses: 20,
    questions: [
      { id: qText, label: "성명", type: "단문형 답변", required: true },
      { id: qFile, label: "증빙 파일", type: "파일 업로드", required: false },
    ] } }, ik());
assert.equal(form.status, 201, JSON.stringify(form.body));
const formId = form.body.id as string;
const appr = await api(cookie, `/forms/${formId}/approvals`, "POST", { version: form.body.version, message: "R11", reference: "QA-R11-" + Date.now() }, ik());
assert.equal(appr.status, 201, JSON.stringify(appr.body));
const dec = await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R11" }, ik());
assert.ok([200, 201].includes(dec.status), JSON.stringify(dec.body));
const current = await api(cookie, `/forms/${formId}`);
const pub = await api(cookie, `/forms/${formId}/publish`, "POST", { version: (current.body as { version: number }).version }, ik());
assert.equal(pub.status, 201, JSON.stringify(pub.body));
const token = pub.body.token as string;
step("published", { formId, publicationId: pub.body.id });

// 2) 공개 조회 + 필수동의 누락 거부
const pubGet = await fetch(`${base}/api/v1/public/forms/${token}`);
const pubData = await pubGet.json() as { closed: boolean; title: string };
assert.equal(pubGet.status, 200); assert.equal(pubData.closed, false);
const noConsent = await publicPost(token, "submissions", { answers: { [qText]: "동의 없는 제출" }, consent: false });
assert.ok(noConsent.status === 400 || noConsent.status === 422, `missing consent → ${noConsent.status}`);
const errCode = (body: unknown) => (body as { error?: { code?: string } })?.error?.code ?? (body as { code?: string })?.code;
assert.ok(String(errCode(noConsent.body)).includes("CONSENT"), JSON.stringify(noConsent.body));
step("consent-required-rejected", { status: noConsent.status, code: errCode(noConsent.body) });

// 3) 실제 파일 업로드 (init→content→complete, ClamAV 검사)
const fileBytes = Buffer.from("R11-T04 acceptance attachment " + randomUUID());
const fileSha = sha256(fileBytes);
const uploadInit = await publicPost(token, "uploads", { name: "r11-evidence.txt", mime: "text/plain", size: fileBytes.length, sha256: fileSha, questionId: qFile });
assert.equal(uploadInit.status, 201, JSON.stringify(uploadInit.body));
const fileId = (uploadInit.body as { id: string }).id, uploadToken = (uploadInit.body as { uploadToken: string }).uploadToken;
const contentPut = await fetch(`${base}/api/v1/uploads/${fileId}/content`, { method: "PUT",
  headers: { origin: base, "content-type": "text/plain", "x-upload-token": uploadToken }, body: fileBytes });
assert.ok([200, 201].includes(contentPut.status), `content → ${contentPut.status} ${await contentPut.text()}`);
const complete = await fetch(`${base}/api/v1/uploads/${fileId}/complete`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", "x-upload-token": uploadToken } });
const completeBody = await complete.json() as { status: string; scanStatus?: string };
assert.equal(complete.status, 200, JSON.stringify(completeBody));
step("file-uploaded", { fileId, scanStatus: completeBody.scanStatus ?? completeBody.status });

// 4) 동의+첨부 제출 → 같은 Idempotency-Key 재제출 멱등 → 새 키 2차 제출
const key1 = randomUUID();
const payload = { answers: { [qText]: "R11 제출자", [qFile]: fileId }, consent: true, attachments: { [qFile]: { fileId, token: uploadToken } } };
const submit1 = await publicPost(token, "submissions", payload, key1);
assert.equal(submit1.status, 201, JSON.stringify(submit1.body));
const sub1 = (submit1.body as { id: string }).id;
const submit1b = await publicPost(token, "submissions", payload, key1);
assert.equal(submit1b.status, 201); assert.equal((submit1b.body as { id: string }).id, sub1, "idempotent replay must return the same submission");
const countAfterReplay = await db.submission.count({ where: { id: sub1 } });
assert.equal(countAfterReplay, 1);
const pub1 = await db.publication.findFirstOrThrow({ where: { id: pub.body.id as string } });
assert.equal(pub1.responseCount, 1, "idempotent replay must not double-count");
const submit2 = await publicPost(token, "submissions", { answers: { [qText]: "두 번째 제출자" }, consent: true });
assert.equal(submit2.status, 201, JSON.stringify(submit2.body));
const sub2 = (submit2.body as { id: string }).id;
step("idempotent-submit", { first: sub1, replaySameId: (submit1b.body as { id: string }).id === sub1, responseCount: 1, secondAccepted: true });

// 5) 관리자 상세 + 첨부 목록/단건/다운로드 해시 대조
const detail = await api(cookie, `/submissions/${sub1}`);
assert.equal(detail.status, 200);
const fileList = await api(cookie, `/files?submissionId=${sub1}`);
assert.equal(fileList.status, 200);
const listed = (fileList.body as { items: { id: string }[] }).items ?? [];
assert.ok(listed.some(item => item.id === fileId), "file-view list must include the attachment");
const fileSingle = await api(cookie, `/files/${fileId}?submissionId=${sub1}&questionId=${qFile}`);
assert.equal(fileSingle.status, 200, JSON.stringify(fileSingle.body));
const download = await fetch(`${base}/api/v1/files/${fileId}/download?${new URLSearchParams({ submissionId: sub1, questionId: qFile })}`, { headers: { cookie, origin: base } });
assert.equal(download.status, 200);
const downloadBytes = Buffer.from(await download.arrayBuffer());
const dbFile = await db.fileObject.findUniqueOrThrow({ where: { id: fileId } });
assert.equal(sha256(downloadBytes), fileSha, "downloaded bytes must match uploaded bytes");
assert.equal(dbFile.sha256, fileSha, "DB sha256 must match uploaded bytes");
step("attachment-hash-verified", { fileId, size: downloadBytes.length, sha256: fileSha.slice(0, 16) + "…", dbMatch: true });

// 6) 메모·철회 — 첨부 없는 두 번째 응답에서 수행
const note = await api(cookie, `/submissions/${sub2}/notes`, "POST", { text: "R11 수용 메모" }, ik());
assert.ok([200, 201].includes(note.status), JSON.stringify(note.body));
const wdDetail = await api(cookie, `/submissions/${sub2}`);
const withdraw = await api(cookie, `/submissions/${sub2}/withdraw`, "POST", { version: (wdDetail.body as { version: number }).version, reason: "R11 수용 철회" }, ik());
assert.equal(withdraw.status, 200, JSON.stringify(withdraw.body));
const afterWd = await api(cookie, `/submissions/${sub2}`);
assert.equal((afterWd.body as { status: string }).status, "withdrawn");
step("withdrawn", { note: note.status, status: "withdrawn" });

// 7) 내보내기 재권한 검사 — viewer( submission.read 없음 ) 403, owner 201
const viewerCookie = await signIn("viewer@catchsecu.local.test");
await api(viewerCookie, "/context", "POST", { serviceId: SERVICE });
const deniedExport = await api(viewerCookie, `/forms/${formId}/submissions/export`);
assert.equal(deniedExport.status, 403, `viewer export → ${deniedExport.status}`);
const ownerExport = await api(cookie, `/forms/${formId}/submissions/export`);
assert.equal(ownerExport.status, 200, `owner export → ${ownerExport.status}`);
step("export-authority", { viewer: deniedExport.status, owner: ownerExport.status, csvRows: String(ownerExport.headers.get("x-export-row-count") ?? "?") });

// 8) 타 회사 차단 — owner-b로 응답·파일 접근
const cookieB = await signIn("owner-b@catchsecu.local.test");
const crossSub = await api(cookieB, `/submissions/${sub1}`);
assert.ok([403, 404].includes(crossSub.status), `cross-tenant submission → ${crossSub.status}`);
const crossFile = await api(cookieB, `/files/${fileId}?submissionId=${sub1}&questionId=${qFile}`);
assert.ok([403, 404].includes(crossFile.status), `cross-tenant file info → ${crossFile.status}`);
const crossDl = await fetch(`${base}/api/v1/files/${fileId}/download?${new URLSearchParams({ submissionId: sub1, questionId: qFile })}`, { headers: { cookie: cookieB, origin: base } });
assert.ok([403, 404].includes(crossDl.status), `cross-tenant download → ${crossDl.status}`);
step("cross-tenant-denied", { submission: crossSub.status, fileInfo: crossFile.status, download: crossDl.status });

// 9) 공유 범위 밖 파일 차단 — qText만 공유한 열람자에게 파일 문항 404
const viewerEmail = "r11-viewer-" + Date.now() + "@catchsecu.local.test";
const mailBefore = new Set(await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[]));
const formVersionId = (await db.formVersion.findFirstOrThrow({ where: { formId, status: "published" } })).id;
const grant = await api(cookie, "/share-grants", "POST", { formId, formVersionId, email: viewerEmail,
  questionIds: [qText], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 201].includes(grant.status), JSON.stringify(grant.body));
for (let i = 0; i < 12; i++) await runOneJob("qa-r11-mail-" + i);
let inviteCode = "";
for (const f of await readdir(env.LOCAL_MAIL_DIR)) {
  if (mailBefore.has(f)) continue;
  try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
    if (m?.to === viewerEmail && typeof m.text === "string" && m.text.includes("열람자 인증코드:"))
      inviteCode = /열람자 인증코드: ([A-Za-z0-9_-]{43})/.exec(m.text)?.[1] ?? "";
  } catch { /* 다른 형식 파일 무시 */ }
}
assert.ok(inviteCode, "share invitation mail missing");
const ch = await fetch(base + "/api/v1/viewer/challenges", { method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ formCode: formId, invitationCode: inviteCode, email: viewerEmail, consent: true }) });
const chText = await ch.text();
assert.equal(ch.status, 202, `challenge → ${ch.status} ${chText}`);
const chCookie = ch.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const chBody = JSON.parse(chText) as { challengeId?: string; id?: string };
for (let i = 0; i < 12; i++) await runOneJob("qa-r11-mail2-" + i);
let verifyCode = "";
for (const f of await readdir(env.LOCAL_MAIL_DIR)) {
  if (mailBefore.has(f)) continue;
  try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
    if (m?.to === viewerEmail && typeof m.text === "string" && m.text.includes("이메일 인증코드:"))
      verifyCode = /이메일 인증코드: (\d{6})/.exec(m.text)?.[1] ?? "";
  } catch { /* 다른 형식 파일 무시 */ }
}
assert.ok(verifyCode, "viewer OTP mail missing");
const ver = await fetch(`${base}/api/v1/viewer/challenges/${chBody.challengeId ?? chBody.id}/verify`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", cookie: chCookie }, body: JSON.stringify({ code: verifyCode }) });
assert.equal(ver.status, 200, `verify → ${ver.status}`);
const vCookie = ver.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const sharedDetail = await fetch(`${base}/api/v1/viewer/submissions/${sub1}`, { headers: { cookie: vCookie } });
assert.equal(sharedDetail.status, 200, `live shared detail → ${sharedDetail.status}`);
const sharedWithdrawn = await fetch(`${base}/api/v1/viewer/submissions/${sub2}`, { headers: { cookie: vCookie } });
assert.ok([404, 410].includes(sharedWithdrawn.status), `withdrawn shared detail → ${sharedWithdrawn.status}`);
const sharedFileInfo = await fetch(`${base}/api/v1/viewer/files/${fileId}?${new URLSearchParams({ submissionId: sub1, questionId: qFile })}`, { headers: { cookie: vCookie } });
assert.equal(sharedFileInfo.status, 404, `out-of-scope shared file → ${sharedFileInfo.status}`);
const sharedDl = await fetch(`${base}/api/v1/viewer/files/${fileId}/download?${new URLSearchParams({ submissionId: sub1, questionId: qFile })}`, { headers: { cookie: vCookie } });
assert.equal(sharedDl.status, 404, `out-of-scope shared download → ${sharedDl.status}`);
step("share-scope-denied", { sharedDetail: sharedDetail.status, withdrawnShared: sharedWithdrawn.status, fileInfo: sharedFileInfo.status, download: sharedDl.status });

// 10) 만료 게시 거부 — 만료 시각 과거로 → 공개 조회 closed + 제출 거부 → 복원
await db.publication.update({ where: { id: pub.body.id as string }, data: { expiresAt: new Date(Date.now() - 60000) } });
const expiredGet = await fetch(`${base}/api/v1/public/forms/${token}`);
const expiredData = await expiredGet.json() as { closed?: boolean; closedReason?: string };
assert.equal(expiredData.closed, true, "expired publication must report closed");
const expiredSubmit = await publicPost(token, "submissions", { answers: { [qText]: "만료 후 제출" }, consent: true });
assert.ok(expiredSubmit.status >= 400 && expiredSubmit.status < 500, `expired submit → ${expiredSubmit.status}`);
step("expired-rejected", { closedReason: expiredData.closedReason, submit: expiredSubmit.status, code: errCode(expiredSubmit.body) });
await db.publication.update({ where: { id: pub.body.id as string }, data: { expiresAt: null } });

// 11) 감사 이벤트 확인
const audits = await db.auditEvent.findMany({ where: { tenantId: TENANT, resourceId: { in: [sub1, sub2, formId, fileId] } },
  select: { action: true, resourceId: true }, orderBy: { createdAt: "asc" } });
const auditActions = new Set(audits.map(row => row.action + ":" + (row.resourceId === sub1 ? "sub" : row.resourceId === fileId ? "file" : "form")));
step("audits", { count: audits.length, actions: [...auditActions] });

await mkdir(directory, { recursive: true });
await writeFile(directory + "/acceptance.json", JSON.stringify(evidence, null, 2));
const fp = await fingerprint();
await writeFile(directory + "/fingerprint.json", JSON.stringify(fp, null, 2));
console.log("DONE", JSON.stringify({ formId, sub1, fileId, digest: fp.digest }));
