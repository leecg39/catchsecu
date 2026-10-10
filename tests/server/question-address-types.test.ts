import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { copyForm, createForm, fingerprint, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, useTemplate } from "@/server/templates";
import { submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctionInput, correctSubmission, getSubmission } from "@/server/submission-management";
import { exportSubmissions } from "@/server/submission-export";
import { createExport, downloadExport, getExport, runOneExport } from "@/server/exports";
import { createShare } from "@/server/sharing";
import { getSharedSubmission, listSharedSubmissions, startViewerChallenge, verifyViewerChallenge } from "@/server/viewer";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { emptyAnswer, formatAnswer, type Answers, type QuestionDefinition } from "@/contracts/questions";
import { domesticAddressError, emptyForeignAddress, foreignAddressError, foreignAddressFields, foreignAddressSchema,
  formatForeignAddress, normalizeForeignAddress, serializeDomesticAddress, type ForeignAddress } from "@/contracts/address-questions";
import { submissionFilters } from "@/contracts/submissions";
import { subjectQuestionTypeAllowed } from "@/contracts/subjects";
import { marketingQuestionTypeAllowed } from "@/contracts/marketing";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Address question QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } }); serviceId = company.services[0].id;
  const email = "address-question-" + randomUUID() + "@example.test", password = "Address-question!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

const domestic = "(06236) 서울 강남구 테헤란로 152 3층";
const foreign: ForeignAddress = { country: "US", countryName: "미국", streetAddress: "123 Main Street", addressDetail: "Suite 200", city: "San Francisco", state: "CA", postalCode: "94105" };
const addressKeys = ["country", "countryName", "streetAddress", "addressDetail", "city", "state", "postalCode"];
function addressQuestions(required = false): QuestionDefinition[] {
  return [{ id: randomUUID(), type: "주소", label: "국내 주소", required }, { id: randomUUID(), type: "해외 주소", label: "해외 주소", required }];
}
async function fixture(questions = addressQuestions()) {
  const content = formContentSchema.parse({ body: "", questions, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "주소 질문", content }, randomUUID(), tx));
  return { form, questions, content };
}
async function publish(id: string, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}
async function post(token: string, answers: unknown) {
  return submitForm(token, submissionInput.parse({ answers, consent: false }), randomUUID(), randomUUID());
}
async function correct(id: string, answers: unknown, version = 1) {
  return correctSubmission(ctx, id, correctionInput.parse({ version, reason: "주소 정보 정정", answers }), randomUUID());
}
async function storedAnswers(id: string) { return db.answer.findMany({ where: { submissionId: id }, orderBy: { id: "asc" } }); }
async function submissionState(formId: string) {
  return { submissions: await db.submission.count(), answers: await db.answer.count(),
    count: (await db.publication.findFirstOrThrow({ where: { formId, status: "active" } })).responseCount,
    audits: await db.auditEvent.count({ where: { action: "submission.created" } }) };
}

test("address helpers preserve the original scalar and seven-key representation with canonical Korean country metadata", () => {
  expect(serializeDomesticAddress(" 06236 ", " 서울 강남구 테헤란로 152 ", " 3층 ")).toBe(domestic);
  expect(serializeDomesticAddress("", "", "")).toBe("");
  expect(domesticAddressError(domestic, true)).toBeUndefined();
  expect(domesticAddressError(" ", true)).toBeDefined();
  expect(normalizeForeignAddress(undefined)).toEqual(emptyForeignAddress());
  const normalized = normalizeForeignAddress({ ...foreign, country: " US ", countryName: "not the selected country", city: " San Francisco " });
  expect(normalized).toEqual(foreign); expect(Object.keys(normalized)).toEqual(addressKeys);
  expect(normalizeForeignAddress({ ...emptyForeignAddress(), countryName: "untrusted label" })).toEqual(emptyForeignAddress());
  expect(emptyAnswer("해외 주소")).toEqual(emptyForeignAddress());
  expect(formatAnswer(foreign, undefined, undefined, "해외 주소")).toBe(formatForeignAddress(foreign));
  expect(formatForeignAddress(foreign)).toContain("미국 (US)");
  expect(formatForeignAddress(foreign)).toContain("123 Main Street");
  for (const type of ["주소", "해외 주소"]) {
    for (const role of ["name", "email"]) expect(subjectQuestionTypeAllowed(role, type)).toBe(false);
    for (const kind of ["name", "email", "sms", "kakao"] as const) expect(marketingQuestionTypeAllowed(kind, type)).toBe(false);
  }
});

