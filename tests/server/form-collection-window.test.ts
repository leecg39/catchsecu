import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { formContentSchema, submissionInput, validateFormForPublish } from "@/contracts/domains";
import { collectionWindowIssue, datetimeLocalIso, datetimeLocalValue } from "@/contracts/form-collection-window";
import { copyForm, createForm, publishForm, readForm, reviseForm, transitionForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, getTemplate, useTemplate } from "@/server/templates";
import { GET as publicRead, POST as publicAction } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");

let ctx: Context, serviceId: string;
const minute = 60_000;
const isoAfter = (minutes: number) => new Date(Date.now() + minutes * minute).toISOString();
function content(open = isoAfter(60), close = isoAfter(120)) {
  return formContentSchema.parse({ body: "수집 일정 검증", questions: [{ id: randomUUID(), type: "단문형 답변", label: "메모", required: false }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 2,
    collectionOpenAt: open, collectionCloseAt: close });
}
function request(path: string, method = "GET", input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin,
    ...(input === undefined ? {} : { "content-type": "application/json" }),
    ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function create(value = content(), title = "수집 일정 폼") {
  return db.$transaction(tx => createForm(ctx, { serviceId, title, content: value }, randomUUID(), tx));
}
async function json(response: Response, status = 200) {
  const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(status); return value;
}

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "수집 일정 QA", publicName: "Collection Window QA",
    policy: { create: { passwordMonths: 0 } }, services: { create: { name: "일정 서비스", externalName: "일정 서비스" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = `collection-window-${randomUUID()}@example.test`, password = "Collection-window!12345";
  const authRequest = (path: string, value: unknown) => new Request(`${origin}/api/v1/auth/${path}`,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  expect((await auth.handler(authRequest("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authRequest("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.publish");
});
afterAll(() => db.$disconnect());

test("수집 일정 계약은 오프셋 ISO·시작 이전 종료·로컬 입력 왕복을 엄격히 검사한다", () => {
  const open = isoAfter(60), close = isoAfter(120), value = content(open, close);
  expect(value.collectionOpenAt).toBe(open); expect(value.collectionCloseAt).toBe(close);
  expect(collectionWindowIssue(value)).toBeNull();
  expect(formContentSchema.safeParse({ ...value, collectionCloseAt: open }).success).toBe(false);
  expect(formContentSchema.safeParse({ ...value, collectionOpenAt: "2026-10-10 12:00" }).success).toBe(false);
  const local = datetimeLocalValue(open), minutePrecision = new Date(open); minutePrecision.setSeconds(0, 0);
  expect(datetimeLocalIso(local)).toBe(minutePrecision.toISOString());
  expect(datetimeLocalIso("")).toBeNull();
  expect(() => validateFormForPublish({ ...value, collectionOpenAt: isoAfter(-1) })).toThrow("현재보다 이후");
  expect(() => validateFormForPublish({ ...value, collectionOpenAt: null, collectionCloseAt: isoAfter(-1) })).toThrow("현재보다 이후");
});

test("일정은 독립 컬럼에 왕복하고 구버전 클라이언트 편집은 보존하며 null은 명시 해제한다", async () => {
  const original = content(), form = await create(original);
  let stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored.collectionWindowSchemaVersion).toBe(1);
  expect(stored.collectionOpenAt?.toISOString()).toBe(original.collectionOpenAt);
  expect(stored.collectionCloseAt?.toISOString()).toBe(original.collectionCloseAt);
  expect((await readForm(ctx, form.id)).content).toMatchObject({ collectionOpenAt: original.collectionOpenAt, collectionCloseAt: original.collectionCloseAt });

  const oldClient = { ...original, body: "구버전 편집" } as Record<string, unknown>;
  delete oldClient.collectionOpenAt; delete oldClient.collectionCloseAt;
  await updateForm(ctx, form.id, { version: 1, content: formContentSchema.parse(oldClient) }, randomUUID());
  expect((await readForm(ctx, form.id)).content).toMatchObject({ collectionOpenAt: original.collectionOpenAt, collectionCloseAt: original.collectionCloseAt });

  await updateForm(ctx, form.id, { version: 2, content: formContentSchema.parse({ ...original, body: "일정 해제",
    collectionOpenAt: null, collectionCloseAt: null }) }, randomUUID());
  stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored.collectionWindowSchemaVersion).toBe(1); expect(stored.collectionOpenAt).toBeNull(); expect(stored.collectionCloseAt).toBeNull();
});

test("복제·템플릿 사용·게시 후 개정은 저장된 수집 일정을 그대로 보존한다", async () => {
  const scheduled = content(), form = await create(scheduled);
  const copied = await db.$transaction(tx => copyForm(tx, ctx, form.id, "일정 복제", randomUUID()));
  expect(copied.content).toMatchObject({ collectionOpenAt: scheduled.collectionOpenAt, collectionCloseAt: scheduled.collectionCloseAt });
  const template = await db.$transaction(tx => createTemplate(ctx,
    { serviceId, title: "일정 템플릿", category: "QA", content: scheduled }, randomUUID(), tx));
  expect((await getTemplate(ctx, template.id)).content).toMatchObject({ collectionOpenAt: scheduled.collectionOpenAt, collectionCloseAt: scheduled.collectionCloseAt });
  const used = await db.$transaction(tx => useTemplate(ctx, template.id,
    { version: 1, serviceId, title: "일정 템플릿 사용" }, randomUUID(), tx));
  expect(used.content).toMatchObject({ collectionOpenAt: scheduled.collectionOpenAt, collectionCloseAt: scheduled.collectionCloseAt });
  await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 2, randomUUID()));
  expect((await readForm(ctx, form.id)).content).toMatchObject({ collectionOpenAt: scheduled.collectionOpenAt, collectionCloseAt: scheduled.collectionCloseAt });
});

test("시작 전에는 공개 내용과 제출을 차단하고 시작·종료 경계에서 상태와 응답 수를 일치시킨다", async () => {
  const scheduled = content(isoAfter(10), isoAfter(20)), form = await create(scheduled);
  const live = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  let publication = await db.publication.findUniqueOrThrow({ where: { id: live.id } });
  expect(publication.opensAt?.toISOString()).toBe(scheduled.collectionOpenAt);
  expect(publication.expiresAt?.toISOString()).toBe(scheduled.collectionCloseAt);

  const before = await json(await publicRead(request("/public/forms/" + live.token)));
  expect(before).toMatchObject({ closed: true, scheduled: true, title: "수집 일정 폼", opensAt: scheduled.collectionOpenAt });
  expect(before).not.toHaveProperty("content"); expect(before).not.toHaveProperty("consentBundle");
  await transitionForm(ctx, form.id, 2, "pause", randomUUID());
  const paused = await json(await publicRead(request("/public/forms/" + live.token)));
  expect(paused.closed).toBe(true); expect(paused).not.toHaveProperty("scheduled"); expect(paused).not.toHaveProperty("content");
  await transitionForm(ctx, form.id, 3, "resume", randomUUID());
  expect(await json(await publicRead(request("/public/forms/" + live.token)))).toMatchObject({ closed: true, scheduled: true });
  const denied = await json(await publicAction(request("/public/forms/" + live.token + "/submissions", "POST",
    submissionInput.parse({ answers: {}, consent: false }))), 425);
  expect(denied.error.code).toBe("PUBLICATION_NOT_OPEN");
  expect(await db.submission.count()).toBe(0); expect((await db.publication.findUniqueOrThrow({ where: { id: live.id } })).responseCount).toBe(0);

  const openedAt = new Date(Date.now() - 2 * minute);
  await db.publication.update({ where: { id: live.id }, data: { opensAt: openedAt } });
  const active = await json(await publicRead(request("/public/forms/" + live.token)));
  expect(active.closed).toBe(false); expect(active.content.body).toBe("수집 일정 검증");
  await json(await publicAction(request("/public/forms/" + live.token + "/submissions", "POST",
    submissionInput.parse({ answers: {}, consent: false }))), 201);
  expect(await db.submission.count()).toBe(1);

  await db.publication.update({ where: { id: live.id }, data: { expiresAt: new Date(Date.now() - minute) } });
  const closed = await json(await publicRead(request("/public/forms/" + live.token)));
  expect(closed.closed).toBe(true); expect(closed).not.toHaveProperty("content");
  const late = await json(await publicAction(request("/public/forms/" + live.token + "/submissions", "POST",
    submissionInput.parse({ answers: {}, consent: false }))), 410);
  expect(late.error.code).toBe("PUBLICATION_CLOSED");
  publication = await db.publication.findUniqueOrThrow({ where: { id: live.id } });
  expect(publication.responseCount).toBe(1); expect(await db.submission.count()).toBe(1);
});

test("게시 요청의 과거 일정·저장된 종료일 불일치를 거절하고 DB도 우회 변조를 막는다", async () => {
  const scheduled = content(), form = await create(scheduled);
  await expect(db.$transaction(tx => publishForm(tx, ctx, form.id,
    { version: 1, expiresAt: isoAfter(180) }, randomUUID()))).rejects.toMatchObject({ status: 409, code: "SCHEDULE_CONFLICT" });
  expect(await db.publication.count()).toBe(0);

  await updateForm(ctx, form.id, { version: 1, content: formContentSchema.parse({ ...scheduled,
    collectionOpenAt: null, collectionCloseAt: isoAfter(-1) }) }, randomUUID());
  await expect(db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 2 }, randomUUID())))
    .rejects.toMatchObject({ status: 422, code: "INVALID_FORM" });
  expect(await db.publication.count()).toBe(0);

  const valid = await create(content(), "DB 일정 제약");
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: valid.id } });
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "collectionWindowSchemaVersion"=0, "collectionOpenAt"=${new Date()} WHERE id=${version.id}`)
    .rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "collectionOpenAt"=${new Date(Date.now() + 3 * minute)}, "collectionCloseAt"=${new Date(Date.now() + 2 * minute)} WHERE id=${version.id}`)
    .rejects.toThrow();
  const published = await db.$transaction(tx => publishForm(tx, ctx, valid.id, { version: 1 }, randomUUID()));
  const row = await db.publication.findUniqueOrThrow({ where: { id: published.id } });
  await expect(db.$executeRaw`UPDATE "Publication" SET "opensAt"=${row.expiresAt} WHERE id=${row.id}`).rejects.toThrow();
});
