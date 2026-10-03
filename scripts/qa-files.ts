import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { requireFileScanner } from "../src/server/file-scanner";
const title = "첨부파일 실동작 QA 2026-10-02", dir = resolve(".local/file-qa");
async function prepare() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "증빙 자료.txt"), "첨부파일 CRUD 검증용 합성 자료\\n회사: 파일 QA\\n확인 번호: FILE-QA-20261002\\n", { mode: 0o600 });
  await writeFile(join(dir, "정정 증빙.txt"), "첨부파일 정정 검증용 합성 자료\\n변경 번호: FILE-QA-CORRECTED-20261002\\n", { mode: 0o600 });
  console.log({ title, fileDirectory: dir });
}
async function evidence() {
  const fixture = JSON.parse(await readFile(".local/password-policy-qa.json", "utf8"));
  const form = await db.form.findFirstOrThrow({ where: { tenantId: fixture.tenantId, title }, orderBy: { createdAt: "desc" },
    include: { publications: true, versions: { include: { submissions: { include: { files: true, answers: true, corrections: true } } } } } });
  const submissions = form.versions.flatMap(version => version.submissions), submission = submissions[0];
  if (!submission || submissions.length !== 1 || submission.files.length !== 2 || submission.status !== "corrected") throw new Error("브라우저 제출·정정 결과가 예상과 다릅니다.");
  const files = [];
  for (const file of submission.files) {
    const name = decrypt<string>(file.nameCipher!), source = await readFile(join(dir, name));
    const sha = createHash("sha256").update(source).digest("hex"), path = resolve(env.PRIVATE_STORAGE_DIR, "objects", file.storageKey + ".enc");
    const disk = await readFile(path), downloaded = await readFile(resolve("docs/qa/files", name === "증빙 자료.txt" ? "download-original.txt" : "download-corrected.txt"));
    const checks = { fileId: file.id, name, size: file.size, scanStatus: file.scanStatus, status: file.status, scanEngine: file.scanEngine,
      sha256: sha, hashMatches: sha === file.sha256, bytesMatch: downloaded.equals(source), encryptedAtRest: !disk.includes(source) && disk.subarray(0, 4).toString() === "CSF1",
      privateMode: ((await lstat(path)).mode & 0o777).toString(8), uploadCapabilityRevoked: file.uploadTokenHash === null };
    if (!checks.hashMatches || !checks.bytesMatch || !checks.encryptedAtRest || !checks.uploadCapabilityRevoked || checks.privateMode !== "600") throw new Error("파일 바이트·저장 검증 실패");
    files.push(checks);
  }
  const audits = await db.auditEvent.findMany({ where: { tenantId: form.tenantId, resource: "file", resourceId: { in: files.map(file => file.fileId) } } });
  const rawAudit = JSON.stringify(audits);
  if (files.some(file => rawAudit.includes(file.name))) throw new Error("감사 기록에 파일 이름이 노출되었습니다.");
  const result = { checkedAt: new Date(), scanner: await requireFileScanner(), formId: form.id, submissionId: submission.id,
    status: submission.status, version: submission.version, correctionCount: submission.corrections.length,
    publicationCount: form.publications.length, responseCount: form.publications.reduce((sum, row) => sum + row.responseCount, 0),
    files, auditActions: audits.map(row => row.action), auditNamesRedacted: true };
  await writeFile("docs/qa/files/database-evidence.json", JSON.stringify(result, null, 2) + "\n");
  console.log({ verified: true, files: files.length, status: submission.status });
}
(async () => { try { if (process.argv[2] === "evidence") await evidence(); else await prepare(); } finally { await db.$disconnect(); } })()
  .catch(error => { console.error(error instanceof Error ? error.message : "검증 실패"); process.exitCode = 1; });
