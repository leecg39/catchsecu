import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { enqueueMarketingMail, runOneJob } from "../src/server/jobs";
import type { MarketingRecord, MarketingPage } from "../src/contracts/marketing";
const target = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (target.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(target.hostname) || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) || env.MAIL_TRANSPORT !== "local") throw new Error("Independent local HTTP and local mailbox QA only.");
const phase = process.argv[2], out = "docs/qa/P07-T02/", checkpoint = ".local/p07-marketing-checkpoint.json";
if (!["prepare", "finish", "database"].includes(phase)) throw new Error("prepare, finish or database required.");
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; cookie: string;
  originalCompanyIds: string[]; originalUserIds: string[]; preservedHash: string; preparedHash: string; finishedHash: string;
  preferenceId: string; smsId: string; manualId: string; submissionId: string; deliveredJobId: string; queuedJobId: string; createKey: string; createInput: object };
const cases: { label: string; status: number }[] = [];
let cookie = "";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const responseCookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function call(label: string, path: string, options: { method?: string; value?: unknown; expected?: number | number[]; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET";
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie, ...(method === "GET" ? {} : { origin }),
    ...(options.value === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers }, ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  const expected = options.expected ?? 200;
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status);
  cases.push({ label, status: response.status }); return response;
}
async function persist(s: State) { await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 }); assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); }
async function preserved(s: Pick<State, "originalCompanyIds" | "originalUserIds">) {
  const scope = { tenantId: { in: s.originalCompanyIds } };
  const companies = await db.company.findMany({ where: { id: { in: s.originalCompanyIds } }, orderBy: { id: "asc" } });
  const services = await db.service.findMany({ where: scope, orderBy: { id: "asc" } });
  const forms = await db.form.findMany({ where: scope, orderBy: { id: "asc" }, include: { versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { id: "asc" } } } } } });
  const submissions = await db.submission.findMany({ where: scope, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, verificationReceipts: { orderBy: { id: "asc" } } } });
  const preferences = await db.marketingPreference.findMany({ where: scope, orderBy: { id: "asc" }, include: { events: { orderBy: { id: "asc" } } } });
  const jobs = await db.job.findMany({ where: { ...scope, marketingPreferenceId: { not: null } }, orderBy: { id: "asc" } });
  const integrations = await db.verificationIntegration.findMany({ where: scope, orderBy: { id: "asc" }, include: { revisions: { orderBy: { id: "asc" } } } });
  const users = await db.user.findMany({ where: { id: { in: s.originalUserIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, emailVerified: true, platformAdmin: true, twoFactorEnabled: true, passwordChangedAt: true } });
  return digest({ companies, services, forms, submissions, preferences, jobs, integrations, users });
}
async function snapshot(s: State) {
  const preferences = await db.marketingPreference.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { events: { orderBy: { id: "asc" } } } });
  const jobs = await db.job.findMany({ where: { tenantId: s.companyId, marketingPreferenceId: { not: null } }, orderBy: { id: "asc" } });
  return { hash: digest({ preferences, jobs }), preferences: preferences.map(p => ({ id: p.id, channel: p.channel, version: p.version, status: p.status, excluded: p.excluded, contactErased: !p.contactCipher, events: p.events.length })),
    jobs: jobs.map(j => ({ id: j.id, status: j.status, attempts: j.attempts, payloadErased: !!j.payloadErasedAt, localCopyErased: !!j.localCopyErasedAt })) };
}
async function getRecord(id: string) { return (await call("현재 동의 상세", "/marketing/preferences/" + id)).json() as Promise<MarketingRecord>; }
await mkdir(out, { recursive: true });
try {
  if (phase === "prepare") {
    // 기존 합성 계정·인증 정보를 재사용하지 않는다.
    await assert.rejects(lstat(checkpoint), { code: "ENOENT" });
    const s = { email: "p07-marketing-" + randomUUID() + "@example.test", password: "QA-" + randomUUID() + "-A9!",
      originalCompanyIds: (await db.company.findMany({ select: { id: true } })).map(r => r.id),
      originalUserIds: (await db.user.findMany({ select: { id: true } })).map(r => r.id), createKey: randomUUID() } as State;
    s.preservedHash = await preserved(s); await persist(s);
    const previousJobs = (await db.job.findMany({ select: { id: true } })).map(row => row.id);
    await call("합성 계정 생성", "/auth/sign-up/email", { method: "POST", value: { name: "마케팅 QA", email: s.email, password: s.password } });
    const user = await db.user.findUniqueOrThrow({ where: { email: s.email } });
    const ownMails = await db.job.findMany({ where: { id: { notIn: previousJobs }, type: "mail" } });
    const verification = ownMails.map(job => decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher)).find(mail => mail.to === s.email && mail.subject === "이메일 인증");
    assert(verification); const link = new URL(verification.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin);
    assert(link.pathname.startsWith("/api/v1/"));
    await call("자기 이메일 인증 토큰 소비", link.pathname.slice(7) + link.search, { expected: [200, 302] });
    assert((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified); s.userId = user.id; assert(!user.platformAdmin);
    const login = await call("합성 계정 로그인", "/auth/sign-in/email", { method: "POST", value: { email: s.email, password: s.password } });
    cookie = responseCookies(login); s.cookie = cookie;
    s.companyId = (await (await call("독립 회사 생성", "/companies", { method: "POST", expected: 201, value: { name: "P07 Marketing " + randomUUID(), publicName: "마케팅 QA" } })).json()).id;
    const ctx = await (await call("자기 회사·서비스 확인", "/context")).json() as { company: { id: string }; services: { id: string }[] };
    assert.equal(ctx.company.id, s.companyId); s.serviceId = ctx.services[0].id; await persist(s);
    const name = randomUUID(), email = randomUUID(), phone = randomUUID(), recipient = randomUUID() + "@example.test";
    const form = await (await call("채널별 동의 폼 생성", "/forms", { method: "POST", expected: 201, headers: { "Idempotency-Key": randomUUID() }, value: { serviceId: s.serviceId, title: "마케팅 합성 HTTP 검증", content: {
      body: "합성 데이터 검증", consentPurpose: "합성 신청", consentRequired: true, retentionDays: 30, maxResponses: 10,
      questions: [{ id: name, label: "이름", type: "단문형 답변", required: true, subjectRole: "name" }, { id: email, label: "이메일", type: "단문형 답변", required: true, subjectRole: "email" }, { id: phone, label: "전화번호", type: "단문형 답변", required: true }],
      marketing: { purpose: "합성 소식 안내", nameQuestionId: name, emailQuestionId: email, smsQuestionId: phone } } } })).json() as { id: string; version: number };
    const publication = await (await call("폼 게시", "/forms/" + form.id + "/publish", { method: "POST", expected: 201, value: { version: form.version }, headers: { "Idempotency-Key": randomUUID() } })).json() as { token: string };
    const submit = (channels: string[], contact: string) => call("명시적 채널별 합성 접수", "/public/forms/" + publication.token + "/submissions", { method: "POST", expected: 201, headers: { "Idempotency-Key": randomUUID() },
      value: { answers: { [name]: "＝1+1", [email]: contact, [phone]: "+821012345678" }, consent: true, marketingChannels: channels } });
    s.submissionId = (await (await submit(["email", "sms"], recipient)).json()).id;
    const list = await (await call("현재 목록·권한·정렬·페이지 보정", "/marketing/preferences?" + new URLSearchParams({ serviceId: s.serviceId, page: "999", sort: "grantedAt", direction: "asc" }))).json() as MarketingPage;
    assert.equal(list.page, 1); assert.equal(list.total, 2); assert(list.permissions.canCreate);
    s.preferenceId = list.items.find(p => p.channel === "email")!.id; s.smsId = list.items.find(p => p.channel === "sms")!.id;
    await call("중복 검색 조건 거부", "/marketing/preferences?serviceId=" + s.serviceId + "&serviceId=" + s.serviceId, { expected: 422 });
    await call("상세 검색 조건 거부", "/marketing/preferences/" + s.preferenceId + "?extra=x", { expected: 422 });
    const csv = await call("수식 문자 방어·개인 캐시 금지 CSV", "/marketing/preferences/export?serviceId=" + s.serviceId);
    assert.equal(csv.headers.get("cache-control"), "private, no-store"); assert((await csv.text()).includes('"\''));
    const deliveryScope = { tenantId: s.companyId, serviceId: s.serviceId };
    const delivered = await enqueueMarketingMail({ to: recipient, subject: "합성 로컬 발송", text: "외부 전달 검증 아님" }, deliveryScope);
    s.deliveredJobId = delivered.id!; await persist(s);
    assert(await runOneJob("p07-http-own-marketing", { tenantId: s.companyId, jobId: s.deliveredJobId }));
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: s.deliveredJobId } })).status, "done");
    assert.equal(JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, s.deliveredJobId + ".json"), "utf8")).to, recipient);
    const queued = await enqueueMarketingMail({ to: recipient, subject: "합성 예약", text: "철회 시 차단 검증" }, deliveryScope, randomUUID(), new Date(Date.now() + 3600000)); s.queuedJobId = queued.id!;
    const p = await getRecord(s.preferenceId);
    const excluded = await (await call("이메일 채널 제외", "/marketing/preferences/" + p.id, { method: "PATCH", value: { version: p.version, excluded: true } })).json() as MarketingRecord;
    assert.equal(excluded.version, p.version + 1); assert(!excluded.eligible); assert((await getRecord(s.smsId)).eligible);
    await call("오래된 변경 버전 거부", "/marketing/preferences/" + p.id, { method: "PATCH", expected: 409, value: { version: p.version, excluded: false } });
    const source = await (await submit([], randomUUID() + "@example.test")).json() as { id: string };
    await call("원본 응답 선택", "/marketing/sources?serviceId=" + s.serviceId + "&page=999");
    s.createInput = { serviceId: s.serviceId, submissionId: source.id, channel: "email", nameQuestionId: name, contactQuestionId: email, grantedAt: new Date(Date.now() - 1000).toISOString(), purpose: "별도 합성 동의", reference: "합성 근거 001", attested: true };
    const create = { method: "POST", expected: 201, value: s.createInput, headers: { "Idempotency-Key": s.createKey } };
    const manual = await (await call("별도 동의 생성", "/marketing/preferences", create)).json() as { id: string; version: number }; s.manualId = manual.id;
    const changed = await (await call("별도 동의 제외 수정", "/marketing/preferences/" + manual.id, { method: "PATCH", value: { version: manual.version, excluded: true } })).json() as MarketingRecord;
    assert.equal((await (await call("생성 재실행 현재 버전", "/marketing/preferences", create)).json()).version, changed.version);
    const sms = await getRecord(s.smsId);
    await call("두 채널 원자 일괄 철회", "/marketing/preferences/withdrawals", { method: "POST", value: { serviceId: s.serviceId, items: [excluded, sms].map(row => ({ id: row.id, version: row.version })) } });
    const count = await db.marketingEvent.count({ where: { tenantId: s.companyId } });
    await call("일괄 철회 반복 요청 멱등", "/marketing/preferences/withdrawals", { method: "POST", value: { serviceId: s.serviceId, items: [excluded, sms].map(row => ({ id: row.id, version: row.version })) } });
    assert.equal(await db.marketingEvent.count({ where: { tenantId: s.companyId } }), count);
    await call("서비스 동의 통계", "/marketing/summary?serviceId=" + s.serviceId);
    await call("이메일 차단 목록", "/email-suppressions?serviceId=" + s.serviceId);
    assert.equal(await preserved(s), s.preservedHash); const snap = await snapshot(s); s.preparedHash = snap.hash; await persist(s);
    await writeFile(out + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, snapshot: snap, originalsUnchanged: true, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length, globalWorkerRun: false, localMailboxVerified: true, providerVerified: false }, null, 2) + "\n");
  } else {
    const s = JSON.parse(await readFile(checkpoint, "utf8")) as State; assert.equal(await preserved(s), s.preservedHash);
    if (phase === "finish") {
      cookie = s.cookie; assert.equal((await snapshot(s)).hash, s.preparedHash);
      const p = await getRecord(s.preferenceId); assert.equal(p.status, "withdrawn"); assert(!p.eligible);
      const erased = await (await call("재시작 후 동의 원문·발송 사본 삭제", "/marketing/preferences/" + p.id, { method: "DELETE", value: { serviceId: s.serviceId, version: p.version } })).json() as { cleanup: { pending: number } };
      assert.equal(erased.cleanup.pending, 0);
      for (const id of [s.deliveredJobId, s.queuedJobId]) {
        const job = await db.job.findUniqueOrThrow({ where: { id } }); assert(job.payloadErasedAt); assert(job.localCopyErasedAt); assert.deepEqual(decrypt(job.payloadCipher), { erased: true });
        await assert.rejects(lstat(resolve(env.LOCAL_MAIL_DIR, id + ".json")), { code: "ENOENT" });
      }
      const current = await getRecord(s.preferenceId); assert.equal(current.contact, null); assert.equal(current.evidence, null);
      await call("반복 삭제 요청", "/marketing/preferences/" + p.id, { method: "DELETE", value: { serviceId: s.serviceId, version: p.version } });
      const manual = await getRecord(s.manualId);
      await call("별도 동의 삭제", "/marketing/preferences/" + manual.id, { method: "DELETE", value: { serviceId: s.serviceId, version: manual.version } });
      await call("삭제 후 생성 캐시 거부", "/marketing/preferences", { method: "POST", expected: 410, value: s.createInput, headers: { "Idempotency-Key": s.createKey } });
      const health = await call("DB 준비 상태", "/health"); assert.equal((await health.json()).database, "ready");
      await call("합성 세션 종료", "/auth/sign-out", { method: "POST", value: {} });
      assert.equal(await db.session.count({ where: { userId: s.userId } }), 0); assert.equal(await preserved(s), s.preservedHash);
      s.finishedHash = (await snapshot(s)).hash; await persist(s);
      await writeFile(out + "http-finish.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, snapshot: await snapshot(s), originalsUnchanged: true, syntheticSessions: 0, restartPersistence: true, globalWorkerRun: false, providerVerified: false }, null, 2) + "\n");
    } else {
      assert.equal((await snapshot(s)).hash, s.finishedHash); assert.equal(await db.session.count({ where: { userId: s.userId } }), 0);
      await writeFile(out + "dev-database.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", originalsUnchanged: true, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length, syntheticSessions: 0, snapshot: await snapshot(s), globalWorkerRun: false, providerVerified: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, result: "passed", httpCases: cases.length }));
} finally { await db.$disconnect(); }
