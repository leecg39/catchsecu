import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { createActivityReview, actOnActivityReview, readActivityReview, decideActivityReviewDestruction, sweepActivityReviewRetention } from "@/server/activity-reviews";
import { updatePolicy, policyDefaults } from "@/server/security-policy";
import { POST as destructionRoute } from "@/app/api/v1/activity-reviews/[id]/destruction/route";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw Error("Isolated test database required");
const users: Record<string, string> = {}, cookies: Record<string, string> = {}, actors: Record<string, Context> = {};
const password = "Activity-retention!123"; let tenantId: string, serviceId: string, eventId: string;
function req(path: string, who = "owner", input?: unknown, key = randomUUID()) { return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie: cookies[who] ?? "", ...(input ? { "content-type": "application/json", "idempotency-key": key } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }); }
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const who of ["owner", "recipient", "stranger"]) {
    const email = `review-retention-${who}@example.test`; expect((await auth.handler(req("/auth/sign-up/email", who, { email, password, name: "보유 " + who }))).status).toBe(200);
    users[who] = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  }
});
beforeEach(async () => {
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "보유 회사", publicName: "보유", services: { create: { name: "보유 서비스", externalName: "보유" } } }, include: { services: true } });
  tenantId = company.id; serviceId = company.services[0].id;
  await db.securityPolicy.create({ data: { tenantId, activityReviewRetentionDays: 30 } });
  for (const who of ["owner", "recipient", "stranger"]) {
    await db.membership.create({ data: { tenantId, userId: users[who], role: who === "owner" ? "owner" : "viewer" } });
    const login = await auth.handler(req("/auth/sign-in/email", who, { email: `review-retention-${who}@example.test`, password })); expect(login.status).toBe(200);
    cookies[who] = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const session = await db.session.findFirstOrThrow({ where: { userId: users[who] }, orderBy: { createdAt: "desc" } });
    await db.session.update({ where: { id: session.id }, data: { activeCompanyId: tenantId } });
    actors[who] = await requireContext(req("/context", who).headers, "service.read");
  }
  eventId = (await db.auditEvent.create({ data: { tenantId, serviceId, actorId: users.recipient, action: "submission.read", resource: "submission", resourceId: randomUUID(), requestId: randomUUID(), detail: {} } })).id;
});
afterAll(async () => { await db.$disconnect(); });
const input = () => ({ auditEventId: eventId, title: "열람 사유 확인", message: "보유 기한 검증용 개인정보 검토 메시지입니다." });
const create = () => createActivityReview(actors.owner, input(), randomUUID(), randomUUID());
async function close(id: string) {
  await actOnActivityReview(actors.recipient, id, { version: 1, action: "response", message: "답변" }, randomUUID(), randomUUID());
  await actOnActivityReview(actors.owner, id, { version: 2, action: "resolve", message: "처리 완료" }, randomUUID(), randomUUID());
}
async function setRetention(days: number | null) {
  const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId } });
  return updatePolicy(actors.owner, policy.version, { ...policyDefaults, activityReviewRetentionDays: days }, randomUUID());
}

test("종결 시 회사 보유 기한이 스냅샷되고 기한 경과 후 sweep이 파기 승인 대기로 전환한다", async () => {
  const { body: { id } } = await create(); await close(id);
  const row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("resolved"); expect(row.destructionStatus).toBe("none");
  expect(row.retentionUntil!.getTime()).toBeCloseTo(row.closedAt!.getTime() + 30 * 86400000, -3);
  expect(await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() - 1000))).toEqual({ pending: 0 });
  expect((await db.activityReview.findUniqueOrThrow({ where: { id } })).destructionStatus).toBe("none");
  expect(await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1))).toEqual({ pending: 1 });
  const swept = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(swept.destructionStatus).toBe("awaiting"); expect(swept.retentionUntil).not.toBeNull();
  expect(await db.auditEvent.count({ where: { tenantId, action: "activity_review.destruction_pending", resourceId: id } })).toBe(1);
  expect((await readActivityReview(actors.owner, id)).canDecideDestruction).toBe(true);
  expect((await readActivityReview(actors.recipient, id)).canDecideDestruction).toBe(false);
});

