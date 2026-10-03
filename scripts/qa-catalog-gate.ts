import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import type { CatalogHistory, PurposeInput, PurposeRecord, RecipientInput, RecipientRecord } from "../src/contracts/processing-catalog";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const people = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const fixture = JSON.parse(await readFile(".local/p04-question-rules-fixture.json", "utf8")) as { userId: string; companyId: string; formId: string };
const person = people.people[1]; assert.equal(fixture.userId, person.id);
assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const cases: { label: string; status: number }[] = [], sessions = new Set<string>();
type Checkpoint = { tenantId: string; serviceId: string; purposeIds: string[]; recipientIds: string[]; firstPurpose: PurposeInput; firstRecipient: RecipientInput };
async function request(label: string, path: string, cookie = "", method = "GET", value?: unknown, expected = 200, extra: Record<string, string> = {}) {
  const result = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie, ...(method !== "GET" ? { origin } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }),
    ...(method === "POST" && ["/recipients", "/processing-purposes"].includes(path) ? { "idempotency-key": randomUUID() } : {}),
    ...extra }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(result.status, expected, label); cases.push({ label, status: result.status }); return result;
}
async function record<T>(label: string, path: string, cookie: string, method = "GET", value?: unknown, expected = 200, extra: Record<string, string> = {}) {
  return await (await request(label, path, cookie, method, value, expected, extra)).json() as T;
}
async function login() {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert.equal(user.status, "active"); assert.equal(user.platformAdmin, false);
  const result = await request("합성 소유자 로그인", "/auth/sign-in/email", "", "POST", { email: person.email, password: person.password });
  const cookie = result.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie); sessions.add(cookie);
  await request("시험 회사 선택", "/context", cookie, "POST", { companyId: fixture.companyId }); return cookie;
}
async function verifyStored(checkpoint: Checkpoint, cookie: string) {
  const { purposeIds, recipientIds, firstPurpose, firstRecipient } = checkpoint;
  const purpose = await record<PurposeRecord>("수집 목적 상세 재조회", "/processing-purposes/" + purposeIds[0], cookie);
  const recipient = await record<RecipientRecord>("수탁자 상세 재조회", "/recipients/" + recipientIds[0], cookie);
  assert.equal(purpose.status, "active"); assert.equal(recipient.status, "active"); assert.equal(purpose.version, 4); assert.equal(recipient.version, 4);
  assert.equal(purpose.retentionMode, "days"); assert.equal(purpose.retentionDays, 45); assert.equal(recipient.purpose, "접수·변경 알림 전달");
  assert.deepEqual(purpose.recipientIds, [recipient.id]);
  const history = await record<CatalogHistory>("수집 목적 개정본 조회", "/processing-purposes/" + purpose.id + "/history", cookie);
  const recipientHistory = await record<CatalogHistory>("수탁자 개정본 조회", "/recipients/" + recipient.id + "/history", cookie);
  assert.equal(history.total, 4); assert.equal(recipientHistory.total, 4);
  const first = history.items.find(row => row.version === 1)!.snapshot as PurposeRecord;
  assert.equal(first.retentionMode, "until_purpose"); assert.equal(first.retentionReason, firstPurpose.retentionReason);
  assert.equal(first.recipients[0].purpose, firstRecipient.purpose); assert.equal(first.recipients[0].version, 1);
  const rows = await db.processingPurpose.findMany({ where: { id: { in: purposeIds }, tenantId: checkpoint.tenantId }, include: { revisions: true, recipients: true } });
  const recipients = await db.recipient.findMany({ where: { id: { in: recipientIds }, tenantId: checkpoint.tenantId }, include: { revisions: true } });
  assert.equal(rows.length, 3); assert.equal(recipients.length, 3); assert(rows.every(row => row.serviceId === checkpoint.serviceId && row.status === "active"));
  assert(recipients.every(row => row.serviceId === checkpoint.serviceId && row.status === "active"));
  assert.equal(rows.reduce((sum, row) => sum + row.revisions.length, 0), 6); assert.equal(recipients.reduce((sum, row) => sum + row.revisions.length, 0), 6);
  assert.deepEqual(new Set(rows.map(row => row.retentionMode)), new Set(["days", "until_purpose", "statutory"]));
  assert.deepEqual(new Set(recipients.map(row => row.kind)), new Set(["processor", "third_party", "source"]));
  const events = await db.auditEvent.findMany({ where: { tenantId: checkpoint.tenantId, actorId: person.id, resourceId: { in: [...purposeIds, ...recipientIds] } } });
  assert.equal(events.length, 12);
  return { purposes: rows.length, recipients: recipients.length, purposeRevisions: 6, recipientRevisions: 6, auditCount: events.length,
    originalSnapshotPreserved: true, linkedRecipientVersionPreserved: true, allRetentionModes: true, allRecipientKinds: true, databaseMatchesHttp: true };
}
async function main() {
  const cookie = await login();
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId } }); assert.equal(form.tenantId, fixture.companyId);
    const service = await db.service.findUniqueOrThrow({ where: { id: form.serviceId } }); assert.equal(service.status, "active");
    const marker = "수집 QA " + randomUUID();
    const firstRecipient: RecipientInput = { serviceId: service.id, name: marker + " 해외 수탁자", kind: "processor", countryCode: "US", purpose: "접수 알림 전달", items: ["이름", "이메일"],
      retentionMode: "days", retentionDays: 30, retentionReason: "", contact: "qa@catchsecu.local.test", transferMethod: "암호화 API", transferTiming: "신청 시", refusalNotice: "동의 거부 시 국내 처리만 진행" };
    await request("국외 필수 연락처 차단", "/recipients", cookie, "POST", { ...firstRecipient, contact: "" }, 422);
    await request("미지원 국가 차단", "/recipients", cookie, "POST", { ...firstRecipient, countryCode: "INVALID" }, 422);
    const key = randomUUID();
    const recipient = await record<RecipientRecord>("국외 수탁자 생성", "/recipients", cookie, "POST", firstRecipient, 201, { "idempotency-key": key });
    const replay = await record<RecipientRecord>("같은 생성 키 재전송", "/recipients", cookie, "POST", firstRecipient, 201, { "idempotency-key": key }); assert.equal(replay.id, recipient.id);
    await request("같은 키의 다른 내용 거부", "/recipients", cookie, "POST", { ...firstRecipient, purpose: "다른 내용" }, 409, { "idempotency-key": key });
    await request("정규화 이름 중복 차단", "/recipients", cookie, "POST", { ...firstRecipient, name: firstRecipient.name.toUpperCase() }, 409);
    const domestic = await record<RecipientRecord>("국내 제3자 제공 생성", "/recipients", cookie, "POST", { ...firstRecipient, name: marker + " 국내 제공자", kind: "third_party", countryCode: "KR" }, 201);
    const source = await record<RecipientRecord>("원자료 제공자 생성", "/recipients", cookie, "POST", { ...firstRecipient, name: marker + " 원자료 제공자", kind: "source", countryCode: "KR" }, 201);
    const firstPurpose: PurposeInput = { serviceId: service.id, name: marker + " 신청 처리", purpose: "합성 상담 신청 처리", lawfulBasis: "consent", basisReference: "",
      items: [{ name: "이름", kind: "general", required: true }, { name: "이메일", kind: "general", required: false }], recipientIds: [recipient.id],
      retentionMode: "until_purpose", retentionDays: null, retentionReason: "상담 종료와 답변 전달이 끝난 때" };
    await request("종료 기준 누락 차단", "/processing-purposes", cookie, "POST", { ...firstPurpose, retentionReason: "" }, 422);
    await request("항목 이름 중복 차단", "/processing-purposes", cookie, "POST", { ...firstPurpose, items: [firstPurpose.items[0], firstPurpose.items[0]] }, 422);
    await request("계약 근거 설명 누락 차단", "/processing-purposes", cookie, "POST", { ...firstPurpose, lawfulBasis: "contract" }, 422);
    const purpose = await record<PurposeRecord>("목적 달성 보유 수집 목적 생성", "/processing-purposes", cookie, "POST", firstPurpose, 201);
    const until = await record<PurposeRecord>("계약 근거와 목적 달성 보유 생성", "/processing-purposes", cookie, "POST", { ...firstPurpose, name: marker + " 계약 처리", lawfulBasis: "contract", basisReference: "합성 상담 계약", recipientIds: [domestic.id] }, 201);
    const statutory = await record<PurposeRecord>("법령 근거와 별도 보존 기준 생성", "/processing-purposes", cookie, "POST", { ...firstPurpose, name: marker + " 법령 처리", lawfulBasis: "legal_obligation", basisReference: "QA 검증용 근거", retentionMode: "statutory", retentionReason: "합성 계약 분쟁 검토 종료 시", recipientIds: [source.id] }, 201);
    const foreign = await db.recipient.findFirst({ where: { tenantId: { not: fixture.companyId }, status: "active" } }); assert(foreign, "Separate-tenant fixture required.");
    await request("타회사 수탁자 연결 차단", "/processing-purposes", cookie, "POST", { ...firstPurpose, name: marker + " 잘못된 연결", recipientIds: [foreign.id] }, 422);
    const updatedRecipient = await record<RecipientRecord>("수탁자 처리 목적 수정", "/recipients/" + recipient.id, cookie, "PATCH", { ...firstRecipient, purpose: "접수·변경 알림 전달", version: 1 }); assert.equal(updatedRecipient.version, 2);
    await request("오래된 수탁자 버전 충돌", "/recipients/" + recipient.id, cookie, "PATCH", { ...firstRecipient, version: 1 }, 409);
    const updatedPurpose = await record<PurposeRecord>("수집 목적 보유 기간 수정", "/processing-purposes/" + purpose.id, cookie, "PATCH", { ...firstPurpose, retentionMode: "days", retentionDays: 45, retentionReason: "", version: 1 }); assert.equal(updatedPurpose.version, 2);
    await request("사용 중 수탁자 보관 차단", "/recipients/" + recipient.id, cookie, "DELETE", undefined, 409, { "if-match": "2" });
    await request("수집 목적 보관", "/processing-purposes/" + purpose.id, cookie, "DELETE", undefined, 204, { "if-match": "2" });
    await request("수탁자 보관", "/recipients/" + recipient.id, cookie, "DELETE", undefined, 204, { "if-match": "2" });
    await request("보관된 수탁자 연결 복원 차단", "/processing-purposes/" + purpose.id + "/restore", cookie, "POST", { version: 3 }, 422);
    await record<RecipientRecord>("수탁자 복원", "/recipients/" + recipient.id + "/restore", cookie, "POST", { version: 3 });
    await record<PurposeRecord>("수집 목적 복원", "/processing-purposes/" + purpose.id + "/restore", cookie, "POST", { version: 3 });
    const list = await record<{ total: number; items: PurposeRecord[] }>("같은 검색 목록 조회", "/processing-purposes?search=" + encodeURIComponent(marker), cookie); assert.equal(list.total, 3);
    await request("미인증 목록 거부", "/processing-purposes", "", "GET", undefined, 401);
    checkpoint = { tenantId: fixture.companyId, serviceId: service.id, purposeIds: [purpose.id, until.id, statutory.id], recipientIds: [recipient.id, domestic.id, source.id], firstPurpose, firstRecipient };
    await writeFile(".local/p05-catalog-checkpoint.json", JSON.stringify(checkpoint), { mode: 0o600 });
  } else checkpoint = JSON.parse(await readFile(".local/p05-catalog-checkpoint.json", "utf8")) as Checkpoint;
  const databaseReport = await verifyStored(checkpoint, cookie);
  await request("합성 세션 로그아웃", "/auth/sign-out", cookie, "POST", {}); sessions.delete(cookie);
  await request("로그아웃 쿠키 상세 차단", "/processing-purposes/" + checkpoint.purposeIds[0], cookie, "GET", undefined, 401);
  await writeFile("docs/qa/P05-T01/http-" + phase + ".json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases,
    database: databaseReport, matchesBeforeRestart: phase === "finish", syntheticSessionsClosed: true, userAdminAccountUntouched: true }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, ...databaseReport }));
}
try { await main(); } finally {
  for (const cookie of sessions) { const result: Response = await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }); assert.equal(result.status, 200); }
  await db.$disconnect();
}
