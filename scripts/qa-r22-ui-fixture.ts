import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { encrypt } from "../src/server/crypto";

const origin = process.env.QA_BASE_URL ?? "http://127.0.0.1:3199";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(origin).origin, "http://127.0.0.1:3199");
const password = randomBytes(24).toString("base64url") + "Aa!1";
const tag = randomUUID().slice(0, 8);
type Actor = { userId: string; email: string; password: string; cookie: string; memberId: string };

async function signup(label: string) {
  const email = `r22-${label}-${tag}@catchsecu.test`;
  const response = await fetch(origin + "/api/v1/auth/sign-up/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: `R22 ${label}`, email, password }) });
  assert.equal(response.status, 200, `${label} signup`);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  return { userId: user.id, email, password };
}
async function login(input: { email: string; password: string }) {
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(response.status, 200, `${input.email} login`);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

try {
  await db.rateLimit.deleteMany();
  await db.apiRateLimit.deleteMany();
  const ownerUser = await signup("owner"), recipientUser = await signup("recipient"),
    viewerUser = await signup("viewer"), foreignUser = await signup("foreign");
  const trial = await db.billingPlanVersion.findFirstOrThrow({ where: { planId: "trial" }, orderBy: { effectiveFrom: "desc" } });
  const now = new Date(), periodEnd = new Date(now.getTime() + 7 * 86400000);
  const fixture = await db.$transaction(async tx => {
    const company = await tx.company.create({ data: { name: `R22 감사 회사 ${tag}`, publicName: "R22 감사 회사",
      policy: { create: { passwordMonths: 0, activityReviewRetentionDays: 30 } } } });
    const foreignCompany = await tx.company.create({ data: { name: `R22 타회사 ${tag}`, publicName: "R22 타회사",
      policy: { create: { passwordMonths: 0 } } } });
    const ownerMember = await tx.membership.create({ data: { tenantId: company.id, userId: ownerUser.userId, role: "owner" } });
    const recipientMember = await tx.membership.create({ data: { tenantId: company.id, userId: recipientUser.userId, role: "privacy" } });
    const viewerMember = await tx.membership.create({ data: { tenantId: company.id, userId: viewerUser.userId, role: "viewer" } });
    const foreignMember = await tx.membership.create({ data: { tenantId: foreignCompany.id, userId: foreignUser.userId, role: "owner" } });
    const service = await tx.service.create({ data: { tenantId: company.id, name: "R22 감사 서비스", externalName: "r22-audit" } });
    const foreignService = await tx.service.create({ data: { tenantId: foreignCompany.id, name: "R22 타회사 서비스", externalName: "r22-foreign" } });
    await tx.serviceGrant.create({ data: { tenantId: company.id, memberId: recipientMember.id, serviceId: service.id,
      capabilities: ["service.read", "audit.read"] } });
    await tx.billingSubscription.createMany({ data: [
      { tenantId: company.id, planId: trial.planId, planVersionId: trial.id, status: "trialing", activationSource: "trial",
        priceKrw: 0, periodStart: now, periodEnd },
      { tenantId: foreignCompany.id, planId: trial.planId, planVersionId: trial.id, status: "trialing", activationSource: "trial",
        priceKrw: 0, periodStart: now, periodEnd },
    ] });
    const form = await tx.form.create({ data: { tenantId: company.id, serviceId: service.id, ownerId: ownerUser.userId, title: "R22 실제 감사 폼" } });
    const version = await tx.formVersion.create({ data: { tenantId: company.id, formId: form.id, number: 1, title: form.title, status: "published" } });
    const publication = await tx.publication.create({ data: { tenantId: company.id, formId: form.id, formVersionId: version.id,
      tokenHash: randomUUID(), tokenCipher: encrypt("r22-publication-token"), maxResponses: 100 } });
    const submission = await tx.submission.create({ data: { tenantId: company.id, formVersionId: version.id,
      publicationId: publication.id, retentionUntil: periodEnd, originalRetentionUntil: periodEnd } });
    const actions = [
      ["service", "service.r22_ui"], ["info", "submission.r22_ui"], ["marketing", "marketing.r22_ui"],
      ["customer", "subject.r22_ui"], ["member", "invitation.r22_ui"], ["authority", "policy.r22_ui"],
      ["external", "share.r22_ui"], ["access", "session.r22_ui"], ["mail", "campaign.r22_ui"],
    ] as const;
    const eventIds: Record<string, string> = {};
    for (const [kind, action] of actions) {
      const resource = action.split(".")[0], info = kind === "info";
      const event = await tx.auditEvent.create({ data: { tenantId: company.id, serviceId: service.id,
        actorId: info ? recipientUser.userId : ownerUser.userId, action, resource,
        resourceId: info ? submission.id : randomUUID(), requestId: randomUUID(), detail: { fixture: "r22" } } });
      eventIds[kind] = event.id;
    }
    const sameTime = new Date("2026-10-11T02:00:00.000Z");
    for (let index = 0; index < 21; index++) await tx.auditEvent.create({ data: { tenantId: company.id, serviceId: service.id,
      actorId: recipientUser.userId, action: "submission.r22_same_time", resource: "submission", resourceId: submission.id,
      requestId: randomUUID(), detail: { index }, createdAt: sameTime } });
    const kstRows = [];
    for (const [label, createdAt] of [["before", "2026-10-10T14:59:59.000Z"], ["start", "2026-10-10T15:00:00.000Z"]] as const) {
      const row = await tx.auditEvent.create({ data: { tenantId: company.id, serviceId: service.id, actorId: recipientUser.userId,
        action: `submission.r22_kst_boundary_${label}`, resource: "submission", resourceId: submission.id,
        requestId: randomUUID(), detail: { label }, createdAt: new Date(createdAt) } });
      kstRows.push({ id: row.id, label, createdAt });
    }
    const review = await tx.activityReview.create({ data: { tenantId: company.id, serviceId: service.id,
      auditEventId: eventIds.info, recipientUserId: recipientUser.userId, requesterId: ownerMember.id,
      recipientId: recipientMember.id, title: "R22 개인정보 활동 검토" } });
    await tx.activityReviewMessage.create({ data: { tenantId: company.id, reviewId: review.id,
      authorId: ownerMember.id, kind: "request", bodyCipher: encrypt("R22 화면 검토 요청 원문") } });
    await tx.auditEvent.create({ data: { tenantId: foreignCompany.id, serviceId: foreignService.id, actorId: foreignUser.userId,
      action: "service.r22_foreign", resource: "service", resourceId: foreignService.id, requestId: randomUUID(), detail: {} } });
    return { tenantId: company.id, foreignTenantId: foreignCompany.id, serviceId: service.id, foreignServiceId: foreignService.id,
      formId: form.id, submissionId: submission.id, reviewId: review.id, eventIds, kstRows,
      memberIds: { owner: ownerMember.id, recipient: recipientMember.id, viewer: viewerMember.id, foreign: foreignMember.id } };
  });
  const actors = {
    owner: { ...ownerUser, memberId: fixture.memberIds.owner, cookie: await login(ownerUser) },
    recipient: { ...recipientUser, memberId: fixture.memberIds.recipient, cookie: await login(recipientUser) },
    viewer: { ...viewerUser, memberId: fixture.memberIds.viewer, cookie: await login(viewerUser) },
    foreign: { ...foreignUser, memberId: fixture.memberIds.foreign, cookie: await login(foreignUser) },
  } satisfies Record<string, Actor>;
  const output = { origin, ...fixture, actors };
  await mkdir(".local", { recursive: true });
  await writeFile(".local/qa-r22-ui.json", JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: "passed", tenantId: fixture.tenantId, auditKinds: Object.keys(fixture.eventIds).length,
    sameTimeRows: 21, reviewId: fixture.reviewId, privateFixture: ".local/qa-r22-ui.json" }));
} finally { await db.$disconnect(); }
