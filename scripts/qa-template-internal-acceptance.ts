import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "@/server/db";

const phase = process.env.QA_PHASE === "final" ? "final" : "pre-deletion";
const templateId = "284a8d6d-fc05-4005-9cbc-6d455562cc28";
const redAssetId = "66c2d488-e5b7-4aed-8090-50efedbe835b";
const blueAssetId = "c5cb0186-fbd9-4dd0-9843-9ae6d180fc82";
const fixtures = {
  red: {
    path: "docs/qa/R08-T03/template-internal-acceptance/fixtures/thumbnail-red.png",
    sha256: "92dadde2682789e16de3615e50017f281c3c2a82e84f76057743f43f04729fce",
  },
  blue: {
    path: "docs/qa/R08-T03/template-internal-acceptance/fixtures/thumbnail-blue.png",
    sha256: "b87126b8728b782c959b12846312673ae0f235345c2724a7cf4fbf1ba7c0f3a9",
  },
};

async function fixtureHash(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function asset(id: string) {
  return db.authorAsset.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      purpose: true,
      size: true,
      status: true,
      expiresAt: true,
      blob: { select: { sha256: true, size: true, status: true, scanStatus: true, expiresAt: true } },
      references: { select: { templateId: true, slot: true } },
    },
  });
}

const fixtureHashes = { red: await fixtureHash(fixtures.red.path), blue: await fixtureHash(fixtures.blue.path) };
assert.deepEqual(fixtureHashes, { red: fixtures.red.sha256, blue: fixtures.blue.sha256 });

const [template, redAsset, blueAsset, audits] = await Promise.all([
  db.formTemplate.findUnique({ where: { id: templateId }, select: {
    id: true, title: true, status: true, version: true, thumbnailAssetId: true, updatedAt: true,
  } }),
  asset(redAssetId),
  asset(blueAssetId),
  db.auditEvent.findMany({ where: { resourceId: templateId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, action: true, createdAt: true } }),
]);

for (const value of [redAsset, blueAsset]) {
  assert.equal(value.purpose, "FORM_CONTENT_IMAGE");
  assert.equal(value.status, "ready");
  assert.equal(value.blob.status, "ready");
  assert.equal(value.blob.scanStatus, "clean");
}
assert.equal(redAsset.blob.sha256, fixtures.red.sha256);
assert.equal(blueAsset.blob.sha256, fixtures.blue.sha256);
assert.equal(redAsset.references.length, 0);
assert.ok(redAsset.expiresAt);

if (phase === "pre-deletion") {
  assert.ok(template);
  assert.equal(template.title, "서버 확정본 QA 20261011");
  assert.equal(template.status, "active");
  assert.ok(template.version >= 5);
  assert.equal(template.thumbnailAssetId, blueAssetId);
  assert.equal(blueAsset.expiresAt, null);
  assert.deepEqual(blueAsset.references, [{ templateId, slot: "template_thumbnail" }]);
  assert.equal(audits.some(row => row.action === "template.deleted"), false);
} else {
  assert.equal(template, null);
  assert.equal(blueAsset.references.length, 0);
  assert.ok(blueAsset.expiresAt);
  assert.ok(audits.some(row => row.action === "template.deleted"));
}

const report = {
  checkedAt: new Date().toISOString(),
  result: "passed",
  phase,
  template,
  fixtures: {
    red: { assetId: redAssetId, sha256: fixtureHashes.red },
    blue: { assetId: blueAssetId, sha256: fixtureHashes.blue },
  },
  assets: [redAsset, blueAsset],
  audits,
};
await writeFile(`docs/qa/R08-T03/template-internal-acceptance/${phase}-database.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, phase, templatePresent: !!template,
  redReferences: redAsset.references.length, blueReferences: blueAsset.references.length }));
await db.$disconnect();
