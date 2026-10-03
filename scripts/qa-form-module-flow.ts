import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { fingerprint, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import { questionTypes } from "../src/contracts/questions";
import { policySettings, type PolicyRecord } from "../src/contracts/security";
import type { FormRecord } from "../src/contracts/forms";
import type { FormConsentBundle } from "../src/contracts/form-documents";
import type { MemberRecord } from "../src/contracts/members";
import type { SharedPage } from "../src/contracts/sharing";
import { FormPublicationSession } from "../src/lib/form-publication";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const people = [source.people[2], source.people[1]], cookies = ["", "", "", ""], cases: { label: string; status: number }[] = [];
const prior = JSON.parse(await readFile(".local/p04-template-gate-checkpoint.json", "utf8")) as { tenantId: string; serviceIds: string[]; memberId: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function request(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, headers: Record<string, string> = {}, raw?: Uint8Array) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie: cookies[actor] ?? "", ...(method === "GET" ? {} : { origin }),
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...headers },
    ...(raw ? { body: raw as BodyInit } : input === undefined ? {} : { body: JSON.stringify(input) }) });
  const responseCode = response.status >= 400 ? (await response.clone().json().catch(() => null))?.error?.code : undefined;
  assert.equal(response.status, expected, label + ": HTTP " + response.status + (responseCode ? " " + responseCode : "")); cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, headers: Record<string, string> = {}) {
  return await (await request(label, path, actor, method, input, expected, headers)).json() as T;
}
const read = (id: string, actor = 1) => data<FormRecord>("현재 폼·작업 권한 조회", "/forms/" + id, actor);
async function member(role: "editor" | "viewer") {
  const current = await data<MemberRecord>("현재 합성 구성원 버전", "/members/" + prior.memberId);
  return data<MemberRecord>("합성 구성원 역할 " + role, "/members/" + prior.memberId, 0, "PATCH", { version: current.version, role, serviceIds: [prior.serviceIds[0]] });
}
async function policy(settings: ReturnType<typeof policySettings.parse>) {
  const current = await data<PolicyRecord>("현재 합성 회사 정책", "/security/policy");
  return data<PolicyRecord>("합성 회사 승인 정책 변경", "/security/policy", 0, "PATCH", { ...settings, tenantId: prior.tenantId, version: current.version, password: people[0].password });
}
type Checkpoint = { tenantId: string; formId: string; sourceFormId: string; templateId: string; fixedId: string; shareId: string; documentId: string; fileId: string; submissionId: string; questionId: string;
  oldToken: string; newToken: string; viewerCookie: string; fileHash: string; originalVersionId: string; originalVersionHash: string; answerHash: string; businessHash: string; originalPolicy: ReturnType<typeof policySettings.parse> };
