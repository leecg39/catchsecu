import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const fixture = JSON.parse(await readFile(".local/qa-r23-ui.json", "utf8"));
const origin = process.env.QA_BASE_URL ?? fixture.origin, restart = process.argv.includes("--restart");
const exportTotal = fixture.exportTotal ?? 11;
const directory = "docs/qa/R23-T04/current", database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_test");
assert.equal(new URL(origin).origin, "http://127.0.0.1:3199");
const checks: Array<{ label: string; status: number }> = [];

async function call(actor: string | null, path: string, expected: number, method = "GET", body?: unknown) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin,
    ...(actor ? { cookie: fixture.actors[actor].cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${actor ?? "anonymous"} ${method} ${path}`);
  checks.push({ label: `${actor ?? "anonymous"} ${method} ${path}`, status: response.status });
  return response;
}
async function freshLogin(actor: string) {
  const value = fixture.actors[actor];
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: value.email, password: value.password }) });
  assert.equal(response.status, 200, `${actor} login`);
  value.cookie = response.headers.getSetCookie().map((item: string) => item.split(";")[0]).join("; ");
  checks.push({ label: `${actor} fresh login`, status: response.status });
}
async function fingerprint() {
  const [services, submissions, certificates, close, exports] = await Promise.all([
    db.service.findMany({ where: { id: { in: [fixture.serviceAId, fixture.serviceBId, fixture.foreignServiceId] } },
      select: { id: true, tenantId: true, name: true, status: true, version: true }, orderBy: { id: "asc" } }),
    db.submission.findMany({ where: { id: { in: [...fixture.submissionIds, fixture.serviceBSubmissionId] } },
      select: { id: true, tenantId: true, formVersionId: true, status: true, submittedAt: true, retentionUntil: true,
        legalHold: true, version: true }, orderBy: { id: "asc" } }),
    db.destructionCertificate.findMany({ where: { id: fixture.certificateId }, select: { id: true, tenantId: true, serviceId: true,
      submissionId: true, requestId: true, counts: true, digest: true, completedAt: true } }),
    db.complianceClose.findUniqueOrThrow({ where: { id: fixture.closeId }, select: { id: true, tenantId: true,
      serviceKey: true, month: true, snapshot: true, createdBy: true, createdAt: true } }),
    db.complianceExportJob.findMany({ where: { closeId: fixture.closeId }, select: { id: true, tenantId: true, closeId: true,
      memberId: true, requesterId: true, format: true, sourceHash: true, status: true, version: true, resultHash: true,
      byteLength: true, pageCount: true, expiresAt: true, completedAt: true, createdAt: true }, orderBy: { id: "asc" } }),
  ]);
  const value = { services, submissions, certificates, close, exports };
  return { value, sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}

try {
  await freshLogin("owner"); await freshLogin("viewer"); await freshLogin("foreign");
  const dashboard = await (await call("owner", "/analytics/dashboard", 200)).json();
  assert.equal(dashboard.totals.retainedSubmissions, 3); assert.equal(dashboard.totals.services, 2);
  const service = await (await call("owner", `/analytics/dashboard?serviceId=${fixture.serviceAId}`, 200)).json();
  assert.equal(service.totals.retainedSubmissions, 2); assert.equal(service.totals.periodSubmissions, 2);
  const privacy = await (await call("owner", `/analytics/privacy?serviceId=${fixture.serviceAId}`, 200)).json();
  assert.deepEqual(privacy.services[0], { id: fixture.serviceAId, name: "R23 서비스 A", retainedSubmissions: 2,
    periodSubmissions: 3, legalHolds: 1, periodConsents: 1, periodConsentWithdrawals: 1,
    periodSubjectWithdrawals: 0, periodDestructions: 1 });
  const marketing = await (await call("owner", `/analytics/marketing?serviceId=${fixture.serviceAId}`, 200)).json();
  assert.deepEqual(marketing.items[0], { id: fixture.serviceAId, name: "R23 서비스 A", granted: 1, withdrawn: 1,
    erased: 1, excluded: 0, eligible: 1, suppressed: 0, total: 3, periodGrants: 1, periodWithdrawals: 1, periodErasures: 1 });
  await call("owner", `/compliance?serviceId=${fixture.serviceAId}`, 200);
  const close = await (await call("owner", `/analytics/closes?month=${fixture.month}&serviceId=${fixture.serviceAId}`, 200)).json();
  assert.equal(close.close.id, fixture.closeId); assert.equal(close.close.totals.retainedSubmissions, 2);
  const duplicate = await (await call("owner", "/analytics/closes", 200, "POST", { month: fixture.month, serviceId: fixture.serviceAId })).json();
  assert.equal(duplicate.created, false); assert.equal(duplicate.close.id, fixture.closeId);
  const exportsPage = await (await call("owner", `/analytics/exports?closeId=${fixture.closeId}&page=2&pageSize=10`, 200)).json();
  assert.equal(exportsPage.total, exportTotal); assert.equal(exportsPage.page, 2); assert.equal(exportsPage.items.length, exportTotal - 10);
  const firstPage = await (await call("owner", `/analytics/exports?closeId=${fixture.closeId}&page=1&pageSize=10`, 200)).json();
  const csvJob = firstPage.items.find((item: { format: string }) => item.format === "csv");
  assert.ok(csvJob, "ready CSV export");
  const download = await call("owner", `/analytics/exports/${csvJob.id}/download`, 200);
  const csv = await download.text(); assert.ok(csv.includes("미판정")); assert.ok(csv.includes("R23 서비스 A"));
  const viewerDashboard = await (await call("viewer", "/analytics/dashboard", 200)).json();
  assert.deepEqual(viewerDashboard.services.map((row: { id: string }) => row.id), [fixture.serviceAId]);
  await call("viewer", `/analytics/privacy?serviceId=${fixture.serviceAId}`, 403);
  await call("viewer", `/analytics/dashboard?serviceId=${fixture.serviceBId}`, 404);
  await call("viewer", `/analytics/closes?month=${fixture.month}`, 403);
  await call("foreign", `/analytics/dashboard?serviceId=${fixture.serviceAId}`, 404);
  await call("owner", `/analytics/dashboard?serviceId=${fixture.foreignServiceId}`, 404);
  await call(null, "/analytics/dashboard", 401);
  await call("owner", `/analytics/dashboard?serviceId=${fixture.serviceAId}&serviceId=${fixture.serviceBId}`, 422);
  await call("owner", "/analytics/closes", 405, "PATCH", {});
  await call("owner", "/analytics/closes", 405, "DELETE");
  const state = await fingerprint();
  await mkdir(directory, { recursive: true });
  const before = directory + "/api-before-restart.json";
  if (restart) assert.equal(state.sha256, JSON.parse(await readFile(before, "utf8")).fingerprint.sha256);
  const report = { result: "passed", checkedAt: new Date().toISOString(), restart, checks,
    fingerprint: { sha256: state.sha256, counts: { services: state.value.services.length, submissions: state.value.submissions.length,
      certificates: state.value.certificates.length, exports: state.value.exports.length } } };
  await writeFile(restart ? directory + "/api-after-restart.json" : before, JSON.stringify(report, null, 2) + "\n");
  await writeFile(".local/qa-r23-ui.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ result: "passed", restart, checks: checks.length, fingerprint: state.sha256 }));
} finally { await db.$disconnect(); }
