import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm } from "@/server/forms";
import { formContentSchema } from "@/contracts/domains";
import { classifyText, analyzePersonalInformation, recordPersonalInformationFeedback } from "@/server/question-nlp";
import { nlpAnalyzeInput, nlpFeedbackInput, type NlpAnalyzedItem } from "@/contracts/question-nlp";
import { collectConsentItems } from "@/contracts/consent-items";
import { hasResidentPersonalInformation, type QuestionPersonalInformation } from "@/contracts/question-personal-information";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "NLP QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "nlp-" + randomUUID() + "@example.test", password = "Nlp-test!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => { await db.$disconnect(); });

const nlp = (type: QuestionPersonalInformation["personalInformationType"], name = "항목"): NlpAnalyzedItem =>
  ({ nlpFeedbackId: randomUUID(), personalInformationType: type, detectedPersonalInformation: name, personalInformationSource: "NLP" });
const user = (type: QuestionPersonalInformation["personalInformationType"], name = "항목"): QuestionPersonalInformation =>
  ({ nlpFeedbackId: null, personalInformationType: type, detectedPersonalInformation: name, personalInformationSource: "USER" });
const hits = (items: { type: string; name: string }[]) => items.map(i => ({ type: i.type, name: i.name }));
const content = (classifications?: unknown, overrides: Record<string, unknown> = {}) => formContentSchema.parse({ body: "안내", questions: [
  { id: randomUUID(), type: "단문형 답변", label: "이름을 입력해주세요", required: false,
    ...(classifications === undefined ? {} : { catchFormPersonalInformationRequests: classifications }), ...overrides },
], font: "16px", bold: false, verify: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100, showSubmitNotice: true });

