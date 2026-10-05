import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as localProvider } from "@/app/api/v1/public/verify/local/route";
import { POST as integrationPost, PATCH as integrationPatch } from "@/app/api/v1/services/[id]/verification/route";
import { cleanupVerification } from "@/server/verification-flow";
import { tokenHash } from "@/server/crypto";
import type { FormContent } from "@/contracts/forms";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
function req(path: string, method = "GET", input?: unknown, cookie = "", key: string = randomUUID(), headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key, ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
const SUBJECT = { name: "홍길동", birthDate: "1990-01-01" };
async function fixture(verify = true) {
  const email = "vrfy-" + randomUUID() + "@catchsecu.test", password = "Verify!12345";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", { name: "인증 시험", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "인증 시험 회사", publicName: "인증 시험", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "인증 서비스", externalName: "인증 서비스" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
  const question = randomUUID();
  const content: FormContent = { body: "인증 필요 폼", consentRequired: true, consentPurpose: "인증 시험", retentionDays: 30, maxResponses: 100, verify,
    questions: [{ id: question, type: "단문형 답변", label: "메모", required: true }] };
  const created = await createForm(req("/forms", "POST", { serviceId: company.services[0].id, title: "인증 폼", content }, cookie));
  expect(created.status).toBe(201);
  const form = await created.json();
  return { company, serviceId: company.services[0].id, cookie, content, form, question };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function configureIntegration(f: Fixture, status: "pending" | "enabled" | "disabled" = "enabled", provider = "local", environment = "sandbox") {
  const res = await integrationPost(req(`/services/${f.serviceId}/verification`, "POST",
    { identityProvider: provider, signatureProvider: null, environment, status }, f.cookie));
  return res;
}
async function publish(f: Fixture) {
  const res = await formAction(req("/forms/" + f.form.id + "/publish", "POST", { version: f.form.version }, f.cookie));
  return res;
}
async function challenge(token: string, kind = "identity") {
  return publicPost(req("/public/forms/" + token + "/verification", "POST", { kind }));
}
async function providerAnswer(attemptId: string, nonce: string, subject = SUBJECT) {
  const res = await localProvider(req("/public/verify/local", "POST", { attemptId, nonce, subject }));
  return { res, assertion: res.status === 200 ? await res.json() : null };
}
async function callback(token: string, assertion: unknown) {
  return publicPost(req("/public/forms/" + token + "/verification-callback", "POST", assertion));
}
async function submit(token: string, question: string, verification?: { attemptId: string; receipt: string }) {
  return publicPost(req("/public/forms/" + token + "/submissions", "POST",
    { consent: true, answers: { [question]: "메모" }, ...(verification ? { verification } : {}) }));
}
async function verifiedReceipt(token: string) {
  const ch = await challenge(token); expect(ch.status).toBe(201);
  const c = await ch.json();
  const { res, assertion } = await providerAnswer(c.attemptId, c.nonce); expect(res.status).toBe(200);
  const cb = await callback(token, assertion); expect(cb.status).toBe(200);
  const done = await cb.json();
  return { ...done, nonce: c.nonce };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("local sandbox 연동 사용 → challenge→provider→callback→영수증 소비로 제출된다", async () => {
  const f = await fixture(true);
  expect((await configureIntegration(f, "enabled")).status).toBe(201);
  const published = await publish(f); expect(published.status).toBe(201);
  const { token } = (await published.json()) as { token: string };
  expect((await submit(token, f.question)).status).toBe(422); // VERIFICATION_REQUIRED
  const proof = await verifiedReceipt(token);
  const res = await submit(token, f.question, { attemptId: proof.attemptId, receipt: proof.receipt });
  expect(res.status).toBe(201);
  const submission = await res.json();
  const attempt = await db.verificationAttempt.findUniqueOrThrow({ where: { id: proof.attemptId } });
  expect(attempt.status).toBe("consumed");
  const receipt = await db.verificationReceipt.findUniqueOrThrow({ where: { attemptId: proof.attemptId } });
  expect(receipt.submissionId).toBe(submission.id);
  expect(receipt.provider).toBe("local");
  expect(receipt.proofHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await db.verificationEvent.count({ where: { attemptId: proof.attemptId, signatureValid: true, verificationStatus: "verified" } })).toBe(1);
});

test("위조 서명·재생·만료·타테넌트·재사용 영수증을 모두 거부한다", async () => {
  const f = await fixture(true), g = await fixture(true);
  await configureIntegration(f, "enabled"); await configureIntegration(g, "enabled");
  const p1 = await publish(f), p2 = await publish(g);
  expect(p1.status).toBe(201); expect(p2.status).toBe(201);
  const t1 = (await p1.json()).token as string, t2 = (await p2.json()).token as string;

  // 위조 서명: subject 변조 → 403, 포렌식 이벤트 기록, attempt는 pending 유지
  const ch = await (await challenge(t1)).json();
  const { assertion } = await providerAnswer(ch.attemptId, ch.nonce);
  const forged = { ...assertion, subject: { name: "변조자", birthDate: "2000-12-31" } };
  const bad = await callback(t1, forged); expect(bad.status).toBe(403);
  expect(await db.verificationEvent.count({ where: { attemptId: ch.attemptId, signatureValid: false, verificationStatus: "rejected" } })).toBe(1);
  expect((await db.verificationAttempt.findUniqueOrThrow({ where: { id: ch.attemptId } })).status).toBe("pending");

  // nonce 불일치(탈취 시도) → provider 단계에서 403
  const stolen = await localProvider(req("/public/verify/local", "POST", { attemptId: ch.attemptId, nonce: "f".repeat(43), subject: SUBJECT }));
  expect(stolen.status).toBe(403);

  // 정상 완료 → 같은 assertion 재생 → 409
  const ok = await callback(t1, assertion); expect(ok.status).toBe(200);
  expect((await callback(t1, assertion)).status).toBe(409);
  const proof = await ok.json();

  // 영수증 토큰 위조
  expect((await submit(t1, f.question, { attemptId: proof.attemptId, receipt: proof.attemptId + "." + "0".repeat(64) })).status).toBe(403);
  // 다른 폼의 영수증 소비 → 404
  expect((await submit(t2, g.question, { attemptId: proof.attemptId, receipt: proof.receipt })).status).toBe(404);
  // 정상 소비 → 재사용 409
  expect((await submit(t1, f.question, { attemptId: proof.attemptId, receipt: proof.receipt })).status).toBe(201);
  expect((await db.verificationAttempt.findUniqueOrThrow({ where: { id: proof.attemptId } })).status).toBe("consumed");
  expect((await submit(t1, f.question, { attemptId: proof.attemptId, receipt: proof.receipt })).status).toBe(409);

  // 만료 attempt(expiresAt은 불변 — 짧은 TTL로 직접 생성) → provider 410 + callback 410 + 워커가 expired 처리
  const pub = await db.publication.findFirstOrThrow({ where: { tenantId: f.company.id, formId: f.form.id } });
  const integ = await db.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: f.company.id, serviceId: f.serviceId } } });
  const nearExpiry = await db.verificationAttempt.create({ data: {
    tenantId: f.company.id, serviceId: f.serviceId, integrationId: integ.id, integrationVersion: integ.version,
    formId: f.form.id, formVersionId: pub.formVersionId, publicationId: pub.id,
    kind: "identity", environment: "sandbox",
    browserNonceHash: tokenHash("nonce|x"), requestHash: "0".repeat(64), documentHash: "0".repeat(64),
    expiresAt: new Date(Date.now() + 200) } });
  await new Promise(r => setTimeout(r, 400));
  const exp = await localProvider(req("/public/verify/local", "POST", { attemptId: nearExpiry.id, nonce: "x".repeat(43), subject: SUBJECT }));
  expect(exp.status).toBe(410);
  const cleanup = await cleanupVerification();
  expect(cleanup.expired).toBeGreaterThanOrEqual(1);
  expect((await db.verificationAttempt.findUniqueOrThrow({ where: { id: nearExpiry.id } })).status).toBe("expired");
  // 인증 불필요 폼의 challenge·영수증 첨부 거부
  const plain = await fixture(false);
  await configureIntegration(plain, "enabled");
  const pp = await publish(plain); const pt = (await pp.json()).token;
  expect((await challenge(pt)).status).toBe(422);
  expect((await submit(pt, plain.question, { attemptId: proof.attemptId, receipt: proof.receipt })).status).toBe(422);
});

