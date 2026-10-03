import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { canonicalDocument, renderDocument } from "../src/server/documents";
import type { DocumentSnapshot } from "../src/contracts/documents";

const stage = process.argv[2], url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const tenantId = "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc";
const document = await db.document.findFirstOrThrow({ where: { tenantId, title: "문서 브라우저 QA 동의서 2026-10-02" }, include: { versions: { orderBy: { number: "asc" }, include: { publications: true } }, purposes: true } });
const expectedCounts: Record<string, number> = { published: 1, revised: 2, connected: 2, archived: 2, final: 3 };
assert.equal(document.versions.length, expectedCounts[stage]);
assert.ok(document.purposes.length > 0);
const versions = [];
for (const version of document.versions) {
  const snapshot = version.snapshot as unknown as DocumentSnapshot;
  assert.equal(version.contentHash, createHash("sha256").update(canonicalDocument(snapshot)).digest("hex"));
  assert.equal(version.renderedText, renderDocument(snapshot));
  assert.ok(snapshot.purposes.some(item => item.retentionDays === 30));
  const statuses: number[] = [];
  for (const link of version.publications) {
    assert.match(link.tokenCipher, /^v1\./); assert.match(link.tokenHash, /^[a-f0-9]{64}$/);
    const response = await fetch(env.BETTER_AUTH_URL + "/api/v1/public/documents/" + decrypt<string>(link.tokenCipher));
    const expected = link.status === "active" && document.status === "published" ? 200 : 410; assert.equal(response.status, expected); statuses.push(response.status);
    if (expected === 200) { const value = await response.json(); assert.equal(value.contentHash, version.contentHash); assert.deepEqual(value.snapshot, snapshot);
      for (const internal of [tenantId, document.serviceId, document.createdBy, "tokenCipher", "tokenHash"]) assert.ok(!JSON.stringify(value).includes(internal)); }
  }
  versions.push({ number: version.number, hash: version.contentHash, body: snapshot.body, publicStatuses: statuses });
}
assert.equal((document.versions[0].snapshot as unknown as DocumentSnapshot).body, '합성 자료만 사용하는 상담 신청 안내입니다.\n<script>window.__documentXss=1</script>');
if (document.versions.length > 1) { assert.notEqual(document.versions[0].contentHash, document.versions[1].contentHash); assert.equal((document.versions[1].snapshot as unknown as DocumentSnapshot).body, "두 번째 개정: 상담 안내 내용을 변경했습니다."); }
if (stage === "archived") assert.equal(document.status, "archived");
const clause = stage === "final" ? await db.clauseTemplate.findFirstOrThrow({ where: { tenantId, serviceId: document.serviceId, title: "상담 안내 문구 QA 2026-10-02" } }) : null;
if (clause) {
  assert.equal(clause.status, "active"); assert.equal(clause.version, 4);
  assert.equal(clause.body, "개정 문구: 문구 관리에서만 수정한 시험 안내입니다.");
  assert.notEqual(clause.body, (document.versions[0].snapshot as unknown as DocumentSnapshot).body);
}
const policy = await db.document.findFirst({ where: { tenantId, serviceId: document.serviceId, title: "문서 브라우저 QA 처리방침 2026-10-02" }, include: { versions: { orderBy: { number: "asc" } } } });
const displays = await db.serviceConsentDisplay.findMany({ where: { tenantId, serviceId: document.serviceId }, include: { publication: true } });
if (["connected", "final"].includes(stage)) {
  assert.ok(policy); assert.equal(policy.status, "published");
  const collection = displays.find(item => item.kind === "collection"), third = displays.find(item => item.kind === "third_party");
  assert.equal(collection?.startText, "수집 안내 QA 문구"); assert.equal(collection?.publication?.documentId, policy.id);
  assert.equal(third?.startText, "제공 안내 QA 문구"); assert.equal(third?.externalUrl, "https://example.test/privacy");
}
const evidence = { stage, result: "PASS", checkedAt: new Date().toISOString(), documentId: document.id, serviceId: document.serviceId,
  documentStatus: document.status, documentVersion: document.version, versions, policyId: policy?.id,
  clause: clause ? { status: clause.status, version: clause.version, copiedDocumentUnchanged: true } : undefined,
  displays: displays.map(item => ({ kind: item.kind, version: item.version, policyMode: item.policyMode, startText: item.startText })),
  auditActions: (await db.auditEvent.findMany({ where: { tenantId, resourceId: document.id }, select: { action: true }, orderBy: { createdAt: "asc" } })).map(item => item.action) };
await writeFile(`docs/qa/documents/database-${stage}.json`, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ stage, result: "PASS", versions: versions.length, documentStatus: document.status })); await db.$disconnect();
