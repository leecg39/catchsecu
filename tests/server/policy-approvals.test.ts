import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { decrypt } from "@/server/crypto";
import { policyDefaults } from "@/contracts/security";
import type { Role, Prisma } from "@/generated/prisma/client";
import { GET as policyGet, PATCH as policyPatch, DELETE as policyReset } from "@/app/api/v1/security/policy/route";
import { GET as approvalList } from "@/app/api/v1/approvals/route";
import { GET as approvalGet, POST as decide, DELETE as cancel } from "@/app/api/v1/approvals/[...segments]/route";
import { GET as formGet, POST as action, PATCH as formPatch, DELETE as formArchive } from "@/app/api/v1/forms/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as context, POST as switchContext } from "@/app/api/v1/context/route";
import { GET as publicGet, POST as publicSubmit } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, password = "Policy-test-password!123";
const tenant = randomUUID(), foreignTenant = randomUUID(), service = randomUUID(), hiddenService = randomUUID();
const cookies: Record<string, string> = {}, users: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "", ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const authCall = (path: string, data: unknown, who = "owner") => auth.handler(req("/auth" + path, "POST", who, data));
async function signup(role: Role, company = tenant, name = role as string) {
  await db.rateLimit.deleteMany();
  const email = name + "@policy.test.local";
  const response = await authCall("/sign-up/email", { name, email, password });
  expect(response.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); users[name] = user.id;
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  if (company === tenant) await db.serviceGrant.create({ data: { tenantId: tenant, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const login = await authCall("/sign-in/email", { email, password }); expect(login.status).toBe(200); cookies[name] = cookieOf(login);
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreignTenant]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  await db.service.createMany({ data: [{ id: service, tenantId: tenant, name: "승인 서비스", externalName: "승인 서비스" }, { id: hiddenService, tenantId: tenant, name: "범위 밖", externalName: "범위 밖" }] });
  await signup("owner"); await signup("editor"); await signup("viewer"); await signup("security"); await signup("owner", foreignTenant, "foreign");
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

async function settings() { return (await policyGet(req("/security/policy"))).json(); }
async function setPolicy(patch: Record<string, unknown>) {
  const current = await settings();
  return policyPatch(req("/security/policy", "PATCH", "owner", { ...policyDefaults,
    sessionMinutes: current.sessionMinutes, requireMfa: current.requireMfa, requireApproval: current.requireApproval,
    approvalRoles: current.approvalRoles, approvalReferenceRequired: current.approvalReferenceRequired,
    approvalRequestTemplate: current.approvalRequestTemplate, tenantId: tenant, version: current.version, password, ...patch }));
}
async function enableApproval() {
  expect((await setPolicy({ requireApproval: true, approvalRoles: ["owner", "security"], approvalReferenceRequired: true, approvalRequestTemplate: "검토 사유를 작성해주세요." })).status).toBe(200);
}
async function newForm(who = "editor", serviceId = service) {
  const content = { body: "승인할 본문", questions: [{ id: randomUUID(), type: "단문형 답변", label: "참가자", required: true }],
    consentRequired: true, consentPurpose: "교육 신청", retentionDays: 30, maxResponses: 10 };
  const response = await formCreate(req("/forms", "POST", who, { title: "승인 시험 " + randomUUID(), serviceId, content }, { "idempotency-key": randomUUID() }));
  expect(response.status).toBe(201); return response.json();
}
async function readForm(id: string, who = "editor") { return (await formGet(req("/forms/" + id, "GET", who))).json(); }
async function requestApproval(id: string, who = "editor", key = randomUUID()) {
  const form = await readForm(id, who);
  return action(req("/forms/" + id + "/approvals", "POST", who, { version: form.version, message: "내부 검토 요청", reference: "LEGAL-2026-01" }, { "idempotency-key": key }));
}
async function approvedForm() {
  const form = await newForm(), created = await requestApproval(form.id); expect(created.status).toBe(201);
  const row = await created.json();
  expect((await decide(req("/approvals/" + row.id + "/decision", "POST", "security", { version: row.version, decision: "approved", reason: "질문과 보유기간을 확인했습니다." }))).status).toBe(200);
  return { form: await readForm(form.id), approval: row };
}
const publish = (id: string, version: number, key = randomUUID()) => action(req("/forms/" + id + "/publish", "POST", "editor", { version }, { "idempotency-key": key }));

describe("company policy and approval enforcement", () => {
  test("policy is tenant scoped and only the owner can mutate with a current password and origin", async () => {
    expect((await policyGet(req("/security/policy", "GET", "anonymous"))).status).toBe(401);
    expect((await policyGet(req("/security/policy", "GET", "viewer"))).status).toBe(403);
    const current = await settings(), input = { ...policyDefaults, tenantId: tenant, version: current.version, password };
    expect(current.sessionMinutes).toBe(30);
    expect((await policyPatch(req("/security/policy", "PATCH", "security", input))).status).toBe(403);
    expect((await policyPatch(req("/security/policy", "PATCH", "owner", input, { origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await policyPatch(req("/security/policy", "PATCH", "owner", { ...input, password: "wrong" }))).status).toBe(401);
    expect((await policyPatch(req("/security/policy", "PATCH", "owner", { ...input, tenantId: foreignTenant }))).status).toBe(409);
    expect(await settings()).toMatchObject({ version: current.version });
    expect((await policyGet(req("/security/policy", "GET", "foreign"))).status).toBe(200);
    expect(await db.securityPolicy.findUnique({ where: { tenantId: foreignTenant } })).toMatchObject({ version: 1 });
  });
  test("policy password checks are rate limited and cannot change the policy after repeated failures", async () => {
    const before = await settings();
    for (let index = 0; index < 5; index++) expect((await setPolicy({ password: "wrong" })).status).toBe(401);
    expect((await setPolicy({ sessionMinutes: 60 })).status).toBe(429);
    expect(await settings()).toMatchObject({ version: before.version, sessionMinutes: before.sessionMinutes });
  });
  test("invalid settings and enabling MFA before owner setup are rejected without writes", async () => {
    const initial = await settings();
    for (const bad of [{ sessionMinutes: 29 }, { sessionMinutes: 121 }, { approvalRoles: ["security"] }, { minPassword: 1 }])
      expect((await setPolicy(bad)).status).toBe(422);
    expect((await setPolicy({ requireMfa: true })).status).toBe(409);
    expect(await settings()).toMatchObject({ version: initial.version, requireMfa: false });
  });
  test("concurrent policy edits commit once and policy audit records omit passwords and values", async () => {
    const initial = await settings();
    const results = await Promise.all([45, 46].map(sessionMinutes => setPolicy({ version: initial.version, sessionMinutes })));
    expect(results.map(response => response.status).sort()).toEqual([200, 409]);
    const current = await settings(); expect(current.version).toBe(initial.version + 1);
    expect([45, 46]).toContain(current.sessionMinutes);
    const audits = await db.auditEvent.findMany({ where: { tenantId: tenant, resource: "securityPolicy" } });
    expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain(password);
  });
  test("shortening session policy invalidates an existing idle session on the next protected request", async () => {
    await db.session.updateMany({ where: { userId: users.viewer }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } });
    expect((await setPolicy({ sessionMinutes: 30 })).status).toBe(200);
    expect((await auth.handler(req("/auth/get-session", "GET", "viewer"))).status).toBe(401);
    expect((await services(req("/services", "GET", "viewer"))).status).toBe(401);
    expect((await services(req("/services"))).status).toBe(200);
    cookies.viewer = cookieOf(await authCall("/sign-in/email", { email: "viewer@policy.test.local", password }));
    await db.session.updateMany({ where: { userId: users.viewer }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } });
    expect((await switchContext(req("/context", "POST", "viewer", { companyId: tenant }))).status).toBe(401);
    cookies.viewer = cookieOf(await authCall("/sign-in/email", { email: "viewer@policy.test.local", password }));
    expect((await policyReset(req("/security/policy", "DELETE", "owner", { tenantId: tenant, version: (await settings()).version, password }))).status).toBe(200);
    expect(await settings()).toMatchObject({ ...policyDefaults });
  });
  test("approval requests enforce required evidence, service scope, tenant scope and idempotency", async () => {
    await enableApproval();
    const form = await newForm();
    expect((await publish(form.id, form.version)).status).toBe(409);
    const data = { version: form.version, message: "원문은 암호화되어야 합니다.", reference: "LEGAL-01" };
    expect((await action(req("/forms/" + form.id + "/approvals", "POST", "editor", { ...data, reference: "" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await action(req("/forms/" + form.id + "/approvals", "POST", "foreign", data, { "idempotency-key": randomUUID() }))).status).toBe(404);
    expect((await action(req("/forms/" + form.id + "/approvals", "POST", "viewer", data, { "idempotency-key": randomUUID() }))).status).toBe(403);
    const hidden = await newForm("owner", hiddenService);
    expect((await action(req("/forms/" + hidden.id + "/approvals", "POST", "editor", data, { "idempotency-key": randomUUID() }))).status).toBe(403);
    const key = randomUUID(), results = await Promise.all([0, 1].map(() => action(req("/forms/" + form.id + "/approvals", "POST", "editor", data, { "idempotency-key": key }))));
    expect(results.map(response => response.status)).toEqual([201, 201]);
    const rows = await Promise.all(results.map(response => response.json())); expect(rows[0]).toEqual(rows[1]);
    expect((await requestApproval(form.id)).status).toBe(409);
    const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(stored.requestCipher).not.toContain(data.message); expect(decrypt(stored.requestCipher)).toEqual({ message: data.message, reference: data.reference });
    expect(await readForm(form.id)).toMatchObject({ status: "pendingApproval", version: 2 });
    expect((await (await approvalList(req("/approvals?status=pending&pageSize=1", "GET", "security"))).json()).total).toBe(1);
    expect((await (await approvalList(req("/approvals", "GET", "foreign"))).json()).total).toBe(0);
    expect((await approvalGet(req("/approvals/" + rows[0].id, "GET", "foreign"))).status).toBe(404);
  });
  test("only assigned reviewers can decide and simultaneous approve/reject has one winner", async () => {
    const form = await newForm(), response = await requestApproval(form.id), row = await response.json();
    const body = { version: 1, decision: "approved", reason: "확인 완료" };
    expect((await decide(req("/approvals/" + row.id + "/decision", "POST", "editor", body))).status).toBe(403);
    expect((await decide(req("/approvals/" + row.id + "/decision", "POST", "security", { ...body, reason: "" }))).status).toBe(422);
    const responses = await Promise.all(["approved", "rejected"].map(decision => decide(req("/approvals/" + row.id + "/decision", "POST", "security", { ...body, decision }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.version).toBe(2); expect(stored.decidedBy).toBe(members.security);
  });
  test("rejection permits a new request and approved publication binds immutable evidence and accepts a real response", async () => {
    const form = await newForm(), first = await (await requestApproval(form.id)).json();
    expect((await decide(req("/approvals/" + first.id + "/decision", "POST", "security", { version: 1, decision: "rejected", reason: "다시 확인해주세요." }))).status).toBe(200);
    expect(await readForm(form.id)).toMatchObject({ status: "draft" });
    const second = await (await requestApproval(form.id)).json();
    expect((await decide(req("/approvals/" + second.id + "/decision", "POST", "security", { version: 1, decision: "approved", reason: "확인했습니다." }))).status).toBe(200);
    const current = await readForm(form.id), key = randomUUID();
    const results = await Promise.all([publish(form.id, current.version, key), publish(form.id, current.version, key)]);
    expect(results.map(response => response.status)).toEqual([201, 201]);
    const published = await results[0].json();
    expect(await results[1].json()).toEqual(published);
    expect(await db.publication.findUnique({ where: { id: published.id } })).toMatchObject({ approvalId: second.id });
    expect(await db.approvalRequest.findUnique({ where: { id: second.id } })).toMatchObject({ status: "consumed", version: 3 });
    const publicForm = await (await publicGet(req("/public/forms/" + published.token, "GET", "anonymous"))).json();
    expect(publicForm.content.body).toBe(form.content.body);
    expect((await publicSubmit(req("/public/forms/" + published.token + "/submissions", "POST", "anonymous",
      { answers: { [publicForm.content.questions[0].id]: "실제 승인 응답" }, consent: true }, { "idempotency-key": randomUUID() }))).status).toBe(201);
    const changed = await formPatch(req("/forms/" + form.id, "PATCH", "editor", { version: current.version + 1, title: "새 초안" }));
    expect(changed.status).toBe(200);
    expect((await publish(form.id, (await changed.json()).version)).status).toBe(409);
    expect((await (await publicGet(req("/public/forms/" + published.token, "GET", "anonymous"))).json()).title).toBe(form.title);
    await expect(db.approvalRequest.update({ where: { id: second.id }, data: { snapshot: {} } })).rejects.toThrow();
    await expect(db.approvalRequest.delete({ where: { id: first.id } })).rejects.toThrow();
  });
  test("editing a pending or approved draft invalidates the approval and preserves its review snapshot", async () => {
    for (const decisionFirst of [false, true]) {
      const form = await newForm(), approval = await (await requestApproval(form.id)).json();
      if (decisionFirst) expect((await decide(req("/approvals/" + approval.id + "/decision", "POST", "security", { version: 1, decision: "approved", reason: "확인" }))).status).toBe(200);
      const current = await readForm(form.id);
      expect((await formPatch(req("/forms/" + form.id, "PATCH", "editor", { version: current.version, content: { ...current.content, body: "검토 후 수정" } }))).status).toBe(200);
      const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
      expect(stored.status).toBe("superseded"); expect(stored.snapshot).toMatchObject({ content: { body: "승인할 본문" } });
      expect((await decide(req("/approvals/" + approval.id + "/decision", "POST", "security", { version: stored.version, decision: "approved", reason: "오래된 승인" }))).status).toBe(409);
      expect((await publish(form.id, (await readForm(form.id)).version)).status).toBe(409);
    }
  });
  test("approval policy changes supersede existing requests while unrelated session changes preserve approval", async () => {
    const { form, approval } = await approvedForm();
    expect((await setPolicy({ approvalReferenceRequired: false })).status).toBe(200);
    expect(await db.approvalRequest.findUnique({ where: { id: approval.id } })).toMatchObject({ status: "superseded" });
    expect((await publish(form.id, (await readForm(form.id)).version)).status).toBe(409);
    const second = await approvedForm(), policyBefore = await settings();
    expect((await setPolicy({ sessionMinutes: 60 })).status).toBe(200);
    expect((await settings()).approvalRevision).toBe(policyBefore.approvalRevision);
    expect((await publish(second.form.id, second.form.version)).status).toBe(201);
  });
  test("publication rechecks a reviewer's active role and service grant", async () => {
    const { form } = await approvedForm();
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.security, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["service.read", "form.read"] } });
    const response = await publish(form.id, form.version); expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVIEWER_UNAVAILABLE");
    expect(await db.publication.count({ where: { formId: form.id } })).toBe(0);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    expect((await publish(form.id, form.version)).status).toBe(201);
  });
  test("cancellation and archive invalidate pending requests without deleting evidence", async () => {
    const form = await newForm(), row = await (await requestApproval(form.id)).json();
    expect((await cancel(req("/approvals/" + row.id, "DELETE", "editor", { version: 1 }))).status).toBe(200);
    expect((await cancel(req("/approvals/" + row.id, "DELETE", "editor", { version: 1 }))).status).toBe(409);
    const second = await (await requestApproval(form.id)).json(), current = await readForm(form.id);
    expect((await formArchive(req("/forms/" + form.id, "DELETE", "editor", undefined, { "if-match": String(current.version) }))).status).toBe(204);
    expect(await db.approvalRequest.findUnique({ where: { id: second.id } })).toMatchObject({ status: "superseded" });
    expect(await db.approvalRequest.count({ where: { formId: form.id } })).toBe(2);
    expect((await decide(req("/approvals/" + second.id + "/decision", "POST", "security", { version: 1, decision: "approved", reason: "보관 후" }))).status).toBe(409);
  });
  test("a concurrent edit and approval cannot approve the modified content", async () => {
    const form = await newForm(), approval = await (await requestApproval(form.id)).json(), current = await readForm(form.id);
    const results = await Promise.all([
      formPatch(req("/forms/" + form.id, "PATCH", "editor", { version: current.version, title: "동시 수정" })),
      decide(req("/approvals/" + approval.id + "/decision", "POST", "security", { version: 1, decision: "approved", reason: "동시 승인" })),
    ]);
    expect(results[0].status).toBe(200); expect([200, 409]).toContain(results[1].status);
    expect(await db.approvalRequest.findUnique({ where: { id: approval.id } })).toMatchObject({ status: "superseded" });
    expect((await publish(form.id, (await readForm(form.id)).version)).status).toBe(409);
  });
  test("database rejects cross-tenant requesters, direct approved inserts and publications without required approval", async () => {
    const form = await newForm(), approval = await (await requestApproval(form.id)).json();
    const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    const copy = { ...stored, snapshot: stored.snapshot as Prisma.InputJsonValue };
    const other = await newForm(), otherVersion = await db.formVersion.findFirstOrThrow({ where: { formId: other.id } });
    await expect(db.approvalRequest.create({ data: { ...copy, id: randomUUID(), formId: other.id, formVersionId: otherVersion.id, requestedBy: members.foreign } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.approvalRequest.create({ data: { ...copy, id: randomUUID(), status: "approved", decidedBy: members.owner, decisionCipher: "fake", decidedAt: new Date() } })).rejects.toThrow();
    await expect(db.publication.create({ data: { tenantId: tenant, formId: form.id, formVersionId: stored.formVersionId,
      tokenHash: randomUUID(), tokenCipher: "fake", maxResponses: 1 } })).rejects.toThrow();
  });
  test("MFA requirement is applied on the next request and cannot be disabled while the policy requires it", async () => {
    const enabled = await authCall("/two-factor/enable", { password });
    expect(enabled.status).toBe(200);
    const payload = await enabled.json(), secret = new TextDecoder().decode(base32.decode(new URL(payload.totpURI).searchParams.get("secret")!));
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verified = await auth.handler(new Request(origin + "/api/v1/auth/two-factor/verify-totp", { method: "POST",
      headers: { origin, cookie: cookieOf(enabled) || cookies.owner, "content-type": "application/json" }, body: JSON.stringify({ code }) }));
    expect(verified.status).toBe(200); cookies.owner = cookieOf(verified);
    expect((await setPolicy({ requireMfa: true })).status).toBe(200);
    const blocked = await services(req("/services", "GET", "editor")); expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("MFA_REQUIRED");
    expect(await (await context(req("/context", "GET", "editor"))).json()).toMatchObject({ requireMfa: true });
    expect((await authCall("/two-factor/disable", { password })).status).toBe(403);
    expect((await policyReset(req("/security/policy", "DELETE", "owner", { tenantId: tenant, version: (await settings()).version, password }))).status).toBe(200);
    expect((await services(req("/services", "GET", "editor"))).status).toBe(200);
  });
});
