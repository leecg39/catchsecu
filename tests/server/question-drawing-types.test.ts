import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { roleCapabilities } from "@/server/permissions";
import { createForm, copyForm, fingerprint, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, useTemplate } from "@/server/templates";
import { submitForm, listSubmissions } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctionInput, correctSubmission, getSubmission, changeSubmission } from "@/server/submission-management";
import { initPublicUpload, initMemberUpload, uploadContent, completeUpload, cancelUpload, cleanupExpiredFiles, renameFile } from "@/server/files";
import { downloadFile } from "@/server/file-download";
import { privateFiles } from "@/server/file-storage";
import { requireFileScanner } from "@/server/file-scanner";
import { sha256 } from "@/server/file-validation";
import { exportSubmissions } from "@/server/submission-export";
import { createExport, downloadExport, getExport, runOneExport } from "@/server/exports";
import { createShare, shareOptions } from "@/server/sharing";
import { getSharedSubmission, sharedFile, startViewerChallenge, verifyViewerChallenge } from "@/server/viewer";
import { certificateDigest, decideDestruction } from "@/server/destruction";
import { runOneDestruction } from "@/server/destruction-worker";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { answersSchema, emptyAnswer, formatAnswer, isEmptyAnswer, type QuestionDefinition } from "@/contracts/questions";
import { drawingAnswerFromFile, drawingAnswerSchema, fileAnswerId, isDrawingAnswer, isFileQuestion } from "@/contracts/drawing-questions";
import { submissionFilters } from "@/contracts/submissions";
import { memberUploadInput, publicUploadInput, type FileInfo } from "@/contracts/files";
import { subjectQuestionTypeAllowed } from "@/contracts/subjects";
import { marketingQuestionTypeAllowed } from "@/contracts/marketing";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=", "base64");
let ctx: Context, serviceId: string;
beforeAll(() => requireFileScanner());
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Drawing QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id; ctx = await actor(company.id, "owner");
});
afterAll(() => db.$disconnect());

async function actor(tenantId: string, role: "owner" | "privacy", readFiles = true) {
  const email = "drawing-" + randomUUID() + "@example.test", password = "Drawing-test!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  if (role !== "owner") await db.serviceGrant.create({ data: { tenantId, serviceId, memberId: member.id,
    capabilities: [...roleCapabilities(role)].filter(cap => readFiles || cap !== "file.read") } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  return requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "submission.read");
}
function questions(required = false): QuestionDefinition[] {
  return [{ id: randomUUID(), type: "직접 그리기", label: "그림", required },
    { id: randomUUID(), type: "파일 업로드", label: "기존 첨부", required: false },
    { id: randomUUID(), type: "단문형 답변", label: "텍스트", required: false }];
}
async function fixture(qs = questions()) {
  const content = formContentSchema.parse({ body: "그림 검증", questions: qs, consentRequired: true, consentPurpose: "그림 수집", retentionDays: 30, maxResponses: 100 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "직접 그리기", content }, randomUUID(), tx));
  await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  const publication = await db.publication.findFirstOrThrow({ where: { formId: form.id, status: "active" } });
  return { form, content, questions: qs, token: decrypt<string>(publication.tokenCipher), publication };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Upload = FileInfo & { uploadToken: string };
