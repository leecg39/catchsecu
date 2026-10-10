import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { defaultParticipationAccessPolicy } from "@/contracts/form-participation-access";
import { createForm, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { deleteParticipationTargetBatch, importParticipationTargets, listParticipationTargetBatches } from "@/server/form-participation-targets";
import { GET as publicRead, POST as publicAction } from "@/app/api/v1/public/forms/[...segments]/route";
import { DELETE as deleteFormAction, GET as readFormAction, POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { publicAuthorAssets } from "@/server/author-asset-reads";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");

let ctx: Context, serviceId: string, authCookie: string;
const email = () => `participant-${randomUUID()}@example.test`;
function content(policy = { ...defaultParticipationAccessPolicy(), enabled: true, useOtp: true, limitDuplicate: true }) {
  return formContentSchema.parse({ body: "참여 인증 검증", questions: [{ id: randomUUID(), type: "단문형 답변", label: "메모", required: false }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20, participationAccess: policy });
}
function request(path: string, method = "GET", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...headers,
    ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function body(response: Response, status = 200) {
  const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(status); return value;
}
async function create(value = content(), title = "참여 인증 폼") {
  return db.$transaction(tx => createForm(ctx, { serviceId, title, content: value }, randomUUID(), tx));
}
async function publish(formId: string, version: number) {
  return db.$transaction(tx => publishForm(tx, ctx, formId, { version }, randomUUID()));
}
async function start(token: string, address: string) {
  return body(await publicAction(request(`/public/forms/${token}/participation-challenges`, "POST", { email: address })), 201);
}
async function otpFor(challengeId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:participation:" + challengeId } });
  return decrypt<{ text: string }>(job.payloadCipher).text.match(/참여 인증번호: (\d{6})/)![1];
}
async function verify(token: string, challenge: { challengeId: string; client: string }, code: string, status = 200) {
  const response = await publicAction(request(`/public/forms/${token}/participation-challenges-verify`, "POST",
    { challengeId: challenge.challengeId, client: challenge.client, code }));
  return { ...await body(response, status), setCookie: response.headers.get("set-cookie") };
}
async function submit(token: string, proof: string, key = randomUUID()) {
  return publicAction(request(`/public/forms/${token}/submissions`, "POST",
    submissionInput.parse({ answers: {}, consent: false, participationProof: proof }), { "idempotency-key": key }));
}

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "참여 인증 QA", publicName: "Participation QA",
    policy: { create: { passwordMonths: 0 } }, services: { create: { name: "참여 서비스", externalName: "참여 서비스" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const ownerEmail = `participation-owner-${randomUUID()}@example.test`, password = "Participation!12345";
  const authRequest = (path: string, value: unknown) => new Request(`${origin}/api/v1/auth/${path}`,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  expect((await auth.handler(authRequest("sign-up/email", { email: ownerEmail, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email: ownerEmail }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authRequest("sign-in/email", { email: ownerEmail, password })); expect(login.status).toBe(200);
  authCookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie: authCookie }), "form.publish");
});
afterAll(() => db.$disconnect());

test("참여 정책은 독립 컬럼에 저장되고 구 클라이언트 생략은 보존하며 명시 해제는 초기값을 고정한다", async () => {
  const original = content(), form = await create(original);
  let stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored).toMatchObject({ participationAccessSchemaVersion: 1, useParticipationAccess: true,
    participationAccessMethod: "EMAIL", participationTargetScope: "ALL", participationUseOtp: true, restrictDuplicateReplies: true });
  expect((await readForm(ctx, form.id)).content?.participationAccess).toEqual(original.participationAccess);

  const oldClient = { ...original, body: "구 클라이언트 편집" } as Record<string, unknown>; delete oldClient.participationAccess;
  await updateForm(ctx, form.id, { version: 1, content: formContentSchema.parse(oldClient) }, randomUUID());
  expect((await readForm(ctx, form.id)).content?.participationAccess).toEqual(original.participationAccess);

  await updateForm(ctx, form.id, { version: 2, content: formContentSchema.parse({ ...original,
    participationAccess: defaultParticipationAccessPolicy() }) }, randomUUID());
  stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored).toMatchObject({ participationAccessSchemaVersion: 1, useParticipationAccess: false,
    participationUseOtp: false, restrictDuplicateReplies: false });
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "useParticipationAccess"=true, "participationUseOtp"=false WHERE id=${stored.id}`).rejects.toThrow();
});

test("지정 명단은 형식·파일내 중복·기등록 중복을 집계하고 게시 전 존재를 강제하며 삭제 시 즉시 회수한다", async () => {
  const policy = { ...defaultParticipationAccessPolicy(), enabled: true, targetScope: "WHITELIST" as const, useOtp: false };
  const form = await create(content(policy), "지정 명단 폼");
  await expect(publish(form.id, 1)).rejects.toMatchObject({ status: 422, code: "PARTICIPATION_TARGET_REQUIRED" });
  const allowed = email();
  const imported = await importParticipationTargets(ctx, form.id, { version: 1, name: "targets.csv",
    emails: ["email", allowed, allowed.toUpperCase(), "invalid", "second@example.test"] }, randomUUID());
  expect(imported).toMatchObject({ targetCount: 2, formVersion: 2, batch: { acceptedCount: 2, rejectedCount: 3 } });
  const listed = await listParticipationTargetBatches(ctx, form.id);
  expect(listed.targetCount).toBe(2); expect(listed.batches[0].name).toBe("targets.csv");
  const live = await publish(form.id, 2);
  const denied = await body(await publicAction(request(`/public/forms/${live.token}/participation-challenges`, "POST", { email: email() })), 403);
  expect(denied.error.code).toBe("PARTICIPATION_TARGET_DENIED");
  const access = await start(live.token, allowed);
  expect(access).toMatchObject({ requiresCode: false }); expect(access.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await body(await publicRead(request(`/public/forms/${live.token}`, "GET", undefined,
    { "x-participation-proof": access.proof })))).content.body).toBe("참여 인증 검증");
  const current = await readForm(ctx, form.id);
  await deleteParticipationTargetBatch(ctx, form.id, listed.batches[0].id, current.version, listed.batches[0].version, randomUUID());
  const revoked = await body(await publicRead(request(`/public/forms/${live.token}`, "GET", undefined,
    { "x-participation-proof": access.proof })), 403);
  expect(revoked.error.code).toBe("PARTICIPATION_TARGET_DENIED");
});

test("지정 명단 HTTP API는 인증·버전 조건을 적용해 등록 조회 삭제한다", async () => {
  const policy = { ...defaultParticipationAccessPolicy(), enabled: true, targetScope: "WHITELIST" as const, useOtp: false };
  const form = await create(content(policy), "지정 명단 API 폼"), address = email();
  const imported = await body(await formAction(request(`/forms/${form.id}/participation-targets`, "POST",
    { version: 1, name: "api-targets.csv", emails: [address, address.toUpperCase(), "invalid"] }, { cookie: authCookie })), 201);
  expect(imported).toMatchObject({ formVersion: 2, targetCount: 1, batch: { acceptedCount: 1, rejectedCount: 2 } });
  const listed = await body(await readFormAction(request(`/forms/${form.id}/participation-targets`, "GET", undefined,
    { cookie: authCookie })));
  expect(listed).toMatchObject({ formVersion: 2, targetCount: 1, batches: [{ id: imported.batch.id, name: "api-targets.csv" }] });
  expect((await readFormAction(request(`/forms/${form.id}/participation-targets`))).status).toBe(401);
  const removed = await body(await deleteFormAction(request(`/forms/${form.id}/participation-targets?batchId=${imported.batch.id}`,
    "DELETE", undefined, { cookie: authCookie, "if-match": "2", "x-batch-version": String(imported.batch.version) })));
  expect(removed).toEqual({ targetCount: 0, formVersion: 3 });
});

test("이메일 OTP 전에는 본문을 숨기고 오류 횟수를 보존하며 인증 뒤 한 번만 제출하고 같은 요청은 재생한다", async () => {
  const form = await create(), live = await publish(form.id, 1), address = email();
  const gate = await body(await publicRead(request(`/public/forms/${live.token}`)));
  expect(gate).toMatchObject({ closed: true, accessRequired: true, access: { method: "EMAIL", useOtp: true, limitDuplicate: true } });
  expect(gate).not.toHaveProperty("content");
  const challenge = await start(live.token, address), otp = await otpFor(challenge.challengeId);
  expect((await verify(live.token, challenge, otp === "000000" ? "111111" : "000000", 422)).error.code).toBe("PARTICIPATION_CODE_INVALID");
  expect((await db.participationChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).attempts).toBe(1);
  const verified = await verify(live.token, challenge, otp), proof = verified.proof;
  expect(verified.setCookie).toContain("cs_participation="); expect(verified.setCookie).toContain("HttpOnly");
  const cookie = verified.setCookie!.split(";", 1)[0];
  const active = await body(await publicRead(request(`/public/forms/${live.token}`, "GET", undefined, { cookie })));
  expect(active.closed).toBe(false); expect(active.content.body).toBe("참여 인증 검증");
  await expect(publicAuthorAssets(live.token, randomUUID(), undefined, { surface: "active" }))
    .rejects.toMatchObject({ status: 401, code: "PARTICIPATION_AUTH_REQUIRED" });
  expect(await publicAuthorAssets(live.token, randomUUID(), undefined, { surface: "active", participationProof: proof }))
    .toMatchObject({ items: [] });
  const key = randomUUID(), first = await body(await submit(live.token, proof, key), 201);
  expect(await body(await submit(live.token, proof, key), 201)).toEqual(first);
  expect((await body(await submit(live.token, proof), 409)).error.code).toBe("PARTICIPATION_DUPLICATED");
  expect((await body(await publicRead(request(`/public/forms/${live.token}`, "GET", undefined,
    { "x-participation-proof": proof })), 409)).error.code).toBe("PARTICIPATION_DUPLICATED");
  expect(await db.submission.count()).toBe(1);
  expect((await db.publication.findUniqueOrThrow({ where: { id: live.id } })).responseCount).toBe(1);
  expect((await db.publicationParticipant.findFirstOrThrow()).submissionCount).toBe(1);
});

test("공개 파일 업로드 초기화는 참여 인증 전에는 차단하고 유효한 증명 뒤에만 허용한다", async () => {
  const questionId = randomUUID();
  const form = await create(formContentSchema.parse({ ...content(), questions: [
    { id: questionId, type: "파일 업로드", label: "증빙", required: false },
  ] }), "참여 인증 파일 폼"), live = await publish(form.id, 1), address = email();
  const upload = { questionId, name: "evidence.txt", mime: "text/plain", size: 1, sha256: "0".repeat(64) };
  const headers = { "idempotency-key": randomUUID() };
  expect((await body(await publicAction(request(`/public/forms/${live.token}/uploads`, "POST", upload, headers)), 401)).error.code)
    .toBe("PARTICIPATION_AUTH_REQUIRED");
  const challenge = await start(live.token, address);
  const proof = (await verify(live.token, challenge, await otpFor(challenge.challengeId))).proof;
  const started = await body(await publicAction(request(`/public/forms/${live.token}/uploads`, "POST", upload,
    { "idempotency-key": randomUUID(), "x-participation-proof": proof })), 201);
  expect(started).toMatchObject({ name: "evidence.txt", questionId, status: "pending" });
});

test("소셜 참여 인증은 외부 제공사 자격증명 연결 전에는 게시하지 않는다", async () => {
  const policy = { ...defaultParticipationAccessPolicy(), enabled: true, method: "SOCIAL" as const,
    useOtp: false, socialProvider: "NAVER" as const, limitDuplicate: true };
  const form = await create(content(policy), "소셜 참여 인증 폼");
  await expect(publish(form.id, 1)).rejects.toMatchObject({ status: 503, code: "SOCIAL_PARTICIPATION_PROVIDER_REQUIRED" });
  expect(await db.publication.count({ where: { formId: form.id } })).toBe(0);
});

test("동일 인증의 동시 제출은 하나만 커밋하고 중복 제한을 켠 새 게시본도 이전 참여 이력을 유지한다", async () => {
  const openPolicy = { ...defaultParticipationAccessPolicy(), enabled: true, useOtp: true, limitDuplicate: false };
  const form = await create(content(openPolicy), "설정 전환 폼"), firstLive = await publish(form.id, 1), address = email();
  const challenge = await start(firstLive.token, address), proof = (await verify(firstLive.token, challenge, await otpFor(challenge.challengeId))).proof;
  const concurrent = await Promise.all([submit(firstLive.token, proof), submit(firstLive.token, proof)]);
  expect(concurrent.map(response => response.status).sort()).toEqual([201, 201]);
  expect((await db.publicationParticipant.findFirstOrThrow()).submissionCount).toBe(2);

  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 2, randomUUID()));
  const revised = await readForm(ctx, form.id);
  await updateForm(ctx, form.id, { version: revised.version, content: formContentSchema.parse({ ...revised.content,
    participationAccess: { ...openPolicy, limitDuplicate: true } }) }, randomUUID());
  const secondLive = await publish(form.id, revised.version + 1);
  const blocked = await body(await publicAction(request(`/public/forms/${secondLive.token}/participation-challenges`, "POST", { email: address })), 409);
  expect(blocked.error.code).toBe("PARTICIPATION_DUPLICATED");
});

test("중복 제한 상태의 동시 제출은 서로 다른 멱등키에서도 정확히 한 건만 만든다", async () => {
  const form = await create(), live = await publish(form.id, 1), address = email();
  const challenge = await start(live.token, address), proof = (await verify(live.token, challenge, await otpFor(challenge.challengeId))).proof;
  const responses = await Promise.all([submit(live.token, proof), submit(live.token, proof)]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await db.submission.count()).toBe(1);
  expect((await db.publication.findUniqueOrThrow({ where: { id: live.id } })).responseCount).toBe(1);
  expect((await db.publicationParticipant.findFirstOrThrow()).submissionCount).toBe(1);
});
