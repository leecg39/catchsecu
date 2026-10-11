import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt, encrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("R05 model tests require the isolated local test database.");

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

async function user() {
  return db.user.create({ data: { name: "모델 검증", email: randomUUID() + "@example.test", emailVerified: true } });
}

test("폐쇄 기록은 사용자당 하나이며 수정·삭제·사용자 삭제에도 사유와 시각을 보존한다", async () => {
  const actor = await user();
  await db.user.update({ where: { id: actor.id }, data: { status: "closed", version: 2 } });
  const reason = "시험 계정 정리 사유";
  const closure = await db.accountClosure.create({ data: { userId: actor.id, reasonCipher: encrypt(reason) } });
  expect(closure.reasonCipher).not.toContain(reason);
  expect(decrypt<string>(closure.reasonCipher!)).toBe(reason);
  await expect(db.accountClosure.create({ data: { userId: actor.id } })).rejects.toMatchObject({ code: "P2002" });
  await expect(db.accountClosure.update({ where: { id: closure.id }, data: { reasonCipher: encrypt("변경") } })).rejects.toThrow();
  await expect(db.accountClosure.delete({ where: { id: closure.id } })).rejects.toThrow();
  await expect(db.user.delete({ where: { id: actor.id } })).rejects.toThrow();
  expect(await db.accountClosure.findUniqueOrThrow({ where: { id: closure.id } })).toEqual(closure);
});

test("폐쇄 완료 시각 역전과 존재하지 않는 사용자 참조를 PostgreSQL이 거부한다", async () => {
  const actor = await user();
  const requestedAt = new Date();
  await expect(db.accountClosure.create({ data: { userId: actor.id, requestedAt, completedAt: new Date(requestedAt.getTime() - 1) } })).rejects.toThrow();
  await expect(db.accountClosure.create({ data: { userId: randomUUID() } })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.accountClosure.count()).toBe(0);
});

test("폐쇄 계정은 재활성화·새 세션·새 활성 소속을 만들 수 없고 기존 소속 이력은 남는다", async () => {
  const actor = await user();
  const company = await db.company.create({ data: { name: "계정 이력 회사", publicName: "계정 이력" } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: actor.id, role: "viewer" } });
  await db.membership.update({ where: { id: member.id }, data: { status: "revoked", version: 2 } });
  await db.user.update({ where: { id: actor.id }, data: { status: "closed", version: 2 } });
  await expect(db.user.update({ where: { id: actor.id }, data: { status: "active" } })).rejects.toThrow();
  await expect(db.session.create({ data: { userId: actor.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })).rejects.toThrow();
  await expect(db.membership.update({ where: { id: member.id }, data: { status: "active", version: 3 } })).rejects.toThrow();
  const otherCompany = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
  await expect(db.membership.create({ data: { tenantId: otherCompany.id, userId: actor.id, role: "viewer" } })).rejects.toThrow();
  expect(await db.session.count({ where: { userId: actor.id } })).toBe(0);
  expect(await db.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ status: "revoked", version: 2 });
});

test("보존 기록 갱신 실패는 같은 트랜잭션의 프로필 변경까지 롤백한다", async () => {
  const actor = await user();
  await db.user.update({ where: { id: actor.id }, data: { status: "closed", version: 2 } });
  const closure = await db.accountClosure.create({ data: { userId: actor.id } });
  await expect(db.$transaction(async tx => {
    await tx.user.update({ where: { id: actor.id }, data: { name: "반영되면 안 되는 이름", version: 3 } });
    await tx.accountClosure.update({ where: { id: closure.id }, data: { completedAt: new Date() } });
  })).rejects.toThrow();
  expect(await db.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ name: actor.name, status: "closed", version: 2 });
});
