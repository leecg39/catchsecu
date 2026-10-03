import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { enqueueMarketingMail, runOneJob } from "../src/server/jobs";
import type { SenderRecord, SenderPage } from "../src/contracts/senders";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(url.hostname) || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) || env.MAIL_TRANSPORT !== "local") throw new Error("Own local synthetic fixture only.");
const phase = process.argv[2], checkpoint = ".local/p08-sender-checkpoint.json", out = "docs/qa/P08-T01/";
if (!["prepare", "finish", "database"].includes(phase)) throw new Error("prepare, finish or database required.");
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; cookie: string;
  originalCompanyIds: string[]; originalUserIds: string[]; preservedHash: string; preparedHash: string; finishedHash: string;
  emailSenderId: string; smsSenderId: string; evidenceId: string; verificationId: string; verificationJobId: string; code: string;
  deliveredJobId: string; queuedJobId: string; createInput: object; createKey: string };
let state: State | undefined, cookie = "";
const cases: { label: string; status: number }[] = [];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function persist(s: State) { await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 }); assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); }
async function call(label: string, path: string, expected = 200, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie, ...(method === "GET" ? {} : { origin }), ...(value === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label); cases.push({ label, status: response.status }); return response;
}
async function record(id: string) { return (await call("현재 발신자 상세", "/senders/" + id)).json() as Promise<SenderRecord>; }
async function action(row: SenderRecord, action: string, value: object = {}, expected = 200) {
  return (await call("발신자 " + action, "/senders/" + row.id + "/" + action, expected, "POST", { version: row.version, ...value })).json();
}
async function preserved(s: State) {
  const scope = { tenantId: { in: s.originalCompanyIds } };
  const companies = await db.company.findMany({ where: { id: { in: s.originalCompanyIds } }, orderBy: { id: "asc" } });
  const services = await db.service.findMany({ where: scope, orderBy: { id: "asc" } });
  const forms = await db.form.findMany({ where: scope, orderBy: { id: "asc" }, include: { versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { id: "asc" } } } } } });
  const submissions = await db.submission.findMany({ where: scope, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, verificationReceipts: { orderBy: { id: "asc" } } } });
  const marketing = await db.marketingPreference.findMany({ where: scope, orderBy: { id: "asc" }, include: { events: { orderBy: { id: "asc" } } } });
  const senders = await db.sender.findMany({ where: scope, orderBy: { id: "asc" }, include: { verifications: { orderBy: { id: "asc" } }, events: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  const jobs = await db.job.findMany({ where: { ...scope, OR: [{ marketingPreferenceId: { not: null } }, { senderId: { not: null } }, { dedupeKey: { startsWith: "mail:sender-verification:" } }] }, orderBy: { id: "asc" } });
  const users = await db.user.findMany({ where: { id: { in: s.originalUserIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, emailVerified: true, platformAdmin: true, twoFactorEnabled: true, passwordChangedAt: true } });
  return digest({ companies, services, forms, submissions, marketing, senders, jobs, users });
}
async function snapshot(s: State) {
  const senders = await db.sender.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { verifications: { orderBy: { id: "asc" } }, events: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  const jobs = await db.job.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" } });
  return { hash: digest({ senders, jobs }), senders: senders.map(r => ({ id: r.id, channel: r.channel, status: r.status, version: r.version, addressErased: !r.addressCipher, events: r.events.length, files: r.files.map(f => ({ id: f.id, status: f.status })) })),
    jobs: jobs.map(j => ({ id: j.id, status: j.status, attempts: j.attempts, payloadErased: !!j.payloadErasedAt, localCopyErased: !!j.localCopyErasedAt })) };
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5eEAAAAASUVORK5CYII=", "base64");
await mkdir(out, { recursive: true });
try {
  if (phase === "prepare") {
    await assert.rejects(lstat(checkpoint), { code: "ENOENT" });
    const s = state = { email: "p08-sender-" + randomUUID() + "@example.test", password: "QA-" + randomUUID() + "-A9!", createKey: randomUUID(),
      originalCompanyIds: (await db.company.findMany({ select: { id: true } })).map(r => r.id), originalUserIds: (await db.user.findMany({ select: { id: true } })).map(r => r.id) } as State;
    s.preservedHash = await preserved(s); await persist(s);
    const previousJobs = (await db.job.findMany({ select: { id: true } })).map(r => r.id);
    await call("자기 합성 계정 생성", "/auth/sign-up/email", 200, "POST", { name: "발신자 QA", email: s.email, password: s.password });
    const user = await db.user.findUniqueOrThrow({ where: { email: s.email } }); s.userId = user.id; assert(!user.platformAdmin); await persist(s);
    const newJobs = await db.job.findMany({ where: { id: { notIn: previousJobs }, type: "mail" } });
    const mail = newJobs.map(j => decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher)).find(m => m.to === s.email && m.subject === "이메일 인증"); assert(mail);
    const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin);
    const verification = await fetch(link, { redirect: "manual" }); assert([200, 302].includes(verification.status)); cases.push({ label: "자기 이메일 인증 토큰 소비", status: verification.status });
    const login = await call("자기 합성 계정 로그인", "/auth/sign-in/email", 200, "POST", { email: s.email, password: s.password });
    cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); s.cookie = cookie;
    s.companyId = (await (await call("독립 회사 생성", "/companies", 201, "POST", { name: "P08 Sender QA " + randomUUID(), publicName: "발신자 QA" })).json()).id;
    const context = await (await call("현재 회사·서비스 확인", "/context")).json(); assert.equal(context.company.id, s.companyId); s.serviceId = context.services[0].id; await persist(s);
    s.createInput = { serviceId: s.serviceId, channel: "email", address: "sender@" + randomUUID() + ".test", label: "합성 발신 주소", description: "로컬 검증" };
    s.emailSenderId = (await (await call("이메일 발신자 등록", "/senders", 201, "POST", s.createInput, { "Idempotency-Key": s.createKey })).json()).id;
    s.smsSenderId = (await (await call("문자 발신자 등록", "/senders", 201, "POST", { serviceId: s.serviceId, channel: "sms", address: "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0"), label: "합성 발신번호", description: "증빙 검증" }, { "Idempotency-Key": randomUUID() })).json()).id;
    let email = await record(s.emailSenderId), sms = await record(s.smsSenderId);
    await call("발신자 정보 수정", "/senders/" + email.id, 200, "PATCH", { version: email.version, address: email.address, label: "수정한 합성 발신 주소", description: "재시작 보존" }); email = await record(email.id);
    assert.equal((await (await call("생성 재실행 현재 버전", "/senders", 201, "POST", s.createInput, { "Idempotency-Key": s.createKey })).json()).version, email.version);
    const list = await (await call("현재 정렬·페이지·권한", "/senders?" + new URLSearchParams({ serviceId: s.serviceId, channel: "email", page: "999", sort: "label", direction: "asc" }))).json() as SenderPage;
    assert.equal(list.page, 1); assert.equal(list.total, 1); assert(list.permissions.canCreate);
    for (const suffix of ["&serviceId=" + s.serviceId, "&extra=x", "&%5F%5Fproto%5F%5F=x"]) await call("잘못된 검색 조건 거부", "/senders?serviceId=" + s.serviceId + "&channel=email" + suffix, 422);
    await call("상세 검색 조건 거부", "/senders/" + email.id + "?extra=x", 422);
    const proof = await action(email, "request-email", {}, 202); s.verificationId = proof.id;
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + proof.id } }); assert.equal(job.tenantId, s.companyId); s.verificationJobId = job.id;
    await runOneJob("p08-own-verification", { tenantId: s.companyId, jobId: job.id });
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status, "done");
    const delivered = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); assert.equal(delivered.to, email.address); s.code = /인증번호: (\d{6})/.exec(delivered.text)![1]; await persist(s);
    email = await record(email.id); await action(email, "dns", {}, 201); email = await record(email.id);
    // 준비된 별도 loopback DNS fixture가 자기 회사의 .test TXT 값만 제공한다.
    await new Promise(r => setTimeout(r, 500)); await action(email, "check"); email = await record(email.id);
    await action(email, "confirm-email", { verificationId: s.verificationId, code: s.code }); email = await record(email.id);
    assert.equal(email.status, "verified"); assert.equal(email.environment, "local"); assert(email.eligible);
    await assert.rejects(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))); assert((await db.job.findUniqueOrThrow({ where: { id: job.id } })).localCopyErasedAt);
    await action(email, "default"); email = await record(email.id); assert(email.isDefault);
    await call("오래된 버전 거부", "/senders/" + email.id, 409, "PATCH", { version: 1, address: email.address, label: "오래된 수정", description: "" });
    await action(sms, "check", {}, 503); sms = await record(sms.id); assert.equal(sms.status, "pending");
    const evidence = await (await call("번호 증빙 준비", "/senders/" + sms.id + "/evidence", 201, "POST", { version: sms.version, name: "합성 증빙.png", size: png.length, mime: "image/png", sha256: createHash("sha256").update(png).digest("hex") }, { "Idempotency-Key": randomUUID() })).json(); s.evidenceId = evidence.id; await persist(s);
    const upload = await fetch(origin + "/api/v1/uploads/" + evidence.id + "/content", { method: "PUT", headers: { cookie, origin, "Content-Type": "image/png" }, body: png }); assert.equal(upload.status, 200); cases.push({ label: "증빙 실제 바이트 업로드", status: upload.status });
    await call("증빙 실제 검사 완료", "/uploads/" + evidence.id + "/complete", 200, "POST"); await action(sms, "evidence/" + evidence.id + "/attach"); sms = await record(sms.id);
    const file = await call("증빙 실제 다운로드", "/senders/" + sms.id + "/evidence/" + evidence.id + "/download"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
    const name = randomUUID(), contact = randomUUID(), recipient = "recipient-" + randomUUID() + "@example.test";
    const form = await (await call("발송 동의 폼 생성", "/forms", 201, "POST", { serviceId: s.serviceId, title: "발신자 합성 수신 동의", content: { body: "합성 검증", consentPurpose: "합성", consentRequired: true, retentionDays: 30, maxResponses: 10, questions: [{ id: name, label: "이름", type: "단문형 답변", required: true }, { id: contact, label: "이메일", type: "단문형 답변", required: true }], marketing: { purpose: "소식", nameQuestionId: name, emailQuestionId: contact } } }, { "Idempotency-Key": randomUUID() })).json();
    const publication = await (await call("수신 동의 폼 게시", "/forms/" + form.id + "/publish", 201, "POST", { version: form.version }, { "Idempotency-Key": randomUUID() })).json();
    await call("명시적 합성 수신 동의", "/public/forms/" + publication.token + "/submissions", 201, "POST", { answers: { [name]: "합성 수신자", [contact]: recipient }, consent: true, marketingChannels: ["email"] }, { "Idempotency-Key": randomUUID() });
    const scope = { tenantId: s.companyId, serviceId: s.serviceId }, sender = { id: email.id, version: email.version };
    const sent = await enqueueMarketingMail({ to: recipient, subject: "합성 From 검증", text: "외부 도달 검증 아님" }, scope, randomUUID(), new Date(), sender); s.deliveredJobId = sent.id!;
    await runOneJob("p08-own-from", { tenantId: s.companyId, jobId: s.deliveredJobId }); assert.equal((await db.job.findUniqueOrThrow({ where: { id: s.deliveredJobId } })).status, "done");
    assert.deepEqual(JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, s.deliveredJobId + ".json"), "utf8")).from, { name: email.label, address: email.address });
    s.queuedJobId = (await enqueueMarketingMail({ to: recipient, subject: "중지 검증 예약", text: "합성" }, scope, randomUUID(), new Date(Date.now() + 3600000), sender)).id!;
    await call("사용 중 발신자 삭제 차단", "/senders/" + email.id, 409, "DELETE", { version: email.version });
    assert.equal(await preserved(s), s.preservedHash); s.preparedHash = (await snapshot(s)).hash; await persist(s);
    await writeFile(out + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", passed: cases.length, cases, originalsUnchanged: true, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length, snapshot: await snapshot(s), localMailboxVerified: true, providerVerified: false, globalWorkerRun: false }, null, 2) + "\n");
  } else {
    assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); const s = state = JSON.parse(await readFile(checkpoint, "utf8")) as State;
    assert.equal(await preserved(s), s.preservedHash);
    if (phase === "finish") {
      cookie = s.cookie; assert.equal((await snapshot(s)).hash, s.preparedHash);
      let email = await record(s.emailSenderId); assert.equal(email.status, "verified"); assert(email.isDefault); assert(email.eligible);
      let sms = await record(s.smsSenderId); assert.equal(sms.evidence?.[0].id, s.evidenceId);
      const file = await call("재시작 후 증빙 다운로드", "/senders/" + sms.id + "/evidence/" + s.evidenceId + "/download"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      await action(email, "disable"); email = await record(email.id); assert.equal(email.status, "disabled"); assert(!email.isDefault);
      const queued = await db.job.findFirstOrThrow({ where: { id: s.queuedJobId, tenantId: s.companyId, senderId: email.id } });
      await db.job.update({ where: { id: queued.id }, data: { dueAt: new Date() } }); await runOneJob("p08-own-block", { tenantId: s.companyId, jobId: queued.id });
      assert.equal((await db.job.findUniqueOrThrow({ where: { id: queued.id } })).status, "cancelled"); await assert.rejects(access(resolve(env.LOCAL_MAIL_DIR, queued.id + ".json")));
      await action(email, "renew"); email = await record(email.id); assert.equal(email.status, "pending");
      await action(email, "confirm-email", { verificationId: s.verificationId, code: s.code }, 422);
      await call("발신자 주소 원문 삭제", "/senders/" + email.id, 200, "DELETE", { version: email.version }); email = await record(email.id); assert.equal(email.address, null); assert(!email.cleanupPending);
      const events = await db.senderEvent.count({ where: { senderId: email.id } });
      await call("반복 삭제 중복 이력 없음", "/senders/" + email.id, 200, "DELETE", { version: email.version }); assert.equal(await db.senderEvent.count({ where: { senderId: email.id } }), events);
      await call("삭제 후 생성 캐시 거부", "/senders", 410, "POST", s.createInput, { "Idempotency-Key": s.createKey });
      await call("번호 증빙 원문 삭제", "/senders/" + sms.id + "/evidence/" + s.evidenceId, 200, "DELETE", { version: sms.version }); sms = await record(sms.id);
      await call("발신번호 삭제", "/senders/" + sms.id, 200, "DELETE", { version: sms.version });
      await call("삭제 증빙 다운로드 차단", "/senders/" + sms.id + "/evidence/" + s.evidenceId + "/download", 410);
      const health = await call("DB 준비 상태", "/health"); assert.equal((await health.json()).database, "ready");
      await call("자기 합성 세션 종료", "/auth/sign-out", 200, "POST", {}); assert.equal(await db.session.count({ where: { userId: s.userId } }), 0);
      assert.equal(await preserved(s), s.preservedHash); s.finishedHash = (await snapshot(s)).hash; await persist(s);
      await writeFile(out + "http-finish.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", passed: cases.length, cases, restartPersistence: true, originalsUnchanged: true, syntheticSessions: 0, snapshot: await snapshot(s), globalWorkerRun: false, providerVerified: false }, null, 2) + "\n");
    } else {
      assert.equal((await snapshot(s)).hash, s.finishedHash); assert.equal(await db.session.count({ where: { userId: s.userId } }), 0);
      await writeFile(out + "dev-database.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", originalsUnchanged: true, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length, syntheticSessions: 0, snapshot: await snapshot(s), globalWorkerRun: false, providerVerified: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, result: "passed", httpCases: cases.length }));
} catch (error) {
  if (state?.userId && /^p08-sender-.*@example\.test$/.test(state.email) && !state.originalUserIds.includes(state.userId)) {
    const own = await db.user.findFirst({ where: { id: state.userId, email: state.email } }); if (own) await db.session.deleteMany({ where: { userId: own.id } });
  }
  throw error;
} finally { await db.$disconnect(); }