test("both address types publish and store only encrypted normalized scalar/object answers", async () => {
  const f = await fixture(addressQuestions(true)), token = await publish(f.form.id), [local, overseas] = f.questions;
  expect((await activePublicForm(token)).content.questions.map(q => q.type)).toEqual(["주소", "해외 주소"]);
  const result = await post(token, { [local.id]: " " + domestic + " ", [overseas.id]: { ...foreign, countryName: "Canada", city: " San Francisco " } });
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toEqual({ [local.id]: domestic, [overseas.id]: foreign });
  const stored = await storedAnswers(result.body.id);
  expect(stored.map(a => a.valueType).sort()).toEqual(["주소", "해외 주소"].sort());
  expect(stored.every(a => a.valueCipher.startsWith("v1.") && !a.valueCipher.includes("Main Street") && !a.valueCipher.includes("테헤란로"))).toBe(true);
  const foreignStored = stored.find(a => a.valueType === "해외 주소")!;
  expect(Object.keys(decrypt<ForeignAddress>(foreignStored.valueCipher))).toEqual(addressKeys);
});

test("optional omission is an empty seven-field object while required omissions and partial core fields fail atomically", async () => {
  const optional = await fixture(), optionalToken = await publish(optional.form.id);
  const result = await post(optionalToken, {});
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toEqual({ [optional.questions[0].id]: "", [optional.questions[1].id]: emptyForeignAddress() });
  const required = await fixture(addressQuestions(true)), token = await publish(required.form.id), [local, overseas] = required.questions;
  const before = await submissionState(required.form.id);
  await expect(post(token, {})).rejects.toMatchObject({ code: "REQUIRED_ANSWER" });
  await expect(post(token, { [local.id]: domestic })).rejects.toMatchObject({ code: "REQUIRED_ANSWER" });
  await expect(post(token, { [local.id]: domestic, [overseas.id]: { ...emptyForeignAddress(), addressDetail: "Suite only" } })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  expect(await submissionState(required.form.id)).toEqual(before);
});

test("optional foreign core fields are all-or-none but detail/state/postal-only values remain permitted", async () => {
  const f = await fixture(), token = await publish(f.form.id), id = f.questions[1].id;
  const core = ["country", "streetAddress", "city"] as const;
  for (let mask = 1; mask < 7; mask++) {
    const value = emptyForeignAddress(); core.forEach((key, index) => { if (mask & (1 << index)) value[key] = foreign[key]; });
    expect(foreignAddressError(value, false)).toBeDefined();
    await expect(post(token, { [id]: value })).rejects.toMatchObject({ status: 422, code: "INVALID_ADDRESS" });
  }
  for (const key of ["addressDetail", "state", "postalCode"] as const) {
    const value = { ...emptyForeignAddress(), [key]: "detail only" };
    expect(foreignAddressError(value, false)).toBeUndefined();
    const result = await post(token, { [id]: value });
    expect((await getSubmission(ctx, result.body.id, randomUUID())).values[id]).toEqual(value);
  }
  expect((await post(token, { [id]: foreign })).status).toBe(201);
});

test("foreign strings, arrays, empty/incomplete objects, extra keys and unknown countries never create submissions", async () => {
  const f = await fixture(), token = await publish(f.form.id), id = f.questions[1].id, before = await submissionState(f.form.id);
  const invalid = ["", "address", [], {}, null, 123, { country: "US" }, { ...foreign, extra: "unexpected" },
    { ...foreign, country: "ZZ" }, { ...foreign, country: "us" }, { ...foreign, city: [] }, { ...foreign, postalCode: 12345 }];
  for (const value of invalid) {
    expect(foreignAddressSchema.safeParse(value).success).toBe(false);
    await expect(post(token, { [id]: value })).rejects.toThrow();
  }
  expect(await submissionState(f.form.id)).toEqual(before);
});

test("all foreign field maxima are accepted and one character beyond each limit is rejected without side effects", async () => {
  const f = await fixture(), token = await publish(f.form.id), id = f.questions[1].id;
  const limits: [keyof ForeignAddress, number][] = [...foreignAddressFields.map(field => [field.key, field.maxLength] as [keyof ForeignAddress, number]), ["countryName", 100]];
  for (const [key, max] of limits) {
    const result = await post(token, { [id]: { ...foreign, [key]: "가".repeat(max) } });
    expect((await getSubmission(ctx, result.body.id, randomUUID())).values[id]).toMatchObject({ [key]: key === "countryName" ? "미국" : "가".repeat(max) });
    const before = await submissionState(f.form.id);
    await expect(post(token, { [id]: { ...foreign, [key]: "가".repeat(max + 1) } })).rejects.toThrow();
    expect(await submissionState(f.form.id)).toEqual(before);
  }
});

test("domestic addresses require five postal digits and a nonblank address within the fixed 1000-character limit", async () => {
  const f = await fixture(), token = await publish(f.form.id), id = f.questions[0].id;
  const maximum = "(12345) " + "가".repeat(992); expect(maximum).toHaveLength(1000);
  expect((await post(token, { [id]: maximum })).status).toBe(201);
  const before = await submissionState(f.form.id);
  for (const value of ["서울 주소", "(1234) 주소", "(123456) 주소", "(abcde) 주소", "(12345)", "(12345)   ", maximum + "가"])
    await expect(post(token, { [id]: value })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  for (const value of [[], foreign]) await expect(post(token, { [id]: value })).rejects.toMatchObject({ code: "INVALID_ANSWER_TYPE" });
  expect(await submissionState(f.form.id)).toEqual(before);
});

test("foreign addresses and UUID-key matrix objects cannot be injected into each other's question type", async () => {
  const matrixRow = randomUUID(), matrixId = randomUUID();
  const f = await fixture([...addressQuestions(), { id: matrixId, type: "행렬형 단일 선택", label: "행렬", required: false,
    options: ["좋음"], rows: [{ id: matrixRow, label: "한 행" }] }]), token = await publish(f.form.id);
  const before = await submissionState(f.form.id);
  await expect(post(token, { [f.questions[1].id]: { [matrixRow]: "좋음" } })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
  await expect(post(token, { [matrixId]: foreign })).rejects.toMatchObject({ code: "UNKNOWN_MATRIX_ROW" });
  expect(await submissionState(f.form.id)).toEqual(before);
  const result = await post(token, { [matrixId]: { [matrixRow]: "좋음" }, [f.questions[1].id]: foreign });
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toMatchObject({ [matrixId]: { [matrixRow]: "좋음" }, [f.questions[1].id]: foreign });
});

test("hidden address inputs reject nonempty payloads, preserve legacy empty payloads and clear earlier values on correction", async () => {
  const parent = randomUUID(), questions = addressQuestions(true).map(question => ({ ...question, condition: { questionId: parent, operator: "equals" as const, value: "예" } }));
  const f = await fixture([{ id: parent, type: "객관식 답변", label: "주소 수집", required: true, options: ["예", "아니오"] }, ...questions]);
  const token = await publish(f.form.id), [local, overseas] = questions;
  await expect(post(token, { [parent]: "아니오", [overseas.id]: foreign })).rejects.toMatchObject({ code: "HIDDEN_ANSWER" });
  await expect(post(token, { [parent]: "아니오", [local.id]: domestic })).rejects.toMatchObject({ code: "HIDDEN_ANSWER" });
  for (const empty of ["", [], {}, emptyForeignAddress()]) {
    const result = await post(token, { [parent]: "아니오", [overseas.id]: empty });
    expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toEqual({ [parent]: "아니오", [local.id]: "", [overseas.id]: emptyForeignAddress() });
  }
  const visible = await post(token, { [parent]: "예", [local.id]: domestic, [overseas.id]: foreign });
  await correct(visible.body.id, { [parent]: "아니오" });
  expect((await getSubmission(ctx, visible.body.id, randomUUID())).values).toEqual({ [parent]: "아니오", [local.id]: "", [overseas.id]: emptyForeignAddress() });
});

test("failed mixed corrections keep the complete snapshot, version, ciphertext, audit and correction records unchanged", async () => {
  const f = await fixture(), token = await publish(f.form.id), [local, overseas] = f.questions;
  const result = await post(token, { [local.id]: domestic, [overseas.id]: foreign }), before = await storedAnswers(result.body.id);
  const row = await db.submission.findUniqueOrThrow({ where: { id: result.body.id } }), audits = await db.auditEvent.count({ where: { action: "submission.corrected" } });
  for (const value of [{ ...foreign, city: "" }, {}, { ...foreign, city: "가".repeat(101) }, { ...foreign, extra: "no" }])
    await expect(correct(result.body.id, { [local.id]: "(12345) 정상 정정", [overseas.id]: value })).rejects.toThrow();
  expect(await storedAnswers(result.body.id)).toEqual(before);
  expect(await db.submission.findUniqueOrThrow({ where: { id: result.body.id } })).toEqual(row);
  expect(await db.correction.count()).toBe(0); expect(await db.correctionPayload.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "submission.corrected" } })).toBe(audits);
  await correct(result.body.id, { [overseas.id]: { ...foreign, city: "Los Angeles" } });
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toEqual({ [local.id]: domestic, [overseas.id]: { ...foreign, city: "Los Angeles" } });
  expect(await db.correction.count()).toBe(1);
});

