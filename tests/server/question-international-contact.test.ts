import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { contentDto, copyForm, createForm, fingerprint, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, getTemplate, updateTemplate, useTemplate } from "@/server/templates";
import { consentBundle } from "@/server/form-documents";
import { submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctionInput, correctSubmission, getSubmission } from "@/server/submission-management";
import { exportSubmissions } from "@/server/submission-export";
import { createMarketing } from "@/server/marketing";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { submissionFilters } from "@/contracts/submissions";
import { marketingCreate } from "@/contracts/marketing";
import type { QuestionDefinition } from "@/contracts/questions";
import { formLanguageCodes, effectiveFormLanguage, formLanguageLabel, formLanguages, isInternationalFormLanguage } from "@/contracts/form-language";
import { internationalContactCountries, internationalDialCodes, internationalContactDialCode, internationalContactError,
  parseInternationalContact, serializeInternationalContact } from "@/contracts/international-contact";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "International contact QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } }); serviceId = company.services[0].id;
  const email = "international-contact-" + randomUUID() + "@example.test", password = "International-test!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

const languages = ["ko", "en", "ja", "zh-CN", "zh-TW", "de", "fr", "ru", "es", "pt", "id", "th", "vi", "tr", "it", "ar"];
test("language and international helpers preserve incomplete candidates and never guess shared-code country ISO", () => {
  expect(formLanguageCodes).toEqual(languages); expect(formLanguages.map(item => item.code)).toEqual(languages);
  expect(effectiveFormLanguage(null)).toBe("ko"); expect(isInternationalFormLanguage(undefined)).toBe(false);
  expect(isInternationalFormLanguage("en")).toBe(true); expect(formLanguageLabel("ko")).toBe("한국어(기본)");
  expect(formLanguages.find(item => item.code === "ar")?.rtl).toBe(true);
  expect(internationalContactCountries).toHaveLength(181); expect(internationalDialCodes).toHaveLength(179);
  expect(parseInternationalContact("+1 123456")).toEqual({ dialCode: "+1", number: "123456", countryCode: "", countryCodes: ["US", "CA"] });
  const seven = parseInternationalContact("+7 123456"); expect(seven.countryCode).toBe(""); expect(seven.countryCodes.sort()).toEqual(["KZ", "RU"]);
  expect(parseInternationalContact("+82 1012345678").countryCode).toBe("KR");
  for (const country of internationalContactCountries) {
    expect(internationalContactDialCode(country.iso)).toBe(country.dialCode);
    expect(internationalContactError(serializeInternationalContact(country.iso, "123456"))).toBeUndefined();
  }
  expect(serializeInternationalContact("+1", "123456")).toBe("+1 123456");
  expect(serializeInternationalContact("", "123456")).toBe("123456"); expect(serializeInternationalContact("KR", "")).toBe("+82 ");
  expect(serializeInternationalContact("", "")).toBe(""); expect(internationalContactError("", false)).toBeUndefined();
  expect(internationalContactError("", true)).toBeDefined(); expect(internationalContactError("+82 ")).toBeDefined();
  expect(internationalContactError("+998 123456789012345")).toBeUndefined();
});
function questions(required = false): QuestionDefinition[] {
  return [{ id: randomUUID(), type: "연락처", label: "Contact", required },
    { id: randomUUID(), type: "단문형 답변", label: "Name", required: false }];
}
async function fixture(language?: string, qs = questions(), extra: Record<string, unknown> = {}) {
  const content = formContentSchema.parse({ body: "International contact", questions: qs, consentRequired: true, consentPurpose: "Contact collection",
    retentionDays: 30, maxResponses: 100, ...(language ? { formLanguage: language } : {}), ...extra });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Contact", content }, randomUUID(), tx));
  return { form, content, questions: qs };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function publish(f: Fixture, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, f.form.id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.form.id, status: "active" } })).tokenCipher);
}
async function post(f: Fixture, token: string, value: unknown, channels: ("sms" | "kakao")[] = [], rest: Record<string, unknown> = {}) {
  return submitForm(token, submissionInput.parse({ answers: { [f.questions[0].id]: value, ...rest }, consent: true, marketingChannels: channels }), randomUUID(), randomUUID());
}
async function correct(id: string, answers: unknown, version = 1) {
  return correctSubmission(ctx, id, correctionInput.parse({ version, reason: "Contact correction", answers }), randomUUID());
}
async function state() {
  return { rows: await db.submission.count(), answers: await db.answer.count(), receipts: await db.consentReceipt.count(),
    preferences: await db.marketingPreference.count(), marketingEvents: await db.marketingEvent.count(),
    counters: await db.publication.findMany({ select: { id: true, responseCount: true }, orderBy: { id: "asc" } }),
    audits: await db.auditEvent.count({ where: { action: { in: ["submission.created", "marketing.granted"] } } }) };
}

