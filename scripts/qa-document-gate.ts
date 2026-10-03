import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { canonicalDocument, renderDocument } from "../src/server/documents";
import { emptyDisplay, type ClauseRecord, type DocumentInput, type DocumentRecord, type DocumentVersionRecord, type DocumentSnapshot, type DisplayRecord, type DocumentOptions } from "../src/contracts/documents";
import type { ConsentEvidence, FormConsentBundle } from "../src/contracts/form-documents";
import type { FormContent, FormRecord, Paged } from "../src/contracts/forms";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const phase = process.argv[2]; assert(["prepare", "finish", "expiry"].includes(phase));
const people = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const catalog = JSON.parse(await readFile(".local/p05-catalog-checkpoint.json", "utf8")) as { tenantId: string; serviceId: string; purposeIds: string[] };
const person = people.people[1]; assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const cases: { label: string; status: number }[] = [], sessions = new Set<string>();
type Published = { document: DocumentRecord; number: number; publicationId: string; url: string };
type PublicForm = { title: string; consentBundle: FormConsentBundle; content: FormContent };
type Checkpoint = { documentIds: string[]; clauseId: string; links: string[]; formId: string; token: string; submissionId: string; receiptId: string;
  firstBody: string; secondBody: string; bundle: FormConsentBundle; receiptSha: string; documentSha: string };
