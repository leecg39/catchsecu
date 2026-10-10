import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { DocumentSnapshot } from "../src/contracts/documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const directory = "docs/qa/R10-T04/overseas-flow";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const initial = JSON.parse(await readFile(directory + "/published.json", "utf8"));
const final = JSON.parse(await readFile(directory + "/final.json", "utf8"));
const recipient = JSON.parse(await readFile(directory + "/recipient.json", "utf8"));
const cookies: Record<string, string> = {};
const checks: { name: string; status: number; code?: string }[] = [];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
async function request(path: string, actor = "", method = "GET", input?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function check(name: string, path: string, actor: string, status: number, method = "GET", input?: unknown, headers?: Record<string, string>) {
  const response = await request(path, actor, method, input, headers), value = await response.json();
  checks.push({ name, status: response.status, code: value?.error?.code });
  assert.equal(response.status, status, name + ": " + JSON.stringify(value)); return value;
}
try {
  for (const actor of ["owner", "viewer", "other"]) {
    const { email, password } = fixture[actor]; assert.ok(email.startsWith("rea-"));
    const response = await request("/auth/sign-in/email", "", "POST", { email, password });
    assert.equal(response.status, 200);
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const row = final.record, path = "/documents/" + row.id;
  const input = Object.fromEntries(["serviceId", "type", "title", "body", "refusalNotice", "rightsContact", "effectiveDate", "purposeIds", "recipientIds"].map(key => [key, row[key]]));
  assert.deepEqual(await check("owner read", path, "owner", 200), row);
  await check("anonymous read", path, "", 401);
  await check("viewer read", path, "viewer", 403);
  await check("viewer create", "/documents", "viewer", 403, "POST", input, { "Idempotency-Key": randomUUID() });
  for (const method of ["GET", "PATCH", "DELETE"]) await check("other tenant " + method, path, "other", 404, method,
    method === "PATCH" ? { ...input, version: row.version } : undefined,
    method === "DELETE" ? { "If-Match": String(row.version) } : undefined);
  await check("stale update", path, "owner", 409, "PATCH", { ...input, version: row.version - 1 });
  await check("stale archive", path, "owner", 409, "DELETE", undefined, { "If-Match": String(row.version - 1) });
  await check("stale unpublish", path + "/unpublish", "owner", 409, "POST", { version: row.version - 1 });
  await check("invalid restore", path + "/restore", "owner", 409, "POST", { version: row.version });
  await check("type immutable", path, "owner", 422, "PATCH", { ...input, type: "consent", version: row.version });
  await check("tenant injection", path, "owner", 422, "PATCH", { ...input, version: row.version, tenantId: fixture.other.companyId });

  const queryPath = `/public/services/${row.serviceId}/documents?`;
  const queries = ["view=overseas", "view=overseas&agreement=required", "view=recipients", "view=recipients&agreement=required",
    "view=recipients&recipient=" + recipient.id, "view=recipients&recipient=90cc7e11-94ac-43e2-a12b-f989b6731aec", "view=overseas&country=US"];
  const latest = final.versions.items.find((version: { number: number }) => version.number === 3).publications[0].url;
  for (const query of queries) {
    const response = await check(query, queryPath + query, "", 200);
    assert.equal(response.items.filter((item: { title: string }) => item.title === row.title).length, 1);
    assert.ok(response.items.some((item: { url: string }) => item.url === latest));
  }
  for (const query of ["view=collection", "view=resident&domestic=domestic&agreement=required", "view=overseas&country=JP"]) {
    const response = await check(query, queryPath + query, "", 200);
    assert.ok(response.items.every((item: { title: string }) => item.title !== row.title));
  }
  await check("invalid country", queryPath + "view=overseas&country=XX", "", 422);
  const versions = await db.documentVersion.findMany({ where: { documentId: row.id }, orderBy: { number: "asc" }, include: { publications: true } });
  for (const version of versions) {
    const token = decrypt<string>(version.publications[0].tokenCipher), status = version.number < 3 ? 410 : 200;
    const publicRow = await check("public version " + version.number, "/public/documents/" + token, "", status);
    if (status === 200) { assert.equal(publicRow.contentHash, version.contentHash); assert.ok(!JSON.stringify(publicRow).includes("recipientSources")); }
    const pdf = await request("/public/documents/" + token + "/pdf");
    checks.push({ name: "public PDF " + version.number, status: pdf.status }); assert.equal(pdf.status, status);
    if (status === 200) assert.equal(hash(new Uint8Array(await pdf.arrayBuffer())), hash(await readFile(directory + "/document-v3.pdf")));
  }

  const stored = await db.document.findUniqueOrThrow({ where: { id: row.id }, include: {
    recipients: true, versions: { orderBy: { number: "asc" }, include: { publications: true, pdf: true,
      recipientSources: { orderBy: { recipientId: "asc" } } } },
  } });
  assert.equal(stored.tenantId, fixture.owner.companyId); assert.equal(stored.serviceId, fixture.owner.serviceId);
  assert.equal(stored.version, 10); assert.equal(stored.draftRevision, 4); assert.equal(stored.status, "published");
  assert.deepEqual(stored.recipients.map(item => item.recipientId), [recipient.id]);
  assert.deepEqual(stored.versions.map(item => item.number), [1, 2, 3]);
  const pdfs = [], pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const version of stored.versions) {
    assert.deepEqual(version.recipientSources.map(item => item.recipientId), [recipient.id, "90cc7e11-94ac-43e2-a12b-f989b6731aec"].sort());
    const snapshot = version.snapshot as unknown as DocumentSnapshot;
    assert.equal(snapshot.type, "overseas_transfer"); assert.equal(snapshot.recipients.length, 2);
    assert.equal(hash(canonical(snapshot)), version.contentHash);
    assert.equal(version.publications[0].status, version.number < 3 ? "revoked" : "active");
    assert.equal(snapshot.recipients.find(item => item.countryCode === "US")?.retentionDays, 45);
    const bytes = await readFile(directory + "/document-v" + version.number + ".pdf");
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.ok(version.pdf);
    assert.equal(hash(bytes), version.pdf.pdfHash); assert.equal(hash(version.pdf.bytes), hash(bytes));
    const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }), parsed = await loading.promise;
    const text = [];
    for (let index = 1; index <= parsed.numPages; index++) {
      const content = await (await parsed.getPage(index)).getTextContent();
      text.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
    }
    assert.equal(parsed.numPages, version.pdf.pageCount); await loading.destroy();
    const normalized = text.join(" ").replace(/\s/g, "");
    for (const expected of ["REA 국외이전 동의서 1010", "REA 국외 수탁자 1010", "45일", "90일", "120일", "암호화 전송"])
      assert.ok(normalized.includes(expected.replace(/\s/g, "")), "PDF omitted " + expected);
    pdfs.push({ number: version.number, bytes: bytes.length, sha256: hash(bytes), pages: version.pdf.pageCount });
  }
  assert.equal(stored.versions[0].contentHash, initial.versions.items[0].contentHash);
  assert.notEqual(stored.versions[0].contentHash, stored.versions[1].contentHash);
  assert.equal(stored.versions[1].contentHash, stored.versions[2].contentHash);
  const events = await db.auditEvent.findMany({ where: { tenantId: stored.tenantId, resourceId: stored.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.equal(events.length, 10); assert.equal(events.filter(item => item.action === "document.published").length, 3);
  const stateHash = hash(JSON.stringify({ stored, events })), restart = process.argv.includes("--after-restart");
  if (restart) assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
  const report = { checkedAt: new Date().toISOString(), result: "passed", documentId: stored.id, rowVersion: stored.version,
    draftRevision: stored.draftRevision, publishedVersions: stored.versions.length, recipientSources: 6, checks, pdfs,
    auditEvents: events.length, snapshotImmutable: true, stateHash, restartVerified: restart };
  await writeFile(directory + (restart ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length, auditEvents: events.length, pdfs, stateHash, restart }));
} finally {
  for (const actor of Object.keys(cookies)) await request("/auth/sign-out", actor, "POST", {}).catch(() => undefined);
  await db.$disconnect();
}
