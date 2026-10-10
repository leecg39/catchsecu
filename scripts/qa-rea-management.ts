import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const directory = "docs/qa/R03-T04/management-flow", companyDirectory = "docs/qa/R03-T03/company-flow", serviceDirectory = "docs/qa/R03-T03/service-flow";
const expectedCompany = JSON.parse(await readFile(companyDirectory + "/final.json", "utf8"));
const expectedService = JSON.parse(await readFile(serviceDirectory + "/restored.json", "utf8"));
assert.equal(expectedCompany.id, "7d2f5f95-3493-4a30-8dcd-65220489d65e"); assert.equal(expectedService.id, "7c3d767e-0eaa-401a-934e-ad6fcd41917f");
const credentials = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const cookies: Record<string, string> = {}, checks: { name: string; status: number }[] = [];
async function request(path: string, actor = "", method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "", ...headers,
    ...(value === undefined ? {} : { "content-type": "application/json" }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function check(name: string, path: string, status: number, actor = "", method = "GET", value?: unknown, headers?: Record<string, string>) {
  const response = await request(path, actor, method, value, headers), text = await response.text();
  checks.push({ name, status: response.status }); assert.equal(response.status, status, name + ": " + text);
  return text ? JSON.parse(text) : null;
}
try {
  for (const actor of ["owner", "viewer", "other"]) {
    const { email, password } = credentials[actor]; assert.ok(email.startsWith("rea-"));
    const response = await request("/auth/sign-in/email", "", "POST", { email, password }); assert.equal(response.status, 200);
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const servicePath = "/services/" + expectedService.id, companyPath = "/companies/" + expectedCompany.id;
  assert.deepEqual(await check("fresh-login service read", servicePath, 200, "owner"), expectedService);
  assert.equal(expectedService.version, 5); assert.equal(expectedService.status, "active");
  await check("anonymous service", servicePath, 401);
  await check("viewer without service grant", servicePath, 403, "viewer");
  await check("other company service", servicePath, 404, "other");
  await check("viewer service write", servicePath, 403, "viewer", "PATCH", { version: 5, name: "거부될 변경" });
  await check("other company service write", servicePath, 404, "other", "PATCH", { version: 5, name: "거부될 변경" });
  await check("stale service write", servicePath, 409, "owner", "PATCH", { version: 4, name: "거부될 변경" });
  await check("stale service archive", servicePath, 409, "owner", "DELETE", undefined, { "If-Match": "4" });
  await check("invalid service type", servicePath, 422, "owner", "PATCH", { version: 5, type: "unknown" });
  const duplicate = await check("same company duplicate service", "/services", 409, "owner", "POST", { name: expectedService.name, externalName: "중복 거부" }); assert.equal(duplicate.error.code, "ALREADY_EXISTS");
  const list = await check("service search and last page clamp", "/services?" + new URLSearchParams({ search: expectedService.name, page: "999", pageSize: "1" }), 200, "owner");
  assert.equal(list.total, 1); assert.equal(list.page, 1); assert.deepEqual(list.items, [expectedService]);
  const primary = await db.service.findUniqueOrThrow({ where: { id: "c8466aa3-dfdc-4305-b3c7-25fe51aa126b" } });
  const used = await check("referenced service archive denied", "/services/" + primary.id, 409, "owner", "DELETE", undefined, { "If-Match": String(primary.version) });
  assert.equal(used.error.code, "SERVICE_IN_USE");
  await check("new company context selection", "/context", 200, "owner", "POST", { companyId: expectedCompany.id });
  const company = await check("new company fresh-login read", companyPath, 200, "owner"); assert.deepEqual(company, expectedCompany);
  assert.equal(company.version, 8); assert.equal(company.closureRequestedAt, null); assert.equal(company.businessFile, null);
  await check("anonymous company", companyPath, 401);
  await check("other company read", companyPath, 404, "other");
  await check("viewer company write", companyPath, 403, "viewer", "PATCH", { version: 8, address: "거부될 변경" });
  await check("stale company write", companyPath, 409, "owner", "PATCH", { version: 7, address: "거부될 변경" });
  await check("invalid company website", companyPath, 422, "owner", "PATCH", { version: 8, website: "javascript:alert(1)" });
  const wrongName = await check("closure wrong confirmation", companyPath, 422, "owner", "DELETE", { version: 8, confirmation: "일치하지 않음", reason: "거부 시험" }); assert.equal(wrongName.error.code, "COMPANY_CONFIRMATION");
  await check("already cancelled closure", companyPath + "/closure", 409, "owner", "POST", { version: 8, action: "cancel" });
  for (const filename of ["uploaded", "replaced"]) {
    const saved = JSON.parse(await readFile(companyDirectory + "/" + filename + ".json", "utf8"));
    await check("deleted business file " + filename, companyPath + "/business-file?fileId=" + saved.businessFile.id, 404, "owner");
  }
  const stored = await db.company.findUniqueOrThrow({ where: { id: company.id }, include: { policy: true, memberships: true, services: true, subscriptions: true, businessFiles: { orderBy: { createdAt: "asc" } } } });
  assert.equal(stored.version, 8); assert.equal(stored.status, "active"); assert.equal(stored.closureRequestedAt, null); assert.equal(stored.closureReasonCipher, null);
  assert.equal(stored.memberships.length, 1); assert.equal(stored.memberships[0].role, "owner"); assert.equal(stored.services.length, 1); assert.ok(stored.policy);
  assert.equal(stored.subscriptions.length, 1); assert.equal(stored.subscriptions[0].activationSource, "trial");
  assert.equal(stored.businessFiles.length, 2);
  for (const file of stored.businessFiles) { assert.equal(file.status, "deleted"); assert.equal(file.storageKey, null); assert.equal(file.nameCipher, null); assert.equal(file.size, 0); assert.match(file.scanEngine, /ClamAV/i); }
  const service = await db.service.findUniqueOrThrow({ where: { id: expectedService.id } });
  const events = await db.auditEvent.findMany({ where: { resourceId: { in: [company.id, service.id] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { action: true, resourceId: true, createdAt: true } });
  assert.deepEqual(events.filter(event => event.resourceId === company.id).map(event => event.action), ["company.created", "company.updated", "company.updated", "company.business_file_uploaded", "company.business_file_downloaded", "company.business_file_uploaded", "company.business_file_removed", "company.closure_requested", "company.closure_cancelled"]);
  assert.deepEqual(events.filter(event => event.resourceId === service.id).map(event => event.action), ["service.created", "service.updated", "service.updated", "service.archived", "service.updated"]);
  assert.equal(service.version, 5); assert.equal(service.status, "active");
  assert.deepEqual(await db.service.findUniqueOrThrow({ where: { id: primary.id } }), primary);
  const bytes = await readFile(companyDirectory + "/synthetic-business-1.pdf"), downloaded = await readFile(companyDirectory + "/downloaded-business-1.pdf"); assert.deepEqual(downloaded, bytes);
  const stateHash = createHash("sha256").update(JSON.stringify({ stored, service, events })).digest("hex"), after = process.argv.includes("--after-restart");
  if (after) assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
  const report = { result: "passed", checkedAt: new Date().toISOString(), afterRestart: after, companyId: company.id, companyVersion: 8, serviceId: service.id, serviceVersion: 5, businessFilesDeleted: 2, downloadedPdfBytes: bytes.length, auditCount: events.length, checks, stateHash };
  await mkdir(directory, { recursive: true }); await writeFile(directory + (after ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
