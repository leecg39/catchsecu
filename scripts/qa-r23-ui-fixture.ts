import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { encrypt } from "../src/server/crypto";
import { runOneComplianceExport } from "../src/server/compliance-exports";

const origin = process.env.QA_BASE_URL ?? "http://127.0.0.1:3199";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(origin).origin, "http://127.0.0.1:3199");
const password = randomBytes(24).toString("base64url") + "Aa!1", tag = randomUUID().slice(0, 8);

async function signup(label: string) {
  const email = `r23-${label}-${tag}@catchsecu.test`;
  const response = await fetch(origin + "/api/v1/auth/sign-up/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: `R23 ${label}`, email, password }) });
  assert.equal(response.status, 200, `${label} signup`);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  return { userId: user.id, email, password };
}
async function login(actor: { email: string; password: string }) {
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(actor) });
  assert.equal(response.status, 200, `${actor.email} login`);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", body?: unknown, key?: string) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

try {
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const ownerUser = await signup("owner"), viewerUser = await signup("viewer"), foreignUser = await signup("foreign");
  const trial = await db.billingPlanVersion.findFirstOrThrow({ where: { planId: "trial" }, orderBy: { effectiveFrom: "desc" } });
  const now = new Date(), month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now);
  const periodEnd = new Date(now.getTime() + 7 * 86400000), submittedAt = new Date(now.getTime() - 3600000);
  const fixture = await db.$transaction(async tx => {
    const company = await tx.company.create({ data: { name: `R23 통계 회사 ${tag}`, publicName: "R23 통계 회사",
      policy: { create: { passwordMonths: 0 } } } });
    const foreignCompany = await tx.company.create({ data: { name: `R23 타회사 ${tag}`, publicName: "R23 타회사",
      policy: { create: { passwordMonths: 0 } } } });
    const ownerMember = await tx.membership.create({ data: { tenantId: company.id, userId: ownerUser.userId, role: "owner" } });
    const viewerMember = await tx.membership.create({ data: { tenantId: company.id, userId: viewerUser.userId, role: "viewer" } });
    const foreignMember = await tx.membership.create({ data: { tenantId: foreignCompany.id, userId: foreignUser.userId, role: "owner" } });
    const serviceA = await tx.service.create({ data: { tenantId: company.id, name: "R23 서비스 A", externalName: "r23-a" } });
    const serviceB = await tx.service.create({ data: { tenantId: company.id, name: "R23 서비스 B", externalName: "r23-b" } });
    const foreignService = await tx.service.create({ data: { tenantId: foreignCompany.id, name: "R23 타회사 서비스", externalName: "r23-foreign" } });
    await tx.serviceGrant.create({ data: { tenantId: company.id, memberId: viewerMember.id, serviceId: serviceA.id,
      capabilities: ["service.read", "submission.read"] } });
    await tx.billingSubscription.createMany({ data: [
      { tenantId: company.id, planId: trial.planId, planVersionId: trial.id, status: "trialing", activationSource: "trial", priceKrw: 0, periodStart: now, periodEnd },
      { tenantId: foreignCompany.id, planId: trial.planId, planVersionId: trial.id, status: "trialing", activationSource: "trial", priceKrw: 0, periodStart: now, periodEnd },
    ] });
    async function form(serviceId: string, title: string) {
      const row = await tx.form.create({ data: { tenantId: company.id, serviceId, ownerId: ownerUser.userId, title, status: "published" } });
      const draft = await tx.formVersion.create({ data: { tenantId: company.id, formId: row.id, number: 1, title } });
      const nameQuestionId = randomUUID(), contactQuestionId = randomUUID();
      await tx.question.createMany({ data: [
        { tenantId: company.id, formVersionId: draft.id, stableKey: nameQuestionId, type: "단문형 답변", label: "이름", required: true, order: 0 },
        { tenantId: company.id, formVersionId: draft.id, stableKey: contactQuestionId, type: "이메일", label: "이메일", required: true, order: 1 },
      ] });
      const version = await tx.formVersion.update({ where: { id: draft.id }, data: { status: "published", publishedAt: submittedAt } });
      const publication = await tx.publication.create({ data: { tenantId: company.id, formId: row.id, formVersionId: version.id,
        tokenHash: randomUUID(), tokenCipher: encrypt(randomUUID()), maxResponses: 100 } });
      return { row, version, publication, nameQuestionId, contactQuestionId };
    }
    const a = await form(serviceA.id, "R23 수집 폼 A"), b = await form(serviceB.id, "R23 수집 폼 B");
    const submissions = [];
    for (let index = 0; index < 3; index++) submissions.push(await tx.submission.create({ data: { tenantId: company.id,
      formVersionId: a.version.id, publicationId: a.publication.id, submittedAt: new Date(submittedAt.getTime() + index * 1000),
      retentionUntil: periodEnd, originalRetentionUntil: periodEnd, legalHold: index === 1 } }));
    const serviceBSubmission = await tx.submission.create({ data: { tenantId: company.id, formVersionId: b.version.id,
      publicationId: b.publication.id, submittedAt, retentionUntil: periodEnd, originalRetentionUntil: periodEnd } });
    const destruction = await tx.destructionRequest.create({ data: { tenantId: company.id, serviceId: serviceA.id,
      submissionId: submissions[2].id, source: "manual", previousStatus: "submitted", status: "running", dueAt: submittedAt,
      requesterId: ownerUser.userId, approverId: ownerUser.userId, approvedAt: submittedAt, startedAt: submittedAt,
      leaseOwner: "r23-fixture", leaseUntil: periodEnd, attempts: 1 } });
    await tx.submission.update({ where: { id: submissions[2].id }, data: { status: "destroying" } });
    const certificate = await tx.destructionCertificate.create({ data: { tenantId: company.id, serviceId: serviceA.id,
      submissionId: submissions[2].id, requestId: destruction.id, counts: { answers: 0, files: 0 }, digest: createHash("sha256").update(submissions[2].id).digest("hex"), completedAt: now } });
    await tx.submission.update({ where: { id: submissions[2].id }, data: { status: "destroyed" } });
    await tx.destructionRequest.update({ where: { id: destruction.id }, data: { status: "completed", completedAt: now,
      leaseOwner: null, leaseUntil: null, version: { increment: 1 } } });
    const receipt = await tx.consentReceipt.create({ data: { tenantId: company.id, submissionId: submissions[0].id,
      purpose: "R23 통계 동의", documentHash: "a".repeat(64), retentionDays: 30, grantedAt: submittedAt } });
    await tx.consentEvent.create({ data: { tenantId: company.id, receiptId: receipt.id, type: "withdrawn", reason: "R23 철회", createdAt: now } });
    for (const [index, status] of ["granted", "withdrawn", "erased"].entries()) {
      const source = index === 2 ? submissions[1] : submissions[index];
      const preference = await tx.marketingPreference.create({ data: { tenantId: company.id, serviceId: serviceA.id,
        sourceSubmissionId: source.id, nameQuestionId: a.nameQuestionId, contactQuestionId: a.contactQuestionId, channel: "email",
        contactHash: createHash("sha256").update(`${tag}-${index}`).digest("hex"), contactCipher: status === "erased" ? null : encrypt(`r23-${index}@example.test`),
        nameHash: status === "erased" ? null : createHash("sha256").update(`R23 name ${index}`).digest("hex"),
        evidenceCipher: status === "erased" ? null : encrypt(JSON.stringify({ purpose: "R23", reference: `R23-${index}` })),
        evidenceHash: createHash("sha256").update(`evidence-${tag}-${index}`).digest("hex"), sourceKind: "form", grantedAt: submittedAt,
        status, withdrawnAt: status === "withdrawn" ? now : null, version: status === "granted" ? 1 : 2 } });
      await tx.marketingEvent.create({ data: { tenantId: company.id, preferenceId: preference.id,
        kind: status === "granted" ? "granted" : status, version: preference.version, createdAt: now } });
    }
    await tx.document.createMany({ data: [
      { tenantId: company.id, serviceId: serviceA.id, createdBy: ownerUser.userId, type: "consent", title: "R23 동의서", effectiveDate: month + "-01", status: "published" },
      { tenantId: company.id, serviceId: serviceA.id, createdBy: ownerUser.userId, type: "privacy_policy", title: "R23 처리방침", effectiveDate: month + "-01", status: "published" },
    ] });
    return { tenantId: company.id, foreignTenantId: foreignCompany.id, serviceAId: serviceA.id, serviceBId: serviceB.id,
      foreignServiceId: foreignService.id, submissionIds: submissions.map(row => row.id), serviceBSubmissionId: serviceBSubmission.id,
      certificateId: certificate.id, memberIds: { owner: ownerMember.id, viewer: viewerMember.id, foreign: foreignMember.id }, month };
  });
  const actors = {
    owner: { ...ownerUser, memberId: fixture.memberIds.owner, cookie: await login(ownerUser) },
    viewer: { ...viewerUser, memberId: fixture.memberIds.viewer, cookie: await login(viewerUser) },
    foreign: { ...foreignUser, memberId: fixture.memberIds.foreign, cookie: await login(foreignUser) },
  };
  const closeResponse = await api(actors.owner.cookie, "/analytics/closes", "POST", { month, serviceId: fixture.serviceAId });
  assert.equal(closeResponse.status, 200, "create close");
  const close = (await closeResponse.json()).close;
  for (let index = 0; index < 11; index++) {
    const created = await api(actors.owner.cookie, "/analytics/exports", "POST", { closeId: close.id, format: "csv" }, randomUUID());
    assert.equal(created.status, 202, `export ${index}`);
    const job = await created.json();
    assert.equal(await runOneComplianceExport(`r23-fixture-${index}`, new Date(), job.id), true);
  }
  const output = { origin, ...fixture, closeId: close.id, actors };
  await mkdir(".local", { recursive: true });
  await writeFile(".local/qa-r23-ui.json", JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: "passed", tenantId: fixture.tenantId, serviceA: fixture.serviceAId,
    collected: 3, withdrawnConsent: 1, destroyed: 1, exports: 11, privateFixture: ".local/qa-r23-ui.json" }));
} finally { await db.$disconnect(); }
