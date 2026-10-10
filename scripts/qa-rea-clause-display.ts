import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const clauseDir = "docs/qa/R10-T03/clause-flow", displayDir = "docs/qa/R10-T04/display-flow";
const clause = JSON.parse(await readFile(clauseDir + "/final.json", "utf8")).row;
const policy = JSON.parse(await readFile(clauseDir + "/policy-final.json", "utf8"));
const displays = JSON.parse(await readFile(displayDir + "/final.json", "utf8"));
const cookies: Record<string, string> = {};
const checks: { name: string; status: number; code?: string }[] = [];
const restart = process.argv.includes("--after-restart");
async function request(path: string, actor: string, method = "GET", input?: unknown, extra: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function check(name: string, path: string, actor: string, expected: number, method = "GET", input?: unknown, extra?: Record<string, string>) {
  const response = await request(path, actor, method, input, extra), value = await response.json().catch(() => null);
  checks.push({ name, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, name + ": " + JSON.stringify(value)); return value;
}
try {
  for (const actor of ["owner", "viewer", "other"]) {
    const { email, password } = fixture[actor]; assert.ok(email.startsWith("rea-"));
    const response = await request("/auth/sign-in/email", "", "POST", { email, password });
    assert.equal(response.status, 200);
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const input = Object.fromEntries(["serviceId", "type", "title", "body"].map(key => [key, clause[key]]));
  const path = "/clause-templates/" + clause.id;
  assert.deepEqual(await check("clause owner read", path, "owner", 200), clause);
  await check("clause anonymous read", path, "", 401);
  await check("clause ungranted viewer read", path, "viewer", 403);
  await check("clause viewer create", "/clause-templates", "viewer", 403, "POST", input, { "Idempotency-Key": randomUUID() });
  for (const method of ["GET", "PATCH", "DELETE"]) {
    await check("clause other tenant " + method, path, "other", 404, method,
      method === "PATCH" ? { ...input, version: clause.version } : undefined,
      method === "DELETE" ? { "If-Match": String(clause.version) } : undefined);
  }
  await check("clause stale update", path, "owner", 409, "PATCH", { ...input, version: clause.version - 1 });
  await check("clause stale archive", path, "owner", 409, "DELETE", undefined, { "If-Match": String(clause.version - 1) });
  await check("clause invalid restore", path + "/restore", "owner", 409, "POST", { version: clause.version });
  await check("clause scope immutable", path, "owner", 422, "PATCH", { ...input, type: "consent", version: clause.version });
  await check("clause tenant injection", "/clause-templates", "owner", 422, "POST", { ...input, tenantId: fixture.other.companyId }, { "Idempotency-Key": randomUUID() });
  for (const kind of ["collection", "third_party"] as const) {
    const row = displays[kind], endpoint = `/services/${row.serviceId}/consent-display/${kind}`;
    const fields = ["version", "nameMode", "startText", "processorText", "policyText", "requiredText", "optionalText", "policyMode", "externalUrl", "publicationId"];
    const value = Object.fromEntries(fields.map(key => [key, row[key]]));
    assert.deepEqual(await check(kind + " owner read", endpoint, "owner", 200), row);
    await check(kind + " anonymous read", endpoint, "", 401);
    await check(kind + " viewer read", endpoint, "viewer", 403);
    await check(kind + " viewer update", endpoint, "viewer", 403, "PATCH", value);
    await check(kind + " other tenant update", endpoint, "other", 403, "PATCH", value);
    await check(kind + " stale update", endpoint, "owner", 409, "PATCH", { ...value, version: row.version - 1 });
    await check(kind + " insecure URL", endpoint, "owner", 422, "PATCH", { ...value, policyMode: "external", externalUrl: "http://example.com", publicationId: null });
    await check(kind + " tenant injection", endpoint, "owner", 422, "PATCH", { ...value, tenantId: fixture.other.companyId });
  }
  await check("linked policy cannot be revoked", `/documents/${policy.record.id}/revoke`, "owner", 409, "POST", {
    version: policy.record.version, publicationId: displays.collection.publicationId,
  });
  const saved = await db.clauseTemplate.findUniqueOrThrow({ where: { id: clause.id } });
  assert.equal(saved.tenantId, fixture.owner.companyId); assert.equal(saved.serviceId, fixture.owner.serviceId);
  assert.equal(saved.version, 6); assert.equal(saved.status, "active"); assert.equal(saved.body, clause.body);
  const document = await db.document.findUniqueOrThrow({ where: { id: policy.record.id }, include: {
    versions: { orderBy: { number: "asc" }, include: { publications: true } },
  } });
  assert.equal(document.version, 5); assert.equal(document.draftRevision, 2); assert.equal(document.type, "privacy_policy");
  assert.notEqual(document.body, saved.body);
  assert.deepEqual(document.versions.map(row => row.number), [1, 2]);
  assert.equal(document.versions[0].contentHash, document.versions[1].contentHash);
  assert.equal(document.versions[0].publications[0].status, "revoked");
  assert.equal(document.versions[1].publications[0].status, "active");
  for (const version of document.versions) {
    assert.ok(version.renderedText.includes(document.body)); assert.ok(!version.renderedText.includes(saved.body));
  }
  const settings = await db.serviceConsentDisplay.findMany({ where: { serviceId: saved.serviceId }, orderBy: { kind: "asc" } });
  assert.equal(settings.length, 2);
  assert.equal(settings[0].kind, "collection"); assert.equal(settings[0].version, 5);
  assert.equal(settings[0].publicationId, document.versions[1].publications[0].id);
  assert.equal(settings[1].kind, "third_party"); assert.equal(settings[1].version, 2);
  assert.equal(settings[1].policyMode, "none"); assert.equal(settings[1].externalUrl, ""); assert.equal(settings[1].publicationId, null);
  const events = await db.auditEvent.findMany({ where: { tenantId: saved.tenantId, OR: [
    { resourceId: saved.id }, { resourceId: document.id }, { resourceId: saved.serviceId, action: "service.consent_display_updated" },
  ] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.equal(events.filter(row => row.resourceId === saved.id).length, 6);
  assert.equal(events.filter(row => row.resourceId === document.id).length, 5);
  assert.equal(events.filter(row => row.action === "service.consent_display_updated").length, 7);
  const stateHash = createHash("sha256").update(JSON.stringify({ saved, document, settings, events })).digest("hex");
  if (restart) assert.equal(stateHash, JSON.parse(await readFile(displayDir + "/verified.json", "utf8")).stateHash);
  const report = { checkedAt: new Date().toISOString(), result: "passed", httpChecks: checks,
    clauseVersion: saved.version, documentVersion: document.version, settingsVersions: settings.map(row => ({ kind: row.kind, version: row.version })),
    auditEvents: events.length, clauseCopyIndependent: true, publicationSnapshotImmutable: true, stateHash, restartVerified: restart };
  await writeFile(displayDir + (restart ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", httpChecks: checks.length, auditEvents: events.length, stateHash, restart }));
} finally {
  for (const actor of Object.keys(cookies)) await request("/auth/sign-out", actor, "POST", {}).catch(() => undefined);
  await db.$disconnect();
}
