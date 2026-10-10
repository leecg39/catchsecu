import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { formContentSchema } from "@/contracts/domains";
import { cloneFormContent } from "@/contracts/form-copy";
import { createForm, publishForm, readForm, versionInclude } from "@/server/forms";
import { submitForm } from "@/server/submissions";
import { correctSubmission } from "@/server/submission-management";
import { decrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Branch QA", publicName: "Branch QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "Branch service", externalName: "Branch service" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = `branches-${randomUUID()}@example.test`, password = "Branch-test!12345";
  const request = (path: string, body: unknown) => new Request(`${origin}/api/v1/auth/${path}`,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

function branchContent() {
  const first = randomUUID(), detail = randomUUID(), finish = randomUUID();
  const route = randomUUID(), detailQuestion = randomUUID(), finishQuestion = randomUUID();
  const short = randomUUID(), long = randomUUID(), excluded = randomUUID();
  const content = formContentSchema.parse({ body: "분기 폼", sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: detail }, allowBack: false },
    { id: detail, title: "상세", body: "", defaultDestination: { kind: "page", pageId: finish }, allowBack: true },
    { id: finish, title: "완료 전", body: "", defaultDestination: { kind: "submit" }, allowBack: true },
  ], questions: [
    { id: route, pageId: first, type: "객관식 답변", label: "경로", required: true, options: ["바로", "상세", "제외"], optionDefinitions: [
      { id: short, label: "바로", value: "바로", branchDestination: { kind: "page", pageId: finish } },
      { id: long, label: "상세", value: "상세", branchDestination: { kind: "page", pageId: detail } },
      { id: excluded, label: "제외", value: "제외", branchDestination: { kind: "ineligible" } },
    ] },
    { id: detailQuestion, pageId: detail, type: "단문형 답변", label: "상세 답변", required: true },
    { id: finishQuestion, pageId: finish, type: "단문형 답변", label: "마지막 답변", required: true },
  ], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20 });
  return { content, first, detail, finish, route, detailQuestion, finishQuestion };
}
async function published() {
  const fixture = branchContent();
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Branch form", content: fixture.content }, randomUUID(), tx));
  const publication = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  return { ...fixture, form, publication };
}

test("branch contract rejects unsupported, competing, self, foreign and cyclic destinations", () => {
  const base = branchContent();
  const unsupported = structuredClone(base.content); unsupported.questions[0].type = "체크박스"; expect(formContentSchema.safeParse(unsupported).success).toBe(false);
  const competing = structuredClone(base.content); competing.questions[1] = { ...competing.questions[1], pageId: base.first, type: "드롭다운", options: ["예"],
    optionDefinitions: [{ id: randomUUID(), label: "예", value: "예", branchDestination: { kind: "submit" } }] };
  expect(formContentSchema.safeParse(competing).success).toBe(false);
  const self = structuredClone(base.content); self.questions[0].optionDefinitions![0].branchDestination = { kind: "page", pageId: base.first };
  expect(formContentSchema.safeParse(self).success).toBe(false);
  const cycle = structuredClone(base.content); cycle.questions[0].optionDefinitions![0].branchDestination = { kind: "page", pageId: base.finish };
  cycle.sections![2].defaultDestination = { kind: "page", pageId: base.first };
  expect(formContentSchema.safeParse(cycle).success).toBe(false);
  const legacy = structuredClone(base.content); delete legacy.sections;
  legacy.questions = legacy.questions.map(question => { const next = { ...question }; delete next.pageId; return next; });
  expect(formContentSchema.safeParse(legacy).success).toBe(false);
});

test("branches round-trip and a copied graph remaps every page destination", async () => {
  const fixture = branchContent();
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Branch form", content: fixture.content }, randomUUID(), tx));
  expect((await readForm(ctx, form.id)).content?.questions[0].optionDefinitions).toEqual(fixture.content.questions[0].optionDefinitions);
  const copy = cloneFormContent(fixture.content), copiedPages = new Set(copy.sections!.map(section => section.id));
  expect(copy.sections!.every(section => !new Set(fixture.content.sections!.map(item => item.id)).has(section.id))).toBe(true);
  expect(copy.questions[0].optionDefinitions!.filter(option => option.branchDestination?.kind === "page")
    .every(option => copiedPages.has((option.branchDestination as { kind: "page"; pageId: string }).pageId))).toBe(true);
});