test("key-order, whitespace or country-label-only corrections are canonical NO_CHANGES", async () => {
  const f = await fixture(), token = await publish(f.form.id), id = f.questions[1].id, result = await post(token, { [id]: foreign });
  const before = await storedAnswers(result.body.id), reverse = Object.fromEntries(Object.entries(foreign).reverse());
  for (const value of [reverse, { ...reverse, countryName: "different country" }, { ...reverse, streetAddress: " 123 Main Street " }])
    await expect(correct(result.body.id, { [id]: value })).rejects.toMatchObject({ status: 422, code: "NO_CHANGES" });
  expect(await storedAnswers(result.body.id)).toEqual(before); expect(await db.correction.count()).toBe(0);
});

test("copy, template and revision preserve address types and retain the historical publication, approval fingerprint and answer bytes", async () => {
  const f = await fixture(), token = await publish(f.form.id), answers: Answers = { [f.questions[0].id]: domestic, [f.questions[1].id]: foreign };
  const response = await post(token, answers), before = await storedAnswers(response.body.id);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" }, include: versionInclude }), hash = fingerprint(version);
  const copied = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "주소 템플릿", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  for (const made of [copied, used]) {
    expect(made.content!.questions.map(q => q.type)).toEqual(["주소", "해외 주소"]);
    expect(made.content!.questions.every(q => !f.questions.some(original => original.id === q.id))).toBe(true);
  }
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const draft = await readForm(ctx, f.form.id); expect(draft.content!.questions.map(q => q.id)).toEqual(f.questions.map(q => q.id));
  draft.content!.questions[1] = { ...draft.content!.questions[1], type: "단문형 답변", label: "새 자유 입력" };
  await updateForm(ctx, f.form.id, { version: 3, content: draft.content! }, randomUUID()); await publish(f.form.id, 4);
  const old = await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude });
  expect(old).toEqual(version); expect(fingerprint(old)).toBe(hash); expect(await storedAnswers(response.body.id)).toEqual(before);
  const detail = await getSubmission(ctx, response.body.id, randomUUID()); expect(detail.values).toEqual(answers);
  expect(detail.questions.map(q => q.type)).toEqual(["주소", "해외 주소"]);
  await expect(correct(response.body.id, { [f.questions[1].id]: "now a string" })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
});

