import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { fingerprint, versionInclude } from "../src/server/forms";
import type { FormDeletionState, FormRecord, Paged } from "../src/contracts/forms";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const person = source.people[1]; assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const foreign = JSON.parse(await readFile(".local/p05-catalog-checkpoint.json", "utf8")) as { tenantId: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cases: { label: string; status: number }[] = [];
let cookie = "";
async function request(label: string, path: string, method = "GET", input?: unknown, expected = 200, key?: string, anonymous = false, version?: number) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: {
    cookie: anonymous ? "" : cookie, ...(method === "GET" ? {} : { origin }),
    ...(input === undefined ? {} : { "content-type": "application/json" }),
    ...(key || method === "POST" ? { "idempotency-key": key ?? randomUUID() } : {}),
    ...(version === undefined ? {} : { "if-match": String(version) }),
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(response.status, expected, label + ": HTTP " + response.status);
  cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, method = "GET", input?: unknown, expected = 200, key?: string, anonymous = false) {
  return await (await request(label, path, method, input, expected, key, anonymous)).json() as T;
}
async function snapshot(tenantId: string, keys: string[]) {
  const forms = await db.form.findMany({ where: { tenantId }, select: { id: true, version: true, status: true, title: true, publishedVersionId: true }, orderBy: { id: "asc" } });
  const versions = await db.formVersion.findMany({ where: { tenantId }, include: versionInclude, orderBy: { id: "asc" } });
  const publications = await db.publication.findMany({ where: { tenantId }, select: { id: true, formId: true, formVersionId: true, status: true, responseCount: true }, orderBy: { id: "asc" } });
  const submissions = await db.submission.findMany({ where: { tenantId }, select: { id: true, formVersionId: true, publicationId: true, status: true, answers: { select: { id: true, questionId: true, valueCipher: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  const caches = await db.idempotencyRecord.findMany({ where: { key: { in: keys } }, orderBy: { id: "asc" } });
  const favorites = await db.formFavorite.findMany({ where: { tenantId }, select: { formId: true, memberId: true }, orderBy: [{ formId: "asc" }, { memberId: "asc" }] });
  const auditCount = await db.auditEvent.count({ where: { tenantId, resource: { in: ["form", "submission"] } } });
  return { forms, versions: versions.map(row => ({ id: row.id, formId: row.formId, status: row.status, hash: fingerprint(row), questionIds: row.questions.map(question => question.id) })), publications,
    submissions: submissions.map(row => ({ ...row, answers: row.answers.map(answer => ({ id: answer.id, questionId: answer.questionId, cipherHash: hash(answer.valueCipher) })) })),
    caches: caches.map(row => ({ id: row.id, resourceType: row.resourceType, resourceId: row.resourceId, invalidatedAt: row.invalidatedAt?.toISOString() ?? null, hasContent: !!row.responseCipher, hasRequestHash: !!row.requestHash })), favorites, auditCount };
}
type Checkpoint = { tenantId: string; serviceId: string; publishedId: string; purgedId: string; copyId: string; token: string;
  create: { input: object; key: string }; save: { input: object; key: string }; keys: string[];
  originalEvidence: { versionHash: string; cipherHash: string }; database: Awaited<ReturnType<typeof snapshot>> };
async function verify(c: Checkpoint) {
  const result = await data<Paged<FormRecord>>("보관 포함 목록의 페이지 보정", `/forms?serviceId=${c.serviceId}&status=all&page=999&pageSize=1&sort=name&direction=asc`);
  assert.equal(result.page, 2); assert.equal(result.total, 2);
  assert(result.items.every(row => row.publication?.token === undefined));
  const visible = await data<Paged<FormRecord>>("보관 제외 목록은 독립 복사본", "/forms?serviceId=" + c.serviceId);
  assert.equal(visible.total, 1); assert.equal(visible.items[0].id, c.copyId);
  const favorites = await data<Paged<FormRecord>>("즐겨찾기와 빈 페이지 복원", `/forms?serviceId=${c.serviceId}&favorite=true&page=999`);
  assert.equal(favorites.page, 1); assert.equal(favorites.total, 1); assert.equal(favorites.items[0].id, c.copyId);
  const eligibility = await data<FormDeletionState>("보관한 게시 폼의 삭제 사유", "/forms/" + c.publishedId + "/deletion");
  assert(!eligibility.canPurge); assert(eligibility.reasons.some(reason => reason.code === "PUBLISHED_EVIDENCE")); assert.equal(eligibility.references.submissions, 1);
  await request("참조된 폼 완전 삭제 차단", "/forms/" + c.publishedId + "/purge", "DELETE", undefined, 409, undefined, false, 3);
  await request("삭제된 초안 상세 없음", "/forms/" + c.purgedId, "GET", undefined, 404);
  await request("삭제된 생성 키 재전송 차단", "/forms", "POST", c.create.input, 410, c.create.key);
  await request("삭제된 저장 키 재전송 차단", "/forms/" + c.purgedId + "/draft", "PATCH", c.save.input, 410, c.save.key);
  await request("보관 후 공개 링크 종료", "/public/forms/" + c.token, "GET", undefined, 410, undefined, true);
  const actual = await snapshot(c.tenantId, c.keys);
  assert.deepEqual(actual, c.database);
  assert.equal(actual.forms.length, 2); assert.equal(actual.versions.length, 2); assert.equal(actual.submissions.length, 1);
  assert.equal(actual.versions.find(version => version.formId === c.publishedId)?.hash, c.originalEvidence.versionHash);
  assert.equal(actual.submissions[0].answers[0].cipherHash, c.originalEvidence.cipherHash);
  assert(actual.caches.filter(cache => cache.resourceId === c.purgedId).every(cache => cache.invalidatedAt && !cache.hasContent && !cache.hasRequestHash));
  assert.equal(await db.auditEvent.count({ where: { tenantId: c.tenantId, action: "form.purged", resourceId: c.purgedId } }), 1);
  return actual;
}
try {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(!user.platformAdmin && user.status === "active");
  const login = await request("합성 검증 계정 로그인", "/auth/sign-in/email", "POST", { email: person.email, password: person.password });
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie);
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const company = await data<{ id: string }>("독립 목록 시험 회사 생성", "/companies", "POST", { name: "P04 목록 검증 " + randomUUID(), publicName: "P04 목록 검증" }, 201);
    const services = await data<Paged<{ id: string }>>("시험 서비스 조회", "/services"); assert.equal(services.total, 1);
    const tenantId = company.id, serviceId = services.items[0].id;
    const content = { body: "목록·삭제 독립 검증", questions: [{ id: randomUUID(), type: "객관식 답변", label: "합성 선택", required: true, options: ["첫째", "둘째"] }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5 };
    const main = await data<FormRecord>("게시 대상 초안 생성", "/forms", "POST", { serviceId, title: "P04 목록 A 게시", content }, 201);
    const create = { input: { serviceId, title: "P04 목록 B 삭제", content }, key: randomUUID() };
    const draft = await data<FormRecord>("삭제 대상 초안 생성", "/forms", "POST", create.input, 201, create.key);
    const same = await data<FormRecord>("생성 키의 동일 결과", "/forms", "POST", create.input, 201, create.key); assert.equal(same.id, draft.id);
    const save = { input: { version: 1, title: "P04 목록 B 수정" }, key: randomUUID() };
    const saved = await data<FormRecord>("동일 초안 저장", "/forms/" + draft.id + "/draft", "PATCH", save.input, 200, save.key); assert.equal(saved.id, draft.id);
    const copyKey = randomUUID(), copy = await data<FormRecord>("독립 폼 복사", "/forms/" + draft.id + "/copy", "POST", { title: "P04 목록 C 독립" }, 201, copyKey);
    assert.notEqual(copy.id, draft.id); assert.notEqual(copy.content.questions[0].id, content.questions[0].id);
    const first = await data<Paged<FormRecord>>("첫 페이지 제목 오름차순", `/forms?serviceId=${serviceId}&pageSize=1&sort=name&direction=asc`); assert.equal(first.total, 3); assert.equal(first.items[0].id, main.id);
    const second = await data<Paged<FormRecord>>("두 번째 페이지 독립 조회", `/forms?serviceId=${serviceId}&page=2&pageSize=1&sort=name&direction=asc`); assert.equal(second.items[0].id, draft.id);
    const last = await data<Paged<FormRecord>>("범위 밖 페이지를 마지막으로 보정", `/forms?serviceId=${serviceId}&page=999&pageSize=1&sort=name&direction=asc`); assert.equal(last.page, 3); assert.equal(last.items[0].id, copy.id);
    const search = await data<Paged<FormRecord>>("검색 뒤 page 보정", `/forms?serviceId=${serviceId}&search=B%20수정&page=2`); assert.equal(search.page, 1); assert.equal(search.items[0].id, draft.id);
    const empty = await data<Paged<FormRecord>>("검색 빈 목록은 첫 페이지", `/forms?serviceId=${serviceId}&search=존재하지않음&page=999`); assert.equal(empty.page, 1); assert.equal(empty.total, 0);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    assert.equal((await data<Paged<FormRecord>>("한국 날짜 기간 검색", `/forms?serviceId=${serviceId}&start=${today}&end=${today}`)).total, 3);
    await request("역순 기간 검증", "/forms?start=2026-10-03&end=2026-10-02", "GET", undefined, 422);
    await request("알 수 없는 목록 파라미터 차단", "/forms?unknown=true", "GET", undefined, 422);
    await request("즐겨찾기 등록", "/forms/" + copy.id + "/favorite", "PUT");
    await request("즐겨찾기 해제", "/forms/" + copy.id + "/favorite", "DELETE", undefined, 204);
    await request("즐겨찾기 재등록", "/forms/" + copy.id + "/favorite", "PUT");
    const eligibility = await data<FormDeletionState>("미참조 초안 삭제 가능", "/forms/" + draft.id + "/deletion"); assert(eligibility.canPurge);
    await request("If-Match 없는 삭제 차단", "/forms/" + draft.id + "/purge", "DELETE", undefined, 422);
    await request("오래된 version 삭제 차단", "/forms/" + draft.id + "/purge", "DELETE", undefined, 409, undefined, false, 1);
    await request("미참조 초안 완전 삭제", "/forms/" + draft.id + "/purge", "DELETE", undefined, 204, undefined, false, 2);
    const publication = await data<{ token: string }>("초안 게시", "/forms/" + main.id + "/publish", "POST", { version: 1 }, 201);
    await request("공개 응답 원자 저장", "/public/forms/" + publication.token + "/submissions", "POST", { answers: { [content.questions[0].id]: "첫째" }, consent: false }, 201, randomUUID(), true);
    const initial = await snapshot(tenantId, [create.key, save.key, copyKey]);
    const originalEvidence = { versionHash: initial.versions.find(version => version.formId === main.id)!.hash, cipherHash: initial.submissions[0].answers[0].cipherHash };
    await request("게시 폼 보관", "/forms/" + main.id, "DELETE", undefined, 204, undefined, false, 2);
    const preview = await data<FormRecord>("복사본 미리보기용 상세", "/forms/" + copy.id); assert.equal(preview.content.questions.length, 1);
    await request("다른 시험 회사 선택", "/context", "POST", { companyId: foreign.tenantId });
    await request("다른 회사의 폼 상세 차단", "/forms/" + copy.id, "GET", undefined, 404);
    await request("다른 회사의 폼 삭제 차단", "/forms/" + copy.id + "/purge", "DELETE", undefined, 404, undefined, false, 1);
    await request("목록 시험 회사 복귀", "/context", "POST", { companyId: tenantId });
    await request("익명 목록 차단", "/forms", "GET", undefined, 401, undefined, true);
    checkpoint = { tenantId, serviceId, publishedId: main.id, purgedId: draft.id, copyId: copy.id, token: publication.token, create, save, keys: [create.key, save.key, copyKey], originalEvidence, database: await snapshot(tenantId, [create.key, save.key, copyKey]) };
    await writeFile(".local/p04-list-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
  } else {
    checkpoint = JSON.parse(await readFile(".local/p04-list-checkpoint.json", "utf8"));
    assert((await db.company.findUniqueOrThrow({ where: { id: checkpoint.tenantId } })).name.startsWith("P04 목록 검증 "));
    await request("재시작 후 시험 회사 선택", "/context", "POST", { companyId: checkpoint.tenantId });
  }
  const independentDatabase = await verify(checkpoint);
  await request("합성 시험 세션 종료", "/auth/sign-out", "POST", {}); cookie = "";
  await writeFile(`docs/qa/P04-T04/http-${phase}.json`, JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, independentDatabase,
    actualUiVerified: false, matchesBeforeRestart: phase === "finish", syntheticSessionsClosed: true, userAdminAccountUntouched: true }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, forms: independentDatabase.forms.length, submissions: independentDatabase.submissions.length, auditCount: independentDatabase.auditCount }));
} finally {
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