test("all sixteen language codes round trip and invalid or null API values fail", async () => {
  for (const language of languages) {
    const f = await fixture(language), detail = await readForm(ctx, f.form.id);
    expect(detail.content).toHaveProperty("formLanguage", language);
    const stored = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id } });
    expect(stored).toHaveProperty("formLanguage", language);
  }
  const base = (await fixture()).content;
  for (const value of ["", "EN", "zh", "xx", null, 1, {}, []]) expect(formContentSchema.safeParse({ ...base, formLanguage: value }).success).toBe(false);
});
test("legacy null language is omitted and retains the exact pre-language approval fingerprint and domestic answer contract", async () => {
  const f = await fixture(), draft = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id } });
  await db.formVersion.update({ where: { id: draft.id }, data: { optionSchemaVersion: 0 } });
  const old = await db.formVersion.findUniqueOrThrow({ where: { id: draft.id }, include: versionInclude });
  const prior = contentDto(old); for (const question of prior.questions) delete question.optionDefinitions;
  expect(prior).not.toHaveProperty("formLanguage");
  const expected = createHash("sha256").update(JSON.stringify({ title: old.title, content: prior, consentBundle: consentBundle(old) })).digest("hex");
  expect(fingerprint(old)).toBe(expected); expect(old).toHaveProperty("formLanguage", null);
  const token = await publish(f); expect((await activePublicForm(token)).content).not.toHaveProperty("formLanguage");
  const result = await post(f, token, "010-1234-5678");
  expect(await getSubmission(ctx, result.body.id, randomUUID())).not.toHaveProperty("formLanguage");
  await expect(post(f, token, "+82 1012345678")).rejects.toMatchObject({ status: 422 });
});

test("old-client content updates preserve the current explicit language in drafts, implicit revisions and templates", async () => {
  const f = await fixture("en"), oldClient = { ...f.content, body: "legacy client changed body" } as Record<string, unknown>;
  delete oldClient.formLanguage;
  await updateForm(ctx, f.form.id, { version: 1, content: formContentSchema.parse(oldClient) }, randomUUID());
  expect((await readForm(ctx, f.form.id)).content).toHaveProperty("formLanguage", "en");
  await publish(f, 2);
  await updateForm(ctx, f.form.id, { version: 3, content: formContentSchema.parse(oldClient) }, randomUUID());
  expect((await readForm(ctx, f.form.id)).content).toHaveProperty("formLanguage", "en");
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "Contact template", category: "일반", content: f.content }, randomUUID(), tx));
  await updateTemplate(ctx, template.id, { version: 1, content: formContentSchema.parse(oldClient) }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content).toHaveProperty("formLanguage", "en");
});

test("non-Korean verification is rejected by create/update/template API and direct DB writes", async () => {
  await expect(fixture("en", questions(), { verify: true })).rejects.toThrow();
  const f = await fixture("en"), before = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id } });
  // Raw SQL exercises the storage constraint, independently of generated Prisma support.
  await expect(db.$executeRaw`UPDATE "FormVersion" SET verify=true WHERE id=${before.id}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "formLanguage"='xx' WHERE id=${before.id}`).rejects.toThrow();
  const omitted = { ...f.content, verify: true } as Record<string, unknown>; delete omitted.formLanguage;
  await expect(updateForm(ctx, f.form.id, { version: 1, content: formContentSchema.parse(omitted) }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  expect((await db.form.findUniqueOrThrow({ where: { id: f.form.id } })).version).toBe(1);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "Contact template", category: "일반", content: f.content }, randomUUID(), tx));
  await expect(updateTemplate(ctx, template.id, { version: 1, content: formContentSchema.parse(omitted) }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect((await getTemplate(ctx, template.id)).version).toBe(1);
});