function meta(bytes = png, name = "userSignImage.png", mime = "image/png") { return { name, mime, size: bytes.length, sha256: sha256(bytes) }; }
async function ready(f: Fixture, questionId = f.questions[0].id, bytes = png, name = "userSignImage.png", mime = "image/png"): Promise<Upload> {
  const started = await initPublicUpload(f.token, publicUploadInput.parse({ questionId, ...meta(bytes, name, mime) }), randomUUID(), randomUUID());
  const file = started.body, principal = { token: file.uploadToken };
  await uploadContent(principal, file.id, new Request(origin + "/api/v1/uploads/" + file.id + "/content", {
    method: "PUT", headers: { origin, "content-type": mime }, body: new Uint8Array(bytes) }), randomUUID());
  return { ...await completeUpload(principal, file.id, randomUUID()), uploadToken: file.uploadToken };
}
async function replacement(f: Fixture, submissionId: string, acting = ctx) {
  const started = await initMemberUpload(acting, memberUploadInput.parse({ purpose: "submission", submissionId,
    questionId: f.questions[0].id, ...meta() }), randomUUID(), randomUUID()), file = started.body;
  await uploadContent({ ctx: acting }, file.id, new Request(origin + "/api/v1/uploads/" + file.id + "/content", {
    method: "PUT", headers: { origin, "content-type": "image/png" }, body: new Uint8Array(png) }), randomUUID());
  return completeUpload({ ctx: acting }, file.id, randomUUID());
}
const proof = (file: Upload) => ({ fileId: file.id, token: file.uploadToken });
async function post(f: Fixture, answers: unknown = {}, attachments: Record<string, { fileId: string; token: string }> = {}) {
  return submitForm(f.token, submissionInput.parse({ answers, attachments, consent: true }), randomUUID(), randomUUID());
}
async function drawSubmission(f: Fixture) {
  const file = await ready(f), value = drawingAnswerFromFile(file);
  const result = await post(f, { [f.questions[0].id]: value }, { [f.questions[0].id]: proof(file) });
  return { file, value, id: result.body.id };
}
async function correct(id: string, answers: unknown, version = 1, acting = ctx) {
  return correctSubmission(acting, id, correctionInput.parse({ version, reason: "그림 정정", answers }), randomUUID());
}
async function snapshot(id: string) {
  return { row: await db.submission.findUniqueOrThrow({ where: { id } }),
    answers: await db.answer.findMany({ where: { submissionId: id }, orderBy: { id: "asc" } }),
    corrections: await db.correction.findMany({ where: { submissionId: id }, orderBy: { id: "asc" } }),
    payloads: await db.correctionPayload.findMany({ where: { correction: { submissionId: id } }, orderBy: { correctionId: "asc" } }),
    audits: await db.auditEvent.count({ where: { resourceId: id, action: "submission.corrected" } }) };
}
async function viewer(f: Fixture, issuer = ctx) {
  const share = await db.$transaction(tx => createShare(issuer, { formId: f.form.id, formVersionId: f.publication.formVersionId,
    questionIds: [f.questions[0].id], email: "drawing-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const invite = decrypt<{ text: string; to: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:" + share.version } })).payloadCipher);
  const challenge = await startViewerChallenge({ formCode: f.form.id, invitationCode: invite.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: invite.to, consent: true }, randomUUID());
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } })).payloadCipher);
  return verifyViewerChallenge(challenge.id, mail.text.match(/인증코드: (\d{6})/)![1], challenge.client, randomUUID());
}