test("보유 기한 미지정 정책에서는 종결 시 기한이 기록되지 않고 sweep도 변경하지 않는다", async () => {
  await setRetention(null);
  const { body: { id } } = await create(); await close(id);
  const row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.retentionUntil).toBeNull(); expect(row.destructionStatus).toBe("none");
  await db.activityReview.update({ where: { id }, data: { retentionUntil: new Date(Date.now() - 1000), version: row.version + 1 } });
  expect(await sweepActivityReviewRetention()).toEqual({ pending: 0 });
  expect((await db.activityReview.findUniqueOrThrow({ where: { id } })).destructionStatus).toBe("none");
});

test("파기 승인은 메시지 원문만 삭제하고 검토 이력·승인자·감사를 보존한다", async () => {
  const { body: { id } } = await create(); await close(id);
  const row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1));
  const before = await db.activityReview.count({ where: { tenantId } });
  const awaiting = await db.activityReview.findUniqueOrThrow({ where: { id } });
  const result = await destructionRoute(req(`/activity-reviews/${id}/destruction`, "owner", { version: awaiting.version, action: "destroy" }));
  expect(result.status).toBe(200);
  const stored = await db.activityReview.findUniqueOrThrow({ where: { id }, include: { destroyApprover: true } });
  expect(stored.destructionStatus).toBe("destroyed"); expect(stored.destroyedAt).not.toBeNull(); expect(stored.destroyApproverId).toBe(actors.owner.member.id);
  expect(await db.activityReview.count({ where: { tenantId } })).toBe(before);
  expect(await db.activityReviewMessage.count({ where: { reviewId: id } })).toBe(0);
  const detail = await readActivityReview(actors.owner, id);
  expect(detail.messages).toHaveLength(0); expect(detail.canDecideDestruction).toBe(false);
  expect(await db.auditEvent.count({ where: { tenantId, action: "activity_review.destroyed", resourceId: id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId, action: { startsWith: "activity_review." } } })).toBe(5);
});

test("보존 처리는 종료 상태로 남고 이후 sweep과 정책 변경도 무시한다", async () => {
  const { body: { id } } = await create(); await close(id);
  let row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1));
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await decideActivityReviewDestruction(actors.owner, id, { version: row.version, action: "keep" }, randomUUID(), randomUUID());
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("kept"); expect(row.destroyedAt).toBeNull();
  await expect(decideActivityReviewDestruction(actors.owner, id, { version: row.version, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, code: "INVALID_DESTRUCTION_TRANSITION" });
  await setRetention(1);
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("kept"); expect(row.retentionUntil!.getTime()).toBeCloseTo(row.closedAt!.getTime() + 30 * 86400000, -3);
  expect(await db.activityReviewMessage.count({ where: { reviewId: id } })).toBe(3);
  await expect(db.activityReview.update({ where: { id }, data: { destructionStatus: "none", version: row.version + 1 } })).rejects.toThrow();
});

