import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import type { ShareRecord, ShareOptions, SharePage, SharedPage } from "../src/contracts/sharing";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL), phase = process.argv[2];
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(env.MAIL_TRANSPORT, "local"); assert.equal(env.FILE_STORAGE, "local"); assert(["prepare", "finish", "database"].includes(phase));
const output = "docs/qa/P06-T04/", checkpoint = ".local/p06-share-management-checkpoint.json", cases: { label: string; status: number }[] = [];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex"), digest = (value: unknown) => hash(JSON.stringify(value));
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; formId: string; submissionId: string; fileId: string;
  first: string; second: string; fileQuestion: string; fileHash: string; grantId: string; viewerCookie: string; businessHash: string; preservedHash: string };
let cookie = "";
async function call(label: string, path: string, options: { method?: string; value?: unknown; cookie?: string; expected?: number | number[]; headers?: Record<string, string>; raw?: Buffer } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie, ...(method === "GET" ? {} : { origin }),
    ...(options.value === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...options.headers },
    ...(options.raw ? { body: new Uint8Array(options.raw) } : options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status); cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options: Parameters<typeof call>[2] = {}) => call(label, "/api/v1" + path, options);
const cookies = (response: Response) => response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function login(email: string, password: string) { cookie = cookies(await api("synthetic owner login", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email, password } })); assert(cookie); }
async function preserved() {
  const values = [];
  for (const file of [".local/p04-form-module-checkpoint.json", ".local/p06-file-access-checkpoint.json"]) {
    const old = JSON.parse(await readFile(file, "utf8")) as { submissionId: string };
    const row = await db.submission.findUniqueOrThrow({ where: { id: old.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } }); values.push(digest(row));
  }
  return digest(values);
}
async function snapshot(s: State) {
  const forms = await db.form.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { versions: { orderBy: { number: "asc" } }, publications: { orderBy: { id: "asc" } } } });
  const submissions = await db.submission.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  const grants = await db.shareGrant.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { fields: { orderBy: { questionId: "asc" } }, challenges: { orderBy: { id: "asc" } }, sessions: { orderBy: { id: "asc" } } } });
  const cache = await db.idempotencyRecord.findMany({ where: { tenantId: s.companyId, resourceType: "shareGrant" }, orderBy: { id: "asc" } });
  return { hash: digest({ forms, submissions, grants, cache }), forms: forms.length, submissions: submissions.length,
    grants: grants.length, active: grants.filter(g => !g.revokedAt && g.expiresAt > new Date()).length, revoked: grants.filter(g => !!g.revokedAt).length,
    cache: cache.length, clearedCache: cache.filter(c => !c.responseCipher && !c.requestHash && !!c.invalidatedAt).length };
}
async function invitation(g: ShareRecord) {
  const mail = decrypt<{ to: string; text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + g.id + ":invite:" + g.version } })).payloadCipher);
  return { email: mail.to, formCode: g.formId, consent: true, invitationCode: mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1] };
}
async function authenticate(g: ShareRecord, failFirst = false) {
  const started = await api("viewer requests own local email code", "/viewer/challenges", { method: "POST", cookie: "", expected: 202, value: await invitation(g) });
  const challenge = await started.json() as { id: string }, challengeCookie = cookies(started);
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + g.id + ":challenge:" + challenge.id } })).payloadCipher);
  const code = mail.text.match(/인증코드: (\d{6})/)![1];
  if (failFirst) await api("wrong code is rejected and attempts persist", "/viewer/challenges/" + challenge.id + "/verify", { method: "POST", cookie: challengeCookie, expected: 422, value: { code: code === "000000" ? "000001" : "000000" } });
  const verified = await api("viewer authenticates own browser code", "/viewer/challenges/" + challenge.id + "/verify", { method: "POST", cookie: challengeCookie, value: { code } });
  assert(verified.headers.getSetCookie().some(c => c.startsWith("cs_viewer=") && c.includes("HttpOnly") && c.includes("SameSite=Strict")));
  await api("consumed code cannot create another session", "/viewer/challenges/" + challenge.id + "/verify", { method: "POST", cookie: challengeCookie, expected: 422, value: { code } });
  assert.equal(await db.viewerSession.count({ where: { challengeId: challenge.id } }), 1);
  if (failFirst) assert.equal((await db.viewerChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).attempts, 1);
  return cookies(verified);
}
async function staleInvitation(input: Awaited<ReturnType<typeof invitation>>) {
  const response = await api("old invitation receives generic challenge shape", "/viewer/challenges", { method: "POST", cookie: "", expected: 202, value: input });
  const result = await response.json() as { id: string }; assert.equal(await db.viewerChallenge.findUnique({ where: { id: result.id } }), null);
}
async function viewerData(s: State, viewerCookie: string, fields: string[]) {
  const response = await api("selected viewer response fields and corrected page", "/viewer/submissions?page=999&pageSize=1", { cookie: viewerCookie });
  const page = await response.json() as SharedPage; assert.equal(page.page, 1); assert.equal(page.total, 1); assert.equal(page.items.length, 1);
  assert.deepEqual(Object.keys(page.items[0].values).sort(), [...fields].sort()); assert.equal(page.items[0].id, s.submissionId);
  const detail = await (await api("selected viewer single response", "/viewer/submissions/" + s.submissionId, { cookie: viewerCookie })).json() as { values: Record<string, unknown> };
  assert.deepEqual(Object.keys(detail.values).sort(), [...fields].sort()); assert(!Object.hasOwn(detail, "receipts") && !Object.hasOwn(detail, "notes"));
  for (const secret of ["emailCipher", "codeHash", "tokenHash"]) assert(!JSON.stringify(page).includes(secret));
}
const filePath = (s: State) => "/viewer/files/" + s.fileId + "/download?" + new URLSearchParams({ submissionId: s.submissionId, questionId: s.fileQuestion });
async function bytes(s: State, viewerCookie: string) {
  const response = await api("shared original byte hash", filePath(s), { cookie: viewerCookie });
  assert.equal(hash(new Uint8Array(await response.arrayBuffer())), s.fileHash); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
try {
  let s: State;
  if (phase === "prepare") {
    const before = await preserved(), email = "p06-share-owner-" + randomUUID() + "@catchsecu.local.test", password = "P06-share!" + randomUUID();
    await api("create independent synthetic owner", "/auth/sign-up/email", { method: "POST", cookie: "", value: { email, password, name: "P06 공유 검증" } });
    const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 30 });
    const ownMail = jobs.map(j => decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher)).find(j => j.to === email && j.subject === "이메일 인증"); assert(ownMail);
    const link = new URL(ownMail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin); assert.equal(link.pathname, "/api/v1/auth/verify-email");
    await call("verify own account email link", link.pathname + link.search, { cookie: "", expected: [200, 302] });
    const user = await db.user.findUniqueOrThrow({ where: { email } }); assert(user.emailVerified && !user.platformAdmin); await login(email, password);
    const company = await (await api("register independent synthetic company", "/companies", { method: "POST", expected: 201, value: { name: "P06 공유 검증 " + randomUUID(), publicName: "합성 공유 검증" } })).json() as { id: string };
    const context = await (await api("company and current service context", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(context.company.id, company.id);
    const serviceId = context.services[0].id, first = randomUUID(), second = randomUUID(), fileQuestion = randomUUID();
    const form = await (await api("create three-field sharing form", "/forms", { method: "POST", expected: 201, value: { serviceId, title: "P06 공유 CRUD 검증", content: { body: "합성 공유", consentRequired: true, consentPurpose: "시험", retentionDays: 30, maxResponses: 10,
      questions: [{ id: first, type: "단문형 답변", label: "허용 이름", required: true }, { id: second, type: "단문형 답변", label: "다른 항목", required: true }, { id: fileQuestion, type: "파일 업로드", label: "첨부 자료", required: true }] } } })).json() as { id: string; version: number };
    const published = await (await api("publish sharing form", "/forms/" + form.id + "/publish", { method: "POST", expected: 201, value: { version: form.version } })).json() as { token: string };
    const payloadBytes = Buffer.from("P06 공유 파일 실제 바이트 " + randomUUID()), fileHash = hash(payloadBytes);
    const file = await (await api("initialize required public attachment", "/public/forms/" + published.token + "/uploads", { method: "POST", cookie: "", expected: 201, value: { questionId: fileQuestion, name: "공유 증빙.txt", mime: "text/plain", size: payloadBytes.length, sha256: fileHash } })).json() as { id: string; uploadToken: string };
    await api("upload actual private encrypted bytes", "/uploads/" + file.id + "/content", { method: "PUT", cookie: "", raw: payloadBytes, headers: { "content-type": "text/plain", "x-upload-token": file.uploadToken } });
    await api("finish actual ClamAV scan", "/uploads/" + file.id + "/complete", { method: "POST", cookie: "", headers: { "x-upload-token": file.uploadToken } });
    const submission = await (await api("submit two answers and required attachment", "/public/forms/" + published.token + "/submissions", { method: "POST", cookie: "", expected: 201, value: { consent: true, answers: { [first]: "공유 이름 합성 값", [second]: "범위 변경 후 합성 값", [fileQuestion]: file.id }, attachments: { [fileQuestion]: { fileId: file.id, token: file.uploadToken } } } })).json() as { id: string };
    s = { email, password, userId: user.id, companyId: company.id, serviceId, formId: form.id, submissionId: submission.id, fileId: file.id, first, second, fileQuestion, fileHash, grantId: "", viewerCookie: "", businessHash: "", preservedHash: before };
    await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 });
    const versionId = (await db.form.findUniqueOrThrow({ where: { id: form.id } })).publishedVersionId!, key = randomUUID();
    const input = { formId: form.id, formVersionId: versionId, email: "p06-share-viewer-" + randomUUID() + "@catchsecu.local.test", questionIds: [first, fileQuestion], expiresAt: new Date(Date.now() + 86400000).toISOString() };
    let grant = await (await api("create selected version and fields grant", "/share-grants", { method: "POST", expected: 201, value: input, headers: { "idempotency-key": key } })).json() as ShareRecord;
    const again = await (await api("lost success replay returns same grant", "/share-grants", { method: "POST", expected: 201, value: input, headers: { "idempotency-key": key } })).json() as ShareRecord; assert.equal(again.id, grant.id);
    assert.equal(await db.shareGrant.count({ where: { tenantId: company.id } }), 1); assert.equal(await db.job.count({ where: { dedupeKey: "mail:share:" + grant.id + ":invite:1" } }), 1);
    await api("same creation key with changed payload denied", "/share-grants", { method: "POST", expected: 409, value: { ...input, email: "different@catchsecu.local.test" }, headers: { "idempotency-key": key } });
    const options = await (await api("current server invite and selectable-field permissions", "/share-grants/options?formId=" + form.id)).json() as ShareOptions; assert(options.permissions.canCreate && options.permissions.canSelectFiles && options.versions[0].questions.every(q => q.selectable));
    const list = await (await api("normalized email search and stale page correction", "/share-grants?formId=" + form.id + "&search=" + encodeURIComponent(input.email.toUpperCase()) + "&page=999&pageSize=1&status=active")).json() as SharePage; assert.equal(list.page, 1); assert.equal(list.total, 1); assert.equal(list.items[0].id, grant.id);
    const read = await (await api("safe grant detail and action permissions", "/share-grants/" + grant.id)).json() as ShareRecord; assert.deepEqual(read.actions, { edit: true, resend: true, revoke: true });
    for (const hidden of ["codeHash", "emailHash", "emailCipher", "invitationCode"]) assert(!JSON.stringify(read).includes(hidden));
    for (const path of ["/share-grants?formId=" + form.id + "&unknown=x", "/share-grants?formId=" + form.id + "&page=1&page=2", "/share-grants/options?formId=" + form.id + "&formId=" + form.id, "/share-grants/" + grant.id + "/events?search=x"])
      await api("strict manager query denied", path, { expected: 422 });
    const oldInvite = await invitation(grant), viewerCookie = await authenticate(grant, true); await viewerData(s, viewerCookie, [first, fileQuestion]); await bytes(s, viewerCookie);
    await api("unshared question file binding denied", filePath(s).replace(fileQuestion, second), { cookie: viewerCookie, expected: 404 });
    await api("strict viewer duplicate query denied", "/viewer/submissions?page=1&page=2", { cookie: viewerCookie, expected: 422 });
    await api("viewer session unknown query denied", "/viewer/session?unknown=x", { cookie: viewerCookie, expected: 422 });
    grant = await (await api("update recipient and replace selected scope", "/share-grants/" + grant.id, { method: "PATCH", value: { version: grant.version, email: "p06-share-new-" + randomUUID() + "@catchsecu.local.test", questionIds: [second], expiresAt: grant.expiresAt } })).json() as ShareRecord;
    await api("captured viewer cookie denied after scope update", "/viewer/session", { cookie: viewerCookie, expected: 401 }); await staleInvitation(oldInvite);
    await api("stale manager version denied", "/share-grants/" + grant.id, { method: "PATCH", expected: 409, value: { version: 1, email: grant.email, questionIds: [second], expiresAt: grant.expiresAt } });
    await api("changed grant creation cache cannot return old recipient", "/share-grants", { method: "POST", expected: 410, value: input, headers: { "idempotency-key": key } });
    const cleared = await db.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope: "share:create:" + company.id + ":" + (await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: user.id } })).id, key } } }); assert(!cleared.responseCipher && !cleared.requestHash && cleared.invalidatedAt);
    const changedCookie = await authenticate(grant); await viewerData(s, changedCookie, [second]); await api("removed file question cannot be downloaded", filePath(s), { cookie: changedCookie, expected: 404 });
    const changedInvite = await invitation(grant); grant = await (await api("resend invite rotates challenge and viewer generations", "/share-grants/" + grant.id + "/resend", { method: "POST", value: { version: grant.version } })).json() as ShareRecord;
    await api("captured viewer cookie denied after resend", "/viewer/session", { cookie: changedCookie, expected: 401 }); await staleInvitation(changedInvite);
    const resentCookie = await authenticate(grant); await viewerData(s, resentCookie, [second]);
    await api("stale revoke version denied", "/share-grants/" + grant.id, { method: "DELETE", expected: 409, headers: { "if-match": "1" } });
    grant = await (await api("revoke external grant", "/share-grants/" + grant.id, { method: "DELETE", headers: { "if-match": String(grant.version) } })).json() as ShareRecord; assert.equal(grant.status, "revoked");
    await api("revoked viewer cookie denied", "/viewer/session", { cookie: resentCookie, expected: 401 }); await api("revoked grant cannot resend", "/share-grants/" + grant.id + "/resend", { method: "POST", expected: 409, value: { version: grant.version } });
    const ends = new Date(Date.now() + 4000);
    let expiring = await (await api("create short actual-time grant", "/share-grants", { method: "POST", expected: 201, value: { ...input, email: "p06-share-expiry-" + randomUUID() + "@catchsecu.local.test", questionIds: [second], expiresAt: ends.toISOString() } })).json() as ShareRecord;
    const expiringCookie = await authenticate(expiring), startedWait = Date.now(); await setTimeout(Math.max(0, ends.getTime() - Date.now() + 40)); const actualExpiryWaitMs = Date.now() - startedWait;
    await api("actual-time grant expiry denies captured cookie", "/viewer/session", { cookie: expiringCookie, expected: 401 });
    const expired = await (await api("expired grant shows edit without resend", "/share-grants/" + expiring.id)).json() as ShareRecord; assert.equal(expired.status, "expired"); assert(expired.actions.edit && !expired.actions.resend);
    expiring = await (await api("extend expired grant with new invitation", "/share-grants/" + expiring.id, { method: "PATCH", value: { version: expiring.version, email: expiring.email, questionIds: [second], expiresAt: new Date(Date.now() + 86400000).toISOString() } })).json() as ShareRecord; assert.equal(expiring.status, "active");
    await api("old expired generation remains denied after extension", "/viewer/session", { cookie: expiringCookie, expected: 401 });
    await api("revoke extended grant", "/share-grants/" + expiring.id, { method: "DELETE", headers: { "if-match": String(expiring.version) } });
    const stable = await (await api("create persistent selected-file grant", "/share-grants", { method: "POST", expected: 201, value: { ...input, email: "p06-share-stable-" + randomUUID() + "@catchsecu.local.test" } })).json() as ShareRecord;
    s.grantId = stable.id; s.viewerCookie = await authenticate(stable); await bytes(s, s.viewerCookie);
    const archiveQuestion = randomUUID(), archival = await (await api("create separate archival form", "/forms", { method: "POST", expected: 201, value: { serviceId, title: "P06 보관 공유 검증", content: { body: "보관 시험", consentRequired: true, consentPurpose: "시험", retentionDays: 30, maxResponses: 10, questions: [{ id: archiveQuestion, type: "단문형 답변", label: "보관 이름", required: false }] } } })).json() as { id: string; version: number };
    await api("publish separate archival form", "/forms/" + archival.id + "/publish", { method: "POST", expected: 201, value: { version: archival.version } });
    const archiveVersion = (await db.form.findUniqueOrThrow({ where: { id: archival.id } })).publishedVersionId!;
    const archiveInput = { ...input, formId: archival.id, formVersionId: archiveVersion, questionIds: [archiveQuestion], email: "p06-share-archive-" + randomUUID() + "@catchsecu.local.test" }, archiveKey = randomUUID();
    const archiveGrant = await (await api("create grant on separate archival form", "/share-grants", { method: "POST", expected: 201, value: archiveInput, headers: { "idempotency-key": archiveKey } })).json() as ShareRecord;
    await api("archive separate form using current version", "/forms/" + archival.id, { method: "DELETE", expected: 204, headers: { "if-match": String(archival.version + 1) } });
    const archived = await (await api("archived permissions preserve read and revoke", "/share-grants?formId=" + archival.id)).json() as SharePage; assert(!archived.permissions.canCreate); assert.deepEqual(archived.items[0].actions, { edit: false, resend: false, revoke: true });
    await api("archived form creation replay denied", "/share-grants", { method: "POST", expected: 409, value: archiveInput, headers: { "idempotency-key": archiveKey } });
    await api("archived form resend denied", "/share-grants/" + archiveGrant.id + "/resend", { method: "POST", expected: 409, value: { version: 1 } });
    await api("archived form grant can be revoked", "/share-grants/" + archiveGrant.id, { method: "DELETE", headers: { "if-match": "1" } });
    const events = await (await api("safe grant audit page correction", "/share-grants/" + stable.id + "/events?page=999&pageSize=1")).json() as { page: number; total: number; items: unknown[] }; assert.equal(events.page, events.total); assert.equal(events.items.length, 1);
    await call("workflow HTML route", "/form/manage/applicant/" + form.id); await call("viewer HTML route", "/shared-privacy/view"); await call("email verification HTML route", "/shared-privacy/email-verify");
    const capturedOwner = cookie; await api("close synthetic owner session", "/auth/sign-out", { method: "POST", value: {} }); await api("captured manager session denied", "/share-grants?formId=" + form.id, { cookie: capturedOwner, expected: 401 }); cookie = "";
    const business = await snapshot(s); s.businessHash = business.hash; assert.equal(await preserved(), before);
    await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 });
    await writeFile(output + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, checks: cases.length, cases, database: business, actualExpiryWaitMs, originalUnchanged: true, browserChecked: false }, null, 2) + "\n");
  } else if (phase === "finish") {
    s = JSON.parse(await readFile(checkpoint, "utf8")) as State; assert(/^p06-share-owner-[0-9a-f-]{36}@catchsecu\.local\.test$/.test(s.email));
    await login(s.email, s.password); await api("select same synthetic company", "/context", { method: "POST", value: { companyId: s.companyId } });
    const detail = await (await api("persistent grant after actual restart", "/share-grants/" + s.grantId)).json() as ShareRecord; assert.equal(detail.id, s.grantId); assert.equal(detail.version, 1); assert.equal(detail.status, "active");
    await api("persistent viewer session after actual restart", "/viewer/session", { cookie: s.viewerCookie }); await viewerData(s, s.viewerCookie, [s.first, s.fileQuestion]); await bytes(s, s.viewerCookie);
    const business = await snapshot(s); assert.equal(business.hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
    await api("close persistent viewer session", "/viewer/logout", { method: "POST", cookie: s.viewerCookie, expected: 204 }); await api("captured viewer session denied after logout", "/viewer/session", { cookie: s.viewerCookie, expected: 401 });
    await api("close restarted synthetic owner session", "/auth/sign-out", { method: "POST", value: {} });
    assert.equal(await db.session.count({ where: { userId: s.userId } }), 0);
    await writeFile(output + "http-finish.json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, checks: cases.length, cases, database: business, originalUnchanged: true, businessUnchanged: true, fileHashUnchanged: true, ownerSessionsClosed: true, browserChecked: false }, null, 2) + "\n");
  } else {
    assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600);
    s = JSON.parse(await readFile(checkpoint, "utf8")) as State;
    const user = await db.user.findUniqueOrThrow({ where: { id: s.userId } }), company = await db.company.findUniqueOrThrow({ where: { id: s.companyId } });
    assert(/^p06-share-owner-[0-9a-f-]{36}@catchsecu\.local\.test$/.test(user.email)); assert(!user.platformAdmin); assert(/^P06 공유 검증 [0-9a-f-]{36}$/.test(company.name));
    const raw = (await db.$queryRaw<{ forms: bigint; submissions: bigint; receipts: bigint; grants: bigint; revoked: bigint; fields: bigint; challenges: bigint; viewerSessions: bigint; liveViewerSessions: bigint; ownerSessions: bigint; caches: bigint; clearedCaches: bigint }[]>`
      SELECT (SELECT count(*) FROM "Form" WHERE "tenantId"=${s.companyId}) AS forms,
        (SELECT count(*) FROM "Submission" WHERE "tenantId"=${s.companyId}) AS submissions,
        (SELECT count(*) FROM "ConsentReceipt" WHERE "tenantId"=${s.companyId}) AS receipts,
        (SELECT count(*) FROM "ShareGrant" WHERE "tenantId"=${s.companyId}) AS grants,
        (SELECT count(*) FROM "ShareGrant" WHERE "tenantId"=${s.companyId} AND "revokedAt" IS NOT NULL) AS revoked,
        (SELECT count(*) FROM "ShareField" WHERE "tenantId"=${s.companyId}) AS fields,
        (SELECT count(*) FROM "ViewerChallenge" WHERE "tenantId"=${s.companyId}) AS challenges,
        (SELECT count(*) FROM "ViewerSession" WHERE "tenantId"=${s.companyId}) AS "viewerSessions",
        (SELECT count(*) FROM "ViewerSession" WHERE "tenantId"=${s.companyId} AND "revokedAt" IS NULL) AS "liveViewerSessions",
        (SELECT count(*) FROM "Session" WHERE "userId"=${s.userId}) AS "ownerSessions",
        (SELECT count(*) FROM "IdempotencyRecord" WHERE "tenantId"=${s.companyId} AND "resourceType"='shareGrant') AS caches,
        (SELECT count(*) FROM "IdempotencyRecord" WHERE "tenantId"=${s.companyId} AND "resourceType"='shareGrant' AND "responseCipher" IS NULL AND "requestHash" IS NULL AND "invalidatedAt" IS NOT NULL) AS "clearedCaches"`)[0];
    const counts = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value)]));
    assert.deepEqual(counts, { forms: 2, submissions: 1, receipts: 1, grants: 4, revoked: 3, fields: 5, challenges: 5, viewerSessions: 5, liveViewerSessions: 0, ownerSessions: 0, caches: 4, clearedCaches: 3 });
    const grants = await db.shareGrant.findMany({ where: { tenantId: s.companyId } });
    for (const grant of grants) { const email = decrypt<string>(grant.emailCipher); assert(!grant.emailCipher.includes(email)); assert.match(grant.emailHash, /^[0-9a-f]{64}$/); assert.match(grant.codeHash, /^[0-9a-f]{64}$/); }
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: s.fileId } }), original = await privateFiles.read(file.storageKey);
    assert.equal(file.tenantId, s.companyId); assert.equal(file.status, "attached"); assert.equal(file.scanStatus, "clean"); assert.equal(hash(original), s.fileHash); assert.equal(file.sha256, s.fileHash); assert.equal(file.size, original.length);
    const encryptedPath = env.PRIVATE_STORAGE_DIR + "/objects/" + file.storageKey + ".enc", encrypted = await readFile(encryptedPath);
    assert.equal(encrypted.subarray(0, 4).toString(), "CSF1"); assert(!encrypted.includes(original)); assert.equal((await lstat(encryptedPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(env.PRIVATE_STORAGE_DIR + "/objects")).mode & 0o777, 0o700); assert.equal(await preserved(), s.preservedHash);
    const migrations = await db.$queryRaw<{ migration_name: string; checksum: string }[]>`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY migration_name`;
    assert.equal(migrations.length, 59); assert.equal((await readdir("prisma/migrations", { withFileTypes: true })).filter(f => f.isDirectory()).length, 59);
    for (const migration of migrations) assert.equal(hash(await readFile("prisma/migrations/" + migration.migration_name + "/migration.sql")), migration.checksum);
    const auditCounts = await db.auditEvent.groupBy({ by: ["action"], where: { tenantId: s.companyId }, _count: true, orderBy: { action: "asc" } });
    await writeFile(output + "database-current.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, readOnly: true, counts, encryptedEmailAndHashedSecrets: true,
      fileHash: s.fileHash, fileScan: file.scanStatus, fileAtRestEncryption: "CSF1", filePermissions: "0600", directoryPermissions: "0700", checkpointPermissions: "0600", migrations: 59, migrationChecksumsMatch: true, originalUnchanged: true, auditCounts }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ phase, checks: cases.length, passed: true }));
} catch (error) {
  if (phase === "prepare" && cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  console.error(JSON.stringify({ phase, passed: false, kind: error instanceof Error ? error.name : "Unknown", message: error instanceof assert.AssertionError ? error.message : "합성 공유 검증 실패" })); process.exitCode = 1;
}
finally { await db.$disconnect(); }
