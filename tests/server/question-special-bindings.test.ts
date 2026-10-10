import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, publishForm, updateForm } from "@/server/forms";
import { submitForm } from "@/server/submissions";
import { correctSubmission } from "@/server/submission-management";
import { createMarketing, marketingSources } from "@/server/marketing";
import { decrypt, tokenHash } from "@/server/crypto";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { checkSubjectQuestions, subjectQuestionTypeAllowed } from "@/contracts/subjects";
import { marketingCreate, marketingQuestionTypeAllowed, validateMarketingConfig, type MarketingChannel } from "@/contracts/marketing";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Special question bindings QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "special-bindings-" + randomUUID() + "@example.test", password = "Special-bindings!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

async function fixture(emailType: "단문형 답변" | "이메일" | "이메일 직접 입력" = "이메일", configured = true, legacyContacts = false) {
  const ids = { name: randomUUID(), email: randomUUID(), sms: randomUUID(), kakao: randomUUID(), birth: randomUUID() };
  const content = formContentSchema.parse({ body: "", questions: [
    { id: ids.name, type: "단문형 답변", label: "이름", required: true, subjectRole: "name" },
    { id: ids.email, type: emailType, label: "이메일", required: true, subjectRole: "email" },
    { id: ids.sms, type: legacyContacts ? "장문형 답변" : "연락처", label: "문자 연락처", required: false },
    { id: ids.kakao, type: legacyContacts ? "단문형 답변" : "연락처", label: "알림톡 연락처", required: false },
    { id: ids.birth, type: "생년월일", label: "생년월일", required: false },
  ], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100,
  ...(configured ? { marketing: { purpose: "소식 안내", nameQuestionId: ids.name, emailQuestionId: ids.email, smsQuestionId: ids.sms, kakaoQuestionId: ids.kakao } } : {}) });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "특수 질문 연결", content }, randomUUID(), tx));
  return { form, ids, content };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function publish(f: Fixture) {
  await db.$transaction(tx => publishForm(tx, ctx, f.form.id, { version: 1 }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.form.id, status: "active" } })).tokenCipher);
}
async function submit(f: Fixture, channels: MarketingChannel[] = [], token?: string) {
  const requestId = randomUUID();
  const result = await submitForm(token ?? await publish(f), submissionInput.parse({ answers: {
    [f.ids.name]: "합성 사용자", [f.ids.email]: "QA@example.test", [f.ids.sms]: "010-1234-5678", [f.ids.kakao]: "010-9876-5432", [f.ids.birth]: "19900102",
  }, consent: false, marketingChannels: channels }), randomUUID(), requestId);
  expect(result.status).toBe(201);
  return { id: result.body.id, requestId };
}
const manualInput = (f: Fixture, submissionId: string, channel: MarketingChannel, nameQuestionId: string = f.ids.name, contactQuestionId: string = f.ids[channel]) => marketingCreate.parse({
  serviceId, submissionId, channel, nameQuestionId, contactQuestionId, grantedAt: new Date(Date.now() - 1000).toISOString(),
  purpose: "별도 수신동의", reference: "합성 동의 근거 01", attested: true,
});

test("binding contracts distinguish names, emails, phone channels and birthdays", () => {
  for (const type of ["단문형 답변", "장문형 답변"]) for (const kind of ["name", "email", "sms", "kakao"] as const)
    expect(marketingQuestionTypeAllowed(kind, type)).toBe(true);
  for (const type of ["이메일", "이메일 직접 입력"]) {
    expect(subjectQuestionTypeAllowed("email", type)).toBe(true);
    expect(subjectQuestionTypeAllowed("name", type)).toBe(false);
    expect(marketingQuestionTypeAllowed("email", type)).toBe(true);
    for (const kind of ["name", "sms", "kakao"] as const) expect(marketingQuestionTypeAllowed(kind, type)).toBe(false);
  }
  for (const kind of ["name", "email", "sms", "kakao"] as const) {
    expect(marketingQuestionTypeAllowed(kind, "생년월일")).toBe(false);
    expect(marketingQuestionTypeAllowed(kind, "연락처")).toBe(kind === "sms" || kind === "kakao");
  }
  for (const role of ["name", "email"]) for (const type of ["연락처", "생년월일", "장문형 답변"])
    expect(subjectQuestionTypeAllowed(role, type)).toBe(false);
  expect(() => checkSubjectQuestions([{ subjectRole: "email", type: "이메일", required: false }])).toThrow();
});

