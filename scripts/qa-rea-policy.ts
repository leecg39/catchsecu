import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const directory = "docs/qa/R10-T04/structured-policy", id = "b575be39-625a-4bc7-9af8-33e848e54500";
const final = JSON.parse(await readFile(directory + "/final.json", "utf8")); assert.equal(final.record.id, id);
const expected1 = JSON.parse(await readFile(directory + "/expected-policy.json", "utf8")), expected2 = structuredClone(expected1);
expected2.children.purpose = "아동 교육 신청 최종 안내";
expected2.cctv = { enabled: false, purposes: [], customPurpose: "", installations: [], managers: [] };
expected2.hosting.trustees[0].subprocessors.pop();
const credentials = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const cookies: Record<string, string> = {}, checks: { name: string; status: number }[] = [], pdfs: unknown[] = [];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
async function request(path: string, actor = "", method = "GET", input?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "", ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function check(name: string, path: string, status: number, actor = "", method = "GET", input?: unknown, headers?: Record<string, string>) {
  const response = await request(path, actor, method, input, headers), body = await response.json(); checks.push({ name, status: response.status }); assert.equal(response.status, status, name + ": " + JSON.stringify(body)); return body;
}
try {
  for (const actor of ["owner", "viewer", "other"]) {
    const { email, password } = credentials[actor]; assert.ok(email.startsWith("rea-"));
    const response = await request("/auth/sign-in/email", "", "POST", { email, password }); assert.equal(response.status, 200);
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const path = "/documents/" + id, row = await check("owner read", path, 200, "owner");
  assert.deepEqual(row, final.record); assert.equal(row.version, 6); assert.equal(row.draftRevision, 4); assert.deepEqual(row.policyDetails, expected2);
  const input = Object.fromEntries(["serviceId", "type", "title", "body", "refusalNotice", "rightsContact", "effectiveDate", "purposeIds", "recipientIds", "policyDetails"].map(key => [key, row[key]]));
  await check("anonymous read", path, 401); await check("viewer read", path, 403, "viewer"); await check("other company read", path, 404, "other");
  await check("viewer write", path, 403, "viewer", "PATCH", { ...input, version: 6 }); await check("other company write", path, 404, "other", "PATCH", { ...input, version: 6 });
  await check("stale update", path, 409, "owner", "PATCH", { ...input, version: 5 });
  await check("stale archive", path, 409, "owner", "DELETE", undefined, { "If-Match": "5" });
  await check("stale publish", path + "/publish", 409, "owner", "POST", { version: 5, expiresAt: null });
  await check("document type isolation", "/documents", 422, "owner", "POST", { ...input, type: "consent" }, { "Idempotency-Key": randomUUID() });
  await check("unknown detail field", path, 422, "owner", "PATCH", { ...input, policyDetails: { ...expected2, injected: true }, version: 6 });
  await check("invalid nested email", path, 422, "owner", "PATCH", { ...input, policyDetails: { ...expected2, officers: { ...expected2.officers, email: "invalid" } }, version: 6 });
  const draft = await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: id } }); assert.deepEqual(draft.payload, expected2); assert.equal(draft.serviceId, row.serviceId); assert.equal(draft.schemaVersion, 1);
  const versions = await db.documentVersion.findMany({ where: { documentId: id }, include: { publications: true, pdf: true }, orderBy: { number: "asc" } }); assert.equal(versions.length, 2);
  for (const version of versions) {
    const saved = final.versions.items.find((item: { number: number }) => item.number === version.number); assert.ok(saved);
    const snapshot = JSON.parse(JSON.stringify(version.snapshot)); assert.deepEqual(snapshot.policyDetails, version.number === 1 ? expected1 : expected2);
    assert.equal(version.contentHash, hash(canonical(snapshot))); assert.equal(version.publications.length, 1); assert.equal(version.publications[0].status, "active");
    const publicPath = "/public/documents/" + saved.publications[0].url.split("/").pop();
    const result = await check("anonymous published version " + version.number, publicPath, 200); assert.deepEqual(result.snapshot, snapshot); assert.equal(result.renderedText, version.renderedText);
    const bytes = await readFile(directory + `/version-${version.number}.pdf`); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    const response = await request(publicPath + "/pdf"); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.ok(version.pdf); assert.equal(version.pdf.pdfHash, hash(bytes));
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), pdf = await task.promise;
    let text = ""; const pages = pdf.numPages;
    try { for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" "); assert.equal(await pdf.getJSActions(), null); } finally { await task.destroy(); }
    for (const phrase of ["합성 재수탁자", "기기 내부 사진 분류", "가상 DPO", "합성 접속 기록"]) assert.ok(text.includes(phrase), phrase);
    if (version.number === 1) assert.ok(text.includes("가상 책임자")); else { assert.ok(text.includes("운영하지 않습니다")); assert.ok(!text.includes("가상 책임자")); }
    pdfs.push({ number: version.number, bytes: bytes.length, sha256: hash(bytes), pages, textVerified: true });
  }
  const events = await db.auditEvent.findMany({ where: { resourceId: id }, orderBy: { createdAt: "asc" }, select: { action: true, resourceId: true, createdAt: true } });
  assert.deepEqual(events.map(event => event.action), ["document.created", "document.published", "document.draft_updated", "document.draft_updated", "document.draft_updated", "document.published"]);
  const persisted = await db.document.findUniqueOrThrow({ where: { id } }); assert.equal(persisted.version, 6);
  const stateHash = hash(canonical(JSON.parse(JSON.stringify({ persisted, draft, versions: versions.map(version => ({ id: version.id, number: version.number, contentHash: version.contentHash, snapshot: version.snapshot, publications: version.publications })), events, pdfs }))));
  const after = process.argv.includes("--after-restart");
  if (after) assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
  const report = { result: "passed", afterRestart: after, documentId: id, version: 6, draftRevision: 4, checks, draftEqualsExpected: true, versions: 2, auditCount: events.length, pdfs, stateHash, checkedAt: new Date().toISOString() };
  await writeFile(directory + (after ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