test("international contacts store encrypted original strings at both six and fifteen national-digit boundaries", async () => {
  const f = await fixture("en", questions(true)), token = await publish(f);
  for (const value of ["+82 1012345678", "+1 123456", "+7 123456789012345", "+998 123456789012345"]) {
    const result = await post(f, token, value), detail = await getSubmission(ctx, result.body.id, randomUUID());
    expect(detail).toHaveProperty("formLanguage", "en"); expect(detail.values[f.questions[0].id]).toBe(value);
    const answer = await db.answer.findFirstOrThrow({ where: { submissionId: result.body.id, valueType: "연락처" } });
    expect(decrypt(answer.valueCipher)).toBe(value); expect(answer.valueCipher).not.toContain(value);
  }
  expect((await activePublicForm(token)).content).toHaveProperty("formLanguage", "en");
});

test("international invalid codes, incomplete pairs, lengths, non-ASCII digits and object/scalar injections fail atomically", async () => {
  const f = await fixture("ja"), token = await publish(f), before = await state();
  for (const value of ["+999 123456", "+0 123456", "+82", "123456", "+82 12345", "+82 1234567890123456", "+82 １２３４５６",
    "+82 123-456", "+82 12 3456", "+82  123456", "+82123456", "+82 +123456", { countryCode: "KR", extraNumber: "123456" }, [], null, 123456])
    await expect(post(f, token, value)).rejects.toThrow();
  expect(await state()).toEqual(before);
  const empty = await post(f, token, ""); expect((await getSubmission(ctx, empty.body.id, randomUUID())).values[f.questions[0].id]).toBe("");
  const required = await fixture("ar", questions(true)), requiredToken = await publish(required);
  await expect(post(required, requiredToken, "")).rejects.toMatchObject({ code: "REQUIRED_ANSWER" });
});

test("Korean explicit language preserves domestic numbers and international display language never changes email or birth validation", async () => {
  const f = await fixture("ko"), token = await publish(f), result = await post(f, token, "010-1234-5678");
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values[f.questions[0].id]).toBe("010-1234-5678");
  await expect(post(f, token, "+82 1012345678")).rejects.toMatchObject({ status: 422 });
  const email = randomUUID(), birth = randomUUID(), intl = await fixture("en", [...questions(),
    { id: email, type: "이메일", label: "Email", required: false }, { id: birth, type: "생년월일", label: "Birth", required: false }]), internationalToken = await publish(intl);
  expect((await post(intl, internationalToken, "+82 1012345678", [], { [email]: "qa@example.test", [birth]: "19900102" })).status).toBe(201);
  await expect(post(intl, internationalToken, "+82 1012345678", [], { [email]: "+82 1012345678" })).rejects.toMatchObject({ status: 422 });
});