async function snapshot(c: Pick<Checkpoint, "formId" | "sourceFormId" | "templateId" | "fixedId" | "shareId" | "documentId" | "fileId" | "submissionId">) {
  const form = await db.form.findUniqueOrThrow({ where: { id: c.formId }, select: { id: true, version: true, status: true, publishedVersionId: true } });
  const versions = await db.formVersion.findMany({ where: { formId: c.formId }, include: versionInclude, orderBy: { number: "asc" } });
  const submission = await db.submission.findUniqueOrThrow({ where: { id: c.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: true } });
  const publications = await db.publication.findMany({ where: { formId: c.formId }, select: { id: true, formVersionId: true, status: true, responseCount: true }, orderBy: { id: "asc" } });
  const fixed = await db.fixedUrl.findUniqueOrThrow({ where: { id: c.fixedId }, select: { id: true, publicationId: true, status: true } });
  const share = await db.shareGrant.findUniqueOrThrow({ where: { id: c.shareId }, select: { id: true, version: true, formVersionId: true, revokedAt: true } });
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: c.fileId }, select: { id: true, status: true, scanStatus: true, submissionId: true, formVersionId: true, sha256: true, uploadTokenHash: true } });
  const document = await db.documentVersion.findMany({ where: { documentId: c.documentId }, select: { id: true, contentHash: true, number: true }, orderBy: { id: "asc" } });
  return { form, versions: versions.map(v => ({ id: v.id, number: v.number, hash: fingerprint(v) })), publications, fixed, share, file: { ...file, uploadTokenHash: !!file.uploadTokenHash }, document,
    sourceForms: await db.form.count({ where: { id: c.sourceFormId } }), templates: await db.formTemplate.count({ where: { id: c.templateId } }),
    approvals: await db.approvalRequest.count({ where: { formId: c.formId } }), submission: { id: submission.id, formVersionId: submission.formVersionId, answers: submission.answers.length,
      cipherHash: hash(submission.answers.map(a => a.valueCipher)), receiptCount: submission.receipts.length } };
}
let originalPolicy: ReturnType<typeof policySettings.parse> | undefined;
let setupActive = false;
try {
  assert((await db.company.findUniqueOrThrow({ where: { id: prior.tenantId } })).name.startsWith("P04 모듈 검증 "));
  for (let actor = 0; actor < 2; actor++) {
    const person = people[actor]; assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email));
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
    const response = await request("합성 로그인 " + actor, "/auth/sign-in/email", actor, "POST", { email: person.email, password: person.password });
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookies[actor]);
    await request("합성 회사 선택 " + actor, "/context", actor, "POST", { companyId: prior.tenantId });
  }
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const currentPolicy = await data<PolicyRecord>("초기 합성 회사 정책", "/security/policy");
    originalPolicy = policySettings.parse(Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, currentPolicy[key as keyof PolicyRecord]])));
    setupActive = true; await policy({ ...originalPolicy, requireApproval: true, approvalRoles: ["owner"] }); await member("editor");
    const serviceId = prior.serviceIds[0];
    const purpose = await data<{ id: string }>("실제 수집 목적 생성", "/processing-purposes", 1, "POST", { serviceId, name: "모듈 결합 목적 " + randomUUID(), purpose: "합성 상담", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, 201);
    const document = await data<{ id: string; version: number }>("실제 동의서 생성", "/documents", 1, "POST", { serviceId, type: "consent", title: "모듈 결합 동의서", body: "합성 상담 개인정보 동의", refusalNotice: "거부할 수 있습니다.", rightsContact: "QA 담당자", effectiveDate: "2026-10-03", purposeIds: [purpose.id], recipientIds: [] }, 201);
    const publishedDocument = await data<{ number: number }>("실제 동의서 게시", "/documents/" + document.id + "/publish", 1, "POST", { version: document.version, expiresAt: null }, 201);
    const documentVersions = await data<{ items: { id: string; number: number }[] }>("게시된 문서 버전 선택", "/documents/" + document.id + "/versions", 1);
    const documentVersion = documentVersions.items.find(v => v.number === publishedDocument.number); assert(documentVersion);
    const questions = questionTypes.map(type => ({ id: randomUUID(), type, label: type, required: true,
      ...(["객관식 답변", "체크박스", "드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"].includes(type) ? { options: ["첫째", "둘째"] } : {}),
      ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "행 A" }, { id: randomUUID(), label: "행 B" }] } : {}),
      ...(["체크박스", "행렬형 복수 선택"].includes(type) ? { selectionLimits: { min: 1, max: 1 } } : {}) }));
    const content = formContentSchema.parse({ body: "모듈 원본 본문", questions, consentRequired: true, consentPurpose: "합성 상담", retentionDays: 30, maxResponses: 5,
      documentConsents: [{ documentVersionId: documentVersion.id, required: true, kind: "collection" }] });
    content.questions[4].condition = { questionId: questions[2].id, operator: "equals", value: "첫째" };
    const sourceForm = await data<FormRecord>("아홉 질문과 게시 문서 폼 생성", "/forms", 1, "POST", { serviceId, title: "전체 흐름 원본", content }, 201);
    assert(!sourceForm.actions);
    const target = await db.membership.findUniqueOrThrow({ where: { id: prior.memberId }, include: { grants: true } }); assert(target.userId === people[1].id && target.tenantId === prior.tenantId && target.role === "editor");
    const grant = target.grants.find(g => g.serviceId === serviceId); assert(grant);
    // Narrow grants are fixture setup; CRUD/publish/approval are exercised through HTTP.
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["form.read", "form.publish"] } });
    const publishOnly = await read(sourceForm.id); assert(publishOnly.actions?.publish && !publishOnly.actions.edit);
    await request("게시 전용은 저장 403", "/forms/" + sourceForm.id + "/draft", 1, "PATCH", { version: sourceForm.version, title: "거부" }, 403);
    await request("게시 전용도 승인 필요 409", "/forms/" + sourceForm.id + "/publish", 1, "POST", { version: sourceForm.version }, 409);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["form.read", "form.write"] } });
    const writeOnly = await read(sourceForm.id); assert(writeOnly.actions?.edit && !writeOnly.actions.publish);
    await request("작성 전용은 게시 403", "/forms/" + sourceForm.id + "/publish", 1, "POST", { version: sourceForm.version }, 403);
    await member("editor");
    const saved = await data<FormRecord>("같은 ID 단계별 초안 저장", "/forms/" + sourceForm.id + "/draft", 1, "PATCH", { version: sourceForm.version, content: { ...content, body: "양식 등록 본문" } }, 200, { "idempotency-key": randomUUID() }); assert.equal(saved.id, sourceForm.id);
    const template = await data<{ id: string; version: number }>("아홉 질문 양식 등록", "/templates", 1, "POST", { serviceId, title: "전체 흐름 양식", category: "QA", content: saved.content }, 201);
    const useKey = randomUUID(), useInput = { serviceId, version: template.version };
    const used = await data<FormRecord>("양식에서 독립 폼 생성", "/templates/" + template.id + "/use", 1, "POST", useInput, 201, { "idempotency-key": useKey });
    assert.equal((await data<FormRecord>("양식 사용 같은 키", "/templates/" + template.id + "/use", 1, "POST", useInput, 201, { "idempotency-key": useKey })).id, used.id);
    assert.deepEqual(used.content.questions.map(q => q.type), [...questionTypes]); assert.notEqual(used.content.questions[0].id, questions[0].id); assert.notEqual(used.content.questions[7].rows![0].id, questions[7].rows![0].id);
    assert.equal(used.content.questions[4].condition?.questionId, used.content.questions[2].id);
    await request("원본 양식 삭제", "/templates/" + template.id, 1, "DELETE", undefined, 204, { "if-match": String(template.version) }); assert.deepEqual((await read(used.id)).content, used.content);
    async function approve(decision: "approved" | "rejected") {
      const current = await read(used.id), row = await data<{ id: string; version: number }>("실제 게시 승인 요청", "/forms/" + used.id + "/approvals", 1, "POST", { version: current.version, message: "아홉 질문·동의 검토", reference: "QA" }, 201);
      await request("실제 승인 " + decision, "/approvals/" + row.id + "/decision", 0, "POST", { version: row.version, decision, reason: "합성 검토" });
    }
    await approve("rejected"); assert.equal((await read(used.id)).status, "draft"); await approve("approved");
    const before = await read(used.id); let firstPublication!: { id: string; token: string }; let writes = 0;
    const publicationSession = new FormPublicationSession({ read, publish: async (id, version, key) => {
      writes++; firstPublication = await data("게시 성공 응답 유실 재현", "/forms/" + id + "/publish", 1, "POST", { version }, 201, { "idempotency-key": key });
      throw new TypeError("합성 게시 성공 응답 유실");
    } });
    await assert.rejects(publicationSession.publish(before), /합성 게시 성공 응답 유실/);
    const recovered = await publicationSession.publish(before); assert.equal(writes, 1); assert(!recovered.actions?.publish && recovered.actions?.share);
    const publicBody = await data<{ consentBundle: FormConsentBundle }>("게시된 실제 동의 문서", "/public/forms/" + firstPublication.token, 2);
    const fixed = await data<{ id: string }>("실제 고정 주소 생성", "/fixed-urls", 1, "POST", { name: "모듈 전체 고정 주소", formId: used.id }, 201);
    const bytes = Buffer.from("실제 아홉 질문 모듈 첨부 " + randomUUID()), fileHash = createHash("sha256").update(bytes).digest("hex"), q = used.content.questions, questionId = q[6].id;
    const upload = await data<{ id: string; uploadToken: string }>("필수 파일 업로드 준비", "/public/forms/" + firstPublication.token + "/uploads", 2, "POST", { questionId, name: "모듈 전체 검증.txt", mime: "text/plain", size: bytes.length, sha256: fileHash }, 201);
    await request("실제 파일 바이트 전송", "/uploads/" + upload.id + "/content", 2, "PUT", undefined, 200, { "content-type": "text/plain", "x-upload-token": upload.uploadToken }, new Uint8Array(bytes));
    await request("실제 ClamAV 검사 완료", "/uploads/" + upload.id + "/complete", 2, "POST", undefined, 200, { "x-upload-token": upload.uploadToken });
    const answers = { [q[0].id]: "합성 이름", [q[1].id]: "장문 답변", [q[2].id]: "첫째", [q[3].id]: ["첫째"], [q[4].id]: "둘째", [q[5].id]: "2026-10-03", [q[6].id]: upload.id,
      [q[7].id]: Object.fromEntries(q[7].rows!.map(row => [row.id, "첫째"])), [q[8].id]: Object.fromEntries(q[8].rows!.map(row => [row.id, ["둘째"]])) };
    const input = { answers, consent: true, documentConsents: publicBody.consentBundle.documents.map(doc => doc.key), attachments: { [questionId]: { fileId: upload.id, token: upload.uploadToken } } };
    for (const [label, invalid] of [["숨은 질문 답변 거부", { ...input, answers: { ...answers, [q[2].id]: "둘째" } }], ["선택 수 초과 거부", { ...input, answers: { ...answers, [q[3].id]: ["첫째", "둘째"] } }], ["필수 문서 동의 누락 거부", { ...input, documentConsents: [] }]] as const)
      await request(label, "/public/forms/" + firstPublication.token + "/submissions", 2, "POST", invalid, 422);
    assert((await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } })).uploadTokenHash);
    const submitKey = randomUUID(), submitted = await data<{ id: string }>("실제 아홉 응답 제출", "/public/forms/" + firstPublication.token + "/submissions", 2, "POST", input, 201, { "idempotency-key": submitKey });
    assert.equal((await data<{ id: string }>("응답 같은 키 재전송", "/public/forms/" + firstPublication.token + "/submissions", 2, "POST", input, 201, { "idempotency-key": submitKey })).id, submitted.id);
    const stored = await db.submission.findUniqueOrThrow({ where: { id: submitted.id }, include: { answers: { orderBy: { id: "asc" } }, receipts: true } }); assert.equal(stored.answers.length, 9); assert(stored.receipts.length);
    const originalVersionHash = fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude })), answerHash = hash(stored.answers.map(a => a.valueCipher));
    const downloadPath = "/files/" + upload.id + "/download?submissionId=" + submitted.id + "&questionId=" + questionId;
    assert.equal(createHash("sha256").update(Buffer.from(await (await request("소유자 실제 첨부 다운로드", downloadPath)).arrayBuffer())).digest("hex"), fileHash);
    const viewerEmail = "module-share-" + randomUUID() + "@catchsecu.local.test";
    const share = await data<{ id: string }>("이전 게시본의 선택 항목 공유", "/share-grants", 0, "POST", { formId: used.id, formVersionId: stored.formVersionId, email: viewerEmail, questionIds: [q[0].id, questionId], expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201);
    const mail = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:1" } }); assert.equal(mail.tenantId, prior.tenantId);
    const invitation = decrypt<{ to: string; text: string }>(mail.payloadCipher); assert.equal(invitation.to, viewerEmail); const invitationCode = invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)?.[1]; assert(invitationCode);
    const challengeResponse = await request("실제 외부 열람 OTP 요청", "/viewer/challenges", 3, "POST", { formCode: used.id, invitationCode, email: viewerEmail, consent: true }, 202);
    cookies[3] = challengeResponse.headers.getSetCookie().map(v => v.split(";")[0]).join("; "); const challenge = await challengeResponse.json() as { id: string };
    const otpJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } }); assert.equal(otpJob.tenantId, prior.tenantId);
    const otpMail = decrypt<{ to: string; text: string }>(otpJob.payloadCipher); assert.equal(otpMail.to, viewerEmail); const code = otpMail.text.match(/이메일 인증코드: (\d{6})/)?.[1]; assert(code);
    const verified = await request("실제 OTP 확인", "/viewer/challenges/" + challenge.id + "/verify", 3, "POST", { code });
    cookies[3] = verified.headers.getSetCookie().map(v => v.split(";")[0]).join("; "); const viewerCookie = cookies[3];
    const shared = await data<SharedPage>("공유된 항목만 열람", "/viewer/submissions", 3); assert.equal(shared.total, 1); assert.deepEqual(Object.keys(shared.items[0].values).sort(), [q[0].id, questionId].sort());
    const sharedPath = "/viewer/files/" + upload.id + "/download?submissionId=" + submitted.id + "&questionId=" + questionId;
    assert.equal(createHash("sha256").update(Buffer.from(await (await request("공유 첨부 실제 다운로드", sharedPath, 3)).arrayBuffer())).digest("hex"), fileHash);
    const now = await read(used.id), changed = await data<FormRecord>("같은 폼 새 게시 초안", "/forms/" + used.id + "/draft", 1, "PATCH", { version: now.version, content: { ...used.content, body: "새 게시 본문" } }, 200, { "idempotency-key": randomUUID() }); assert.equal(changed.draftNumber, 2);
    await approve("approved"); const current = await read(used.id), fresh = await data<{ id: string; token: string }>("새 승인본 실제 게시", "/forms/" + used.id + "/publish", 1, "POST", { version: current.version }, 201);
    assert.equal((await db.fixedUrl.findUniqueOrThrow({ where: { id: fixed.id } })).publicationId, fresh.id);
    await request("이전 공개 링크 410", "/public/forms/" + firstPublication.token, 2, "GET", undefined, 410);
    const stillShared = await data<SharedPage>("새 게시 후 이전 공유 버전 유지", "/viewer/submissions", 3); assert.equal(stillShared.viewer.formNumber, 1); assert.equal(stillShared.items[0].id, submitted.id);
    let row = await read(used.id); await request("실제 공개 중단", "/forms/" + used.id + "/pause", 1, "POST", { version: row.version });
    await request("중단 공개 링크 410", "/public/forms/" + fresh.token, 2, "GET", undefined, 410);
    row = await read(used.id); await request("실제 공개 재개", "/forms/" + used.id + "/resume", 1, "POST", { version: row.version }); await request("재개 공개 링크 200", "/public/forms/" + fresh.token, 2);
    row = await read(used.id); await request("실제 폼 보관", "/forms/" + used.id, 1, "DELETE", undefined, 204, { "if-match": String(row.version) });
    await request("보관 공개 링크 410", "/public/forms/" + fresh.token, 2, "GET", undefined, 410); await request("보관하면 공유 열람 401", "/viewer/submissions", 3, "GET", undefined, 401);
    await request("합성 외부 열람 종료", "/viewer/logout", 3, "POST", undefined, 204); cookies[3] = "";
    const archived = await read(used.id); assert(!archived.actions?.publish && !archived.actions?.share);
    await request("원본 미참조 초안 보관", "/forms/" + sourceForm.id, 1, "DELETE", undefined, 204, { "if-match": String(saved.version) });
    await request("원본 미참조 초안 완전 삭제", "/forms/" + sourceForm.id + "/purge", 1, "DELETE", undefined, 204, { "if-match": String(saved.version + 1) });
    await member("viewer"); await policy(originalPolicy); setupActive = false;
    checkpoint = { tenantId: prior.tenantId, formId: used.id, sourceFormId: sourceForm.id, templateId: template.id, fixedId: fixed.id, shareId: share.id, documentId: document.id, fileId: upload.id, submissionId: submitted.id, questionId,
      oldToken: firstPublication.token, newToken: fresh.token, viewerCookie, fileHash, originalVersionId: stored.formVersionId, originalVersionHash, answerHash, businessHash: "", originalPolicy };
    checkpoint.businessHash = hash(await snapshot(checkpoint));
    await writeFile(".local/p04-form-module-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
  } else checkpoint = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8"));
  assert.equal(checkpoint.tenantId, prior.tenantId); const beforeReads = await snapshot(checkpoint); assert.equal(hash(beforeReads), checkpoint.businessHash);
  assert.equal(beforeReads.form.status, "archived"); assert.equal(beforeReads.versions.length, 2); assert.equal(beforeReads.approvals, 3); assert.equal(beforeReads.sourceForms, 0); assert.equal(beforeReads.templates, 0); assert.equal(beforeReads.file.scanStatus, "clean"); assert.equal(beforeReads.submission.cipherHash, checkpoint.answerHash);
  assert.equal(beforeReads.versions.find(v => v.id === checkpoint.originalVersionId)?.hash, checkpoint.originalVersionHash); assert.equal(beforeReads.share.formVersionId, checkpoint.originalVersionId);
  const owner = await read(checkpoint.formId, 0), viewer = await read(checkpoint.formId, 1); assert(!owner.actions?.publish && owner.actions?.responses && !viewer.actions?.publish && !viewer.actions?.responses);
  await request("최종 이전 공개 링크 종료", "/public/forms/" + checkpoint.oldToken, 2, "GET", undefined, 410); await request("최종 새 공개 링크 종료", "/public/forms/" + checkpoint.newToken, 2, "GET", undefined, 410);
  cookies[3] = checkpoint.viewerCookie; await request("최종 외부 공유 종료 유지", "/viewer/submissions", 3, "GET", undefined, 401); cookies[3] = "";
  const filePath = "/files/" + checkpoint.fileId + "/download?submissionId=" + checkpoint.submissionId + "&questionId=" + checkpoint.questionId;
  assert.equal(createHash("sha256").update(Buffer.from(await (await request("최종 보관 후 소유자 파일 보존", filePath)).arrayBuffer())).digest("hex"), checkpoint.fileHash);
  await request("조회자 첨부 접근 거부", filePath, 1, "GET", undefined, 403);
  assert.equal(hash(await snapshot(checkpoint)), checkpoint.businessHash);
  for (let actor = 0; actor < 2; actor++) { await request("합성 세션 종료 " + actor, "/auth/sign-out", actor, "POST", {}); cookies[actor] = ""; }
  await writeFile(`docs/qa/P04-T05/workflow/http-${phase}.json`, JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, businessDatabase: beforeReads,
    matchesBeforeRestart: phase === "finish", actualUiVerified: false, syntheticSessionsClosed: true, userAdminAccountUntouched: true, externalDeliveryVerified: false, localMailQueueOtpVerified: true,
    publicFileUploadExercised: true, completeConsentApprovalFileShareFlow: true, publicationSuccessResponseLossExercised: true, narrowGrantFixtureSetup: true, auditCount: await db.auditEvent.count({ where: { tenantId: prior.tenantId } }) }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, versions: beforeReads.versions.length, answers: beforeReads.submission.answers, approvals: beforeReads.approvals }));
} finally {
  if (setupActive && cookies[0]) { await member("viewer").catch(() => undefined); if (originalPolicy) await policy(originalPolicy).catch(() => undefined); }
  for (const cookie of cookies.slice(0, 2).filter(Boolean)) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