test("권한·버전·상태·회사 격리를 검사한다", async () => {
  const { body: { id } } = await create(); await close(id);
  const row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await expect(decideActivityReviewDestruction(actors.owner, id, { version: row.version, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, code: "INVALID_DESTRUCTION_TRANSITION" });
  await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1));
  const awaiting = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await expect(decideActivityReviewDestruction(actors.recipient, id, { version: awaiting.version, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  await expect(decideActivityReviewDestruction(actors.owner, id, { version: awaiting.version + 9, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  await expect(decideActivityReviewDestruction(actors.stranger, id, { version: awaiting.version, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  await expect(decideActivityReviewDestruction(actors.owner, randomUUID(), { version: 1, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  const other = await db.company.create({ data: { name: "타회사", publicName: "타회사", memberships: { create: { userId: users.owner, role: "owner" } } } });
  await db.session.update({ where: { id: actors.owner.session.id }, data: { activeCompanyId: other.id } });
  const ctx = await requireContext(req("/context", "owner").headers, "service.read");
  await expect(decideActivityReviewDestruction(ctx, id, { version: awaiting.version, action: "destroy" }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  expect((await db.activityReview.findUniqueOrThrow({ where: { id } })).destructionStatus).toBe("awaiting");
  expect(await db.activityReviewMessage.count({ where: { reviewId: id } })).toBe(3);
});

test("동시 파기 승인은 한 번만 성공하고 같은 키 재시도는 같은 응답을 돌려준다", async () => {
  const { body: { id } } = await create(); await close(id);
  const row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1));
  const awaiting = await db.activityReview.findUniqueOrThrow({ where: { id } });
  const inputD = { version: awaiting.version, action: "destroy" as const };
  const first = await decideActivityReviewDestruction(actors.owner, id, inputD, "same-destruction-key-0001", randomUUID());
  expect((await decideActivityReviewDestruction(actors.owner, id, inputD, "same-destruction-key-0001", randomUUID())).body).toEqual(first.body);
  await expect(decideActivityReviewDestruction(actors.owner, id, { ...inputD, action: "keep" }, "same-destruction-key-0001", randomUUID())).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_MISMATCH" });
  const { body: { id: second } } = await create(); await close(second);
  const secondRow = await db.activityReview.findUniqueOrThrow({ where: { id: second } });
  await sweepActivityReviewRetention(new Date(secondRow.retentionUntil!.getTime() + 1));
  const secondAwaiting = await db.activityReview.findUniqueOrThrow({ where: { id: second } });
  const race = await Promise.allSettled([
    decideActivityReviewDestruction(actors.owner, second, { version: secondAwaiting.version, action: "destroy" }, randomUUID(), randomUUID()),
    decideActivityReviewDestruction(actors.owner, second, { version: secondAwaiting.version, action: "keep" }, randomUUID(), randomUUID())]);
  expect(race.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const stored = await db.activityReview.findUniqueOrThrow({ where: { id: second } });
  expect(["destroyed", "kept"]).toContain(stored.destructionStatus);
});

test("정책 변경은 종결 검토의 남은 기한을 재계산하고 해제 시 대기도 되돌린다", async () => {
  const { body: { id } } = await create(); await close(id);
  await setRetention(7);
  let row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.retentionUntil!.getTime()).toBeCloseTo(row.closedAt!.getTime() + 7 * 86400000, -3);
  await sweepActivityReviewRetention(new Date(row.retentionUntil!.getTime() + 1));
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("awaiting");
  await db.activityReview.update({ where: { id }, data: { retentionUntil: new Date(Date.now() + 86400000), version: row.version + 1 } });
  await setRetention(36500);
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("none");
  await db.activityReview.update({ where: { id }, data: { retentionUntil: new Date(Date.now() - 1000), version: row.version + 1 } });
  await sweepActivityReviewRetention();
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("awaiting");
  await setRetention(null);
  row = await db.activityReview.findUniqueOrThrow({ where: { id } });
  expect(row.destructionStatus).toBe("none"); expect(row.retentionUntil).toBeNull();
});

test("승인 트랜잭션 밖의 메시지 삭제와 진행 중 검토의 파기 필드 변경을 거부한다", async () => {
  const { body: { id } } = await create();
  await expect(db.activityReviewMessage.deleteMany({ where: { reviewId: id } })).rejects.toThrow();
  await expect(db.activityReview.update({ where: { id }, data: { destructionStatus: "awaiting", version: 2 } })).rejects.toThrow();
  await expect(db.activityReview.update({ where: { id }, data: { destructionStatus: "destroyed", destroyedAt: new Date(), destroyApproverId: actors.owner.member.id, version: 2 } })).rejects.toThrow();
  await db.activityReviewMessage.deleteMany({ where: { reviewId: randomUUID() } });
});

beforeSecurityCase(grantSecurityTestTrials);
