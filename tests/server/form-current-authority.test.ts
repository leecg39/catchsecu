import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, updateForm, listForms, readForm, archiveForm, copyForm, designateFormRetention, formDeletionState, publishForm, purgeForm, reviseForm, setFormFavorite, transitionForm } from "@/server/forms";
import { createTemplate, updateTemplate, listTemplates, getTemplate, deleteTemplate, useTemplate } from "@/server/templates";
import { encrypt } from "@/server/crypto";
import { formInput } from "@/contracts/domains";
import { z } from "zod";
import { formDocumentOptions } from "@/server/form-documents";
import { approvalForForm, listApprovals, requestApproval } from "@/server/approvals";
import { createFixedUrl, listFixedUrls } from "@/server/fixed-urls";
import { createRetentionRule } from "@/server/retention-rules";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, formId: string, templateId: string, cookie: string, input: z.infer<typeof formInput>;
const listQuery = { page: 1, pageSize: 10, search: "" };
function authRequest(path: string, value: unknown) { return new Request(origin + "/api/v1/auth/" + path, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value),
}); }
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Current form actor", publicName: "Forms", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "Forms", externalName: "Forms" } } }, include: { services: true } });
  const email = "form-current-" + randomUUID() + "@example.test", password = "Form-current-actor!123";
  expect((await auth.handler(authRequest("sign-up/email", { email, password, name: "Owner" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authRequest("sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
  // A request IP already verified by the HTTP adapter; this suite exercises the inner transaction.
  ctx = { ...ctx, clientIp: "192.0.2.1" };
  input = formInput.parse({ serviceId: company.services[0].id, title: "Original", content: { body: "", consentRequired: false,
    consentPurpose: "", retentionDays: 30, maxResponses: 50,
    questions: [{ id: randomUUID(), type: "단문형 답변" as const, label: "Name", required: true }] } });
  formId = (await db.$transaction(tx => createForm(ctx, input, randomUUID(), tx))).id;
  templateId = (await db.$transaction(tx => createTemplate(ctx, { ...input, category: "QA" }, randomUUID(), tx))).id;
});
afterEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_form_authority_audit ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_form_authority_audit()');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_form_authority_cache ON "IdempotencyRecord"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_form_authority_cache()');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_form_authority_favorite ON "FormFavorite"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_form_authority_favorite()');
});
afterAll(async () => { await db.$disconnect(); });
const mutate = (kind: "form" | "template") => kind === "form"
  ? updateForm(ctx, formId, { version: 1, title: "Forbidden change" }, randomUUID())
  : updateTemplate(ctx, templateId, { version: 1, title: "Forbidden change" }, randomUUID());
async function unchanged() {
  expect(await db.form.findUniqueOrThrow({ where: { id: formId } })).toMatchObject({ title: "Original", version: 1 });
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: templateId } })).toMatchObject({ title: "Original", version: 1 });
  expect(await db.auditEvent.count({ where: { action: { in: ["form.draft_updated", "template.updated"] } } })).toBe(0);
}
const cases = ["mfa", "ip", "password", "idle", "company"] as const;
async function invalidate(kind: typeof cases[number]) {
  if (kind === "mfa") await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  if (kind === "ip") {
    await db.ipRule.create({ data: { tenantId: ctx.tenantId, cidr: "198.51.100.0/24", enabled: true } });
    await db.ipAccessPolicy.create({ data: { tenantId: ctx.tenantId, enabled: true } });
  }
  if (kind === "password") {
    await db.user.update({ where: { id: ctx.user.id }, data: { passwordChangedAt: new Date("2020-01-01T00:00:00Z") } });
    await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { passwordMonths: 1 } });
  }
  if (kind === "idle") await db.$executeRaw`UPDATE "Session" SET "updatedAt"=now()-interval '2 days' WHERE id=${ctx.session.id}`;
  if (kind === "company") {
    const other = await db.company.create({ data: { name: "Other", publicName: "Other" } });
    await db.membership.create({ data: { tenantId: other.id, userId: ctx.user.id, role: "owner" } });
    await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
  }
}
const codes = { mfa: "MFA_REQUIRED", ip: "IP_NOT_ALLOWED", password: "PASSWORD_CHANGE_REQUIRED", idle: "SESSION_EXPIRED", company: "COMPANY_CHANGED" };
test.each(cases)("form and template operations reject current %s after Context resolution", async kind => {
  await invalidate(kind);
  for (const operation of [() => mutate("form"), () => mutate("template"), () => readForm(ctx, formId), () => getTemplate(ctx, templateId),
    () => listForms(ctx, listQuery), () => listTemplates(ctx, { ...listQuery, scope: "all" }),
    () => db.$transaction(tx => createForm(ctx, input, randomUUID(), tx)),
    () => db.$transaction(tx => createTemplate(ctx, { ...input, category: "QA" }, randomUUID(), tx)),
    () => db.$transaction(tx => copyForm(tx, ctx, formId, "Copy", randomUUID())),
    () => db.$transaction(tx => reviseForm(tx, ctx, formId, 1, randomUUID())),
    () => db.$transaction(tx => publishForm(tx, ctx, formId, { version: 1 }, randomUUID())),
    () => transitionForm(ctx, formId, 1, "pause", randomUUID()),
    () => transitionForm(ctx, formId, 1, "resume", randomUUID()),
    () => archiveForm(ctx, formId, 1, randomUUID()),
    () => purgeForm(ctx, formId, 1, randomUUID()),
    () => designateFormRetention(ctx, formId, { version: 1, retentionDays: 20 }, randomUUID()),
    () => setFormFavorite(ctx, formId, true),
    () => formDeletionState(ctx, formId),
    () => deleteTemplate(ctx, templateId, 1, randomUUID()),
    () => db.$transaction(tx => useTemplate(ctx, templateId, { version: 1, serviceId: input.serviceId }, randomUUID(), tx)),
    () => formDocumentOptions(ctx, input.serviceId, listQuery),
    () => approvalForForm(ctx, formId, 1, 10),
    () => listApprovals(ctx, { ...listQuery, status: "all", sort: "createdAt", direction: "desc" }),
    () => db.$transaction(tx => requestApproval(tx, ctx, formId, { version: 1, message: "", reference: "" }, randomUUID())),
    () => listFixedUrls(ctx, listQuery),
    () => db.$transaction(tx => createFixedUrl(ctx, { formId, name: "Denied URL" }, randomUUID(), tx))])
    await expect(operation()).rejects.toMatchObject({ code: codes[kind] });
  await unchanged();
});
test.each(["form", "template"].flatMap(kind => ["mfa", "ip", "password"].map(policy => ({ kind: kind as "form" | "template", policy }))))("$kind waiting on Company lock observes committed $policy policy", async ({ kind, policy }) => {
  const holder = new Client({ connectionString: env.DATABASE_URL }); await holder.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await holder.query("BEGIN"); const pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await holder.query('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', [ctx.tenantId]);
    pending = mutate(kind).then(value => ({ value }), error => ({ error }));
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await holder.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
      if (result.rows[0].count > 0) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    if (policy === "mfa") await holder.query('UPDATE "SecurityPolicy" SET "requireMfa"=true WHERE "tenantId"=$1', [ctx.tenantId]);
    if (policy === "ip") {
      await holder.query('INSERT INTO "IpRule" (id,"tenantId",cidr,enabled,"updatedAt") VALUES ($1,$2,$3,true,now())', [randomUUID(), ctx.tenantId, "198.51.100.0/24"]);
      await holder.query('INSERT INTO "IpAccessPolicy" ("tenantId",enabled,"updatedAt") VALUES ($1,true,now())', [ctx.tenantId]);
    }
    if (policy === "password") {
      await holder.query('UPDATE "User" SET "passwordChangedAt"=$1 WHERE id=$2', [new Date("2020-01-01T00:00:00Z"), ctx.user.id]);
      await holder.query('UPDATE "SecurityPolicy" SET "passwordMonths"=1 WHERE "tenantId"=$1', [ctx.tenantId]);
    }
    await holder.query("COMMIT");
    expect(await pending).toMatchObject({ error: { code: codes[policy as keyof typeof codes] } }); await unchanged();
  } finally { await holder.query("ROLLBACK"); await holder.end(); if (pending) await pending; }
});
async function delayAudit() {
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_form_authority_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action IN ('form.draft_updated','template.updated') THEN PERFORM pg_sleep(1.1); END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_form_authority_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_form_authority_audit()');
}
test.each(["form", "template"] as const)("%s rolls back content and audit when the session expires during audit insertion", async kind => {
  await delayAudit();
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 700) } });
  await expect(mutate(kind)).rejects.toMatchObject({ code: "SESSION_EXPIRED" }); await unchanged();
});
test.each(["form", "template"] as const)("%s rolls back when a temporary MFA exception expires during the write", async kind => {
  await delayAudit();
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  const approver = await db.user.create({ data: { id: randomUUID(), email: "approver-" + randomUUID() + "@example.test", name: "Recovery owner", emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: ctx.tenantId, userId: approver.id, role: "owner" } });
  await db.mfaException.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, createdById: member.id,
    reasonCipher: encrypt("QA temporary recovery"), expiresAt: new Date(Date.now() + 700) } });
  await expect(mutate(kind)).rejects.toMatchObject({ code: "MFA_REQUIRED" }); await unchanged();
});
test.each(["form", "template"] as const)("%s rolls back when a password deferral expires during audit insertion", async kind => {
  await delayAudit();
  const changedAt = new Date("2020-01-01T00:00:00Z");
  await db.user.update({ where: { id: ctx.user.id }, data: { passwordChangedAt: changedAt } });
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { passwordMonths: 1, passwordDeferral: "period" } });
  await db.passwordDeferral.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, userId: ctx.user.id,
    passwordChangedAt: changedAt, passwordRevision: 1, mode: "period", expiresAt: new Date(Date.now() + 700) } });
  await expect(mutate(kind)).rejects.toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" }); await unchanged();
});
test("favorite rolls back when an expert assignment expires during insertion", async () => {
  const assigner = await db.user.create({ data: { id: randomUUID(), email: "assigner-" + randomUUID() + "@example.test", name: "QA assigner", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: assigner.id, role: "owner" } });
  const assignment = await db.expertAssignment.create({ data: { tenantId: ctx.tenantId, expertUserId: ctx.user.id,
    assignedById: assigner.id, expiresAt: new Date(Date.now() + 60000) } });
  await db.expertAssignmentService.create({ data: { tenantId: ctx.tenantId, assignmentId: assignment.id, serviceId: input.serviceId } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  await db.serviceGrant.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, serviceId: input.serviceId, capabilities: ["form.read"] } });
  await db.$executeRawUnsafe('CREATE FUNCTION qa_form_authority_favorite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1); RETURN NEW; END $$');
  await db.$executeRawUnsafe('CREATE TRIGGER qa_form_authority_favorite BEFORE INSERT ON "FormFavorite" FOR EACH ROW EXECUTE FUNCTION qa_form_authority_favorite()');
  await db.expertAssignment.update({ where: { id: assignment.id }, data: { expiresAt: new Date(Date.now() + 700) } });
  await expect(setFormFavorite(ctx, formId, true)).rejects.toMatchObject({ code: "EXPERT_SCOPE" });
  expect(await db.formFavorite.count()).toBe(0); await unchanged();
});
test.each(["form", "template"] as const)("%s rolls back content when audit insertion fails", async kind => {
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_form_authority_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action IN ('form.draft_updated','template.updated') THEN RAISE EXCEPTION 'QA audit storage failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_form_authority_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_form_authority_audit()');
  await expect(mutate(kind)).rejects.toThrow(); await unchanged();
});
function creation(kind: "form" | "template", key: string) {
  return (kind === "form" ? formCreate : templateCreate)(new Request(origin + "/api/v1/" + (kind === "form" ? "forms" : "templates"), {
    method: "POST", headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ ...input, title: "Cached create", ...(kind === "template" ? { category: "QA" } : {}) }),
  }));
}
test.each(["form", "template"] as const)("%s create rolls back object, audit and cache when session expires in cache insertion", async kind => {
  await db.$executeRawUnsafe('CREATE FUNCTION qa_form_authority_cache() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.1); RETURN NEW; END $$');
  await db.$executeRawUnsafe('CREATE TRIGGER qa_form_authority_cache BEFORE INSERT ON "IdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION qa_form_authority_cache()');
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 700) } });
  const response = await creation(kind, randomUUID());
  expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("SESSION_EXPIRED");
  expect(await db.form.count()).toBe(1); expect(await db.formTemplate.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: { in: ["form.created", "template.created"] } } })).toBe(2);
  expect(await db.idempotencyRecord.count()).toBe(0);
});
async function waitBlocked(holder: Client, count = 1) {
  const pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  for (let attempt = 0; attempt < 100; attempt++) {
    await holder.query("SELECT pg_stat_clear_snapshot()");
    const result = await holder.query(`WITH RECURSIVE waiting(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
    ) SELECT count(*)::int AS count FROM waiting`, [pid]);
    if (result.rows[0].count >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Expected real PostgreSQL lock wait");
}
test.each(["form", "template"] as const)("%s cached create rejects natural expiry after replay validation", async kind => {
  const key = randomUUID(), created = await creation(kind, key); expect(created.status).toBe(201);
  const row = await created.json(), holder = new Client({ connectionString: env.DATABASE_URL }); await holder.connect();
  let pending: Promise<Response> | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query('SELECT id FROM "' + (kind === "form" ? "Form" : "FormTemplate") + '" WHERE id=$1 FOR UPDATE', [row.id]);
    await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 1200) } });
    pending = creation(kind, key);
    await waitBlocked(holder);
    await holder.query("SELECT pg_sleep(1.3)"); await holder.query("COMMIT");
    const response = await pending; expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("SESSION_EXPIRED");
    expect(await db.idempotencyRecord.count()).toBe(1);
    expect(await db.form.count()).toBe(kind === "form" ? 2 : 1);
    expect(await db.formTemplate.count({ where: { tenantId: ctx.tenantId } })).toBe(kind === "template" ? 2 : 1);
  } finally { await holder.query("ROLLBACK"); await holder.end(); if (pending) await pending; }
});
test("concurrent retention creates serialize without a Service SHARE-to-UPDATE deadlock", async () => {
  const holder = new Client({ connectionString: env.DATABASE_URL }); await holder.connect();
  let pending: Promise<unknown>[] = [];
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Service" WHERE id=$1 FOR SHARE', [input.serviceId]);
    pending = [1, 2].map(() => createRetentionRule(ctx, { serviceId: input.serviceId, retentionDays: 10, reason: "QA" }, randomUUID(), randomUUID())
      .then(value => ({ value }), error => ({ error })));
    await waitBlocked(holder, 2);
    await holder.query("COMMIT");
    const results = await Promise.all(pending);
    expect(results.filter(result => (result as { value?: unknown }).value)).toHaveLength(1);
    expect(results.filter(result => (result as { error?: unknown }).error)).toEqual([{ error: expect.objectContaining({ code: "RULE_EXISTS" }) }]);
    expect(await db.retentionRule.count()).toBe(1);
  } finally { await holder.query("ROLLBACK"); await holder.end(); await Promise.all(pending); }
});
