import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm } from "@/server/forms";
import { formContentSchema } from "@/contracts/domains";
import { generateDisplayProposal, readDisplay } from "@/server/documents";
import { createPurpose, createRecipient } from "@/server/processing-catalog";
import { createSubprocessor } from "@/server/subprocessors";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "문안 생성 QA", publicName: "QA 회사", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA 서비스" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "display-" + randomUUID() + "@example.test", password = "Display-test!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "service.manage");
  await db.$transaction(async tx => {
    await createPurpose(tx, ctx, { serviceId, name: "이벤트 참여 관리", purpose: "이벤트 운영", lawfulBasis: "consent", basisReference: "",
      items: [{ name: "성명", kind: "general", required: true }], recipientIds: [], retentionMode: "until_purpose", retentionDays: null, retentionReason: "목적 달성 시까지" }, randomUUID());
    await createRecipient(tx, ctx, { serviceId, name: "QA 제공처", kind: "third_party", countryCode: "KR", purpose: "위탁 운영", items: ["성명"],
      retentionMode: "until_purpose", retentionDays: null, retentionReason: "목적 달성 시까지", contact: "", transferMethod: "", transferTiming: "", refusalNotice: "" }, randomUUID());
    await createSubprocessor(tx, ctx, serviceId, { name: "QA 수탁사", email: "sub@example.test", changeSummary: "등록" }, randomUUID());
  });
  const content = formContentSchema.parse({ body: "안내", questions: [
    { id: randomUUID(), type: "단문형 답변", label: "이름", required: true,
      catchFormPersonalInformationRequests: [{ nlpFeedbackId: null, personalInformationType: "PERSONAL_INFORMATION", detectedPersonalInformation: "성명", personalInformationSource: "USER" }] },
  ], font: "16px", bold: false, verify: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100, showSubmitNotice: true });
  await db.$transaction(tx => createForm(ctx, { serviceId, title: "문안 QA 폼", content }, randomUUID(), tx));
});
afterAll(async () => { await db.$disconnect(); });

test("collection proposal embeds purpose and subprocessor names with basis counts and audits fields only", async () => {
  const result = await generateDisplayProposal(ctx, serviceId, "collection", randomUUID());
  expect(result.basis).toMatchObject({ purposeCount: 1, subprocessorCount: 1, recipientCount: 0, itemCount: 1, truncated: false });
  expect(result.proposals.startText).toContain("QA 서비스");
  expect(result.proposals.startText).toContain("이벤트 참여 관리");
  expect(result.proposals.processorText).toContain("QA 수탁사");
  expect(result.proposals.requiredText).toContain("거부할 권리");
  expect(result.proposals.optionalText).toContain("지장이 없습니다");
  for (const text of Object.values(result.proposals)) expect(text.length).toBeLessThanOrEqual(200);
  const event = await db.auditEvent.findFirstOrThrow({ where: { action: "service.consent_display_generated" } });
  expect(JSON.stringify(event.detail)).not.toContain("QA 수탁사");
  expect(JSON.stringify(event.detail)).not.toContain("이벤트 참여 관리");
});
test("third_party proposal names recipients and keeps stored settings untouched until PATCH", async () => {
  const result = await generateDisplayProposal(ctx, serviceId, "third_party", randomUUID());
  expect(result.basis.recipientCount).toBe(1);
  expect(result.proposals.startText).toContain("제3자에게 제공");
  expect(result.proposals.processorText).toContain("제공받는 자");
  expect(result.proposals.processorText).toContain("QA 제공처");
  const stored = await readDisplay(ctx, serviceId, "third_party");
  expect(stored.version).toBe(0);
  expect(stored.startText).toBe("");
  expect(stored.processorText).toBe("");
});
test("empty catalog still yields safe fallback texts", async () => {
  const other = await db.service.create({ data: { tenantId: ctx.tenantId, name: "빈 서비스", externalName: "빈 서비스" } });
  const result = await generateDisplayProposal(ctx, other.id, "collection", randomUUID());
  expect(result.basis).toMatchObject({ purposeCount: 0, itemCount: 0, subprocessorCount: 0, recipientCount: 0 });
  expect(result.proposals.startText).toContain("수집·이용");
  expect(result.proposals.processorText).toBe("");
});
test("generation enforces service.manage and rejects archived services", async () => {
  await db.user.create({ data: { name: "Backup", email: randomUUID() + "@example.test", emailVerified: true,
    memberships: { create: { tenantId: ctx.tenantId, role: "owner" } } } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(generateDisplayProposal(ctx, serviceId, "collection", randomUUID())).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "owner" } });
  await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
  await expect(generateDisplayProposal(ctx, serviceId, "collection", randomUUID())).rejects.toMatchObject({ code: "SERVICE_ARCHIVED" });
});
test("long purpose lists are shortened and flagged as truncated", async () => {
  for (let index = 0; index < 8; index++)
    await db.$transaction(tx => createPurpose(tx, ctx, { serviceId, name: "아주 긴 처리 목적 이름 " + "가".repeat(40) + index, purpose: "목적",
      lawfulBasis: "consent", basisReference: "", items: [{ name: "성명", kind: "general", required: true }], recipientIds: [],
      retentionMode: "until_purpose", retentionDays: null, retentionReason: "목적 달성 시까지" }, randomUUID()));
  const result = await generateDisplayProposal(ctx, serviceId, "collection", randomUUID());
  expect(result.basis.truncated).toBe(true);
  expect(result.proposals.startText.length).toBeLessThanOrEqual(200);
});
