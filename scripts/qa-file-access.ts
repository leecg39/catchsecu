import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL), phase = process.argv[2];
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(env.MAIL_TRANSPORT, "local"); assert.equal(env.FILE_STORAGE, "local"); assert(["prepare", "finish", "recover-viewer"].includes(phase));
const output = "docs/qa/P06-T03/", checkpoint = ".local/p06-file-access-checkpoint.json", cases: { label: string; status: number }[] = [];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex"), digest = (value: unknown) => hash(JSON.stringify(value));
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; formId: string; submissionId: string; fileId: string; questionId: string;
  fileHash: string; viewerCookie: string; grantId: string; businessHash: string; preservedHash: string };
let cookie = "";
async function call(label: string, path: string, options: { method?: string; value?: unknown; cookie?: string; expected?: number | number[]; headers?: Record<string, string>; raw?: Buffer } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie, ...(method === "GET" ? {} : { origin }),
    ...(options.value === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...options.headers },
    ...(options.raw ? { body: new Uint8Array(options.raw) } : options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status); cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options: Parameters<typeof call>[2] = {}) => call(label, "/api/v1" + path, options);
const cookies = (r: Response) => r.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function login(email: string, password: string) { cookie = cookies(await api("synthetic login", "/auth/sign-in/email", { method: "POST", value: { email, password }, cookie: "" })); assert(cookie); }
async function preserved() {
  const old = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8")) as { submissionId: string };
  const row = await db.submission.findUniqueOrThrow({ where: { id: old.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  return digest(row);
}
async function snapshot(s: State) {
  const form = await db.form.findUniqueOrThrow({ where: { id: s.formId }, include: { versions: { orderBy: { number: "asc" } }, publications: { orderBy: { id: "asc" } } } });
  assert.equal(form.tenantId, s.companyId);
  const submissions = await db.submission.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: {
    answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  const files = await db.fileObject.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" } });
  return { hash: digest({ form, submissions, files }), forms: 1, submissions: submissions.length, files: files.map(f => ({ id: f.id, status: f.status, scanStatus: f.scanStatus, sha256: f.sha256 })),
    receipts: submissions.reduce((n, r) => n + r.receipts.length, 0) };
}
async function mailFor(id: string) { return decrypt<{ to: string; text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: id } })).payloadCipher); }
async function share(s: State, expiresAt = new Date(Date.now() + 86400000)) {
  const versionId = (await db.form.findUniqueOrThrow({ where: { id: s.formId } })).publishedVersionId;
  const grant = await (await api("create bound file share", "/share-grants", { method: "POST", expected: 201, value: { formId: s.formId, formVersionId: versionId,
    email: "p06-file-viewer-" + randomUUID() + "@catchsecu.local.test", questionIds: [s.questionId], expiresAt: expiresAt.toISOString() } })).json() as { id: string; version: number };
  const invitation = await mailFor("mail:share:" + grant.id + ":invite:1");
  const challengeResponse = await api("request own local viewer code", "/viewer/challenges", { method: "POST", cookie: "", expected: 202,
    value: { email: invitation.to, formCode: s.formId, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], consent: true } });
  const challenge = await challengeResponse.json() as { id: string }, mail = await mailFor("mail:share:" + grant.id + ":challenge:" + challenge.id);
  const authenticated = await api("verify own local viewer code", "/viewer/challenges/" + challenge.id + "/verify", { method: "POST", cookie: cookies(challengeResponse), value: { code: mail.text.match(/인증코드: (\d{6})/)![1] } });
  return { grant, cookie: cookies(authenticated), expiresAt };
}
const path = (s: State, viewer = false, download = true) => (viewer ? "/viewer/files/" : "/files/") + s.fileId + (download ? "/download" : "") + "?" + new URLSearchParams({ submissionId: s.submissionId, questionId: s.questionId });
async function readBytes(s: State, viewer = false) {
  const response = await api(viewer ? "shared bytes exact hash" : "private bytes exact hash", path(s, viewer), { ...(viewer ? { cookie: s.viewerCookie } : {}) });
  assert.equal(hash(new Uint8Array(await response.arrayBuffer())), s.fileHash); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert(response.headers.get("content-security-policy")?.includes("sandbox"));
}
try {
  let s: State;
  if (phase === "prepare") {
    const before = await preserved(), email = "p06-file-owner-" + randomUUID() + "@catchsecu.local.test", password = "P06-files!" + randomUUID();
    await api("create independent synthetic account", "/auth/sign-up/email", { method: "POST", cookie: "", value: { email, password, name: "P06 첨부파일 검증" } });
    const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 30 });
    const ownMail = jobs.map(j => ({ job: j, mail: decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher) })).find(j => j.mail.to === email && j.mail.subject === "이메일 인증"); assert(ownMail);
    const verification = new URL(ownMail.mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(verification.origin, origin); assert.equal(verification.pathname, "/api/v1/auth/verify-email");
    await call("verify own account link", verification.pathname + verification.search, { cookie: "", expected: [200, 302] });
    const user = await db.user.findUniqueOrThrow({ where: { email } }); assert(user.emailVerified && !user.platformAdmin);
    await login(email, password);
    const company = await (await api("register independent synthetic company", "/companies", { method: "POST", expected: 201, value: { name: "P06 첨부 검증 " + randomUUID(), publicName: "합성 첨부 검증" } })).json() as { id: string };
    const context = await (await api("registered company context", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(context.company.id, company.id);
    const first = randomUUID(), second = randomUUID(), serviceId = context.services[0].id;
    const form = await (await api("create two-file form", "/forms", { method: "POST", expected: 201, value: { serviceId, title: "P06 첨부 검증", content: {
      body: "합성 첨부", consentRequired: true, consentPurpose: "시험", retentionDays: 30, maxResponses: 10,
      questions: [first, second].map(id => ({ id, type: "파일 업로드", label: "합성 자료", required: true })) } } })).json() as { id: string; version: number };
    const pub = await (await api("publish two-file form", "/forms/" + form.id + "/publish", { method: "POST", expected: 201, value: { version: form.version } })).json() as { token: string };
    const files: { id: string; uploadToken: string; hash: string }[] = [];
    for (const questionId of [first, second]) {
      const bytes = Buffer.from("P06 실제 첨부 바이트 " + randomUUID()), fingerprint = hash(bytes);
      const file = await (await api("initialize public attachment", "/public/forms/" + pub.token + "/uploads", { method: "POST", expected: 201, cookie: "", value: { questionId, name: "합성 증빙.txt", mime: "text/plain", size: bytes.length, sha256: fingerprint } })).json() as { id: string; uploadToken: string };
      await api("write actual encrypted bytes", "/uploads/" + file.id + "/content", { method: "PUT", cookie: "", raw: bytes, headers: { "content-type": "text/plain", "x-upload-token": file.uploadToken } });
      await api("complete actual ClamAV scan", "/uploads/" + file.id + "/complete", { method: "POST", cookie: "", headers: { "x-upload-token": file.uploadToken } }); files.push({ ...file, hash: fingerprint });
    }
    const submitted = await (await api("bind two files in one submission", "/public/forms/" + pub.token + "/submissions", { method: "POST", cookie: "", expected: 201,
      value: { consent: true, answers: { [first]: files[0].id, [second]: files[1].id }, attachments: { [first]: { fileId: files[0].id, token: files[0].uploadToken }, [second]: { fileId: files[1].id, token: files[1].uploadToken } } } })).json() as { id: string };
    s = { email, password, userId: user.id, companyId: company.id, serviceId, formId: form.id, submissionId: submitted.id, fileId: files[0].id, questionId: first,
      fileHash: files[0].hash, viewerCookie: "", grantId: "", businessHash: "", preservedHash: before };
    const privateList = await (await api("private two-file list", "/files?submissionId=" + s.submissionId)).json() as { total: number }; assert.equal(privateList.total, 2);
    await api("private safe metadata", path(s, false, false)); await readBytes(s);
    await api("anonymous file denied", path(s), { cookie: "", expected: 401 });
    const selected = await share(s); s.viewerCookie = selected.cookie; s.grantId = selected.grant.id;
    const sharedList = await (await api("shared selected-file list", "/viewer/files?submissionId=" + s.submissionId, { cookie: selected.cookie })).json() as { total: number }; assert.equal(sharedList.total, 1);
    await api("shared safe metadata", path(s, true, false), { cookie: selected.cookie }); await readBytes(s, true);
    for (const [viewer, currentCookie] of [[false, cookie], [true, selected.cookie]] as const) {
      for (const invalid of [path(s, viewer).replace(first, second), path(s, viewer).replace(s.submissionId, randomUUID()), path(s, viewer).replace(s.fileId, randomUUID())]) await api("wrong file binding denied", invalid, { cookie: currentCookie, expected: 404 });
      for (const suffix of ["&questionId=" + second, "&submissionId=" + s.submissionId, "&token=ignored"]) await api("duplicate or unknown query denied", path(s, viewer) + suffix, { cookie: currentCookie, expected: 422 });
    }
    await api("unselected shared file denied", path({ ...s, fileId: files[1].id, questionId: second }, true), { cookie: selected.cookie, expected: 404 });
    const memberBytes = Buffer.from("P06 미제출 파일 CRUD " + randomUUID()), memberFile = await (await api("member file create", "/uploads/init", { method: "POST", expected: 201,
      value: { purpose: "service", serviceId, name: "변경 전.txt", mime: "text/plain", size: memberBytes.length, sha256: hash(memberBytes) } })).json() as { id: string };
    await api("member file upload", "/uploads/" + memberFile.id + "/content", { method: "PUT", raw: memberBytes, headers: { "content-type": "text/plain" } });
    const ready = await (await api("member file scan", "/uploads/" + memberFile.id + "/complete", { method: "POST" })).json() as { version: number };
    const renamed = await (await api("member file rename", "/files/" + memberFile.id, { method: "PATCH", value: { name: "변경 후.txt", version: ready.version } })).json() as { name: string; version: number }; assert.equal(renamed.name, "변경 후.txt");
    await api("stale rename version denied", "/files/" + memberFile.id, { method: "PATCH", value: { name: "충돌.txt", version: ready.version }, expected: 409 });
    assert.equal((await (await api("member file metadata", "/files/" + memberFile.id)).json()).name, "변경 후.txt");
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: memberFile.id } });
    await api("member file delete", "/files/" + memberFile.id, { method: "DELETE", headers: { "if-match": String(renamed.version) }, expected: 204 });
    assert.equal((await db.fileObject.findUniqueOrThrow({ where: { id: memberFile.id } })).status, "deleted"); await assert.rejects(privateFiles.read(stored.storageKey));
    await api("deleted file unavailable", "/files/" + memberFile.id, { expected: 409 });
    await api("attached evidence cannot delete", "/files/" + s.fileId, { method: "DELETE", headers: { "if-match": "4" }, expected: 404 });
    await api("revoke first share", "/share-grants/" + selected.grant.id, { method: "DELETE", headers: { "if-match": "1" } });
    await api("revoked captured viewer denied", path(s, true), { cookie: selected.cookie, expected: 401 });
    const deadline = new Date(Date.now() + 3000), short = await share(s, deadline); s.viewerCookie = short.cookie;
    await readBytes(s, true); const waitStarted = Date.now(); await setTimeout(Math.max(0, deadline.getTime() - Date.now() + 50)); const actualExpiryWaitMs = Date.now() - waitStarted;
    await api("actually expired captured viewer denied", path(s, true), { cookie: short.cookie, expected: 401 });
    const active = await share(s); s.viewerCookie = active.cookie; s.grantId = active.grant.id;
    for (const route of ["/file-view/" + s.submissionId, "/file-view/" + s.submissionId + "/" + first + "/" + s.fileId,
      "/file-view/" + s.submissionId + "/shared", "/file-view/" + s.submissionId + "/" + first + "/" + s.fileId + "/shared"]) await call("file-view HTML route only", route);
    const captured = cookie; await api("sign out synthetic owner", "/auth/sign-out", { method: "POST", value: {} }); cookie = "";
    await api("captured owner session denied", path(s), { cookie: captured, expected: 401 });
    const state = await snapshot(s); s.businessHash = state.hash; assert.equal(await preserved(), before);
    await writeFile(checkpoint, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
    await writeFile(output + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, checks: cases.length, cases, database: state,
      actualExpiryWaitMs, originalUnchanged: true, browserChecked: false }, null, 2) + "\n");
  } else {
    s = JSON.parse(await readFile(checkpoint, "utf8")) as State; assert(/^p06-file-owner-[0-9a-f-]{36}@catchsecu\.local\.test$/.test(s.email));
    const company = await db.company.findUniqueOrThrow({ where: { id: s.companyId } }); assert(/^P06 첨부 검증 [0-9a-f-]{36}$/.test(company.name));
    await login(s.email, s.password); await api("select same independent company", "/context", { method: "POST", value: { companyId: s.companyId } });
    if (phase === "recover-viewer") {
      await api("previous recovery cookie remains logged out", path(s, true), { cookie: s.viewerCookie, expected: 401 });
      const renewed = await share(s); s.viewerCookie = renewed.cookie; s.grantId = renewed.grant.id;
      assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
      await api("logout recovery fixture owner", "/auth/sign-out", { method: "POST", value: {} });
      await writeFile(checkpoint, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
      await writeFile(output + "http-recovery.json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, checks: cases.length, cases, businessUnchanged: true }, null, 2) + "\n");
      console.log(JSON.stringify({ phase, checks: cases.length, passed: true }));
    } else {
    await readBytes(s); await readBytes(s, true);
    await api("same private metadata after restart", path(s, false, false)); await api("same shared metadata after restart", path(s, true, false), { cookie: s.viewerCookie });
    const state = await snapshot(s); assert.equal(state.hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
    await api("logout persisted viewer", "/viewer/logout", { method: "POST", cookie: s.viewerCookie, expected: 204 });
    await api("logged out viewer file denied", path(s, true), { cookie: s.viewerCookie, expected: 401 });
    await api("logout synthetic owner after restart", "/auth/sign-out", { method: "POST", value: {} });
    await db.session.deleteMany({ where: { userId: s.userId } });
    await writeFile(output + "http-finish.json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, checks: cases.length, cases, database: state, originalUnchanged: true,
      businessUnchanged: true, privateAndSharedHashUnchanged: true, browserChecked: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, checks: cases.length, passed: true }));
} catch (error) { console.error(JSON.stringify({ phase, passed: false, kind: error instanceof Error ? error.name : "Unknown", message: error instanceof assert.AssertionError ? error.message : "합성 첨부 검증 실패" })); process.exitCode = 1; }
finally { await db.$disconnect(); }
