// Dedicated local database only. This prepares API-verified data, not browser evidence.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";
import { requireContext } from "../src/server/context";
import { decrypt } from "../src/server/crypto";
import { requestPaymentOrder, virtualPaymentCheckout, readPaymentOrder } from "../src/server/payments";
import { requestSubjectAccess, createSubjectSession, withSubject, subjectConsents, subjectEvents } from "../src/server/subjects";
import { POST as createPurpose } from "../src/app/api/v1/processing-purposes/route";
import { POST as createRecipient } from "../src/app/api/v1/recipients/route";
import { POST as createDocument } from "../src/app/api/v1/documents/route";
import { POST as documentAction } from "../src/app/api/v1/documents/[...segments]/route";
import { GET as publicDocument } from "../src/app/api/v1/public/documents/[token]/route";
import { POST as createForm } from "../src/app/api/v1/forms/route";
import { POST as formAction } from "../src/app/api/v1/forms/[...segments]/route";
import { GET as publicForm, POST as submit } from "../src/app/api/v1/public/forms/[...segments]/route";
import { POST as uploadComplete, PUT as uploadBytes } from "../src/app/api/v1/uploads/[...segments]/route";
import { GET as privateFile } from "../src/app/api/v1/files/[...segments]/route";
import { POST as createShare } from "../src/app/api/v1/share-grants/route";
import { GET as readShare } from "../src/app/api/v1/share-grants/[...segments]/route";
import { GET as viewerGet, POST as viewerPost } from "../src/app/api/v1/viewer/[...segments]/route";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_mock_admin");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.ok(["localhost", "127.0.0.1", "catchsecu-mock.localhost"].includes(new URL(origin).hostname));
assert.equal(env.FILE_STORAGE, "local");
assert.equal(resolve(env.PRIVATE_STORAGE_DIR), resolve(".local/mock-page-storage"), "Use dedicated Mock fixture storage.");
assert.equal(env.MAIL_TRANSPORT, "local"); assert.equal(env.PAYMENT_PROVIDER, "local");
const checks: { name: string; status: number }[] = [], routes: Record<string, string> = {};
let cookie = "";
function req(path: string, method = "GET", input?: unknown, anonymous = false, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: anonymous ? "" : cookie,
    "idempotency-key": randomUUID(), ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function checked<T>(name: string, response: Response, status = 200): Promise<T> {
  checks.push({ name, status: response.status });
  assert.equal(response.status, status, name + (response.status !== status ? ": " + JSON.stringify(await response.clone().json()) : ""));
  return response.json() as Promise<T>;
}
const out = "docs/qa/mock-completion/dynamic-fixtures";
await mkdir(out, { recursive: true }); await mkdir(".local", { recursive: true });
try {
  const email = "mock-pages-" + randomUUID() + "@catchsecu.test", password = randomBytes(24).toString("base64url") + "!1aA";
  await checked("signup", await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: "동적 화면 Mock" })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "Mock 동적 화면", publicName: "Mock 동적 화면", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "Mock 서비스", externalName: "Mock 서비스" } } }, include: { services: true } });
  const serviceId = company.services[0].id;
  const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }));
  await checked("login", login.clone()); cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  const ctx = await requireContext(new Headers({ cookie }), "billing.write");
  const plan = await db.billingPlan.create({ data: { id: "mock-pages-" + randomUUID(), name: "Mock 화면 요금제" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000,
    currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400000) } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000 } });
  const order = await requestPaymentOrder(ctx, { subscriptionId: subscription.id }, randomUUID(), randomUUID());
  await virtualPaymentCheckout(ctx, order.body.id, "paid", randomUUID());
  assert.equal((await readPaymentOrder(ctx, order.body.id)).status, "paid"); checks.push({ name: "virtual payment persisted paid", status: 200 });
  for (const path of ["/pay/result/success/:purchaseId", "/pay/credit/success/:purchaseId", "/pay/plus/success/:purchaseId", "/pay/plus/success/:purchasedId/:type"])
    routes[path] = path.replace(/:purchase[d]?Id/g, order.body.id).replace(":type", "basic");
  const purpose = await checked<{ id: string }>("purpose", await createPurpose(req("/processing-purposes", "POST", { serviceId, name: "Mock 상담", purpose: "합성 상담 처리", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] })), 201);
  const recipient = await checked<{ id: string }>("recipient", await createRecipient(req("/recipients", "POST", { serviceId, name: "Mock 국외 수탁자", kind: "processor", countryCode: "US", purpose: "합성 상담 처리", items: ["이름"], retentionMode: "days", retentionDays: 30, retentionReason: "", contact: "mock@catchsecu.test", transferMethod: "암호화 전송", transferTiming: "동의 후", refusalNotice: "거부 시 상담 제한" })), 201);
  for (const [prefix, type] of [["P", "privacy_policy"], ["C", "consent"], ["OC", "overseas_transfer"]]) {
    const document = await checked<{ id: string; version: number }>("document " + prefix, await createDocument(req("/documents", "POST", { serviceId, type, title: "Mock " + prefix, body: "합성 데이터 문서", refusalNotice: "거부 시 상담 제한", rightsContact: "Mock 문의", effectiveDate: new Date().toISOString().slice(0, 10), purposeIds: [purpose.id], recipientIds: type === "overseas_transfer" ? [recipient.id] : [] })), 201);
    const published = await checked<{ url: string }>("publish " + prefix, await documentAction(req(`/documents/${document.id}/publish`, "POST", { version: document.version, expiresAt: null })), 201);
    const token = published.url.split("/").at(-1)!;
    const body = await checked<{ snapshot: { type: string } }>("public " + prefix, await publicDocument(req("/public/documents/" + token, "GET", undefined, true)));
    assert.equal(body.snapshot.type, type); routes[`/document/${prefix}/:token`] = `/document/${prefix}/${token}`;
  }
  const nameId = randomUUID(), emailId = randomUUID(), fileQuestion = randomUUID();
  const form = await checked<{ id: string; version: number }>("form create", await createForm(req("/forms", "POST", { serviceId, title: "Mock 동적 폼", content: { body: "합성 동적 시험", consentPurpose: "합성 상담 처리", consentRequired: true, retentionDays: 30, maxResponses: 100, questions: [
    { id: nameId, label: "이름", required: true, type: "단문형 답변", subjectRole: "name" }, { id: emailId, label: "이메일", required: true, type: "단문형 답변", subjectRole: "email" }, { id: fileQuestion, label: "Mock 첨부", required: true, type: "파일 업로드" }] } })), 201);
  const publication = await checked<{ token: string }>("form publish", await formAction(req(`/forms/${form.id}/publish`, "POST", { version: form.version })), 201);
  await checked("public form", await publicForm(req("/public/forms/" + publication.token, "GET", undefined, true)));
  const contact = { name: "Mock 정보주체", email: "subject-" + randomUUID() + "@catchsecu.test" };
  const bytes = Buffer.from("Mock 첨부파일 검증 데이터\n" + randomUUID());
  const file = await checked<{ id: string; uploadToken: string }>("upload init", await submit(req(`/public/forms/${publication.token}/uploads`, "POST", { questionId: fileQuestion, name: "mock-proof.txt", mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, true)), 201);
  await checked("upload bytes", await uploadBytes(new Request(`${origin}/api/v1/uploads/${file.id}/content`, { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": file.uploadToken }, body: new Uint8Array(bytes) })));
  await checked("upload scan complete", await uploadComplete(req(`/uploads/${file.id}/complete`, "POST", undefined, true, { "x-upload-token": file.uploadToken })));
  const submission = await checked<{ id: string }>("public submission", await submit(req(`/public/forms/${publication.token}/submissions`, "POST", { answers: { [nameId]: contact.name, [emailId]: contact.email, [fileQuestion]: file.id }, consent: true, attachments: { [fileQuestion]: { fileId: file.id, token: file.uploadToken } } }, true)), 201);
  const binding = `?submissionId=${submission.id}&questionId=${fileQuestion}`;
  const ownerDownload = await privateFile(req(`/files/${file.id}/download${binding}`));
  assert.equal(ownerDownload.status, 200); assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()), bytes);
  checks.push({ name: "owner file byte roundtrip", status: 200 });
  await checked("anonymous private file denied", await privateFile(req(`/files/${file.id}/download${binding}`, "GET", undefined, true)), 401);
  const storedFile = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(storedFile.scanStatus, "clean"); assert.equal(storedFile.uploadTokenHash, null);
  const options = await checked<{ versions: { id: string }[] }>("share options", await readShare(req(`/share-grants/options?formId=${form.id}`)));
  const shareEmail = "viewer-" + randomUUID() + "@catchsecu.test";
  const grant = await checked<{ id: string; version: number }>("share create", await createShare(req("/share-grants", "POST", { formId: form.id, formVersionId: options.versions[0].id, email: shareEmail, questionIds: [nameId, fileQuestion], expiresAt: new Date(Date.now() + 86400000).toISOString() })), 201);
  const invitationJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${grant.id}:invite:${grant.version}` } });
  const invitation = decrypt<{ text: string }>(invitationJob.payloadCipher);
  const invitationCode = /열람자 인증코드: ([A-Za-z0-9_-]{43})/.exec(invitation.text)?.[1]; assert.ok(invitationCode);
  const challengeResponse = await viewerPost(req("/viewer/challenges", "POST", { formCode: form.id, invitationCode, email: shareEmail, consent: true }, true));
  const challengeCookie = challengeResponse.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  const challenge = await checked<{ id: string }>("viewer challenge", challengeResponse, 202);
  const challengeJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${grant.id}:challenge:${challenge.id}` } });
  const code = /인증코드: (\d{6})/.exec(decrypt<{ text: string }>(challengeJob.payloadCipher).text)?.[1]; assert.ok(code);
  const verifiedResponse = await viewerPost(req(`/viewer/challenges/${challenge.id}/verify`, "POST", { code }, true, { cookie: challengeCookie }));
  const viewerCookie = verifiedResponse.headers.getSetCookie().find(v => v.startsWith("cs_viewer="))!.split(";")[0];
  const viewer = await checked<{ expiresAt: string }>("viewer verified", verifiedResponse);
  const records = await checked<{ items: { id: string }[] }>("shared records", await viewerGet(req("/viewer/submissions", "GET", undefined, true, { cookie: viewerCookie })));
  assert.equal(records.items.length, 1); assert.equal(records.items[0].id, submission.id); assert.ok(!JSON.stringify(records).includes(contact.email));
  const viewerDownload = await viewerGet(req(`/viewer/files/${file.id}/download${binding}`, "GET", undefined, true, { cookie: viewerCookie }));
  assert.equal(viewerDownload.status, 200); assert.deepEqual(Buffer.from(await viewerDownload.arrayBuffer()), bytes);
  checks.push({ name: "shared file byte roundtrip with hidden email excluded", status: 200 });
  await checked("shared file without cookie denied", await viewerGet(req(`/viewer/files/${file.id}/download${binding}`, "GET", undefined, true)), 401);
  for (const path of ["/file-view/:customerId", "/file-view/:customerId/shared", "/file-view/:customerId/:questionId/:fileId", "/file-view/:customerId/:questionId/:fileId/shared"])
    routes[path] = path.replace(":customerId", submission.id).replace(":questionId", fileQuestion).replace(":fileId", file.id);
  routes["/shared-privacy/view"] = "/shared-privacy/view";
  for (const path of ["/projects/:outerToken/form", "/project/:outerToken/form", "/url/:outerToken", "/test-projects/:outerToken/form", "/customer-use-case/:outerToken"])
    routes[path] = path.replace(":outerToken", publication.token);
  const access = await requestSubjectAccess({ ...contact, consent: true }, null, randomUUID());
  const jobs = await db.job.findMany({ where: { dedupeKey: { startsWith: "mail:subject-access:" } }, orderBy: { createdAt: "desc" } });
  const mail = jobs.map(job => decrypt<{ to: string; text: string }>(job.payloadCipher)).find(value => value.to === contact.email);
  assert.ok(mail); const accessToken = /\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1]; assert.ok(accessToken);
  const subject = await createSubjectSession(accessToken, access.browser);
  const consents = await withSubject(subject.token, subject.id, (tx, session) => subjectConsents(tx, session, 1, 20, randomUUID()));
  assert.equal(consents.total, 1);
  await withSubject(subject.token, subject.id, (tx, session) => subjectEvents(tx, session, 1, 20, randomUUID()));
  checks.push({ name: "subject cookie session and persisted consent/event queries", status: 200 });
  for (const path of ["/infoOwner/agree-history/:infoOwnerToken", "/infoOwner/action-history/:infoOwnerToken"]) routes[path] = path.replace(":infoOwnerToken", subject.id);
  await checked("unknown public document rejected", await publicDocument(req("/public/documents/" + "A".repeat(43), "GET", undefined, true)), 404);
  await checked("unknown public form rejected", await publicForm(req("/public/forms/" + "A".repeat(43), "GET", undefined, true)), 404);
  await assert.rejects(withSubject(null, subject.id, (tx, session) => subjectConsents(tx, session, 1, 20, randomUUID())), (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 401);
  checks.push({ name: "subject history without cookie rejected", status: 401 });
  const privatePath = ".local/mock-page-fixtures.json";
  await writeFile(privatePath, JSON.stringify({ generatedAt: new Date().toISOString(), origin, database: database.pathname, storage: resolve(env.PRIVATE_STORAGE_DIR), email, password, companyId: company.id, serviceId, formId: form.id, routes, viewer: { expiresAt: viewer.expiresAt, cookies: [{ name: "cs_viewer", value: viewerCookie.slice("cs_viewer=".length), path: "/api/v1/viewer", httpOnly: true, sameSite: "Strict" }] }, subject: { id: subject.id, expiresAt: subject.expiresAt, cookies: [{ name: "cs_subject", value: subject.token, path: "/api/v1/subjects", httpOnly: true, sameSite: "Strict" }, { name: "cs_subject_browser", value: access.browser, path: "/api/v1/subjects", httpOnly: true, sameSite: "Strict" }] } }, null, 2), { mode: 0o600 });
  await writeFile(out + "/report.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", evidenceLevel: "mock-api-fixture", browserVerified: false, realExternalAcceptance: false, checks, routes: Object.keys(routes).map(path => ({ path, fixtureSha256: createHash("sha256").update(routes[path]).digest("hex") })), privateFixture: privatePath, subjectExpiresAt: subject.expiresAt, note: "No mail sent. Re-run to refresh expiring subject session; private cookie/token values are excluded from this report." }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length, preparedRoutes: Object.keys(routes).length, browserVerified: false }));
} finally { await db.$disconnect(); }
