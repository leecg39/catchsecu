import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, publishForm, copyForm } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { selectionLimitsSchema } from "@/contracts/questions";
import { submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { decrypt } from "@/server/crypto";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Exact selection QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } }); serviceId = company.services[0].id;
  const email = "exact-" + randomUUID() + "@example.test", password = "Exact-selection!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());
async function fixture(exact = true, required = false, checkbox = false) {
  const qid = randomUUID(), rowIds = [randomUUID(), randomUUID()];
  const content = formContentSchema.parse({ body: "", questions: [{ id: qid, type: checkbox ? "체크박스" : "행렬형 복수 선택", label: "관심 주제", required,
    options: ["A", "B", "C"], ...(!checkbox ? { rows: rowIds.map((id, i) => ({ id, label: "행 " + (i + 1) })) } : {}),
    selectionLimits: { min: 2, max: 2, ...(exact ? { mode: "exact" } : {}) } }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "정확한 선택 수", content }, randomUUID(), tx));
  await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  const publication = await db.publication.findFirstOrThrow({ where: { formId: form.id } });
  const token = decrypt<string>(publication.tokenCipher);
  const post = (value: unknown) => submitForm(token, submissionInput.parse({ answers: { [qid]: value }, consent: false }), randomUUID(), randomUUID());
  return { form, qid, rowIds, token, post };
}

test("optional exact matrix permits wholly empty and fully exact responses, rejects incomplete rows", async () => {
  const f = await fixture(), [a, b] = f.rowIds;
  for (const value of [{}, { [a]: [], [b]: [] }, { [a]: ["A", "B"], [b]: ["B", "C"] }]) expect((await f.post(value)).status).toBe(201);
  for (const value of [{ [a]: ["A", "B"] }, { [a]: ["A"], [b]: ["B", "C"] }, { [a]: ["A", "B"], [b]: [] }, { [a]: ["A", "B", "C"], [b]: ["A", "B"] }])
    await expect(f.post(value)).rejects.toMatchObject({ status: 422, code: "SELECTION_COUNT" });
  expect(await db.submission.count({ where: { tenantId: ctx.tenantId } })).toBe(3);
});
test("required exact matrix rejects wholly empty and validates every row", async () => {
  const f = await fixture(true, true), [a, b] = f.rowIds;
  await expect(f.post({})).rejects.toMatchObject({ status: 422, code: "REQUIRED_ANSWER" });
  await expect(f.post({ [a]: ["A", "B"], [b]: ["A"] })).rejects.toMatchObject({ status: 422, code: "SELECTION_COUNT" });
  expect((await f.post({ [a]: ["A", "B"], [b]: ["A", "B"] })).status).toBe(201);
});
test("optional empty response never bypasses matrix row keys, value types or valid options", async () => {
  const f = await fixture(), [a, b] = f.rowIds;
  await expect(f.post({ [randomUUID()]: [] })).rejects.toMatchObject({ status: 422, code: "UNKNOWN_MATRIX_ROW" });
  await expect(f.post({ [a]: "" })).rejects.toMatchObject({ status: 422, code: "INVALID_ANSWER_TYPE" });
  for (const choices of [["A", "A"], ["A", "위조"]])
    await expect(f.post({ [a]: choices, [b]: ["A", "B"] })).rejects.toMatchObject({ status: 422, code: "INVALID_OPTION" });
  expect(await db.submission.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
});
test("legacy min=max matrix keeps empty-row semantics and unchanged public settings", async () => {
  const f = await fixture(false), [a] = f.rowIds;
  expect((await f.post({ [a]: ["A", "B"] })).status).toBe(201);
  expect((await activePublicForm(f.token)).content.questions[0].selectionLimits).toEqual({ min: 2, max: 2 });
});
test("exact checkbox permits optional omission but rejects under/over count and duplicates", async () => {
  const f = await fixture(true, false, true);
  expect((await f.post([])).status).toBe(201); expect((await f.post(["A", "B"])).status).toBe(201);
  for (const values of [["A"], ["A", "B", "C"]]) await expect(f.post(values)).rejects.toMatchObject({ status: 422, code: "SELECTION_COUNT" });
  await expect(f.post(["A", "A"])).rejects.toMatchObject({ status: 422, code: "INVALID_OPTION" });
});
test("exact mode survives public DTO and copy; corrections validate the original version atomically", async () => {
  const f = await fixture(), [a, b] = f.rowIds, value = { [a]: ["A", "B"], [b]: ["B", "C"] };
  expect((await activePublicForm(f.token)).content.questions[0].selectionLimits).toEqual({ min: 2, max: 2, mode: "exact" });
  const copied = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  expect((await readForm(ctx, copied.id)).content!.questions[0].selectionLimits).toEqual({ min: 2, max: 2, mode: "exact" });
  const response = await f.post(value), id = response.body.id;
  await expect(correctSubmission(ctx, id, { version: 1, reason: "불완전 행", answers: { [f.qid]: { [a]: ["A", "B"] } } }, randomUUID())).rejects.toMatchObject({ status: 422, code: "SELECTION_COUNT" });
  expect((await getSubmission(ctx, id, randomUUID())).values[f.qid]).toEqual(value);
  expect(await db.correction.count({ where: { submissionId: id } })).toBe(0);
  await correctSubmission(ctx, id, { version: 1, reason: "선택 답변 전체 삭제", answers: { [f.qid]: {} } }, randomUUID());
  expect((await getSubmission(ctx, id, randomUUID())).values[f.qid]).toEqual({});
});
test("exact definition requires positive equal min/max and DB rejects bypassed malformed limits", async () => {
  expect(selectionLimitsSchema.safeParse({ min: 2, max: 2, mode: "exact" }).success).toBe(true);
  for (const limits of [{ min: 1, max: 2, mode: "exact" }, { max: 2, mode: "exact" }, { min: 0, max: 2, mode: "exact" }, { min: 2, max: 2, mode: "other" }])
    expect(selectionLimitsSchema.safeParse(limits).success).toBe(false);
  const f = await fixture(false), copied = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const question = await db.question.findFirstOrThrow({ where: { formVersion: { formId: copied.id } } });
  for (const limits of [{ min: 1, max: 2, mode: "exact" }, { min: 2, max: 2, mode: null }, { max: 2, mode: "exact" }])
    await expect(db.question.update({ where: { id: question.id }, data: { selectionLimits: limits } })).rejects.toThrow();
  await db.question.update({ where: { id: question.id }, data: { selectionLimits: { min: 2, max: 2, mode: "exact" } } });
});