test("sync and worker CSV emit canonical seven-key JSON or an empty cell without changing scalar/choice/matrix output", async () => {
  const matrixRow = randomUUID(), scalar = randomUUID(), choice = randomUUID(), matrix = randomUUID();
  const f = await fixture([...addressQuestions(), { id: scalar, type: "단문형 답변", label: "텍스트", required: false },
    { id: choice, type: "체크박스", label: "선택", required: false, options: ["A", "B"] },
    { id: matrix, type: "행렬형 단일 선택", label: "행렬", required: false, options: ["좋음"], rows: [{ id: matrixRow, label: "행" }] }]);
  const token = await publish(f.form.id), [local, overseas] = f.questions;
  const address = { ...foreign, addressDetail: 'Suite "200", North\nWing' };
  const full = await post(token, { [local.id]: domestic, [overseas.id]: address, [scalar]: "plain text", [choice]: ["A", "B"], [matrix]: { [matrixRow]: "좋음" } });
  const empty = await post(token, {}), detailOnlyValue = { ...emptyForeignAddress(), addressDetail: "Suite only" };
  const detailOnly = await post(token, { [overseas.id]: detailOnlyValue });
  const filters = submissionFilters.parse({}), sync = await exportSubmissions(ctx, f.form.id, filters, randomUUID());
  const rows = parse(sync.csv, { bom: true }) as string[][];
  const fullRow = rows.find(row => row[0] === full.body.id)!;
  expect(fullRow.slice(7)).toEqual([domestic, JSON.stringify(address), "plain text", '["A","B"]', "좋음"]);
  expect(JSON.parse(fullRow[8])).toEqual(address); expect(Object.keys(JSON.parse(fullRow[8]))).toEqual(addressKeys);
  expect(rows.find(row => row[0] === empty.body.id)!.slice(7)).toEqual(["", "", "", "[]", ""]);
  expect(rows.find(row => row[0] === detailOnly.body.id)![8]).toBe(JSON.stringify(detailOnlyValue));
  const job = await createExport(ctx, { formId: f.form.id, filters }, randomUUID(), randomUUID());
  for (let step = 0; step < 5 && (await getExport(ctx, job.id)).status !== "ready"; step++)
    expect(await runOneExport("address-test", new Date(), job.id)).toBe(true);
  expect((await getExport(ctx, job.id)).status).toBe("ready");
  expect((await downloadExport(ctx, job.id, randomUUID())).csv).toBe(sync.csv);
});