test("drawing is a nullable strict opaque file reference, never a storage key or formal identity role", () => {
  const value = drawingAnswerFromFile({ id: randomUUID(), name: "userSignImage.png", size: png.length });
  expect(Object.keys(value)).toEqual(["s3Key", "fileName", "fileSize"]); expect(isDrawingAnswer(value)).toBe(true);
  expect(fileAnswerId(value)).toBe(value.s3Key); expect(fileAnswerId(value.s3Key)).toBe(value.s3Key);
  expect(fileAnswerId("raw/storage-key")).toBeUndefined(); expect(fileAnswerId(null)).toBeUndefined();
  expect(isFileQuestion("직접 그리기")).toBe(true); expect(isFileQuestion("파일 업로드")).toBe(true); expect(isFileQuestion("서명")).toBe(false);
  expect(emptyAnswer("직접 그리기")).toBeNull(); expect(isEmptyAnswer(null)).toBe(true); expect(isEmptyAnswer(value)).toBe(false);
  expect(formatAnswer(value, undefined, undefined, "직접 그리기")).toBe("첨부파일");
  expect(formatAnswer(value.s3Key, undefined, undefined, "직접 그리기")).toBe("첨부파일");
  for (const invalid of [{}, [], value.s3Key, { ...value, extra: true }, { ...value, fileSize: 0 }, { ...value, fileSize: 10485761 }, { ...value, s3Key: "https://s3.invalid/file" }])
    expect(drawingAnswerSchema.safeParse(invalid).success).toBe(false);
  for (const role of ["name", "email"]) expect(subjectQuestionTypeAllowed(role, "직접 그리기")).toBe(false);
  for (const kind of ["name", "email", "sms", "kakao"] as const) expect(marketingQuestionTypeAllowed(kind, "직접 그리기")).toBe(false);
});
test("real PNG and legacy FILE bytes scan, encrypt, attach once and download with private headers", async () => {
  const f = await fixture(questions(true)), drawing = await ready(f), legacyBytes = Buffer.from("legacy FILE"),
    legacy = await ready(f, f.questions[1].id, legacyBytes, "legacy.txt", "text/plain");
  expect((await activePublicForm(f.token)).content.questions[0].type).toBe("직접 그리기");
  const value = drawingAnswerFromFile(drawing), created = await post(f, { [f.questions[0].id]: value, [f.questions[1].id]: legacy.id },
    { [f.questions[0].id]: proof(drawing), [f.questions[1].id]: proof(legacy) });
  const detail = await getSubmission(ctx, created.body.id, randomUUID()); expect(detail.values[f.questions[0].id]).toEqual(value);
  const listing = await listSubmissions(ctx, f.form.id, 1, 20, randomUUID());
  expect(listing.items[0].questions.map(question => question.id)).toEqual(f.questions.map(question => question.id));
  expect(detail.values[f.questions[1].id]).toBe(legacy.id); expect(detail.attachments).toHaveLength(2);
  const stored = await db.fileObject.findUniqueOrThrow({ where: { id: drawing.id } });
  expect(stored).toMatchObject({ status: "attached", scanStatus: "clean", uploadTokenHash: null, expiresAt: null });
  expect(stored.scanEngine).toContain("ClamAV"); expect(stored.storageKey).not.toBe(value.s3Key);
  expect(JSON.stringify(detail)).not.toContain(stored.storageKey);
  const encrypted = await readFile(resolve(env.PRIVATE_STORAGE_DIR, "objects", stored.storageKey + ".enc"));
  expect(encrypted.subarray(0, 4).toString()).toBe("CSF1"); expect(encrypted.includes(png)).toBe(false);
  const answer = await db.answer.findFirstOrThrow({ where: { submissionId: created.body.id, valueType: "직접 그리기" } });
  expect(answer.valueCipher.startsWith("v1.")).toBe(true); expect(answer.valueCipher).not.toContain(value.fileName);
  expect(decrypt(answer.valueCipher)).toEqual(value);
  const response = await downloadFile(ctx, drawing.id, { submissionId: created.body.id, questionId: f.questions[0].id }, randomUUID());
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png); expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(post(f, { [f.questions[0].id]: value }, { [f.questions[0].id]: proof(drawing) })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
});

test("optional DRAW omissions normalize to null while visible non-DRAW null and invalid DRAW shapes are rejected", async () => {
  const row = randomUUID(), f = await fixture([...questions(), { id: randomUUID(), type: "행렬형 단일 선택", label: "행렬", required: false,
    options: ["A"], rows: [{ id: row, label: "행" }] }, { id: randomUUID(), type: "해외 주소", label: "주소", required: false }]);
  for (const answers of [{}, { [f.questions[0].id]: null }]) {
    const result = await post(f, answers); expect((await getSubmission(ctx, result.body.id, randomUUID())).values[f.questions[0].id]).toBeNull();
  }
  for (const q of f.questions.slice(1)) await expect(post(f, { [q.id]: null })).rejects.toMatchObject({ status: 422, code: "INVALID_ANSWER_TYPE" });
  for (const value of [randomUUID(), "", [], {}, { [row]: "A" }]) await expect(post(f, { [f.questions[0].id]: value })).rejects.toThrow();
  const required = await fixture(questions(true)); for (const answers of [{}, { [required.questions[0].id]: null }])
    await expect(post(required, answers)).rejects.toMatchObject({ code: "REQUIRED_ANSWER" });
});