test.each(["이메일", "이메일 직접 입력"] as const)("%s binds a normalized subject and corrections use the same identity contract", async emailType => {
  const f = await fixture(emailType, false), token = await publish(f);
  const first = await submit(f, [], token), second = await submit(f, [], token);
  const a = await db.submission.findUniqueOrThrow({ where: { id: first.id }, include: { subject: true } });
  const b = await db.submission.findUniqueOrThrow({ where: { id: second.id } });
  expect(a.subjectId).not.toBeNull(); expect(b.subjectId).toBe(a.subjectId);
  expect(decrypt(a.subject!.contactCipher)).toEqual({ name: "합성 사용자", email: "qa@example.test" });
  await correctSubmission(ctx, first.id, { version: 1, reason: "이메일 정정", answers: { [f.ids.email]: "Other@example.test" } }, randomUUID());
  const corrected = await db.submission.findUniqueOrThrow({ where: { id: first.id }, include: { subject: true } });
  expect(corrected.subjectId).not.toBe(a.subjectId);
  expect(decrypt(corrected.subject!.contactCipher)).toEqual({ name: "합성 사용자", email: "other@example.test" });
  expect((await db.submission.findUniqueOrThrow({ where: { id: second.id } })).subjectId).toBe(a.subjectId);
});

test.each(["이메일", "이메일 직접 입력"] as const)("%s and contact questions create all selected marketing channels atomically", async emailType => {
  const f = await fixture(emailType), response = await submit(f, ["email", "sms", "kakao"]);
  const rows = await db.marketingPreference.findMany({ where: { sourceSubmissionId: response.id }, orderBy: { channel: "asc" } });
  expect(rows.map(row => row.channel)).toEqual(["email", "kakao", "sms"]);
  for (const row of rows) {
    const expected = row.channel === "email" ? "qa@example.test" : row.channel === "sms" ? "+821012345678" : "+821098765432";
    expect(decrypt(row.contactCipher!)).toEqual({ name: "합성 사용자", contact: expected });
    expect(row.contactQuestionId).toBe(f.ids[row.channel as MarketingChannel]);
    expect(row.sourceKind).toBe("form");
  }
  expect(await db.marketingEvent.count({ where: { preferenceId: { in: rows.map(row => row.id) }, kind: "granted" } })).toBe(3);
  expect(await db.auditEvent.count({ where: { requestId: response.requestId, action: "marketing.granted" } })).toBe(3);
});

test.each(["이메일", "이메일 직접 입력"] as const)("manual sources expose %s/contact types and reject incompatible bindings without writes", async emailType => {
  const f = await fixture(emailType, false), response = await submit(f);
  const sources = await marketingSources(ctx, serviceId, 1, "", randomUUID());
  const source = sources.items.find(row => row.id === response.id)!;
  expect(source.questions.map(q => q.id).sort()).toEqual([f.ids.name, f.ids.email, f.ids.sms, f.ids.kakao].sort());
  expect(source.questions.find(q => q.id === f.ids.email)?.type).toBe(emailType);
  expect(source.questions.find(q => q.id === f.ids.sms)?.type).toBe("연락처");
  const incompatible: [MarketingChannel, string, string][] = [
    ["sms", f.ids.email, f.ids.sms], ["email", f.ids.sms, f.ids.email], ["email", f.ids.name, f.ids.sms], ["sms", f.ids.name, f.ids.email],
    ["kakao", f.ids.name, f.ids.email], ["email", f.ids.name, f.ids.birth], ["sms", f.ids.name, f.ids.birth], ["kakao", f.ids.name, f.ids.birth],
  ];
  for (const [channel, name, contact] of incompatible)
    await expect(db.$transaction(tx => createMarketing(tx, ctx, manualInput(f, response.id, channel, name, contact), randomUUID())))
      .rejects.toMatchObject({ status: 422, code: "CONTACT_QUESTION" });
  expect(await db.marketingPreference.count()).toBe(0); expect(await db.marketingEvent.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "marketing.granted" } })).toBe(0);
  for (const channel of ["email", "sms", "kakao"] as const)
    await db.$transaction(tx => createMarketing(tx, ctx, manualInput(f, response.id, channel), randomUUID()));
  expect(await db.marketingPreference.count({ where: { sourceSubmissionId: response.id, sourceKind: "manual" } })).toBe(3);
});