test("authenticated external sharing returns only selected canonical address objects and the original question types", async () => {
  const secret = randomUUID(), f = await fixture([...addressQuestions(), { id: secret, type: "단문형 답변", label: "공유 제외", required: false }]);
  const token = await publish(f.form.id), [local, overseas] = f.questions;
  const result = await post(token, { [local.id]: domestic, [overseas.id]: foreign, [secret]: "private" });
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" } });
  const share = await db.$transaction(tx => createShare(ctx, { formId: f.form.id, formVersionId: version.id, questionIds: [local.id, overseas.id],
    email: "address-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const inviteJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:" + share.version } });
  const invite = decrypt<{ text: string; to: string }>(inviteJob.payloadCipher);
  const invitationCode = invite.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1];
  const challenge = await startViewerChallenge({ formCode: f.form.id, invitationCode, email: invite.to, consent: true }, randomUUID());
  const challengeJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } });
  const code = decrypt<{ text: string }>(challengeJob.payloadCipher).text.match(/인증코드: (\d{6})/)![1];
  const session = await verifyViewerChallenge(challenge.id, code, challenge.client, randomUUID());
  const detail = await getSharedSubmission(session.token, result.body.id, randomUUID());
  expect(detail.values).toEqual({ [local.id]: domestic, [overseas.id]: foreign }); expect(detail.values).not.toHaveProperty(secret);
  const page = await listSharedSubmissions(session.token, 1, 20, randomUUID());
  expect(page.items[0].values).toEqual(detail.values); expect(page.viewer.questions.map(q => q.type)).toEqual(["주소", "해외 주소"]);
  expect(formatAnswer(detail.values[overseas.id], undefined, undefined, "해외 주소")).toContain("도시: San Francisco");
});

test("existing scalar and choice publications remain unchanged when a draft later switches to address types", async () => {
  const oldQuestions: QuestionDefinition[] = [{ id: randomUUID(), type: "단문형 답변", label: "기존 주소 텍스트", required: false },
    { id: randomUUID(), type: "객관식 답변", label: "선택", required: false, options: ["기존 선택"] }];
  const f = await fixture(oldQuestions), token = await publish(f.form.id);
  const answers = { [oldQuestions[0].id]: "구형 주소는 우편번호 없이 그대로 보존", [oldQuestions[1].id]: "기존 선택" };
  const response = await post(token, answers), before = await storedAnswers(response.body.id);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" }, include: versionInclude }), hash = fingerprint(version);
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const draft = await readForm(ctx, f.form.id);
  draft.content!.questions = draft.content!.questions.map((q, index) => ({ id: q.id, label: q.label, required: false, type: index ? "해외 주소" : "주소" }));
  await updateForm(ctx, f.form.id, { version: 3, content: draft.content! }, randomUUID()); await publish(f.form.id, 4);
  const old = await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude });
  expect(old).toEqual(version); expect(fingerprint(old)).toBe(hash); expect(await storedAnswers(response.body.id)).toEqual(before);
  expect((await getSubmission(ctx, response.body.id, randomUUID())).values).toEqual(answers);
  const csv = await exportSubmissions(ctx, f.form.id, submissionFilters.parse({}), randomUUID());
  expect((parse(csv.csv, { bom: true }) as string[][])[1].slice(7)).toEqual(Object.values(answers));
});