test("submission recomputes visited pages and rejects required bypass or unvisited answer injection", async () => {
  const f = await published();
  await expect(submitForm(f.publication.token, { consent: false, answers: {
    [f.route]: "바로", [f.detailQuestion]: "주입", [f.finishQuestion]: "완료",
  } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code: "UNVISITED_ANSWER" });
  await expect(submitForm(f.publication.token, { consent: false, answers: {
    [f.route]: "상세", [f.finishQuestion]: "완료",
  } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code: "REQUIRED_ANSWER" });
  await expect(submitForm(f.publication.token, { consent: false, answers: { [f.route]: "제외" } }, randomUUID(), randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "INELIGIBLE_PATH" });

  const replayKey = randomUUID(), shortInput = { consent: false, answers: {
    [f.route]: "바로", [f.finishQuestion]: "완료",
  } };
  const short = await submitForm(f.publication.token, shortInput, replayKey, randomUUID());
  expect(await submitForm(f.publication.token, shortInput, replayKey, randomUUID())).toEqual(short);
  const stored = await db.submission.findUniqueOrThrow({ where: { id: short.body.id }, include: { answers: true } });
  expect(stored).toMatchObject({ pagePathVersion: 1, visitedPageKeys: [f.first, f.finish], terminationKind: "submit" });
  expect(stored.answers).toHaveLength(3);

  const long = await submitForm(f.publication.token, { consent: false, answers: {
    [f.route]: "상세", [f.detailQuestion]: "상세 입력", [f.finishQuestion]: "완료",
  } }, randomUUID(), randomUUID());
  expect(await db.submission.findUniqueOrThrow({ where: { id: long.body.id } })).toMatchObject({
    pagePathVersion: 1, visitedPageKeys: [f.first, f.detail, f.finish], terminationKind: "submit",
  });
});

test("correction can switch branches only with the newly visited required answers", async () => {
  const f = await published();
  const created = await submitForm(f.publication.token, { consent: false, answers: {
    [f.route]: "바로", [f.finishQuestion]: "완료",
  } }, randomUUID(), randomUUID());
  await expect(correctSubmission(ctx, created.body.id, { version: 1, reason: "경로 변경", answers: { [f.route]: "상세" } }, randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "REQUIRED_ANSWER" });
  await correctSubmission(ctx, created.body.id, { version: 1, reason: "경로 변경", answers: {
    [f.route]: "상세", [f.detailQuestion]: "새 상세",
  } }, randomUUID());
  expect(await db.submission.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({
    version: 2, visitedPageKeys: [f.first, f.detail, f.finish], terminationKind: "submit",
  });
  await correctSubmission(ctx, created.body.id, { version: 2, reason: "상세 경로 제거", answers: { [f.route]: "바로" } }, randomUUID());
  const cleared = await db.answer.findFirstOrThrow({ where: { submissionId: created.body.id, question: { stableKey: f.detailQuestion } } });
  expect(decrypt(cleared.valueCipher)).toBe("");
  expect(await db.submission.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({
    version: 3, visitedPageKeys: [f.first, f.finish], terminationKind: "submit",
  });
});

test("database guards reject direct cross-version branches and paged submissions without path evidence", async () => {
  const firstFixture = branchContent(), secondFixture = branchContent();
  const firstForm = await db.$transaction(tx => createForm(ctx, { serviceId, title: "First draft", content: firstFixture.content }, randomUUID(), tx));
  const secondForm = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Second draft", content: secondFixture.content }, randomUUID(), tx));
  const firstVersion = await db.formVersion.findFirstOrThrow({ where: { formId: firstForm.id }, include: versionInclude });
  const secondVersion = await db.formVersion.findFirstOrThrow({ where: { formId: secondForm.id }, include: versionInclude });
  await expect(db.questionOption.update({ where: { id: firstVersion.questions[0].options[0].id }, data: {
    branchDestinationKind: "page", branchDestinationSectionId: secondVersion.sections[1].id,
  } })).rejects.toThrow();
  const first = await db.$transaction(tx => publishForm(tx, ctx, firstForm.id, { version: 1 }, randomUUID()));
  await expect(db.submission.create({ data: { tenantId: ctx.tenantId, formVersionId: firstVersion.id, publicationId: first.id,
    retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } })).rejects.toThrow();
  await expect(db.submission.create({ data: { tenantId: ctx.tenantId, formVersionId: firstVersion.id, publicationId: first.id,
    pagePathVersion: 1, visitedPageKeys: [firstFixture.first, firstFixture.detail], terminationKind: "submit",
    retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } })).rejects.toThrow();
});