test("DRAW upload MIME and direct DB bindings enforce PNG while legacy FILE stays compatible", async () => {
  const f = await fixture(), before = await db.fileObject.count();
  for (const mime of ["text/plain", "image/jpeg", "application/pdf"]) {
    const name = mime === "text/plain" ? "bad.txt" : mime === "image/jpeg" ? "bad.jpg" : "bad.pdf";
    await expect(initPublicUpload(f.token, publicUploadInput.parse({ questionId: f.questions[0].id, ...meta(png, name, mime) }), randomUUID(), randomUUID()))
      .rejects.toMatchObject({ code: "INVALID_DRAWING" });
  }
  expect(await db.fileObject.count()).toBe(before);
  const file = await ready(f), stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
  await expect(db.fileObject.create({ data: { tenantId: stored.tenantId, serviceId, ownerKind: "public", publicationId: stored.publicationId,
    formVersionId: stored.formVersionId, questionId: stored.questionId, nameCipher: stored.nameCipher, mime: "text/plain", size: png.length,
    sha256: stored.sha256, storageKey: randomUUID(), uploadTokenHash: stored.uploadTokenHash, expiresAt: stored.expiresAt } })).rejects.toThrow();
  await expect(db.fileObject.update({ where: { id: file.id }, data: { mime: "text/plain", version: { increment: 1 } } })).rejects.toThrow();
  expect((await ready(f, f.questions[1].id, Buffer.from("FILE allowed"), "file.txt", "text/plain")).status).toBe("ready");
});

