import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { ConsentEvidence } from "../src/contracts/form-documents";
const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = "docs/qa/form-documents/", tenantId = "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc";
const fixture = JSON.parse(await readFile(directory + "browser-fixture.json", "utf8"));
const submission = await db.submission.findFirstOrThrow({ where: { id: fixture.submissionId, tenantId }, include: {
  formVersion: { include: { documentBindings: { orderBy: { order: "asc" }, include: { documentVersion: true } }, form: true } }, receipts: { include: { events: true } },
} });
assert.equal(submission.formVersion.formId, fixture.formId); assert.equal(submission.formVersion.number, 1);
assert.equal(submission.formVersion.documentBindings.length, 2); assert.equal(submission.formVersion.receiptEvidenceVersion, 1);
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const phase = process.argv[2] ?? "before";
if (phase === "before") {
  assert.equal(submission.receipts.length, 1); const receipt = submission.receipts[0];
  assert.equal(receipt.evidenceVersion, 1); assert.ok(receipt.evidenceCipher?.startsWith("v1.")); assert.ok(receipt.pdfCipher?.startsWith("v1."));
  const evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher!);
  assert.equal(evidence.formVersion, 1); assert.equal(evidence.generalConsent, true); assert.equal(evidence.bundle.documents.length, 1);
  assert.equal(evidence.bundle.documents[0].key, submission.formVersion.documentBindings[0].id);
  assert.equal(evidence.bundle.documents[0].contentHash, submission.formVersion.documentBindings[0].documentVersion.contentHash);
  assert.equal(evidence.bundle.documents[0].renderedText, submission.formVersion.documentBindings[0].documentVersion.renderedText);
  assert.equal(evidence.bundle.documents[0].display.kind, "collection");
  assert.equal(submission.formVersion.documentBindings[1].required, false); assert.equal(submission.formVersion.documentBindings[1].kind, "third_party");
  assert.equal(evidence.bundle.display?.policy?.kind, "document");
  const browser = JSON.parse(await readFile(directory + "browser-receipt-detail.json", "utf8"));
  assert.deepEqual(browser.receipts[0].evidence, evidence); assert.equal(browser.receipts[0].pdfAvailable, true);
  const bytes = await readFile(directory + "browser-receipt-v1.pdf");
  assert.equal(sha(bytes), receipt.pdfHash); assert.deepEqual(bytes, Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64"));
  const run = promisify(execFile), { stdout: text } = await run("/Users/user01/homebrew/bin/pdftotext", ["-layout", directory + "browser-receipt-v1.pdf", "-"]);
  const normalized = text.replace(/v\d+\s*\|\s*\d+\s*\/\s*\d+/g, "").replace(/\s/g, "");
  for (const expected of ["개인정보 동의 영수증", evidence.formBody, evidence.bundle.documents[0].renderedText, receipt.documentHash, receipt.id, submission.id])
    assert.ok(normalized.includes(expected.replace(/\s/g, "")), "PDF content differs: " + expected.slice(0, 40));
  assert.ok(!normalized.includes("PDF여러페이지QA"));
  const { stdout: fonts } = await run("/Users/user01/homebrew/bin/pdffonts", [directory + "browser-receipt-v1.pdf"]);
  assert.match(fonts, /NotoSansCJKkr-Regular.*yes\s+yes\s+yes/);
  const { stdout: info } = await run("/Users/user01/homebrew/bin/pdfinfo", [directory + "browser-receipt-v1.pdf"]);
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]); assert.ok(pages >= 1);
  await writeFile(directory + "browser-receipt-v1.txt", text); await writeFile(directory + "browser-receipt-fonts.txt", fonts);
  await writeFile(directory + "file-verification.json", JSON.stringify({ phase, formId: fixture.formId, submissionId: submission.id, receiptId: receipt.id,
    bytes: bytes.length, pdfHash: receipt.pdfHash, evidenceHash: receipt.documentHash, pages, acceptedDocuments: 1, offeredDocuments: 2,
    optionalRefused: true, embeddedFont: true, textVerified: true, browserApiMatchesDatabase: true }, null, 2));
  console.log({ phase, pages, bytes: bytes.length, acceptedDocuments: 1, optionalRefused: true, result: "PASS" });
} else if (phase === "final") {
  const before = JSON.parse(await readFile(directory + "file-verification.json", "utf8"));
  assert.equal(submission.status, "destroyed"); assert.equal(submission.receipts.length, 0);
  assert.equal(await db.consentEvent.count({ where: { receiptId: before.receiptId } }), 0);
  assert.equal(await db.answer.count({ where: { submissionId: submission.id } }), 0);
  assert.equal(await db.consentReceipt.count({ where: { submissionId: submission.id, OR: [{ evidenceCipher: { not: null } }, { pdfCipher: { not: null } }] } }), 0);
  const versions = await db.formVersion.findMany({ where: { formId: fixture.formId }, orderBy: { number: "asc" } });
  assert.equal(versions.length, 2); assert.equal(versions[1].status, "published"); assert.notEqual(versions[0].body, versions[1].body);
  for (const name of ["browser-receipt-after-revision.pdf", "browser-receipt-after-withdrawal.pdf", "browser-receipt-after-restart.pdf"])
    assert.equal(sha(await readFile(directory + name)), before.pdfHash);
  const certificate = await db.destructionCertificate.findFirstOrThrow({ where: { submissionId: submission.id } });
  const kept = await db.submission.findFirstOrThrow({ where: { formVersionId: versions[1].id, status: "submitted" }, include: { receipts: true } });
  assert.equal(kept.receipts.length, 1);
  const currentEvidence = decrypt<ConsentEvidence>(kept.receipts[0].evidenceCipher!);
  assert.equal(currentEvidence.formVersion, 2); assert.equal(currentEvidence.bundle.documents.length, 2);
  assert.equal(currentEvidence.bundle.documents[1].display.policy?.kind, "external");
  const currentPdf = await readFile(directory + "browser-receipt-v2.pdf");
  assert.equal(sha(currentPdf), kept.receipts[0].pdfHash);
  assert.deepEqual(currentPdf, Buffer.from(decrypt<string>(kept.receipts[0].pdfCipher!), "base64"));
  const { stdout: currentText } = await promisify(execFile)("/Users/user01/homebrew/bin/pdftotext", ["-layout", directory + "browser-receipt-v2.pdf", "-"]);
  const normalized = currentText.replace(/v\d+\s*\|\s*\d+\s*\/\s*\d+/g, "").replace(/\s/g, "");
  for (const doc of currentEvidence.bundle.documents) assert.ok(normalized.includes(doc.renderedText.replace(/\s/g, "")));
  assert.ok(normalized.includes("https://example.test/privacy"));
  await writeFile(directory + "browser-receipt-v2.txt", currentText);
  await writeFile(directory + "final-verification.json", JSON.stringify({ phase, historicalBytesUnchanged: true, destroyedSubmissionId: submission.id,
    deletedReceipts: true, deletedEvents: true, deletedAnswers: true, certificateId: certificate.id, retainedSubmissionId: kept.id,
    publishedFormVersion: 2, currentReceiptPdfVerified: true, acceptedCurrentDocuments: 2, result: "PASS" }, null, 2));
  console.log({ phase, historicalBytesUnchanged: true, deletedReceipts: true, retainedSubmissionId: kept.id, result: "PASS" });
} else throw new Error("Unsupported QA phase");
await db.$disconnect();
