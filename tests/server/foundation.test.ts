import { GET as templateList, POST as templateCreate } from "@/app/api/v1/templates/route";
import { GET as templateGet, PATCH as templatePatchRoute, POST as templateUse, DELETE as templateDelete } from "@/app/api/v1/templates/[...segments]/route";
import { GET as memberList } from "@/app/api/v1/members/route";
import { GET as memberGet, PATCH as memberPatch, DELETE as memberDelete, POST as memberTransfer } from "@/app/api/v1/members/[...segments]/route";
import { GET as inviteList, POST as createInvite } from "@/app/api/v1/invitations/route";
import { POST as inviteAction, DELETE as inviteRevoke } from "@/app/api/v1/invitations/[...segments]/route";
import { safeReturnTo, authPath } from "@/lib/return-to";
import { GET as submissionRoute, PATCH as correctSubmissionRoute, POST as submissionAction, DELETE as deleteSubmissionNote } from "@/app/api/v1/submissions/[...segments]/route";
import { GET as listFormRoute } from "@/app/api/v1/forms/route";
import { PUT as favoriteFormRoute } from "@/app/api/v1/forms/[...segments]/route";
import { GET as listFixedRoute, POST as createFixedRoute } from "@/app/api/v1/fixed-urls/route";
import { GET as fixedRoute, PATCH as patchFixedRoute, DELETE as deleteFixedRoute } from "@/app/api/v1/fixed-urls/[id]/route";
import { GET as resolveFixedRoute } from "@/app/api/v1/public/urls/[slug]/route";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { decrypt, encrypt } from "@/server/crypto";
import { runOneJob, claimJob } from "@/server/jobs";
import { idempotent } from "@/server/idempotency";
import { rateLimit } from "@/server/http";
import { GET as health } from "@/app/api/v1/health/route";
import { GET as context } from "@/app/api/v1/context/route";
import { GET as services, POST as createService } from "@/app/api/v1/services/route";
import { GET as service, PATCH as patchService, DELETE as deleteService } from "@/app/api/v1/services/[id]/route";
import { POST as createFormRoute } from "@/app/api/v1/forms/route";
import { GET as formRoute, PATCH as patchFormRoute, POST as formAction, DELETE as deleteFormRoute } from "@/app/api/v1/forms/[...segments]/route";
import { GET as readPublicForm, POST as submitPublicForm } from "@/app/api/v1/public/forms/[...segments]/route";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Refusing to run destructive fixtures outside the isolated test DB.");
const origin = env.BETTER_AUTH_URL;
const password = "Test-only-password!123";
const ids: Record<"a" | "b" | "owner" | "viewer" | "foreign", string> = { a: randomUUID(), b: randomUUID(), owner: randomUUID(), viewer: randomUUID(), foreign: randomUUID() };
let ownerCookie = "", viewerCookie = "", foreignCookie = "", serviceId = "";
function request(path: string, method = "GET", cookie = "", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}), ...extra },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function authCall(path: string, value?: unknown, cookie = "") { return auth.handler(request("/auth" + path, value === undefined ? "GET" : "POST", cookie, value)); }
async function signin(email: string) {
  const response = await authCall("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return cookies(response);
}
async function createUser(id: string, email: string, tenantId: string, role: "owner" | "viewer") {
  const response = await authCall("/sign-up/email", { name: role, email, password });
  expect(response.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  ids[id as keyof typeof ids] = user.id;
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  await db.membership.create({ data: { userId: user.id, tenantId, role } });
}
beforeAll(async () => {
  // TRUNCATE is permitted only by the exact test DB guard above.
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: ids.a, name: "A", publicName: "A", policy: { create: {} } } });
  await db.company.create({ data: { id: ids.b, name: "B", publicName: "B", policy: { create: {} } } });
  await createUser("owner", "owner-a@test.local", ids.a, "owner");
  await createUser("viewer", "viewer-a@test.local", ids.a, "viewer");
  await createUser("foreign", "owner-b@test.local", ids.b, "owner");
  ownerCookie = await signin("owner-a@test.local");
  viewerCookie = await signin("viewer-a@test.local");
  foreignCookie = await signin("owner-b@test.local");
  await db.rateLimit.deleteMany();
  await db.job.updateMany({ data: { status: "cancelled" } });
});
afterAll(async () => { await db.$disconnect(); });