test("forged metadata, raw storage keys, missing proofs and other question/publication files fail without consuming uploads", async () => {
  const f = await fixture(), other = await fixture(), file = await ready(f), value = drawingAnswerFromFile(file);
  const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
  for (const changed of [{ ...value, fileName: "forged.png" }, { ...value, fileSize: value.fileSize + 1 }, { ...value, s3Key: stored.storageKey }])
    await expect(post(f, { [f.questions[0].id]: changed }, { [f.questions[0].id]: proof(file) })).rejects.toMatchObject({ status: 422 });
  await expect(post(f, { [f.questions[0].id]: value })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  await expect(post(f, { [f.questions[0].id]: value }, { [f.questions[0].id]: { fileId: file.id, token: "A".repeat(43) } })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  await expect(post(other, { [other.questions[0].id]: value }, { [other.questions[0].id]: proof(file) })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  const wrong = await ready(f, f.questions[1].id);
  await expect(post(f, { [f.questions[0].id]: drawingAnswerFromFile(wrong) }, { [f.questions[0].id]: proof(wrong) })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  expect(await db.submission.count()).toBe(0); expect(await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).toEqual(stored);
  const results = await Promise.allSettled([post(f, { [f.questions[0].id]: value }, { [f.questions[0].id]: proof(file) }),
    post(f, { [f.questions[0].id]: value }, { [f.questions[0].id]: proof(file) })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
});

test("correction replacement, clearing and restoration keep prior evidence; canonical metadata order is NO_CHANGES", async () => {
  const f = await fixture(), a = await drawSubmission(f), b = await replacement(f, a.id), next = drawingAnswerFromFile(b);
  await expect(correct(a.id, { [f.questions[0].id]: Object.fromEntries(Object.entries(a.value).reverse()) })).rejects.toMatchObject({ code: "NO_CHANGES" });
  await expect(correct(a.id, { [f.questions[0].id]: a.file.id })).rejects.toMatchObject({ code: "INVALID_DRAWING" });
  await correct(a.id, { [f.questions[0].id]: next }); await correct(a.id, { [f.questions[0].id]: null }, 2);
  await correct(a.id, { [f.questions[0].id]: a.value }, 3);
  const detail = await getSubmission(ctx, a.id, randomUUID()); expect(detail.values[f.questions[0].id]).toEqual(a.value);
  expect(detail.attachments.map(file => file.id).sort()).toEqual([a.file.id, b.id].sort()); expect(detail.corrections).toHaveLength(3);
  const old = await downloadFile(ctx, b.id, { submissionId: a.id, questionId: f.questions[0].id }, randomUUID());
  expect(Buffer.from(await old.arrayBuffer())).toEqual(png);
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: a.id } });
  expect(receipt.pdfHash).toBeTruthy(); expect(receipt.pdfCipher).toBeTruthy();
});

test("invalid mixed corrections and stale versions roll back answers, audit, version and file attachment together", async () => {
  const f = await fixture(), a = await drawSubmission(f), b = await replacement(f, a.id), before = await snapshot(a.id);
  await expect(correct(a.id, { [f.questions[2].id]: "must roll back", [f.questions[0].id]: { ...drawingAnswerFromFile(b), fileName: "wrong.png" } })).rejects.toMatchObject({ code: "INVALID_DRAWING" });
  expect(await snapshot(a.id)).toEqual(before); expect((await db.fileObject.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("ready");
  await expect(correct(a.id, { [f.questions[0].id]: drawingAnswerFromFile(b) }, 9)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  expect(await snapshot(a.id)).toEqual(before);
  const foreign = await drawSubmission(f);
  await expect(correct(a.id, { [f.questions[0].id]: foreign.value })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  expect(await snapshot(a.id)).toEqual(before);
});

test("without file.read list/detail/history mask DRAW metadata, preserve omitted baseline and reject direct UUID writes", async () => {
  const f = await fixture(), a = await drawSubmission(f), b = await replacement(f, a.id);
  await correct(a.id, { [f.questions[0].id]: drawingAnswerFromFile(b) });
  const limited = await actor(ctx.tenantId, "privacy", false), detail = await getSubmission(limited, a.id, randomUUID());
  expect(detail.values[f.questions[0].id]).toBe(b.id); expect(detail.attachments).toEqual([]);
  expect(detail.corrections[0].before![f.questions[0].id]).toBe(a.file.id); expect(detail.corrections[0].after![f.questions[0].id]).toBe(b.id);
  const page = await listSubmissions(limited, f.form.id, 1, 20, randomUUID());
  expect(page.items[0].values[f.questions[0].id]).toBe(b.id); expect(JSON.stringify(page)).not.toContain("userSignImage.png");
  expect(JSON.stringify(detail)).not.toContain("userSignImage.png");
  await correct(a.id, { [f.questions[2].id]: "scalar only" }, 2, limited);
  expect((await getSubmission(ctx, a.id, randomUUID())).values[f.questions[0].id]).toEqual(drawingAnswerFromFile(b));
  await expect(correct(a.id, { [f.questions[0].id]: b.id }, 3, limited)).rejects.toMatchObject({ status: 422, code: "INVALID_DRAWING" });
  await expect(correct(a.id, { [f.questions[0].id]: null }, 3, limited)).rejects.toMatchObject({ status: 403 });
  await expect(downloadFile(limited, b.id, { submissionId: a.id, questionId: f.questions[0].id }, randomUUID())).rejects.toMatchObject({ status: 403 });
});

test("hidden drawing rejects nonempty metadata and correction clears the value while preserving the old file", async () => {
  const parent = randomUUID(), qs = questions(); qs[0] = { ...qs[0], required: true, condition: { questionId: parent, operator: "equals", value: "예" } };
  const f = await fixture([{ id: parent, type: "객관식 답변", label: "그림", required: true, options: ["예", "아니오"] }, ...qs]);
  const file = await ready(f, qs[0].id), value = drawingAnswerFromFile(file);
  await expect(post(f, { [parent]: "아니오", [qs[0].id]: value }, { [qs[0].id]: proof(file) })).rejects.toMatchObject({ code: "HIDDEN_ANSWER" });
  const blank = await post(f, { [parent]: "아니오", [qs[0].id]: null });
  expect((await getSubmission(ctx, blank.body.id, randomUUID())).values[qs[0].id]).toBeNull();
  const created = await post(f, { [parent]: "예", [qs[0].id]: value }, { [qs[0].id]: proof(file) });
  await correct(created.body.id, { [parent]: "아니오" });
  expect((await getSubmission(ctx, created.body.id, randomUUID())).values[qs[0].id]).toBeNull();
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("attached");
});

test("response-bound drawing filenames cannot be renamed through API or DB, and scalar corrections preserve metadata", async () => {
  const f = await fixture(), a = await drawSubmission(f), b = await replacement(f, a.id);
  await expect(renameFile(ctx, b.id, { name: "renamed.png", version: b.version }, randomUUID())).rejects.toMatchObject({ code: "FILE_NAME_LOCKED" });
  const before = await db.fileObject.findUniqueOrThrow({ where: { id: a.file.id } });
  await expect(db.fileObject.update({ where: { id: a.file.id }, data: { nameCipher: "arbitrary", version: { increment: 1 } } })).rejects.toThrow();
  expect(await db.fileObject.findUniqueOrThrow({ where: { id: a.file.id } })).toEqual(before);
  await correct(a.id, { [f.questions[2].id]: "other field" });
  expect((await getSubmission(ctx, a.id, randomUUID())).values[f.questions[0].id]).toEqual(a.value);
});

test("sync/worker CSV resolve authorized names and use the existing attachment placeholder without file.read", async () => {
  const f = await fixture(), a = await drawSubmission(f), filters = submissionFilters.parse({});
  const sync = await exportSubmissions(ctx, f.form.id, filters, randomUUID());
  expect((parse(sync.csv, { bom: true }) as string[][]).find(row => row[0] === a.id)![7]).toBe("userSignImage.png");
  expect(sync.csv).not.toContain(a.file.id); expect(sync.csv).not.toContain("s3Key");
  const limited = await actor(ctx.tenantId, "privacy", false), redacted = await exportSubmissions(limited, f.form.id, filters, randomUUID());
  expect((parse(redacted.csv, { bom: true }) as string[][]).find(row => row[0] === a.id)![7]).toBe("첨부파일");
  const job = await createExport(ctx, { formId: f.form.id, filters }, randomUUID(), randomUUID());
  for (let step = 0; step < 5 && (await getExport(ctx, job.id)).status !== "ready"; step++) await runOneExport("drawing-test", new Date(), job.id);
  expect((await downloadExport(ctx, job.id, randomUUID())).csv).toBe(sync.csv);
  const b = await replacement(f, a.id); await correct(a.id, { [f.questions[0].id]: drawingAnswerFromFile(b) });
  await expect(downloadExport(ctx, job.id, randomUUID())).rejects.toMatchObject({ status: 410 });
});

test("external viewers read only current drawing bytes and issuer file permission is checked again", async () => {
  const f = await fixture(), a = await drawSubmission(f), issuer = await actor(ctx.tenantId, "privacy"), session = await viewer(f, issuer);
  expect((await getSharedSubmission(session.token, a.id, randomUUID())).values[f.questions[0].id]).toEqual(a.value);
  const response = await sharedFile(session.token, a.id, f.questions[0].id, a.file.id, true, randomUUID());
  expect(response).toBeInstanceOf(Response); expect(Buffer.from(await (response as Response).arrayBuffer())).toEqual(png);
  const b = await replacement(f, a.id); await correct(a.id, { [f.questions[0].id]: drawingAnswerFromFile(b) });
  await expect(sharedFile(session.token, a.id, f.questions[0].id, a.file.id, true, randomUUID())).rejects.toMatchObject({ status: 404 });
  expect((await getSharedSubmission(session.token, a.id, randomUUID())).attachments.map(file => file.id)).toEqual([b.id]);
  const grant = await db.serviceGrant.findFirstOrThrow({ where: { memberId: issuer.member.id, serviceId } });
  await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities.filter(cap => cap !== "file.read") } });
  await expect(getSharedSubmission(session.token, a.id, randomUUID())).rejects.toMatchObject({ status: 401, code: "VIEWER_SESSION_EXPIRED" });
  const options = await shareOptions(issuer, f.form.id);
  expect(options.versions[0].questions.find(q => q.id === f.questions[0].id)?.selectable).toBe(false);
  await expect(viewer(f, issuer)).rejects.toMatchObject({ status: 403 });
});

test("copy/template/revision preserve question types without copying files or changing published answer and consent evidence", async () => {
  const f = await fixture(), a = await drawSubmission(f), before = await snapshot(a.id);
  const version = await db.formVersion.findUniqueOrThrow({ where: { id: f.publication.formVersionId }, include: versionInclude }), hash = fingerprint(version);
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: a.id } }), count = await db.fileObject.count();
  const copied = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "그림 템플릿", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  for (const made of [copied, used]) {
    expect(made.content!.questions[0].type).toBe("직접 그리기"); expect(made.content!.questions[0].id).not.toBe(f.questions[0].id);
  }
  expect(await db.fileObject.count()).toBe(count);
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const draft = await readForm(ctx, f.form.id); expect(draft.content!.questions[0].id).toBe(f.questions[0].id);
  draft.content!.questions[0] = { ...draft.content!.questions[0], type: "단문형 답변" };
  await updateForm(ctx, f.form.id, { version: 3, content: draft.content! }, randomUUID());
  await db.$transaction(tx => publishForm(tx, ctx, f.form.id, { version: 4 }, randomUUID()));
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude })).toEqual(version);
  expect(fingerprint(version)).toBe(hash); expect(await snapshot(a.id)).toEqual(before);
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
});

