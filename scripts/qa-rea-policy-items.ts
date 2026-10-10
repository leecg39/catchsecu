import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = "docs/qa/R10-T04/trustee-items", fixture = JSON.parse(await readFile(".local/rea-fullstack/access-fixture.json", "utf8"));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => JSON.stringify(key) + ":" + canonical(value)).join(",") + "}";
  return JSON.stringify(value);
}
let cookie = "";
async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: path.startsWith("/public/") ? "" : cookie, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body ===undefined ? {} : { body: JSON.stringify(body) }) });
}
const checks: { path: string; status: number }[] = [];
async function json(path: string, status = 200, method = "GET", body?: unknown, headers?: Record<string, string>) {
  const response = await request(path, method, body, headers), value = await response.json();
  checks.push({ path, status: response.status }); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
try {
  const login = await request("/auth/sign-in/email", "POST", { email: fixture.owner.email, password: fixture.owner.password });
  assert.equal(login.status, 200); cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await mkdir(directory, { recursive: true });
  if (process.argv.includes("--prepare")) {
    const purposes = [];
    for (const [name, key, items] of [
      ["REA 항목 초기값 A 1010", "3b99d857-bf52-4bcb-a0e4-3250ca0fd793", [{ name: "이메일", kind: "general", required: true }, { name: "별명", kind: "general", required: false }]],
      ["REA 항목 초기값 B 1010", "0cc0edc5-7828-40bb-8c76-1803b8eebeb9", [{ name: "이메일", kind: "general", required: true }, { name: "계정 이름", kind: "general", required: true }, { name: "연락처", kind: "general", required: false }]],
    ] as const) purposes.push(await json("/processing-purposes", 201, "POST", { serviceId: fixture.serviceId, name, purpose: "합성 서비스 수집 항목 검증", lawfulBasis: "consent", basisReference: "", items: [...items], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, { "Idempotency-Key": key }));
    const options = await json("/documents/options?serviceId=" + fixture.serviceId);
    assert.deepEqual(options.policyItems, { requiredItems: ["이메일", "계정 이름"], optionalItems: ["별명", "연락처"] });
    await writeFile(directory + "/prepared.json", JSON.stringify({ tenantId: fixture.tenantId, serviceId: fixture.serviceId, purposes, options }, null, 2) + "\n");
    console.log(JSON.stringify({ prepared: true, purposeIds: purposes.map(row => row.id), policyItems: options.policyItems }));
  } else {
    const final = JSON.parse(await readFile(directory + "/browser-final.json", "utf8")), id: string = final.record.id;
    const first = JSON.parse(await readFile(directory + "/first-published.json", "utf8"));
    assert.deepEqual(final.versions.items.find((item: { number: number }) => item.number === 1), first.versions.items[0]);
    const row = await json("/documents/" + id); assert.deepEqual(row, final.record);
    const preview = await json("/documents/" + id + "/preview"); assert.equal(preview.publishErrors.length, 0);
    const draft = await db.documentPolicyDraft.findUniqueOrThrow({ where: { documentId: id } });
    assert.equal(draft.tenantId, fixture.tenantId); assert.equal(draft.serviceId, fixture.serviceId); assert.deepEqual(draft.payload, row.policyDetails);
    const versions = await db.documentVersion.findMany({ where: { documentId: id }, include: { publications: true, pdf: true }, orderBy: { number: "asc" } });
    assert.equal(versions.length, 2); const pdfs = [];
    for (const version of versions) {
      assert.equal(version.contentHash, hash(canonical(version.snapshot)));
      const saved = final.versions.items.find((item: { number: number }) => item.number === version.number);
      const path = "/public/documents/" + saved.publications[0].url.split("/").pop(), result = await json(path);
      assert.deepEqual(result.snapshot, version.snapshot); assert.equal(result.renderedText, version.renderedText); assert.equal(result.contentHash, version.contentHash);
      const response = await request(path + "/pdf"); assert.equal(response.status, 200);
      const bytes = new Uint8Array(await response.arrayBuffer()), task = getDocument({ data: bytes.slice(), useSystemFonts: false }), pdf = await task.promise;
      let text = "";
      try { for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" "); assert.equal(await pdf.getJSActions(), null); } finally { await task.destroy(); }
      for (const phrase of ["합성 재수탁사", "재수탁 처리 근거 확인", version.number === 1 ? "재수탁 별도 항목" : "재수탁 최종 항목"]) { assert.ok(result.renderedText.includes(phrase), phrase); assert.ok(text.includes(phrase), phrase); }
      const file = directory + "/version-" + version.number + ".pdf";
      if (process.argv.includes("--after-restart")) assert.deepEqual(bytes, new Uint8Array(await readFile(file))); else await writeFile(file, bytes);
      const stored = await db.documentPdf.findUniqueOrThrow({ where: { documentVersionId: version.id } }); assert.equal(stored.pdfHash, hash(bytes));
      pdfs.push({ number: version.number, hash: hash(bytes), bytes: bytes.length, contentHash: version.contentHash });
    }
    const audits = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId, resourceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.equal(audits.length, 5); assert.equal(row.version, 5); assert.equal(row.draftRevision, 3);
    const stateHash = hash(canonical({ row, draft, versions: versions.map(({ pdf: _pdf, ...row }) => { void _pdf; return row; }), audits }));
    if (process.argv.includes("--after-restart")) assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
    const proof = { passed: true, afterRestart: process.argv.includes("--after-restart"), anonymousPublic: true, documentId: id, checks, pdfs, auditCount: audits.length, version: row.version, stateHash };
    await writeFile(directory + (proof.afterRestart ? "/verified-after-restart.json" : "/verified.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
  }
} finally { await db.$disconnect(); }
