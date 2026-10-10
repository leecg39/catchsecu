import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import type { DocumentSnapshot } from "../src/contracts/documents";

const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const output = "docs/qa/R10-T03/document-flow";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const browser = JSON.parse(await readFile(output + "/final.json", "utf8"));
const hash = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
try {
  const row = await db.document.findUniqueOrThrow({ where: { id: browser.record.id },
    include: { purposes: true, versions: { orderBy: { number: "asc" }, include: { publications: true, pdf: true } } } });
  assert.equal(row.tenantId, fixture.owner.companyId); assert.equal(row.serviceId, fixture.owner.serviceId);
  assert.equal(row.status, "published"); assert.equal(row.version, 8); assert.equal(row.draftRevision, 3);
  assert.equal(row.body, browser.record.body); assert.equal(row.purposes.length, 1);
  assert.deepEqual(row.versions.map(version => version.number), [1, 2, 3]);
  for (const version of row.versions) {
    const snapshot = version.snapshot as unknown as DocumentSnapshot;
    assert.equal(hash(canonical(snapshot)), version.contentHash);
    assert.equal(snapshot.purposes[0].name, "REA 검증 수집 목적 1010"); assert.equal(snapshot.purposes[0].retentionDays, 120);
    assert.equal(snapshot.recipients[0].name, "REA 검증 수탁자 1010"); assert.equal(snapshot.recipients[0].retentionDays, 90);
    const shown = browser.versions.items.find((item: { number: number }) => item.number === version.number);
    assert.equal(version.contentHash, shown.contentHash);
    assert.equal(version.publications.length, 1);
    assert.equal(version.publications[0].status, version.number < 3 ? "revoked" : "active");
  }
  const first = row.versions[0], second = row.versions[1], third = row.versions[2];
  assert.ok(first.renderedText.includes("REA 문서 초안 원문")); assert.ok(!first.renderedText.includes("REA 최종 문서 본문"));
  assert.notEqual(first.contentHash, second.contentHash); assert.equal(second.contentHash, third.contentHash);
  const pdf = await readFile(output + "/document-v1.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-"); assert.ok(first.pdf);
  assert.equal(hash(pdf), first.pdf.pdfHash); assert.equal(hash(first.pdf.bytes), hash(pdf));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const parsed = await loading.promise;
  const text: string[] = [];
  for (let page = 1; page <= parsed.numPages; page++) {
    const content = await (await parsed.getPage(page)).getTextContent();
    text.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
  }
  assert.equal(parsed.numPages, first.pdf.pageCount); await loading.destroy();
  const normalized = text.join(" ").replace(/\s/g, "");
  for (const expected of ["REA 게시 문서 1010", "REA 문서 초안 원문", "REA 검증 수집 목적 1010", "120일", "90일"])
    assert.ok(normalized.includes(expected.replace(/\s/g, "")), "PDF omitted " + expected);
  const events = await db.auditEvent.findMany({ where: { tenantId: row.tenantId, resourceId: row.id }, orderBy: { createdAt: "asc" } });
  assert.equal(events.length, 8);
  assert.equal(events.filter(event => event.action === "document.published").length, 3);
  assert.equal(events.filter(event => event.action === "document.draft_updated").length, 2);
  const stateHash = hash(JSON.stringify({ row, events }));
  const restart = process.argv.includes("--after-restart");
  if (restart) assert.equal(stateHash, JSON.parse(await readFile(output + "/db.json", "utf8")).stateHash);
  const report = { checkedAt: new Date().toISOString(), result: "passed", readOnly: true, documentId: row.id,
    rowVersion: row.version, draftRevision: row.draftRevision, publishedVersions: row.versions.map(version => ({
      number: version.number, contentHash: version.contentHash, status: version.publications[0].status,
    })), downloadedPdf: { bytes: pdf.length, hash: hash(pdf), pages: first.pdf.pageCount, databaseBytesMatch: true, koreanTextVerified: true },
    auditEvents: events.length, publishedSnapshotsImmutable: true, stateHash, restartVerified: restart };
  await writeFile(output + (restart ? "/db-after-restart.json" : "/db.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