test("cancelled and expired unattached PNG uploads are physically removed without exposing metadata", async () => {
  const f = await fixture(), cancelled = await ready(f), stored = await db.fileObject.findUniqueOrThrow({ where: { id: cancelled.id } });
  await cancelUpload({ token: cancelled.uploadToken }, cancelled.id, cancelled.version, randomUUID());
  await expect(privateFiles.read(stored.storageKey)).rejects.toThrow();
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: cancelled.id } }))).toMatchObject({ status: "deleted", nameCipher: null, size: 0 });
  const expired = await ready(f), row = await db.fileObject.findUniqueOrThrow({ where: { id: expired.id } });
  await db.fileObject.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000), version: { increment: 1 } } });
  await expect(post(f, { [f.questions[0].id]: drawingAnswerFromFile(expired) }, { [f.questions[0].id]: proof(expired) })).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
  expect((await cleanupExpiredFiles()).deleted).toBeGreaterThanOrEqual(1); await expect(privateFiles.read(row.storageKey)).rejects.toThrow();
});

test("response destruction erases current and old drawing bytes plus encrypted answers, corrections and receipt payloads", async () => {
  const f = await fixture(), a = await drawSubmission(f), b = await replacement(f, a.id);
  await correct(a.id, { [f.questions[0].id]: drawingAnswerFromFile(b) });
  const files = await db.fileObject.findMany({ where: { submissionId: a.id } });
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: a.id } });
  expect(receipt.pdfCipher).toBeTruthy(); expect(files).toHaveLength(2);
  const requested = await changeSubmission(ctx, a.id, "destruction-request", { version: 2, reason: "그림 증거 파기" }, randomUUID());
  await decideDestruction(ctx, requested.destructionId!, "approve", { version: 1, reason: "승인" }, randomUUID());
  expect(await runOneDestruction("drawing-test", new Date(), { tenantId: ctx.tenantId, requestId: requested.destructionId! })).toBe(true);
  expect((await db.submission.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("destroyed");
  expect(await db.answer.count({ where: { submissionId: a.id } })).toBe(0);
  expect(await db.correctionPayload.count({ where: { correction: { submissionId: a.id } } })).toBe(0);
  for (const file of files) {
    expect(await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "deleted", size: 0, sha256: null, nameCipher: null });
    await expect(privateFiles.read(file.storageKey)).rejects.toThrow();
  }
  // Destruction removes the receipt row and its events, rather than leaving a PDF tombstone.
  expect(await db.consentReceipt.count({ where: { submissionId: a.id } })).toBe(0);
  expect(await db.consentEvent.count({ where: { receiptId: receipt.id } })).toBe(0);
  const certificate = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: a.id } });
  expect(certificate.counts).toMatchObject({ answers: 3, files: 2, receipts: 1 });
  expect(certificate.digest).toBe(certificateDigest(certificate));
  const caches = await db.idempotencyRecord.findMany({ where: { tenantId: ctx.tenantId, resourceId: { in: [a.id, ...files.map(file => file.id)] } } });
  expect(caches.length).toBeGreaterThan(0);
  for (const cache of caches) { expect(cache.responseCipher).toBeNull(); expect(cache.requestHash).toBeNull(); expect(cache.invalidatedAt).not.toBeNull(); }
  expect(await getSubmission(ctx, a.id, randomUUID())).toMatchObject({ values: {}, attachments: [], receipts: [], corrections: [] });
  expect(answersSchema.safeParse({ [f.questions[0].id]: null }).success).toBe(true);
});