test("연동 미사용·외부 공급자·운영 환경은 게시·인증을 차단한다", async () => {
  const f = await fixture(true);
  // 연동 없이 verify 폼 게시 → 503
  expect((await publish(f)).status).toBe(503);
  // pending 상태 → 게시 503
  expect((await configureIntegration(f, "pending")).status).toBe(201);
  expect((await publish(f)).status).toBe(503);
  // 외부 공급자 enabled → 422
  const foreign = await fixture(true);
  expect((await configureIntegration(foreign, "enabled", "nicheck", "sandbox")).status).toBe(422);
  // production 환경 enabled → 422
  const prod = await fixture(true);
  expect((await configureIntegration(prod, "enabled", "local", "production")).status).toBe(422);
  // enabled로 전환 후 게시 가능
  const row = await db.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: f.company.id, serviceId: f.serviceId } } });
  const up = await integrationPatch(req(`/services/${f.serviceId}/verification`, "PATCH",
    { identityProvider: "local", signatureProvider: null, environment: "sandbox", status: "enabled", version: row.version }, f.cookie));
  expect(up.status).toBe(200);
  const published = await publish(f); expect(published.status).toBe(201);
  const { token } = await published.json();
  // 사용 중지로 전환하면 기존 verified 영수증도 소비 차단
  const proof = await verifiedReceipt(token);
  const row2 = await db.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: f.company.id, serviceId: f.serviceId } } });
  await integrationPatch(req(`/services/${f.serviceId}/verification`, "PATCH",
    { identityProvider: "local", signatureProvider: null, environment: "sandbox", status: "disabled", version: row2.version }, f.cookie));
  expect((await submit(token, f.question, { attemptId: proof.attemptId, receipt: proof.receipt })).status).toBe(422);
});

test("enabled 연동 상태와 sandbox 실측 여부가 readiness에 반영된다", async () => {
  const f = await fixture(true);
  expect((await configureIntegration(f, "enabled")).status).toBe(201);
  const published = await publish(f); expect(published.status).toBe(201);
  const { token } = await published.json();
  const before = await db.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: f.company.id, serviceId: f.serviceId } } });
  expect(before.status).toBe("enabled");
  expect(await db.verificationAttempt.count({ where: { serviceId: f.serviceId, status: "verified" } })).toBe(0);
  await verifiedReceipt(token);
  expect(await db.verificationAttempt.count({ where: { serviceId: f.serviceId, status: "verified" } })).toBe(1);
});