describe("PostgreSQL / sessions / tenant boundaries", () => {
  test("actual database health and unsigned access rejection", async () => {
    expect(await (await health(request("/health"))).json()).toEqual({ status: "ok", database: "ready" });
    expect((await context(request("/context"))).status).toBe(401);
    const response = await context(request("/context", "GET", ownerCookie));
    expect(response.status).toBe(200);
    expect((await response.json()).company.id).toBe(ids.a);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
  test("incorrect passwords and suspended accounts cannot create a session", async () => {
    const invalid = await authCall("/sign-in/email", { email: "owner-a@test.local", password: "incorrect" });
    expect(invalid.status).toBe(401);
    await db.user.update({ where: { id: ids.foreign }, data: { status: "suspended" } });
    const suspended = await authCall("/sign-in/email", { email: "owner-b@test.local", password });
    expect(suspended.status).toBe(403);
    expect((await context(request("/context", "GET", foreignCookie))).status).toBe(401);
    await db.user.update({ where: { id: ids.foreign }, data: { status: "active" } });
  });
  test("service create/read/update/archive is durable and rejects stale edits", async () => {
    const created = await createService(request("/services", "POST", ownerCookie, { name: "연동 검증", externalName: "공개 이름", type: "app", description: "보존할 소개" }));
    expect(created.status).toBe(201);
    const value = await created.json(); serviceId = value.id;
    expect(await db.service.findUnique({ where: { id: value.id } })).toMatchObject({ tenantId: ids.a, name: "연동 검증" });
    expect((await service(request("/services/" + value.id, "GET", ownerCookie))).status).toBe(200);
    const changed = await patchService(request("/services/" + value.id, "PATCH", ownerCookie, { version: 1, name: "변경 완료" }));
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ version: 2, type: "app", description: "보존할 소개" });
    expect((await patchService(request("/services/" + value.id, "PATCH", ownerCookie, { version: 1, name: "오래된 편집" }))).status).toBe(409);
    const listed = await (await services(request("/services?search=변경", "GET", ownerCookie))).json();
    expect(listed.total).toBe(1);
    expect((await deleteService(request("/services/" + value.id, "DELETE", ownerCookie, undefined, { "if-match": "2" }))).status).toBe(204);
    expect(await db.service.findUnique({ where: { id: value.id } })).toMatchObject({ status: "archived", version: 3 });
    expect((await (await services(request("/services", "GET", ownerCookie))).json()).total).toBe(0);
    expect(await db.auditEvent.count({ where: { resourceId: value.id } })).toBe(3);
  });
  test("other tenant, viewer writes, malformed input and foreign Origin are rejected", async () => {
    expect((await service(request("/services/" + serviceId, "GET", foreignCookie))).status).toBe(404);
    expect((await createService(request("/services", "POST", viewerCookie, { name: "금지", externalName: "금지" }))).status).toBe(403);
    expect((await createService(request("/services", "POST", ownerCookie, { name: "", externalName: "이름" }))).status).toBe(422);
    expect((await createService(request("/services", "POST", ownerCookie, { name: "X", externalName: "X" }, { origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await (await services(request("/services?status=all", "GET", foreignCookie))).json()).total).toBe(0);
  });
  test("database rejects cross-company grants, duplicate names and mutable audit events", async () => {
    const member = await db.membership.findFirstOrThrow({ where: { tenantId: ids.b } });
    await expect(db.serviceGrant.create({ data: { tenantId: ids.a, memberId: member.id, serviceId, capabilities: ["service.read"] } })).rejects.toThrow();
    await expect(db.service.create({ data: { tenantId: ids.a, name: "변경 완료", externalName: "중복" } })).rejects.toThrow();
    const event = await db.auditEvent.findFirstOrThrow();
    await expect(db.auditEvent.update({ where: { id: event.id }, data: { action: "forged" } })).rejects.toThrow();
  });
  test("two simultaneous edits allow exactly one version update", async () => {
    const created = await (await createService(request("/services", "POST", ownerCookie, { name: "동시 편집", externalName: "동시 편집" }))).json();
    const responses = await Promise.all(["first", "second"].map(name => patchService(request("/services/" + created.id, "PATCH", ownerCookie, { version: 1, name }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  });
  test("idempotent parallel requests perform one mutation and reject a changed payload", async () => {
    const key = randomUUID(), scope = "test:" + ids.a;
    let count = 0;
    const operation = async () => { count++; return { status: 201, body: { id: randomUUID() } }; };
    const responses = await Promise.all([idempotent(scope, key, { amount: 10 }, operation), idempotent(scope, key, { amount: 10 }, operation)]);
    expect(count).toBe(1);
    expect(responses[0]).toEqual(responses[1]);
    await expect(idempotent(scope, key, { amount: 11 }, operation)).rejects.toMatchObject({ status: 409 });
  });
  test("worker claim is exclusive, an expired lease recovers and local delivery is durable", async () => {
    const job = await db.job.create({ data: { type: "mail", payloadCipher: encrypt({ to: "mail@test.local", subject: "lease", text: "durable" }), dedupeKey: randomUUID() } });
    const claims = await Promise.all([claimJob("worker-a"), claimJob("worker-b")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db.job.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 10000) } });
    expect(await runOneJob("worker-restarted")).toBe(true);
    expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "done", attempts: 2 });
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
    expect(mail.text).toBe("durable");
  });
  test("UTC queue deadlines and active leases are not shifted by the database server time zone", async () => {
    const zone = await db.$queryRaw<{ timezone: string }[]>`SELECT current_setting('TimeZone') AS timezone`;
    expect(zone[0].timezone).toBe("UTC");
    const job = await db.job.create({ data: { type: "mail", payloadCipher: encrypt({ to: "scheduled@test.local", subject: "future", text: "schedule" }),
      dueAt: new Date(Date.now() + 5 * 60000), dedupeKey: randomUUID() } });
    expect(await claimJob("early-worker")).toBeUndefined();
    await db.job.update({ where: { id: job.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const start = Date.now(); expect((await claimJob("on-time-worker"))?.id).toBe(job.id);
    const leased = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(leased.leaseUntil!.getTime()).toBeGreaterThanOrEqual(start + 59900);
    expect(leased.leaseUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
    expect(await claimJob("second-worker")).toBeUndefined();
    await db.job.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1) } });
    expect(await runOneJob("recovered-worker")).toBe(true);
    const before = Date.now(); await rateLimit("utc-clock-test", 5);
    const limited = await db.apiRateLimit.findUniqueOrThrow({ where: { key: "utc-clock-test" } });
    expect(limited.resetAt.getTime()).toBeGreaterThanOrEqual(before + 59900);
    expect(limited.resetAt.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
  });
  test("logout revokes database session and refuses the old cookie", async () => {
    const cookie = await signin("owner-b@test.local");
    expect((await authCall("/sign-out", {}, cookie)).status).toBe(200);
    expect((await context(request("/context", "GET", cookie))).status).toBe(401);
  });
  test("tenant inactivity timeout is checked before refreshing the session", async () => {
    const cookie = await signin("owner-b@test.local");
    await db.session.updateMany({ where: { userId: ids.foreign }, data: { updatedAt: new Date(Date.now() - 61 * 60000) } });
    expect((await context(request("/context", "GET", cookie))).status).toBe(401);
    expect(await db.session.count({ where: { userId: ids.foreign } })).toBeLessThanOrEqual(1);
  });
});


describe("immutable forms and encrypted public submissions", () => {
  let formId = "", token = "", activeServiceId = "";
  const questionId = randomUUID(), optionId = randomUUID();
  const content = { body: "설문 본문", questions: [
    { id: questionId, type: "단문형 답변", label: "이름", required: true },
    { id: optionId, type: "객관식 답변", label: "선호", required: true, options: ["예", "아니요"] },
  ], consentRequired: true, consentPurpose: "참가 신청", retentionDays: 365, maxResponses: 1 };
  const answers = { [questionId]: "암호화 시험 응답", [optionId]: "예" };
  test("create and publish a validated immutable snapshot", async () => {
    const service = await createService(request("/services", "POST", ownerCookie, { name: "폼 서비스", externalName: "폼 서비스" }));
    activeServiceId = (await service.json()).id;
    const response = await createFormRoute(request("/forms", "POST", ownerCookie, { serviceId: activeServiceId, title: "원본 제목", content }, { "idempotency-key": randomUUID() }));
    expect(response.status).toBe(201);
    formId = (await response.json()).id;
    expect((await readPublicForm(request("/public/forms/" + formId))).status).toBe(404);
    const published = await formAction(request("/forms/" + formId + "/publish", "POST", ownerCookie, { version: 1 }, { "idempotency-key": randomUUID() }));
    expect(published.status).toBe(201);
    token = (await published.json()).token;
    const publicResponse = await readPublicForm(request("/public/forms/" + token));
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).title).toBe("원본 제목");
    const publication = await db.publication.findFirstOrThrow({ where: { formId } });
    expect(publication.tokenHash).not.toContain(token);
    expect(publication.tokenCipher).not.toContain(token);
  });
  test("published fields, questions and options cannot be altered in the database", async () => {
    const version = await db.formVersion.findFirstOrThrow({ where: { formId, status: "published" }, include: { questions: { include: { options: true } } } });
    await expect(db.formVersion.update({ where: { id: version.id }, data: { body: "변조" } })).rejects.toThrow();
    await expect(db.question.update({ where: { id: version.questions[0].id }, data: { label: "변조" } })).rejects.toThrow();
    const option = version.questions.flatMap(question => question.options)[0];
    await expect(db.questionOption.update({ where: { id: option.id }, data: { value: "변조" } })).rejects.toThrow();
    await expect(db.question.create({ data: { tenantId: ids.a, formVersionId: version.id, stableKey: randomUUID(), type: "단문형 답변", label: "추가 변조", required: true, order: 99 } })).rejects.toThrow();
  });
  test("editing a published form creates a new draft while its public snapshot stays unchanged", async () => {
    const updated = await patchFormRoute(request("/forms/" + formId, "PATCH", ownerCookie, { version: 2, title: "수정 제목", content: { ...content, body: "새 본문" } }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ version: 3, hasDraft: true, draftNumber: 2 });
    const published = await (await readPublicForm(request("/public/forms/" + token))).json();
    expect(published.title).toBe("원본 제목");
    expect(published.content.body).toBe("설문 본문");
    expect((await patchFormRoute(request("/forms/" + formId, "PATCH", ownerCookie, { version: 2, title: "경합" }))).status).toBe(409);
    expect(await db.formVersion.count({ where: { formId } })).toBe(2);
  });
  test("consent, question ownership, option values and answer types are checked on the server", async () => {
    const submit = (payload: unknown) => submitPublicForm(request("/public/forms/" + token + "/submissions", "POST", "", payload, { "idempotency-key": randomUUID() }));
    expect((await submit({ answers, consent: false })).status).toBe(422);
    expect((await submit({ answers: { ...answers, [randomUUID()]: "위조" }, consent: true })).status).toBe(422);
    expect((await submit({ answers: { ...answers, [optionId]: "잘못된 선택지" }, consent: true })).status).toBe(422);
    expect((await submit({ answers: { ...answers, [questionId]: ["타입 변조"] }, consent: true })).status).toBe(422);
    expect(await db.submission.count({ where: { publication: { formId } } })).toBe(0);
  });
  test("two concurrent submissions cannot exceed the response limit; retry is idempotent", async () => {
    const key = randomUUID(), payload = { answers, consent: true };
    const path = "/public/forms/" + token + "/submissions";
    const responses = await Promise.all([
      submitPublicForm(request(path, "POST", "", payload, { "idempotency-key": key })),
      submitPublicForm(request(path, "POST", "", payload, { "idempotency-key": key })),
      submitPublicForm(request(path, "POST", "", payload, { "idempotency-key": randomUUID() })),
    ]);
    const statuses = responses.map(response => response.status);
    expect(statuses.includes(201)).toBe(true);
    expect(await db.submission.count({ where: { publication: { formId } } })).toBe(1);
    expect((await db.publication.findFirstOrThrow({ where: { formId } })).responseCount).toBe(1);
    if (statuses[0] === 201) {
      expect(statuses[1]).toBe(201);
      expect(await responses[0].json()).toEqual(await responses[1].json());
      expect(statuses[2]).toBe(409);
    } else { expect(statuses.slice(0, 2)).toEqual([409, 409]); expect(statuses[2]).toBe(201); }
  });
  test("responses are encrypted at rest and visible only to the permitted company and role", async () => {
    const answer = await db.answer.findFirstOrThrow({ where: { submission: { publication: { formId } }, question: { stableKey: questionId } } });
    expect(answer.valueCipher).not.toContain(answers[questionId]);
    expect(decrypt(answer.valueCipher)).toBe(answers[questionId]);
    const response = await formRoute(request("/forms/" + formId + "/submissions", "GET", ownerCookie));
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].values).toEqual(answers);
    expect((await formRoute(request("/forms/" + formId + "/submissions", "GET", viewerCookie))).status).toBe(403);
    // The old foreign cookie expired in the previous timeout test; make a new valid session.
    foreignCookie = await signin("owner-b@test.local");
    expect((await formRoute(request("/forms/" + formId + "/submissions", "GET", foreignCookie))).status).toBe(404);
    expect(await db.consentReceipt.count({ where: { submission: { publication: { formId } } } })).toBe(1);
  });
  test("a different tenant cannot supply a parent service or a question from another version", async () => {
    const denied = await createFormRoute(request("/forms", "POST", foreignCookie, { serviceId: activeServiceId, title: "침범", content }, { "idempotency-key": randomUUID() }));
    expect(denied.status).toBe(404);
    const submission = await db.submission.findFirstOrThrow({ where: { publication: { formId } } });
    const draft = await db.formVersion.findFirstOrThrow({ where: { formId, status: "draft" }, include: { questions: true } });
    await expect(db.answer.create({ data: { tenantId: ids.a, submissionId: submission.id, formVersionId: submission.formVersionId,
      questionId: draft.questions[0].id, valueType: "단문형 답변", valueCipher: encrypt("잘못된 참조") } })).rejects.toThrow();
  });
  test("republishing revokes the old token while preserving old responses; archive closes the new token", async () => {
    const published = await formAction(request("/forms/" + formId + "/publish", "POST", ownerCookie, { version: 3 }, { "idempotency-key": randomUUID() }));
    expect(published.status).toBe(201);
    const latest = await published.json();
    expect((await readPublicForm(request("/public/forms/" + token))).status).toBe(410);
    expect((await (await readPublicForm(request("/public/forms/" + latest.token))).json()).title).toBe("수정 제목");
    expect(await db.submission.count({ where: { publication: { formId } } })).toBe(1);
    expect((await deleteFormRoute(request("/forms/" + formId, "DELETE", ownerCookie, undefined, { "if-match": "4" }))).status).toBe(204);
    expect((await readPublicForm(request("/public/forms/" + latest.token))).status).toBe(410);
  });
  test("form listing and favorites are scoped, paginated and filter on the server", async () => {
    const member = await db.membership.findFirstOrThrow({ where: { userId: ids.viewer, tenantId: ids.a } });
    const query = "/forms?status=all&serviceId=" + activeServiceId;
    expect((await listFormRoute(request(query, "GET", viewerCookie))).status).toBe(403);
    await db.serviceGrant.create({ data: { tenantId: ids.a, memberId: member.id, serviceId: activeServiceId, capabilities: ["form.read", "service.read"] } });
    expect((await favoriteFormRoute(request("/forms/" + formId + "/favorite", "PUT", viewerCookie))).status).toBe(200);
    const own = await (await listFormRoute(request(query + "&favorite=true&pageSize=1&sort=name&direction=asc", "GET", viewerCookie))).json();
    expect(own.total).toBe(1);
    expect(own.items[0]).toMatchObject({ id: formId, favorite: true, serviceName: "폼 서비스" });
    expect((await (await listFormRoute(request(query + "&favorite=true", "GET", ownerCookie))).json()).total).toBe(0);
    expect((await (await listFormRoute(request(query + "&start=2099-01-01", "GET", ownerCookie))).json()).total).toBe(0);
    expect((await listFormRoute(request(query + "&start=2026-12-01&end=2026-01-01", "GET", ownerCookie))).status).toBe(422);
    expect((await favoriteFormRoute(request("/forms/" + formId + "/favorite", "PUT", foreignCookie))).status).toBe(404);
    expect((await deleteFormRoute(request("/forms/" + formId + "/favorite", "DELETE", viewerCookie))).status).toBe(204);
  });
  let copiedId = "", copiedToken = "", aliasId = "", aliasSlug = "";
  test("copy has its own editable draft and idempotent publication; pause/resume gates public reads", async () => {
    const key = randomUUID(), path = "/forms/" + formId + "/copy";
    const responses = await Promise.all([1, 2].map(() => formAction(request(path, "POST", ownerCookie, { title: "고정 URL 시험" }, { "idempotency-key": key }))));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const first = await responses[0].json(), second = await responses[1].json();
    copiedId = first.id; expect(second.id).toBe(copiedId);
    expect(first.id).not.toBe(formId);
    expect(first).toMatchObject({ hasDraft: true, version: 1, publication: null });
    const published = await formAction(request("/forms/" + copiedId + "/publish", "POST", ownerCookie, { version: 1 }, { "idempotency-key": randomUUID() }));
    expect(published.status).toBe(201); copiedToken = (await published.json()).token;
    const viewer = await (await formRoute(request("/forms/" + copiedId, "GET", viewerCookie))).json();
    expect(viewer.publication.token).toBeUndefined();
    expect((await formAction(request("/forms/" + copiedId + "/pause", "POST", ownerCookie, { version: 2 }))).status).toBe(200);
    expect((await readPublicForm(request("/public/forms/" + copiedToken))).status).toBe(410);
    expect((await formAction(request("/forms/" + copiedId + "/resume", "POST", ownerCookie, { version: 3 }))).status).toBe(200);
    expect((await readPublicForm(request("/public/forms/" + copiedToken))).status).toBe(200);
  });
  test("fixed URL create/read validates scope, payload, uniqueness and retry", async () => {
    const key = randomUUID(), payload = { name: "고정 링크", formId: copiedId, slug: "test-" + randomUUID() };
    aliasSlug = payload.slug;
    const response = await createFixedRoute(request("/fixed-urls", "POST", ownerCookie, payload, { "idempotency-key": key }));
    expect(response.status).toBe(201); aliasId = (await response.json()).id;
    const retried = await createFixedRoute(request("/fixed-urls", "POST", ownerCookie, payload, { "idempotency-key": key }));
    expect(retried.status).toBe(201); expect((await retried.json()).id).toBe(aliasId);
    expect((await createFixedRoute(request("/fixed-urls", "POST", ownerCookie, payload, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect((await createFixedRoute(request("/fixed-urls", "POST", ownerCookie, { ...payload, slug: "../escape" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await fixedRoute(request("/fixed-urls/" + aliasId, "GET", foreignCookie))).status).toBe(404);
    expect((await createFixedRoute(request("/fixed-urls", "POST", viewerCookie, payload, { "idempotency-key": randomUUID() }))).status).toBe(403);
    expect((await (await listFixedRoute(request("/fixed-urls?search=고정&pageSize=1", "GET", ownerCookie))).json()).total).toBe(1);
    const publicResult = await resolveFixedRoute(request("/public/urls/" + aliasSlug));
    expect(publicResult.status).toBe(200);
    expect((await publicResult.json()).token).toBe(copiedToken);
  });
  test("fixed URL follows republishing, supports versioned edits and is revoked immediately", async () => {
    expect((await patchFormRoute(request("/forms/" + copiedId, "PATCH", ownerCookie, { version: 4, title: "새 게시 제목" }))).status).toBe(200);
    const published = await formAction(request("/forms/" + copiedId + "/publish", "POST", ownerCookie, { version: 5 }, { "idempotency-key": randomUUID() }));
    expect(published.status).toBe(201);
    const resolved = await (await resolveFixedRoute(request("/public/urls/" + aliasSlug))).json();
    expect(resolved.title).toBe("새 게시 제목"); expect(resolved.token).not.toBe(copiedToken);
    expect((await readPublicForm(request("/public/forms/" + copiedToken))).status).toBe(410);
    const current = await (await fixedRoute(request("/fixed-urls/" + aliasId, "GET", ownerCookie))).json();
    expect(current.version).toBe(2);
    expect((await patchFixedRoute(request("/fixed-urls/" + aliasId, "PATCH", ownerCookie, { version: 2, name: "수정한 링크" }))).status).toBe(200);
    expect((await patchFixedRoute(request("/fixed-urls/" + aliasId, "PATCH", ownerCookie, { version: 2, name: "충돌" }))).status).toBe(409);
    expect((await deleteFixedRoute(request("/fixed-urls/" + aliasId, "DELETE", ownerCookie, undefined, { "if-match": "3" }))).status).toBe(204);
    expect((await resolveFixedRoute(request("/public/urls/" + aliasSlug))).status).toBe(410);
    expect((await db.fixedUrl.findUniqueOrThrow({ where: { id: aliasId } })).status).toBe("revoked");
  });

  let submissionId = "";
  test("correction checks answer rules, keeps encrypted original history and rejects stale updates", async () => {
    const row = await db.submission.findFirstOrThrow({ where: { publication: { formId } } }); submissionId = row.id;
    const path = "/submissions/" + submissionId;
    expect((await submissionRoute(request(path, "GET", foreignCookie))).status).toBe(404);
    expect((await submissionRoute(request(path, "GET", viewerCookie))).status).toBe(403);
    expect((await correctSubmissionRoute(request(path, "PATCH", ownerCookie, { version: 1, reason: "수정", answers: { [optionId]: "변조" } }))).status).toBe(422);
    const result = await Promise.all(["정정한 이름", "다른 이름"].map(value => correctSubmissionRoute(request(path, "PATCH", ownerCookie,
      { version: 1, reason: "참가자가 요청한 정정", answers: { [questionId]: value } }))));
    expect(result.map(response => response.status).sort()).toEqual([200, 409]);
    const detail = await (await submissionRoute(request(path, "GET", ownerCookie))).json();
    expect(detail.version).toBe(2); expect(detail.status).toBe("corrected");
    expect(detail.corrections).toHaveLength(1);
    expect(detail.corrections[0].before[questionId]).toBe(answers[questionId]);
    expect(detail.corrections[0].after[questionId]).toBe(detail.values[questionId]);
    expect(detail.corrections[0].reason).toBe("참가자가 요청한 정정");
    const history = await db.correction.findFirstOrThrow({ where: { submissionId }, include: { payload: true } });
    expect(history.reason).toBe("answers_corrected");
    expect(history.payload!.beforeCipher).not.toContain(answers[questionId]);
    expect(history.payload!.beforeCipher).not.toContain("참가자가 요청한 정정");
    await expect(db.correctionPayload.update({ where: { id: history.payload!.id }, data: { beforeCipher: encrypt("변조") } })).rejects.toThrow();
    expect(detail.receipts[0].events).toHaveLength(1);
  });
  test("encrypted notes have real create, read, edit and delete with tenant and parent boundaries", async () => {
    const path = "/submissions/" + submissionId + "/notes", payload = { text: "관리자 확인 메모" }, key = randomUUID();
    const response = await submissionAction(request(path, "POST", ownerCookie, payload, { "idempotency-key": key }));
    expect(response.status).toBe(201); const note = await response.json();
    expect((await (await submissionAction(request(path, "POST", ownerCookie, payload, { "idempotency-key": key }))).json()).id).toBe(note.id);
    expect((await db.submissionNote.findUniqueOrThrow({ where: { id: note.id } })).textCipher).not.toContain(payload.text);
    expect((await submissionAction(request(path, "POST", viewerCookie, payload, { "idempotency-key": randomUUID() }))).status).toBe(403);
    expect((await correctSubmissionRoute(request(path + "/" + note.id, "PATCH", foreignCookie, { version: 1, text: "금지" }))).status).toBe(404);
    const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: copiedId, status: "active" } })).tokenCipher);
    const extra = await submitPublicForm(request("/public/forms/" + token + "/submissions", "POST", "", { answers, consent: true }, { "idempotency-key": randomUUID() }));
    expect(extra.status).toBe(201); const extraId = (await extra.json()).id;
    expect((await correctSubmissionRoute(request("/submissions/" + extraId + "/notes/" + note.id, "PATCH", ownerCookie, { version: 1, text: "다른 응답" }))).status).toBe(404);
    expect((await correctSubmissionRoute(request(path + "/" + note.id, "PATCH", ownerCookie, { version: 1, text: "변경 메모" }))).status).toBe(200);
    expect((await correctSubmissionRoute(request(path + "/" + note.id, "PATCH", ownerCookie, { version: 1, text: "경합" }))).status).toBe(409);
    const detail = await (await submissionRoute(request("/submissions/" + submissionId, "GET", ownerCookie))).json();
    expect(detail.notes[0]).toMatchObject({ text: "변경 메모", version: 2 });
    expect((await deleteSubmissionNote(request(path + "/" + note.id, "DELETE", ownerCookie, undefined, { "if-match": "2" }))).status).toBe(204);
    expect(await db.submissionNote.findUnique({ where: { id: note.id } })).toBeNull();
  });
  test("withdrawal is immutable, hold blocks destruction requests, and pending destruction does not pretend data was erased", async () => {
    const path = "/submissions/" + submissionId;
    expect((await submissionAction(request(path + "/hold", "POST", ownerCookie, { version: 2, reason: "분쟁 확인", hold: true }))).status).toBe(200);
    const held = await submissionAction(request(path + "/destruction-request", "POST", ownerCookie, { version: 3, reason: "파기 요청" }));
    expect(held.status).toBe(409); expect((await held.json()).error.code).toBe("LEGAL_HOLD");
    expect((await submissionAction(request(path + "/hold", "POST", ownerCookie, { version: 3, reason: "보존 종료", hold: false }))).status).toBe(200);
    expect((await submissionAction(request(path + "/withdraw", "POST", ownerCookie, { version: 4, reason: "정보주체 철회 요청" }))).status).toBe(200);
    expect((await submissionAction(request(path + "/withdraw", "POST", ownerCookie, { version: 5, reason: "중복" }))).status).toBe(409);
    expect((await correctSubmissionRoute(request(path, "PATCH", ownerCookie, { version: 5, reason: "철회 후 정정", answers }))).status).toBe(409);
    expect(await db.consentEvent.count({ where: { receipt: { submissionId }, type: "withdrawn" } })).toBe(1);
    expect((await submissionAction(request(path + "/destruction-request", "POST", ownerCookie, { version: 5, reason: "보유 목적 종료" }))).status).toBe(200);
    expect(await db.submission.findUnique({ where: { id: submissionId } })).toMatchObject({ status: "pendingDestruction", version: 6 });
    expect(await db.answer.count({ where: { submissionId } })).toBe(2);
    expect((await submissionAction(request(path + "/hold", "POST", ownerCookie, { version: 6, reason: "파기 전 보존", hold: true }))).status).toBe(200);
  });

});


describe("membership permissions / invitations / ownership", () => {
  let managedService = "", anotherService = "", target: Awaited<ReturnType<typeof fixtureUser>>, admin: Awaited<ReturnType<typeof fixtureUser>>;
  async function fixtureUser(role?: "viewer" | "admin") {
    const email = "member-" + randomUUID() + "@test.local";
    // Account setup is fixture work; it must not exhaust the rate limit of the API under test.
    await db.rateLimit.deleteMany();
    expect((await authCall("/sign-up/email", { name: "구성원 시험", email, password })).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const member = role ? await db.membership.create({ data: { tenantId: ids.a, userId: user.id, role,
      grants: { create: { serviceId: managedService, capabilities: role === "viewer" ? ["service.read", "form.read"] : [] } } } }) : null;
    return { user, member, cookie: await signin(email) };
  }
  async function invite(email: string, cookie = ownerCookie, role = "viewer", selected = [managedService]) {
    return createInvite(request("/invitations", "POST", cookie, { email, role, serviceIds: selected }, { "idempotency-key": randomUUID() }));
  }
  async function tokenFor(id: string, version = 1) {
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + id + ":" + version } });
    const mail = decrypt<{ text: string; to: string }>(job.payloadCipher);
    const href = mail.text.split("\n").find(line => line.startsWith(origin))!;
    const token = new URL(href).searchParams.get("token")!;
    expect(token).toHaveLength(43);
    expect(JSON.stringify(await db.invitation.findUnique({ where: { id } }))).not.toContain(token);
    return token;
  }
  beforeAll(async () => {
    managedService = (await db.service.create({ data: { tenantId: ids.a, name: "구성원 시험 서비스", externalName: "구성원 시험" } })).id;
    anotherService = (await db.service.create({ data: { tenantId: ids.a, name: "추가 권한 서비스", externalName: "추가 권한" } })).id;
    target = await fixtureUser("viewer");
    admin = await fixtureUser("admin");
  });
  test("member listing is scoped and searchable; own permissions, owner changes and escalation are denied", async () => {
    expect((await memberList(request("/members", "GET", viewerCookie))).status).toBe(403);
    const result = await (await memberList(request("/members?pageSize=1&search=" + target.user.email, "GET", ownerCookie))).json();
    expect(result).toMatchObject({ total: 1, pageSize: 1 });
    expect(result.items[0].user).not.toHaveProperty("password");
    expect(result.items[0]).not.toHaveProperty("tenantId");
    const foreignOwner = await db.membership.findFirstOrThrow({ where: { tenantId: ids.b } });
    expect((await memberGet(request("/members/" + foreignOwner.id, "GET", ownerCookie))).status).toBe(404);
    const owner = await db.membership.findFirstOrThrow({ where: { userId: ids.owner, tenantId: ids.a } });
    expect((await memberPatch(request("/members/" + owner.id, "PATCH", ownerCookie, { version: owner.version, role: "viewer" }))).status).toBe(409);
    expect((await memberDelete(request("/members/" + owner.id, "DELETE", admin.cookie, undefined, { "if-match": String(owner.version) }))).status).toBe(403);
    expect((await memberPatch(request("/members/" + target.member!.id, "PATCH", admin.cookie, { version: 1, role: "billing" }))).status).toBe(403);
    const badService = await db.service.create({ data: { tenantId: ids.b, name: "B 권한 시험", externalName: "B" } });
    expect((await memberPatch(request("/members/" + target.member!.id, "PATCH", ownerCookie, { version: 1, serviceIds: [badService.id] }))).status).toBe(404);
  });
  test("concurrent edits accept one version; suspension and removal revoke sessions and preserve membership history", async () => {
    const changes = await Promise.all(["editor", "privacy"].map(role => memberPatch(request("/members/" + target.member!.id, "PATCH", ownerCookie, { version: 1, role, serviceIds: [anotherService] }))));
    expect(changes.map(response => response.status).sort()).toEqual([200, 409]);
    const actual = await db.membership.findUniqueOrThrow({ where: { id: target.member!.id }, include: { grants: true } });
    expect(actual.version).toBe(2); expect(actual.grants.map(grant => grant.serviceId)).toEqual([anotherService]);
    expect((await memberPatch(request("/members/" + actual.id, "PATCH", ownerCookie, { version: 2, status: "suspended" }))).status).toBe(200);
    expect((await context(request("/context", "GET", target.cookie))).status).toBe(401);
    expect((await memberPatch(request("/members/" + actual.id, "PATCH", ownerCookie, { version: 3, status: "active" }))).status).toBe(200);
    target.cookie = await signin(target.user.email);
    expect((await memberDelete(request("/members/" + actual.id, "DELETE", ownerCookie, undefined, { "if-match": "4" }))).status).toBe(204);
    expect(await db.membership.findUnique({ where: { id: actual.id } })).toMatchObject({ status: "revoked", version: 5 });
    expect(await db.serviceGrant.count({ where: { memberId: actual.id } })).toBe(0);
    expect((await context(request("/context", "GET", target.cookie))).status).toBe(401);
    expect((await memberPatch(request("/members/" + actual.id, "PATCH", ownerCookie, { version: 5, status: "active" }))).status).toBe(409);
  });
  test("invite creation is idempotent, hides tokens, and rejects foreign services, members and unprivileged users", async () => {
    const recipient = await fixtureUser(), key = randomUUID();
    const payload = { email: recipient.user.email, role: "viewer", serviceIds: [managedService] };
    const responses = await Promise.all([0, 1].map(() => createInvite(request("/invitations", "POST", ownerCookie, payload, { "idempotency-key": key }))));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const values = await Promise.all(responses.map(response => response.json()));
    expect(values[0].id).toBe(values[1].id); expect(values[0]).not.toHaveProperty("tokenHash");
    expect(await db.job.count({ where: { dedupeKey: "mail:invitation:" + values[0].id + ":1" } })).toBe(1);
    expect((await invite(recipient.user.email)).status).toBe(409);
    expect((await invite(admin.user.email)).status).toBe(409);
    expect((await invite("denied@test.local", viewerCookie)).status).toBe(403);
    expect((await invite("denied@test.local", admin.cookie, "billing")).status).toBe(403);
    const foreignService = await db.service.findFirstOrThrow({ where: { tenantId: ids.b } });
    expect((await invite("denied@test.local", ownerCookie, "viewer", [foreignService.id])).status).toBe(404);
    const token = await tokenFor(values[0].id);
    expect((await inviteAction(request("/invitations/preview", "POST", "", { token }))).status).toBe(401);
    expect((await inviteAction(request("/invitations/preview", "POST", foreignCookie, { token }))).status).toBe(404);
    expect(await (await inviteAction(request("/invitations/preview", "POST", recipient.cookie, { token }))).json()).toMatchObject({ companyName: "A", role: "viewer", email: recipient.user.email });
    expect((await (await inviteList(request("/invitations?search=" + recipient.user.email, "GET", ownerCookie))).json()).total).toBe(1);
    expect((await (await inviteList(request("/invitations?search=" + recipient.user.email, "GET", foreignCookie))).json()).total).toBe(0);
  });
  test("resend rotates the token, cancellation invalidates it, expiry is enforced and stale updates fail", async () => {
    const recipient = await fixtureUser(), row = await (await invite(recipient.user.email)).json(), token = await tokenFor(row.id);
    expect((await inviteAction(request("/invitations/" + row.id + "/resend", "POST", foreignCookie, { version: 1 }))).status).toBe(404);
    expect((await inviteAction(request("/invitations/" + row.id + "/resend", "POST", ownerCookie, { version: 1 }))).status).toBe(200);
    expect((await inviteAction(request("/invitations/preview", "POST", recipient.cookie, { token }))).status).toBe(404);
    const rotated = await tokenFor(row.id, 2);
    expect((await inviteAction(request("/invitations/" + row.id + "/resend", "POST", ownerCookie, { version: 1 }))).status).toBe(409);
    await db.invitation.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await inviteAction(request("/invitations/accept", "POST", recipient.cookie, { token: rotated }, { "idempotency-key": randomUUID() }))).status).toBe(410);
    const listed = await (await inviteList(request("/invitations?status=expired&search=" + recipient.user.email, "GET", ownerCookie))).json();
    expect(listed.total).toBe(1); expect(listed.items[0].status).toBe("expired");
    expect((await inviteRevoke(request("/invitations/" + row.id, "DELETE", ownerCookie, undefined, { "if-match": "2" }))).status).toBe(200);
    expect((await inviteAction(request("/invitations/preview", "POST", recipient.cookie, { token: rotated }))).status).toBe(410);
    expect(await db.job.findUnique({ where: { dedupeKey: "mail:invitation:" + row.id + ":2" } })).toMatchObject({ status: "cancelled" });
  });
  test("acceptance consumes one invitation concurrently, assigns only chosen services and changes the active company", async () => {
    const recipient = await fixtureUser(), row = await (await invite(recipient.user.email)).json(), token = await tokenFor(row.id), key = randomUUID();
    const result = await Promise.all([0, 1].map(() => inviteAction(request("/invitations/accept", "POST", recipient.cookie, { token }, { "idempotency-key": key }))));
    expect(result.map(response => response.status)).toEqual([200, 200]);
    expect(await db.membership.count({ where: { userId: recipient.user.id, tenantId: ids.a } })).toBe(1);
    const info = await (await context(request("/context", "GET", recipient.cookie))).json();
    expect(info.company).toMatchObject({ id: ids.a, role: "viewer" });
    expect(info.services.map((service: { id: string }) => service.id)).toEqual([managedService]);
    expect((await inviteAction(request("/invitations/accept", "POST", recipient.cookie, { token }, { "idempotency-key": randomUUID() }))).status).toBe(410);
    expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "invitation.accepted" } })).toBe(1);
    // A removed user may rejoin only by accepting a newly issued invitation.
    target.cookie = await signin(target.user.email);
    const restoration = await (await invite(target.user.email)).json(), restoredToken = await tokenFor(restoration.id);
    expect((await inviteAction(request("/invitations/accept", "POST", target.cookie, { token: restoredToken }, { "idempotency-key": randomUUID() }))).status).toBe(200);
    expect(await db.membership.findUnique({ where: { id: target.member!.id } })).toMatchObject({ status: "active", role: "viewer", version: 6 });
  });
  test("revoked inviter permissions and archived services invalidate outstanding invitations", async () => {
    const recipient = await fixtureUser(), row = await (await invite(recipient.user.email, admin.cookie)).json(), token = await tokenFor(row.id);
    await db.membership.update({ where: { id: admin.member!.id }, data: { role: "viewer" } });
    expect((await inviteAction(request("/invitations/accept", "POST", recipient.cookie, { token }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect(await db.membership.count({ where: { userId: recipient.user.id } })).toBe(0);
    await db.membership.update({ where: { id: admin.member!.id }, data: { role: "admin" } });
    await db.service.update({ where: { id: managedService }, data: { status: "archived" } });
    expect((await inviteAction(request("/invitations/accept", "POST", recipient.cookie, { token }, { "idempotency-key": randomUUID() }))).status).toBe(404);
    await db.service.update({ where: { id: managedService }, data: { status: "active" } });
  });
  test("database protects the last active owner and ownership transfer requires password, then changes authority immediately", async () => {
    const owner = await db.membership.findFirstOrThrow({ where: { userId: ids.owner, tenantId: ids.a } });
    await expect(db.membership.update({ where: { id: owner.id }, data: { role: "viewer" } })).rejects.toThrow();
    await expect(db.membership.update({ where: { id: owner.id }, data: { status: "suspended" } })).rejects.toThrow();
    await expect(db.membership.delete({ where: { id: owner.id } })).rejects.toThrow();
    const path = "/members/" + admin.member!.id + "/transfer", current = await db.membership.findUniqueOrThrow({ where: { id: admin.member!.id } });
    expect((await memberTransfer(request(path, "POST", ownerCookie, { version: current.version, password: "wrong" }))).status).toBe(401);
    expect((await memberTransfer(request(path, "POST", ownerCookie, { version: current.version, password }))).status).toBe(200);
    expect(await db.membership.findUnique({ where: { id: owner.id } })).toMatchObject({ role: "admin" });
    expect((await memberTransfer(request(path, "POST", ownerCookie, { version: current.version, password }))).status).toBe(403);
    const former = await db.membership.findUniqueOrThrow({ where: { id: owner.id } });
    expect((await memberTransfer(request("/members/" + owner.id + "/transfer", "POST", admin.cookie, { version: former.version, password }))).status).toBe(200);
    expect(await db.membership.count({ where: { tenantId: ids.a, role: "owner", status: "active" } })).toBe(1);
  });
  test("auth return paths preserve invitation context but reject external and encoded redirect targets", () => {
    expect(safeReturnTo("/oauth2/invite/signup?token=abc")).toBe("/oauth2/invite/signup?token=abc");
    for (const unsafe of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/%5cevil.invalid", "/%0aevil", "javascript:alert(1)"]) expect(safeReturnTo(unsafe)).toBe("/dashboard");
    expect(authPath("/login", "/oauth2/invite/signup?token=abc")).toBe("/login?returnTo=%2Foauth2%2Finvite%2Fsignup%3Ftoken%3Dabc");
  });
});


describe("service-scoped full-schema templates", () => {
  let templateId = "", service = "", hiddenService = "", editorCookie = "", copiedFormId = "";
  const content = {
    body: "템플릿 전체 본문", verify: false, font: "20px", bold: true, consentRequired: true,
    consentPurpose: "템플릿 기반 신청 처리", retentionDays: 30, maxResponses: 4, showSubmitNotice: false,
    questions: [
      { id: randomUUID(), type: "단문형 답변", label: "이름", required: true },
      { id: randomUUID(), type: "객관식 답변", label: "참여 방식", required: true, options: ["온라인", "오프라인"] },
      { id: randomUUID(), type: "체크박스", label: "관심 항목", required: false, options: ["기초", "심화"] },
      { id: randomUUID(), type: "날짜", label: "희망 날짜", required: true },
      { id: randomUUID(), type: "장문형 답변", label: "질문", required: false },
      { id: randomUUID(), type: "드롭다운", label: "수업 시간", required: false, options: ["오전", "오후"] },
    ],
  };
  beforeAll(async () => {
    service = (await db.service.create({ data: { tenantId: ids.a, name: "템플릿 서비스", externalName: "템플릿 서비스" } })).id;
    hiddenService = (await db.service.create({ data: { tenantId: ids.a, name: "제한 템플릿 서비스", externalName: "제한" } })).id;
    await db.rateLimit.deleteMany();
    expect((await authCall("/sign-up/email", { name: "템플릿 편집자", email: "template-editor@test.local", password })).status).toBe(200);
    const user = await db.user.update({ where: { email: "template-editor@test.local" }, data: { emailVerified: true } });
    await db.membership.create({ data: { userId: user.id, tenantId: ids.a, role: "editor",
      grants: { create: { serviceId: service, capabilities: ["service.read", "form.read", "form.write", "form.publish"] } } } });
    editorCookie = await signin(user.email);
  });
  test("template create is idempotent and rejects invalid content, duplicate questions and unauthorized services", async () => {
    const input = { serviceId: service, title: "재사용 신청서", category: "교육", content }, key = randomUUID();
    const responses = await Promise.all([0, 1].map(() => templateCreate(request("/templates", "POST", editorCookie, input, { "idempotency-key": key }))));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const rows = await Promise.all(responses.map(response => response.json()));
    expect(rows[0].id).toBe(rows[1].id); templateId = rows[0].id;
    expect(rows[0].content).toEqual(content);
    expect((await templateCreate(request("/templates", "POST", viewerCookie, input, { "idempotency-key": randomUUID() }))).status).toBe(403);
    expect((await templateCreate(request("/templates", "POST", editorCookie, { ...input, serviceId: hiddenService }, { "idempotency-key": randomUUID() }))).status).toBe(403);
    for (const invalid of [
      { ...content, questions: [content.questions[0], content.questions[0]] },
      { ...content, questions: [{ ...content.questions[1], options: [] }] },
      { ...content, consentPurpose: "" },
    ]) expect((await templateCreate(request("/templates", "POST", editorCookie, { ...input, title: "잘못된 템플릿", content: invalid }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect(await db.formTemplate.count({ where: { tenantId: ids.a, serviceId: service } })).toBe(1);
  });
  test("listing and direct access enforce company and service boundaries; public templates are read-only", async () => {
    const hidden = await db.formTemplate.create({ data: { tenantId: ids.a, serviceId: hiddenService, title: "비공개 범위", category: "교육", content } });
    const global = await db.formTemplate.create({ data: { title: "공용 시험 템플릿", category: "교육", content } });
    const result = await (await templateList(request("/templates?scope=company&pageSize=1&search=교육", "GET", editorCookie))).json();
    expect(result).toMatchObject({ total: 1, pageSize: 1 }); expect(result.items[0].id).toBe(templateId);
    expect((await templateGet(request("/templates/" + hidden.id, "GET", editorCookie))).status).toBe(403);
    expect((await templateGet(request("/templates/" + templateId, "GET", foreignCookie))).status).toBe(404);
    expect((await (await templateList(request("/templates?scope=company", "GET", foreignCookie))).json()).total).toBe(0);
    expect((await templateGet(request("/templates/" + global.id, "GET", editorCookie))).status).toBe(200);
    expect((await templatePatchRoute(request("/templates/" + global.id, "PATCH", ownerCookie, { version: 1, title: "불법 변경" }))).status).toBe(403);
    expect((await templateDelete(request("/templates/" + global.id, "DELETE", ownerCookie, undefined, { "if-match": "1" }))).status).toBe(403);
  });
  test("concurrent content edits commit one version and reject stale updates", async () => {
    const responses = await Promise.all(["수정 A", "수정 B"].map(title => templatePatchRoute(request("/templates/" + templateId, "PATCH", editorCookie,
      { version: 1, title, content: { ...content, body: "수정된 전체 본문" } }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await (await templateGet(request("/templates/" + templateId, "GET", editorCookie))).json()).toMatchObject({ version: 2, content: { body: "수정된 전체 본문" } });
    expect((await templatePatchRoute(request("/templates/" + templateId, "PATCH", editorCookie, { version: 1, title: "오래된 수정" }))).status).toBe(409);
  });
  test("using a template copies all content/settings with new question identities and protects target service permissions", async () => {
    const key = randomUUID(), path = "/templates/" + templateId + "/use";
    expect((await templateUse(request(path, "POST", editorCookie, { version: 2, serviceId: hiddenService }, { "idempotency-key": randomUUID() }))).status).toBe(403);
    expect((await templateUse(request(path, "POST", editorCookie, { version: 1, serviceId: service }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    const result = await Promise.all([0, 1].map(() => templateUse(request(path, "POST", editorCookie, { version: 2, serviceId: service }, { "idempotency-key": key }))));
    expect(result.map(response => response.status)).toEqual([201, 201]);
    const values = await Promise.all(result.map(response => response.json())); copiedFormId = values[0].id;
    expect(values[1].id).toBe(copiedFormId);
    const actual = values[0].content;
    expect(actual).toMatchObject({ ...content, body: "수정된 전체 본문", questions: expect.any(Array) });
    expect(actual.questions.map((question: { id: string; options?: string[] }) => ({ ...question, id: null, options: question.options ?? [] }))).toEqual(content.questions.map(question => ({ ...question, id: null, options: question.options ?? [] })));
    for (const question of actual.questions) expect(content.questions.some(original => original.id === question.id)).toBe(false);
    const published = await formAction(request("/forms/" + copiedFormId + "/publish", "POST", editorCookie, { version: 1 }, { "idempotency-key": randomUUID() }));
    expect(published.status).toBe(201);
    const token = (await published.json()).token;
    const publicForm = await (await readPublicForm(request("/public/forms/" + token))).json();
    expect(publicForm.content.questions).toHaveLength(6); expect(publicForm.content.retentionDays).toBe(30);
    const answers = Object.fromEntries(actual.questions.map((question: { id: string; type: string }) => [question.id,
      question.type === "날짜" ? "2026-10-03" : question.type === "객관식 답변" ? "온라인" : question.type === "체크박스" ? ["기초", "심화"] : question.type === "드롭다운" ? "오후" : "브라우저와 별개의 통합 시험"]));
    expect((await submitPublicForm(request("/public/forms/" + token + "/submissions", "POST", "", { answers, consent: true }, { "idempotency-key": randomUUID() }))).status).toBe(201);
  });
  test("editing/deleting a source template leaves previously copied forms and submissions unchanged", async () => {
    const copiedBefore = await (await formRoute(request("/forms/" + copiedFormId, "GET", editorCookie))).json();
    expect((await templatePatchRoute(request("/templates/" + templateId, "PATCH", editorCookie, { version: 2, content: { ...content, body: "복제 후 수정", questions: [content.questions[0]] } }))).status).toBe(200);
    expect((await templateDelete(request("/templates/" + templateId, "DELETE", editorCookie, undefined, { "if-match": "2" }))).status).toBe(409);
    expect((await templateDelete(request("/templates/" + templateId, "DELETE", editorCookie, undefined, { "if-match": "3" }))).status).toBe(204);
    expect((await templateGet(request("/templates/" + templateId, "GET", editorCookie))).status).toBe(404);
    const copiedAfter = await (await formRoute(request("/forms/" + copiedFormId, "GET", editorCookie))).json();
    expect(copiedAfter.content).toEqual(copiedBefore.content);
    expect(await db.submission.count({ where: { formVersion: { formId: copiedFormId } } })).toBe(1);
    expect(await db.auditEvent.count({ where: { resourceId: templateId, action: "template.used" } })).toBe(1);
  });
  test("database constraints reject mismatched company/service template ownership", async () => {
    await expect(db.formTemplate.create({ data: { tenantId: ids.b, serviceId: service, title: "cross tenant", category: "교육", content } })).rejects.toThrow();
    await expect(db.formTemplate.create({ data: { tenantId: ids.a, title: "missing service", category: "교육", content } })).rejects.toThrow();
    await expect(db.formTemplate.create({ data: { serviceId: service, title: "global leak", category: "교육", content } })).rejects.toThrow();
  });
});

describe("email verification / recovery / MFA", () => {
  test("unverified signup, verification mail and reset link roundtrip", async () => {
    await db.rateLimit.deleteMany();
    const email = "new-" + randomUUID() + "@test.local";
    const created = await authCall("/sign-up/email", { name: "새 가입", email, password });
    expect(created.status).toBe(200);
    expect((await authCall("/sign-in/email", { email, password })).status).toBe(403);
    const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
    const job = jobs.find(item => decrypt<{ to: string }>(item.payloadCipher).to === email)!;
    expect(job.payloadCipher).not.toContain(email);
    await runOneJob("verify-mail-worker");
    const verification = decrypt<{ text: string }>(job.payloadCipher).text.match(/https?:\/\/\S+/)![0];
    const verified = await auth.handler(new Request(verification));
    expect([200, 302]).toContain(verified.status);
    const cookie = await signin(email);
    expect((await context(request("/context", "GET", cookie))).status).toBe(200);
    expect((await authCall("/request-password-reset", { email, redirectTo: "/passwordChange" })).status).toBe(200);
    const resetJobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
    const mail = resetJobs.map(item => decrypt<{ to: string; text: string; subject: string }>(item.payloadCipher)).find(mail => mail.to === email && mail.subject === "비밀번호 재설정")!;
    const link = mail.text.match(/https?:\/\/\S+/)![0];
    const redirect = await auth.handler(new Request(link));
    const token = new URL(redirect.headers.get("location")!, origin).searchParams.get("token");
    const reset = await authCall("/reset-password", { token, newPassword: password + "new" });
    expect(reset.status).toBe(200);
    expect((await authCall("/reset-password", { token, newPassword: password + "new" })).status).toBe(400);
    expect((await context(request("/context", "GET", cookie))).status).toBe(401);
  });
  test("MFA blocks pre-authenticated sessions, verifies TOTP and consumes a recovery code once", async () => {
    await db.rateLimit.deleteMany();
    const cookie = await signin("owner-a@test.local");
    const enabled = await authCall("/two-factor/enable", { password }, cookie);
    expect(enabled.status).toBe(200);
    const { totpURI, backupCodes } = await enabled.json();
    const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get("secret")!));
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verified = await authCall("/two-factor/verify-totp", { code }, cookies(enabled) || cookie);
    expect(verified.status).toBe(200);
    expect((await context(request("/context", "GET", ownerCookie))).status).toBe(401);
    expect((await context(request("/context", "GET", cookies(verified)))).status).toBe(200);
    const signinResponse = await authCall("/sign-in/email", { email: "owner-a@test.local", password });
    expect((await signinResponse.json()).twoFactorRedirect).toBe(true);
    const pendingCookie = cookies(signinResponse);
    expect((await context(request("/context", "GET", pendingCookie))).status).toBe(401);
    const backup = await authCall("/two-factor/verify-backup-code", { code: backupCodes[0] }, pendingCookie);
    expect(backup.status).toBe(200);
    const second = await authCall("/sign-in/email", { email: "owner-a@test.local", password });
    const replay = await authCall("/two-factor/verify-backup-code", { code: backupCodes[0] }, cookies(second));
    expect(replay.status).not.toBe(200);
    expect((await authCall("/two-factor/verify-totp", { code: "000000" }, cookies(second))).status).not.toBe(200);
  });
  test("an expired password reset link cannot change the password", async () => {
    await db.rateLimit.deleteMany();
    const email = "expire-" + randomUUID() + "@test.local";
    expect((await authCall("/sign-up/email", { name: "만료", email, password })).status).toBe(200);
    await runOneJob("expire-verify-mail");
    const signupJobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
    const signupMail = signupJobs.map(item => decrypt<{ to: string; text: string }>(item.payloadCipher)).find(item => item.to === email)!;
    expect([200, 302]).toContain((await auth.handler(new Request(signupMail.text.match(/https?:\/\/\S+/)![0]))).status);
    expect((await authCall("/request-password-reset", { email, redirectTo: "/passwordChange" })).status).toBe(200);
    await runOneJob("expire-reset-mail");
    const resetJobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
    const resetMail = resetJobs.map(item => decrypt<{ to: string; text: string; subject: string }>(item.payloadCipher)).find(item => item.to === email && item.subject === "비밀번호 재설정")!;
    const redirect = await auth.handler(new Request(resetMail.text.match(/https?:\/\/\S+/)![0]));
    const token = new URL(redirect.headers.get("location")!, origin).searchParams.get("token");
    await db.verification.updateMany({ data: { expiresAt: new Date(Date.now() - 60000) } });
    expect((await authCall("/reset-password", { token, newPassword: password + "expired" })).status).not.toBe(200);
  });
});