async function request(label: string, path: string, cookie = "", method = "GET", value?: unknown, expected = 200, extra: Record<string, string> = {}) {
  const result = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie, ...(method === "GET" ? {} : { origin }),
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(result.status, expected, label); cases.push({ label, status: result.status }); return result;
}
async function record<T>(label: string, path: string, cookie = "", method = "GET", value?: unknown, expected = 200, extra: Record<string, string> = {}) {
  return await (await request(label, path, cookie, method, value, expected, extra)).json() as T;
}
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function pdf(label: string, path: string, cookie: string) {
  const result = await request(label, path, cookie); assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert(result.headers.get("content-type")?.startsWith("application/pdf")); const bytes = Buffer.from(await result.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); return sha(bytes);
}
function docInput(row: DocumentRecord): DocumentInput {
  return { serviceId: row.serviceId, type: row.type, title: row.title, body: row.body, refusalNotice: row.refusalNotice, rightsContact: row.rightsContact,
    effectiveDate: row.effectiveDate, purposeIds: row.purposeIds, recipientIds: row.recipientIds };
}
const publicPath = (link: string) => "/public/documents/" + link.split("/").pop();
async function verifyStored(checkpoint: Checkpoint, cookie: string) {
  const consent = await record<DocumentRecord>("동의서 현재 상세 대조", "/documents/" + checkpoint.documentIds[0], cookie);
  const policy = await record<DocumentRecord>("처리방침 비공개 상태 대조", "/documents/" + checkpoint.documentIds[1], cookie);
  const overseas = await record<DocumentRecord>("국외 이전 문서 상태 대조", "/documents/" + checkpoint.documentIds[2], cookie);
  assert.equal(consent.status, "published"); assert.equal(consent.version, 10); assert.equal(consent.latestNumber, 3);
  assert.equal(policy.status, "private"); assert.equal(overseas.status, "published");
  const clause = await record<ClauseRecord>("문구 변경·보관·복원 대조", "/clause-templates/" + checkpoint.clauseId, cookie);
  assert.equal(clause.version, 4); assert.equal(clause.status, "active"); assert.notEqual(clause.body, checkpoint.firstBody);
  const history = await record<Paged<DocumentVersionRecord>>("불변 게시 버전 비교", "/documents/" + consent.id + "/versions", cookie);
  assert.equal(history.total, 3); assert.equal(history.items.find(row => row.number === 1)!.snapshot.body, checkpoint.firstBody);
  assert.equal(history.items.find(row => row.number === 2)!.snapshot.body, checkpoint.secondBody);
  assert.equal(history.items.find(row => row.number === 3)!.snapshot.body, checkpoint.secondBody);
  for (const version of history.items) { assert.equal(version.contentHash, sha(canonicalDocument(version.snapshot))); assert.equal(version.renderedText, renderDocument(version.snapshot)); }
  const links = history.items.flatMap(row => row.publications); assert.equal(links.filter(row => row.status === "revoked").length, 2); assert.equal(links.filter(row => row.url).length, 1);
  await request("첫 게시 링크 회수 유지", publicPath(checkpoint.links[0]), "", "GET", undefined, 410);
  await request("둘째 게시 링크 회수 유지", publicPath(checkpoint.links[1]), "", "GET", undefined, 410);
  const publicDocument = await record<{ snapshot: DocumentSnapshot; contentHash: string }>("재게시 링크 실제 공개 DTO", publicPath(checkpoint.links[2]));
  assert.equal(publicDocument.snapshot.body, checkpoint.secondBody);
  for (const internal of [catalog.tenantId, catalog.serviceId, consent.id, "tokenHash", "tokenCipher"]) assert(!JSON.stringify(publicDocument).includes(internal));
  const frozen = await record<PublicForm>("공개 폼의 당시 동의 문구 대조", "/public/forms/" + checkpoint.token); assert.deepEqual(frozen.consentBundle, checkpoint.bundle);
  assert.equal(await pdf("당시 동의 영수증 PDF 실제 다운로드", "/submissions/" + checkpoint.submissionId + "/receipts/" + checkpoint.receiptId + "/pdf", cookie), checkpoint.receiptSha);
  assert.equal(await pdf("이전 게시본 PDF 실제 다운로드", "/documents/" + consent.id + "/versions/1/pdf", cookie), checkpoint.documentSha);
  const stored = await db.documentVersion.findMany({ where: { documentId: { in: checkpoint.documentIds }, tenantId: catalog.tenantId } }); assert.equal(stored.length, 5);
  for (const version of stored) { const snapshot = version.snapshot as unknown as DocumentSnapshot; assert.equal(version.contentHash, sha(canonicalDocument(snapshot))); assert.equal(version.renderedText, renderDocument(snapshot)); }
  const receipt = await db.consentReceipt.findUniqueOrThrow({ where: { id: checkpoint.receiptId } }); assert.equal(receipt.submissionId, checkpoint.submissionId); assert.equal(receipt.tenantId, catalog.tenantId);
  assert.deepEqual(decrypt<ConsentEvidence>(receipt.evidenceCipher!).bundle, checkpoint.bundle);
  assert.equal(sha(Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64")), checkpoint.receiptSha);
  const binding = await db.formDocumentBinding.findFirstOrThrow({ where: { formVersion: { formId: checkpoint.formId } }, include: { documentVersion: true } });
  assert.equal(binding.documentVersion.number, 1); assert.equal(binding.documentVersion.documentId, consent.id);
  assert.equal(binding.documentVersion.contentHash, checkpoint.bundle.documents[0].contentHash);
  const events = await db.auditEvent.findMany({ where: { tenantId: catalog.tenantId, resourceId: { in: [...checkpoint.documentIds, checkpoint.clauseId] } } });
  assert.equal(events.length, 19); // 10 consent, 3 policy, 2 overseas and 4 clause writes.
  return { documents: 3, publishedVersions: 5, clauseVersion: 4, catalogLinksMatch: true, allDocumentTypes: true, snapshotHashesMatch: true, revokedLinksStayClosed: true,
    receiptBundleFrozen: true, receiptPdfShaMatches: true, documentPdfShaMatches: true, immutableFormBinding: true, auditCount: events.length };
}
async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert.equal(user.status, "active"); assert.equal(user.platformAdmin, false);
  const login = await request("합성 소유자 로그인", "/auth/sign-in/email", "", "POST", { email: person.email, password: person.password });
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie); sessions.add(cookie);
  await request("시험 회사 선택", "/context", cookie, "POST", { companyId: catalog.tenantId });
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const marker = "문서 QA " + randomUUID(), firstBody = "합성 상담 안내 문구 v1", secondBody = '개정 동의 문구 v2\n<script>window.__documentGateXss=1</script><img src=x onerror="alert(1)">';
    const clauseInput = { serviceId: catalog.serviceId, type: "consent", title: marker + " 문구", body: firstBody };
    const clause = await record<ClauseRecord>("문구 템플릿 생성", "/clause-templates", cookie, "POST", clauseInput, 201);
    const input: DocumentInput = { serviceId: catalog.serviceId, type: "consent", title: marker + " 동의서", body: "초기 초안", refusalNotice: "동의를 거부할 수 있습니다.", rightsContact: "QA 문의", effectiveDate: "2026-10-03", purposeIds: [catalog.purposeIds[0]], recipientIds: [] };
    await request("무효 시행일 차단", "/documents", cookie, "POST", { ...input, effectiveDate: "2026-02-30" }, 422);
    const key = randomUUID(), created = await record<DocumentRecord>("동의서 초안 생성", "/documents", cookie, "POST", input, 201, { "idempotency-key": key });
    const replay = await record<DocumentRecord>("초안 생성 재전송", "/documents", cookie, "POST", input, 201, { "idempotency-key": key }); assert.equal(replay.id, created.id);
    const applied = await record<DocumentRecord>("문구를 초안에 복사", "/documents/" + created.id + "/apply-clause", cookie, "POST", { version: created.version, templateId: clause.id, templateVersion: 1 });
    const first = await record<Published>("동의서 첫 게시", "/documents/" + created.id + "/publish", cookie, "POST", { version: applied.version, expiresAt: null }, 201);
    await record<ClauseRecord>("원본 문구만 개정", "/clause-templates/" + clause.id, cookie, "PATCH", { ...clauseInput, body: "별도로 개정한 문구 v2", version: 1 });
    const policyDraft = await record<DocumentRecord>("처리방침 초안 생성", "/documents", cookie, "POST", { ...input, type: "privacy_policy", title: marker + " 처리방침", body: "합성 처리방침", purposeIds: catalog.purposeIds }, 201);
    const policy = await record<Published>("처리방침 게시", "/documents/" + policyDraft.id + "/publish", cookie, "POST", { version: 1, expiresAt: null }, 201);
    const overseasDraft = await record<DocumentRecord>("국외 이전 동의서 생성", "/documents", cookie, "POST", { ...input, type: "overseas_transfer", title: marker + " 국외 이전" }, 201);
    await record<Published>("국외 이전 동의서 게시", "/documents/" + overseasDraft.id + "/publish", cookie, "POST", { version: 1, expiresAt: null }, 201);
    const displayPath = "/services/" + catalog.serviceId + "/consent-display/collection";
    const current = await record<DisplayRecord>("서비스 동의 표시 설정 조회", displayPath, cookie);
    const displayed = await record<DisplayRecord>("동의 표시와 게시 처리방침 연결", displayPath, cookie, "PATCH", { ...emptyDisplay(), version: current.version, startText: "당시 안내 문구", policyMode: "document", publicationId: policy.publicationId });
    await request("연결 중 처리방침 비공개 차단", "/documents/" + policyDraft.id + "/unpublish", cookie, "POST", { version: policy.document.version }, 409);
    const history = await record<Paged<DocumentVersionRecord>>("연결할 첫 게시 버전 조회", "/documents/" + created.id + "/versions", cookie);
    const questionId = randomUUID();
    const content: FormContent = { body: "합성 상담 접수", questions: [{ id: questionId, label: "합성 이름", type: "단문형 답변", required: true }], consentRequired: true,
      consentPurpose: "합성 상담 처리", retentionDays: 30, maxResponses: 10, documentConsents: [{ documentVersionId: history.items[0].id, required: true, kind: "collection" }] };
    const form = await record<FormRecord>("첫 게시 문서 연결 폼 생성", "/forms", cookie, "POST", { serviceId: catalog.serviceId, title: marker + " 동의 폼", content }, 201);
    const live = await record<{ token: string }>("동의 폼 게시", "/forms/" + form.id + "/publish", cookie, "POST", { version: form.version }, 201);
    const publicForm = await record<PublicForm>("당시 문서·표시 문구 공개 조회", "/public/forms/" + live.token);
    assert.equal(publicForm.consentBundle.documents[0].renderedText, history.items[0].renderedText); assert.equal(publicForm.consentBundle.display?.startText, "당시 안내 문구");
    await request("필수 문서 동의 누락 차단", "/public/forms/" + live.token + "/submissions", "", "POST", { answers: { [questionId]: "합성 응답자" }, consent: true, documentConsents: [] }, 422);
    const submission = await record<{ id: string }>("실제 문서 동의 응답 제출", "/public/forms/" + live.token + "/submissions", "", "POST", { answers: { [questionId]: "합성 응답자" }, consent: true, documentConsents: publicForm.consentBundle.documents.map(row => row.key) }, 201);
    const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submission.id } });
    const receiptSha = await pdf("동의 영수증 최초 PDF", "/submissions/" + submission.id + "/receipts/" + receipt.id + "/pdf", cookie);
    const documentSha = await pdf("첫 게시본 최초 PDF", "/documents/" + created.id + "/versions/1/pdf", cookie);
    await record<DisplayRecord>("현재 표시 문구 변경·처리방침 연결 해제", displayPath, cookie, "PATCH", { ...emptyDisplay(), version: displayed.version, startText: "현재는 변경된 문구" });
    await record<DocumentRecord>("처리방침 비공개 전환", "/documents/" + policyDraft.id + "/unpublish", cookie, "POST", { version: policy.document.version });
    const changed = await record<DocumentRecord>("동의서 초안 개정", "/documents/" + created.id, cookie, "PATCH", { ...docInput(first.document), body: secondBody, version: first.document.version });
    const second = await record<Published>("동의서 개정본 게시", "/documents/" + created.id + "/publish", cookie, "POST", { version: changed.version, expiresAt: null }, 201);
    await request("게시 내용 중복 차단", "/documents/" + created.id + "/publish", cookie, "POST", { version: second.document.version, expiresAt: null }, 409);
    await request("오래된 문서 버전 충돌", "/documents/" + created.id, cookie, "PATCH", { ...input, version: first.document.version }, 409);
    const revoked = await record<DocumentRecord>("첫 게시 링크 개별 회수", "/documents/" + created.id + "/revoke", cookie, "POST", { version: second.document.version, publicationId: first.publicationId });
    const privateDoc = await record<DocumentRecord>("동의서 전체 비공개", "/documents/" + created.id + "/unpublish", cookie, "POST", { version: revoked.version });
    await request("동의서 보관", "/documents/" + created.id, cookie, "DELETE", undefined, 204, { "if-match": String(privateDoc.version) });
    const restored = await record<DocumentRecord>("동의서 초안 복원", "/documents/" + created.id + "/restore", cookie, "POST", { version: privateDoc.version + 1 });
    const third = await record<Published>("복원 후 새 버전 재게시", "/documents/" + created.id + "/publish", cookie, "POST", { version: restored.version, expiresAt: null }, 201);
    await request("문구 보관", "/clause-templates/" + clause.id, cookie, "DELETE", undefined, 204, { "if-match": "2" });
    await record<ClauseRecord>("문구 복원", "/clause-templates/" + clause.id + "/restore", cookie, "POST", { version: 3 });
    checkpoint = { documentIds: [created.id, policyDraft.id, overseasDraft.id], clauseId: clause.id, links: [first.url, second.url, third.url], formId: form.id, token: live.token,
      submissionId: submission.id, receiptId: receipt.id, firstBody, secondBody, bundle: publicForm.consentBundle, receiptSha, documentSha };
    await writeFile(".local/p05-document-checkpoint.json", JSON.stringify(checkpoint), { mode: 0o600 });
  } else checkpoint = JSON.parse(await readFile(".local/p05-document-checkpoint.json", "utf8")) as Checkpoint;
  if (phase === "expiry") {
    const source = await record<DocumentRecord>("만료 시험용 원본 초안 조회", "/documents/" + checkpoint.documentIds[0], cookie);
    const draft = await record<DocumentRecord>("만료 시험용 독립 처리방침 생성", "/documents", cookie, "POST", { ...docInput(source), type: "privacy_policy", title: "공개 만료 QA " + randomUUID() }, 201);
    const previous = await record<Published>("만료하지 않는 이전 게시본 생성", "/documents/" + draft.id + "/publish", cookie, "POST", { version: draft.version, expiresAt: null }, 201);
    const latestDraft = await record<DocumentRecord>("최신 만료 시험 본문으로 개정", "/documents/" + draft.id, cookie, "PATCH", { ...docInput(previous.document), body: previous.document.body + "\n최신 만료 시험 본문", version: previous.document.version });
    const expiresAt = new Date(Date.now() + 61000).toISOString(), startedAt = Date.now();
    const published = await record<Published>("61초 뒤 실제 만료되는 링크 게시", "/documents/" + draft.id + "/publish", cookie, "POST", { version: latestDraft.version, expiresAt }, 201);
    assert.equal(published.document.hasActivePublication, true);
    const checkpointPath = ".local/p05-document-expiry-checkpoint.json";
    await writeFile(checkpointPath, JSON.stringify({ documentId: draft.id, published, expiresAt }), { mode: 0o600 });
    await request("만료 전 공개 링크 정상", publicPath(published.url));
    const options = await record<DocumentOptions>("만료 전 처리방침 선택 가능", "/documents/options?serviceId=" + catalog.serviceId, cookie);
    assert(options.policies.some(row => row.publicationId === published.publicationId));
    while (Date.now() <= new Date(expiresAt).getTime()) await new Promise(resolve => setTimeout(resolve, 250));
    await request("실제 시간 경과 후 링크 만료", publicPath(published.url), "", "GET", undefined, 410);
    await request("최신 버전 만료 후에도 이전 버전 공개 유지", publicPath(previous.url));
    const expiredDocument = await record<DocumentRecord>("실제 만료 뒤 화면의 재게시 가능 상태", "/documents/" + draft.id, cookie);
    assert.equal(expiredDocument.hasActivePublication, false); assert.equal(expiredDocument.hasUnpublishedChanges, false);
    const history = await record<Paged<DocumentVersionRecord>>("만료 후 이력의 공유 URL 제거", "/documents/" + draft.id + "/versions", cookie);
    const link = history.items[0].publications[0]; assert.equal(link.status, "expired"); assert(!link.url);
    const expiredOptions = await record<DocumentOptions>("만료 후 처리방침 선택 제외", "/documents/options?serviceId=" + catalog.serviceId, cookie);
    assert(!expiredOptions.policies.some(row => row.publicationId === published.publicationId));
    const reopened = await record<Published>("최신 게시본 만료 뒤 같은 내용 재게시", "/documents/" + draft.id + "/publish", cookie, "POST", { version: published.document.version, expiresAt: null }, 201);
    assert.equal(reopened.number, 3); assert.equal(reopened.document.hasActivePublication, true); await request("재게시 링크 정상", publicPath(reopened.url));
    await request("새 게시 후 옛 링크는 계속 만료", publicPath(published.url), "", "GET", undefined, 410);
    const versions = await db.documentVersion.findMany({ where: { documentId: draft.id }, orderBy: { number: "asc" } });
    assert.equal(versions.length, 3); assert.equal(versions[1].contentHash, versions[2].contentHash); assert.notEqual(versions[0].contentHash, versions[1].contentHash);
    const stored = await db.documentPublication.findUniqueOrThrow({ where: { id: published.publicationId } }); assert(stored.expiresAt && stored.expiresAt <= new Date());
    await request("만료 시험 합성 세션 로그아웃", "/auth/sign-out", cookie, "POST", {}); sessions.delete(cookie);
    await writeFile("docs/qa/P05-T02/http-expiry.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, realTimeElapsedMs: Date.now() - startedAt,
      expiredHttpStatus: 410, expiredHistoryUrlOmitted: true, expiredPolicyExcluded: true, sameContentRepublished: true, oldLinkRemainsExpired: true,
      immutableLatestVersionsWithEqualHash: true, previousVersionRemainsActive: true, syntheticSessionsClosed: true }, null, 2) + "\n");
    console.log(JSON.stringify({ phase, result: "passed", checks: cases.length, realTimeElapsedMs: Date.now() - startedAt })); return;
  }
  const databaseReport = await verifyStored(checkpoint, cookie);
  let expiryAfterRestart: { oldLinkStillExpired: boolean; newVersionStillActive: boolean; equalImmutableHashes: boolean } | undefined;
  if (phase === "finish") {
    const expiry = JSON.parse(await readFile(".local/p05-document-expiry-checkpoint.json", "utf8")) as { documentId: string; published: Published };
    const row = await record<DocumentRecord>("재시작 후 만료·재게시 상태 유지", "/documents/" + expiry.documentId, cookie);
    assert.equal(row.latestNumber, expiry.published.number + 1); assert.equal(row.hasActivePublication, true);
    const history = await record<Paged<DocumentVersionRecord>>("재시작 후 만료·재게시 이력 유지", "/documents/" + row.id + "/versions", cookie);
    assert.equal(history.total, expiry.published.number + 1); assert.equal(history.items[0].contentHash, history.items[1].contentHash);
    const oldLink = history.items.find(version => version.number === expiry.published.number)!.publications[0], newLink = history.items[0].publications[0];
    assert.equal(oldLink.status, "expired"); assert(!oldLink.url); assert(newLink.url);
    await request("재시작 후 옛 링크 만료 유지", publicPath(expiry.published.url), "", "GET", undefined, 410);
    await request("재시작 후 새 링크 정상 유지", publicPath(newLink.url));
    expiryAfterRestart = { oldLinkStillExpired: true, newVersionStillActive: true, equalImmutableHashes: true };
  }
  await request("합성 세션 로그아웃", "/auth/sign-out", cookie, "POST", {}); sessions.delete(cookie);
  await request("로그아웃 쿠키 문서 상세 차단", "/documents/" + checkpoint.documentIds[0], cookie, "GET", undefined, 401);
  await request("로그아웃 쿠키 문구 상세 차단", "/clause-templates/" + checkpoint.clauseId, cookie, "GET", undefined, 401);
  await writeFile("docs/qa/P05-T02/http-" + phase + ".json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, database: databaseReport,
    receiptSha: checkpoint.receiptSha, documentSha: checkpoint.documentSha, matchesBeforeRestart: phase === "finish", expiryAfterRestart,
    syntheticSessionsClosed: true, userAdminAccountUntouched: true }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", checks: cases.length, ...databaseReport }));
}
try { await main(); } finally {
  for (const cookie of sessions) { const result: Response = await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }); assert.equal(result.status, 200); }
  await db.$disconnect();
}