test("classifyText detects Korean personal-information cues in label order with dedup and type hints", () => {
  expect(hits(classifyText({ label: "성명과 휴대폰번호를 입력해주세요", questionType: "단문형 답변" }).items))
    .toEqual([{ type: "PERSONAL_INFORMATION", name: "성명" }, { type: "PERSONAL_INFORMATION", name: "휴대폰번호" }]);
  expect(classifyText({ label: "연락처를 알려주세요", questionType: "단문형 답변" }).items[0].suggest).toBe("연락처");
  expect(classifyText({ label: "이메일 주소를 입력해주세요", questionType: "객관식 답변" }).items[0].suggest).toBe("이메일 직접 입력");
  expect(classifyText({ label: "주민등록번호를 입력해주세요", questionType: "객관식 답변" }).items[0]).toMatchObject({ type: "RESIDENT", name: "주민등록번호", suggest: "단문형 답변" });
  expect(classifyText({ label: "건강 상태를 적어주세요", questionType: "장문형 답변" }).items[0]).toMatchObject({ type: "SENSITIVE", name: "건강정보" });
  expect(classifyText({ label: "개선 의견을 알려주세요", questionType: "단문형 답변" }).items).toEqual([]);
  expect(hits(classifyText({ label: "연락처와 전화번호", questionType: "단문형 답변" }).items)).toHaveLength(1);
  expect(hits(classifyText({ label: "선택하세요", questionType: "객관식 답변", optionLabels: ["이름", "이메일"] }).items)).toEqual([{ type: "PERSONAL_INFORMATION", name: "성명" }, { type: "PERSONAL_INFORMATION", name: "이메일" }]);
  expect(classifyText({ label: "이름을 입력해주세요", questionType: "행렬형 단일 선택" }).items).toEqual([]);
});
test("analyzePersonalInformation returns uuid feedback ids only for Korean non-matrix questions and enforces service scope", async () => {
  const result = await analyzePersonalInformation(ctx, serviceId, { formLanguage: "ko", questionType: "단문형 답변", label: "이름과 이메일을 입력해주세요" });
  expect(result.items.map(i => i.detectedPersonalInformation)).toEqual(["성명", "이메일"]);
  expect(result.items.every(i => i.personalInformationSource === "NLP" && i.nlpFeedbackId)).toBe(true);
  expect(result.suggestedType).toBe("이메일 직접 입력");
  expect(await analyzePersonalInformation(ctx, serviceId, { formLanguage: "en", questionType: "단문형 답변", label: "이름" })).toEqual({ engine: "local-deterministic-v1", items: [], suggestedType: null });
  expect((await analyzePersonalInformation(ctx, serviceId, { formLanguage: "ko", questionType: "행렬형 단일 선택", label: "이름" })).items).toEqual([]);
  await expect(analyzePersonalInformation(ctx, randomUUID(), { formLanguage: "ko", questionType: "단문형 답변", label: "이름" })).rejects.toMatchObject({ status: 404 });
  expect(() => nlpAnalyzeInput.parse({ formLanguage: "xx", questionType: "단문형 답변", label: "이름" })).toThrow();
  await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
  await expect(analyzePersonalInformation(ctx, serviceId, { formLanguage: "ko", questionType: "단문형 답변", label: "이름" })).rejects.toMatchObject({ code: "SERVICE_ARCHIVED" });
});
test("analyzePersonalInformation rejects readers and rechecks current membership", async () => {
  await db.user.create({ data: { name: "Backup", email: randomUUID() + "@example.test", emailVerified: true,
    memberships: { create: { tenantId: ctx.tenantId, role: "owner" } } } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(analyzePersonalInformation(ctx, serviceId, { formLanguage: "ko", questionType: "단문형 답변", label: "이름" })).rejects.toMatchObject({ status: 403 });
});
test("recordPersonalInformationFeedback validates input and audits counts and types without item names", async () => {
  const proposed = [nlp("PERSONAL_INFORMATION", "이름")], corrected = [user("IDENTIFICATION", "주민등록")];
  expect(await recordPersonalInformationFeedback(ctx, serviceId, { formLanguage: "ko", questionType: "단문형 답변", label: "문항", proposed, corrected }, randomUUID())).toEqual({ recorded: true });
  const event = await db.auditEvent.findFirstOrThrow({ where: { action: "form.question_pi_feedback" } });
  expect(JSON.stringify(event.detail)).not.toContain("이름");
  expect(JSON.stringify(event.detail)).not.toContain("주민등록");
  expect(event.detail).toMatchObject({ changedFields: ["corrected:IDENTIFICATION"], count: 1 });
  expect(() => nlpFeedbackInput.parse({ formLanguage: "ko", questionType: "단문형 답변", label: "", proposed, corrected })).toThrow();
  expect(() => nlpFeedbackInput.parse({ formLanguage: "ko", questionType: "단문형 답변", label: "문항", proposed: [{ ...proposed[0], nlpFeedbackId: null }], corrected })).toThrow();
  expect(() => nlpFeedbackInput.parse({ formLanguage: "ko", questionType: "단문형 답변", label: "문항", proposed: [user("PERSONAL_INFORMATION")], corrected })).toThrow();
});
test("schema enforces source feedback-id pairing while form storage preserves NLP items and consent projection", async () => {
  expect(() => nlpFeedbackInput.parse({ formLanguage: "ko", questionType: "단문형 답변", label: "문항", proposed: [nlp("PERSONAL_INFORMATION")], corrected: [] })).not.toThrow();
  const items = [nlp("PERSONAL_INFORMATION", "이름"), user("SENSITIVE", "건강")];
  const input = content(items);
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "NLP 분류", content: input }, randomUUID(), tx));
  const saved = (await readForm(ctx, form.id)).content!.questions[0].catchFormPersonalInformationRequests!;
  expect(saved).toEqual(items);
  const stored = (await db.question.findMany({ where: { formVersion: { formId: form.id }, NOT: { catchFormPersonalInformationRequests: { equals: Prisma.DbNull } } } }))
    .flatMap(row => row.catchFormPersonalInformationRequests as QuestionPersonalInformation[]);
  expect(stored.map(i => i.personalInformationSource)).toEqual(["NLP", "USER"]);
  expect(stored[0].nlpFeedbackId).toBe(items[0].nlpFeedbackId);
  expect(stored[1].nlpFeedbackId).toBeNull();
  expect(collectConsentItems((await readForm(ctx, form.id)).content!.questions))
    .toEqual([{ type: "PERSONAL_INFORMATION", name: "이름" }, { type: "SENSITIVE", name: "건강" }]);
  expect(() => content([{ ...nlp("PERSONAL_INFORMATION"), nlpFeedbackId: null }])).toThrow();
  expect(() => content([{ ...user("PERSONAL_INFORMATION"), nlpFeedbackId: randomUUID() }])).toThrow();
});
test("RESIDENT NLP items keep required enforcement and matrix prohibition per source", async () => {
  const resident = nlp("RESIDENT", "주민등록번호");
  expect(hasResidentPersonalInformation([resident])).toBe(true);
  expect(() => content([resident])).toThrow();
  expect(() => content([resident], { required: true })).not.toThrow();
  expect(() => content([{ ...resident, personalInformationType: "SENSITIVE" }], { type: "행렬형 단일 선택" })).toThrow();
  expect(() => content([{ ...resident, personalInformationType: "NON_PERSONAL_INFORMATION", detectedPersonalInformation: "" }], { type: "행렬형 단일 선택" })).not.toThrow();
});