test("corrections always use their published version language and retain legacy answers after the new draft changes language", async () => {
  const f = await fixture(), token = await publish(f), oldResponse = await post(f, token, "010-1234-5678");
  const oldVersion = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" }, include: versionInclude }), hash = fingerprint(oldVersion);
  const oldBytes = await db.answer.findMany({ where: { submissionId: oldResponse.body.id } });
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const draft = await readForm(ctx, f.form.id);
  await updateForm(ctx, f.form.id, { version: 3, content: formContentSchema.parse({ ...draft.content, formLanguage: "en" }) }, randomUUID());
  const internationalToken = await publish(f, 4), currentResponse = await post(f, internationalToken, "+1 1234567890");
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: oldVersion.id }, include: versionInclude })).toEqual(oldVersion);
  expect(fingerprint(oldVersion)).toBe(hash); expect(await db.answer.findMany({ where: { submissionId: oldResponse.body.id } })).toEqual(oldBytes);
  await correct(oldResponse.body.id, { [f.questions[0].id]: "010-9876-5432" });
  await expect(correct(oldResponse.body.id, { [f.questions[0].id]: "+82 1098765432" }, 2)).rejects.toMatchObject({ status: 422 });
  await correct(currentResponse.body.id, { [f.questions[0].id]: "+7 1234567890" });
  expect((await getSubmission(ctx, currentResponse.body.id, randomUUID())).values[f.questions[0].id]).toBe("+7 1234567890");
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "formLanguage"='en' WHERE id=${oldVersion.id}`).rejects.toThrow();
});

test("failed mixed correction retains scalar, version, ciphertext, correction payload and audit atomically", async () => {
  const f = await fixture("en"), token = await publish(f), result = await post(f, token, "+82 1012345678"), id = result.body.id;
  const before = await db.answer.findMany({ where: { submissionId: id }, orderBy: { id: "asc" } }), row = await db.submission.findUniqueOrThrow({ where: { id } });
  for (const value of ["+999 123456", "+82 12345", "010-1234-5678"])
    await expect(correct(id, { [f.questions[0].id]: value, [f.questions[1].id]: "must rollback" })).rejects.toMatchObject({ status: 422 });
  expect(await db.answer.findMany({ where: { submissionId: id }, orderBy: { id: "asc" } })).toEqual(before);
  expect(await db.submission.findUniqueOrThrow({ where: { id } })).toEqual(row);
  expect(await db.correction.count({ where: { submissionId: id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: id, action: "submission.corrected" } })).toBe(0);
  await expect(correct(id, { [f.questions[0].id]: "+82 1012345678" })).rejects.toMatchObject({ code: "NO_CHANGES" });
});

test("copy and template use retain language, while explicit change affects the approval fingerprint", async () => {
  const f = await fixture("fr"), before = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id }, include: versionInclude }), hash = fingerprint(before);
  const copy = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  expect(copy.content).toHaveProperty("formLanguage", "fr");
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "International", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(used.content).toHaveProperty("formLanguage", "fr");
  await updateForm(ctx, f.form.id, { version: 1, content: formContentSchema.parse({ ...f.content, formLanguage: "ar" }) }, randomUUID());
  const after = await db.formVersion.findUniqueOrThrow({ where: { id: before.id }, include: versionInclude });
  expect(fingerprint(after)).not.toBe(hash); expect(contentDto(after)).toHaveProperty("formLanguage", "ar");
});

test("hidden international contacts reject supplied values and clear prior answers during correction", async () => {
  const parent = randomUUID(), qs = questions(true); qs[0] = { ...qs[0], condition: { questionId: parent, operator: "equals", value: "yes" } };
  const f = await fixture("en", [{ id: parent, type: "객관식 답변", label: "Show", required: true, options: ["yes", "no"] }, ...qs]), token = await publish(f);
  const submit = async (answers: unknown) => submitForm(token, submissionInput.parse({ answers, consent: true }), randomUUID(), randomUUID());
  await expect(submit({ [parent]: "no", [qs[0].id]: "+82 1012345678" })).rejects.toMatchObject({ code: "HIDDEN_ANSWER" });
  const result = await submit({ [parent]: "yes", [qs[0].id]: "+82 1012345678" });
  await correct(result.body.id, { [parent]: "no" });
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values[qs[0].id]).toBe("");
});

test("CSV retains exact international scalar including shared dial codes and values beyond complete E164 length", async () => {
  const f = await fixture("en"), token = await publish(f), values = ["+1 123456", "+7 1234567890", "+998 123456789012345"];
  const ids: string[] = [];
  for (const value of values) ids.push((await post(f, token, value)).body.id);
  const csv = (await exportSubmissions(ctx, f.form.id, submissionFilters.parse({}), randomUUID())).csv;
  const rows = parse(csv, { bom: true }) as string[][];
  // CSV protects leading '+' from spreadsheet formula interpretation.
  for (const [index, id] of ids.entries()) expect(rows.find(row => row[0] === id)![7]).toBe("'" + values[index]);
});

test("marketing retains stronger complete-E164 policy: unsuitable consent rolls back everything but no-consent storage succeeds", async () => {
  const qs = questions(), config = { purpose: "Updates", nameQuestionId: qs[1].id, smsQuestionId: qs[0].id };
  const f = await fixture("en", qs, { marketing: config }), token = await publish(f);
  for (const value of ["+1 123456", "+998 123456789012345"]) {
    const before = await state();
    await expect(post(f, token, value, ["sms"], { [qs[1].id]: "QA" })).rejects.toThrow();
    expect(await state()).toEqual(before);
    const result = await post(f, token, value, [], { [qs[1].id]: "QA" });
    expect((await getSubmission(ctx, result.body.id, randomUUID())).values[qs[0].id]).toBe(value);
    await expect(db.$transaction(tx => createMarketing(tx, ctx, marketingCreate.parse({ serviceId, submissionId: result.body.id,
      channel: "sms", nameQuestionId: qs[1].id, contactQuestionId: qs[0].id, grantedAt: new Date().toISOString(),
      purpose: "manual consent", reference: "explicit manual evidence", attested: true }), randomUUID()))).rejects.toThrow();
    expect(await db.marketingPreference.count()).toBe(0);
  }
  const accepted = await post(f, token, "+82 1012345678", ["sms"], { [qs[1].id]: "QA" });
  const preference = await db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: accepted.body.id } });
  expect(decrypt(preference.contactCipher!)).toEqual({ name: "QA", contact: "+821012345678" });
});