test("database subject and marketing guards reject cross-kind bindings while existing text bindings remain valid", async () => {
  const f = await fixture("이메일", false);
  const questions = await db.question.findMany({ where: { formVersion: { formId: f.form.id } } });
  const name = questions.find(q => q.stableKey === f.ids.name)!, email = questions.find(q => q.stableKey === f.ids.email)!;
  for (const [id, data] of [
    [name.id, { type: "이메일" }], [name.id, { type: "연락처" }], [email.id, { type: "생년월일" }], [email.id, { required: false }],
  ] as const) await expect(db.question.update({ where: { id }, data })).rejects.toThrow();
  expect(await db.question.findUniqueOrThrow({ where: { id: email.id } })).toEqual(email);
  for (const [kind, contactQuestionId] of [["email", f.ids.sms], ["sms", f.ids.email], ["kakao", f.ids.birth]] as const) {
    const config = { purpose: "잘못된 연결", nameQuestionId: f.ids.name, [kind + "QuestionId"]: contactQuestionId };
    expect(() => validateMarketingConfig(config, f.content.questions)).toThrow();
  }
  const response = await submit(f);
  const created = await db.$transaction(tx => createMarketing(tx, ctx, manualInput(f, response.id, "email"), randomUUID()));
  const stored = await db.marketingPreference.findUniqueOrThrow({ where: { id: created.id } });
  for (const binding of [{ channel: "email", contactQuestionId: f.ids.sms }, { channel: "sms", contactQuestionId: f.ids.email },
    { channel: "kakao", contactQuestionId: f.ids.email }, { channel: "email", contactQuestionId: f.ids.birth },
    { channel: "sms", contactQuestionId: f.ids.birth }, { channel: "kakao", contactQuestionId: f.ids.birth }, { nameQuestionId: f.ids.sms }])
    await expect(db.marketingPreference.create({ data: { ...stored, ...binding, id: randomUUID(), contactHash: tokenHash(randomUUID()) } })).rejects.toThrow();
  expect(await db.marketingPreference.count()).toBe(1);
  const legacy = await fixture("단문형 답변", true, true), previous = await submit(legacy, ["email", "sms", "kakao"]);
  expect(await db.marketingPreference.count({ where: { sourceSubmissionId: previous.id } })).toBe(3);
});

test("a conditional kakao contact is rejected during both draft creation and draft updates", async () => {
  const f = await fixture(), selectorId = randomUUID();
  const content = formContentSchema.parse({ ...f.content, questions: [
    { id: selectorId, type: "객관식 답변", label: "연락처 표시", required: false, options: ["표시", "숨김"] },
    ...f.content.questions.map(question => question.id === f.ids.kakao
      ? { ...question, condition: { questionId: selectorId, operator: "equals", value: "표시" } } : question),
  ] });
  const createRequestId = randomUUID(), updateRequestId = randomUUID();
  await expect(db.$transaction(tx => createForm(ctx, { serviceId, title: "조건부 알림톡", content }, createRequestId, tx)))
    .rejects.toMatchObject({ status: 422, code: "INVALID_QUESTIONS" });
  await expect(updateForm(ctx, f.form.id, { version: 1, content }, updateRequestId))
    .rejects.toMatchObject({ status: 422, code: "INVALID_QUESTIONS" });
  expect(await db.form.count()).toBe(1);
  expect((await db.form.findUniqueOrThrow({ where: { id: f.form.id } })).version).toBe(1);
  expect((await db.question.findFirstOrThrow({ where: { formVersion: { formId: f.form.id }, stableKey: f.ids.kakao } })).condition).toBeNull();
  expect(await db.auditEvent.count({ where: { requestId: { in: [createRequestId, updateRequestId] } } })).toBe(0);
});
