import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { parse } from "csv-parse/sync";
import { drawingAnswerFromFile } from "../src/contracts/drawing-questions";
import { privateFiles } from "../src/server/file-storage";
import type { FormRecord } from "../src/contracts/forms";
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = ".local/rea-fullstack/drawing-questions", output = "docs/qa/R08-T02/drawing-questions/flow", file = directory + "/fixture.json";
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[]; originalFileId?: string; currentFileId?: string; token?: string; submissionId?: string; hash?: string };
let f: Fixture;
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const checks: { action: string; status: number; code?: string }[] = [];
async function request<T = FormRecord>(action: string, path: string, expected: number, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: f.cookie, "idempotency-key": randomUUID(),
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null); checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + ": " + (value?.error?.code ?? "")); return { response, value: value as T };
}
async function snapshot() {
  return db.$transaction(async tx => ({ forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: {
    versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } }, publications: { orderBy: { id: "asc" } } } }),
    submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
    files: await tx.fileObject.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    corrections: await tx.correction.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { payload: true } }),
    preferences: await tx.marketingPreference.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    subjects: await tx.dataSubject.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
const labels = ["필수 그림", "선택 그림", "일반 첨부", "메모"];
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash && !f.companyId && !f.formId);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Preparation already wrote data; inspect instead of replaying");
    } else {
      f = { email: "rea-drawing-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "", questionIds: Array.from({ length: 4 }, () => randomUUID()) }; await save();
    }
    await request("register QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "그리기 질문 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "그리기 질문 검증", publicName: "그리기 QA" })).value.id;
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } }); await save();

    f.formId = (await request("create draft for Ego type editing", "/forms", 201, { serviceId: service.id, title: "그리기 질문 검증", content: {
      body: "PNG 그리기·파일 검사·정정 실제 시험", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      questions: f.questionIds.map((id, i) => ({ id, type: "단문형 답변", label: labels[i], required: i === 0 })) } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish") {
      const form = (await request("read Ego-saved drawing types", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(form.content.questions.map(q => q.type), ["직접 그리기", "직접 그리기", "파일 업로드", "단문형 답변"]);
      await request("publish drawing questions", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      f.token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId } })).tokenCipher); await save();
      for (const [label, value] of [["missing required drawing", null], ["scalar drawing injection", randomUUID()], ["array drawing injection", []], ["extra metadata", { s3Key: randomUUID(), fileName: "userSignImage.png", fileSize: 100, extra: true }]] as const) {
        await request("reject " + label, "/public/forms/" + f.token + "/submissions", 422, { answers: { [f.questionIds[0]]: value }, consent: false });
      }
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 0);
    } else if (mode === "verify-flow" || mode === "verify-correction") {
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { answers: { include: { question: true } } } }); assert.equal(rows.length, 1);
      const row = rows[0], expectedVersion = mode === "verify-flow" ? 1 : 2;
      const answers = Object.fromEntries(row.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)]));
      const files = await db.fileObject.findMany({ where: { tenantId: f.companyId, submissionId: row.id }, orderBy: { createdAt: "asc" } });
      assert.equal(files.length, expectedVersion); assert.equal(row.version, expectedVersion);
      const current = files.at(-1)!;
      assert.deepEqual(answers[f.questionIds[0]], drawingAnswerFromFile({ ...current, name: decrypt<string>(current.nameCipher!) }));
      assert.deepEqual(answers[f.questionIds[1]], null); assert.equal(answers[f.questionIds[2]], "");
      assert.equal(answers[f.questionIds[3]], mode === "verify-flow" ? "그림 제출 확인" : "그림 정정 확인");
      for (const file of files) { assert.equal(file.mime, "image/png"); assert.equal(file.status, "attached"); assert.equal(file.scanStatus, "clean"); assert(file.scanEngine?.startsWith("ClamAV 1.5.4/")); }
      const bytes = await privateFiles.read(current.storageKey);
      const browserPng = await readFile(directory + (mode === "verify-flow" ? "/original-download.png" : "/corrected.png"));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(browserPng).digest("hex"), "Stored PNG must match the browser artifact");
      const hash = createHash("sha256").update(bytes).digest("hex"); assert.equal(current.sha256, hash);
      assert(current.nameCipher && !current.nameCipher.includes("userSignImage.png"));
      assert(row.answers.every(answer => !answer.valueCipher.includes(current.id)));
      f.submissionId = row.id; f.originalFileId ??= files[0].id; f.currentFileId = current.id; await save();
      const corrections = await db.correction.findMany({ where: { submissionId: row.id }, include: { payload: true } });
      assert.equal(corrections.length, expectedVersion - 1);
      if (mode === "verify-correction") {
        assert(corrections[0].payload); assert.deepEqual(new Set(corrections[0].changedFields), new Set([f.questionIds[0], f.questionIds[3]]));
        const before = decrypt<{ answers: Record<string, unknown> }>(corrections[0].payload.beforeCipher).answers;
        const after = decrypt<Record<string, unknown>>(corrections[0].payload.afterCipher);
        assert.deepEqual(before[f.questionIds[0]], drawingAnswerFromFile({ ...files[0], name: decrypt<string>(files[0].nameCipher!) }));
        assert.deepEqual(after[f.questionIds[0]], drawingAnswerFromFile({ ...current, name: decrypt<string>(current.nameCipher!) }));
      }
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1, version: row.version, corrections: corrections.length, attachments: files.length, optionalDrawingNull: true, legacyFileEmpty: true, pngBytesMatchBrowser: true, browserArtifact: mode === "verify-flow" ? "authenticated original download (pre-apply resize capture is not a byte baseline)" : "actual applied File blob captured before correction submission", pngSha256: hash, scanStatus: current.scanStatus, scanEngine: current.scanEngine, encryptedAnswerMetadata: true }, null, 2) + "\n");
    } else if (mode === "verify-csv") {
      const rows: string[][] = parse(await readFile(directory + "/responses.csv", "utf8"), { bom: true }); assert.equal(rows.length, 2);
      for (const [i, expected] of ["userSignImage.png", "", "", "그림 정정 확인"].entries()) {
        const column = rows[0].findIndex(value => value === "[v1 · 질문 " + (i + 1) + "] " + labels[i]); assert(column >= 0); assert.equal(rows[1][column], expected);
      }
      await writeFile(output + "/csv.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", source: "Ego browser download", rows: 1, authorizedFileName: true, noStorageKeys: true }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyFormLanguageColumn)).digest("hex");
      if (mode === "freeze") { assert(!f.hash); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, forms: state.forms.length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length, files: state.files.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
