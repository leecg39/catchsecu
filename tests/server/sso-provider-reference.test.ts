import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "ApiRateLimit" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });
async function fixture() {
  const user = await db.user.create({ data: { name: "참조 검사", email: randomUUID() + "@catchsecu.test", emailVerified: true } });
  const company = await db.company.create({ data: { name: "참조 회사", publicName: "참조 회사" } });
  const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "참조 SSO", issuer: "https://idp.example.test",
    clientId: "qa", tokenUrl: "https://idp.example.test/token", jwksUrl: "https://idp.example.test/jwks", authorizationUrl: "https://idp.example.test/authorize" } });
  return { user, company, provider };
}
test("SSO DB 참조: 존재하지 않는 공급자 계정 생성 거부", async () => {
  const f = await fixture();
  await expect(db.account.create({ data: { userId: f.user.id, providerId: "sso:" + randomUUID(), accountId: "missing" } })).rejects.toMatchObject({ code: "P2003" });
});
test("SSO DB 참조: 연결 계정이 있는 공급자의 직접 삭제 거부", async () => {
  const f = await fixture();
  await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "linked" } });
  await expect(db.ssoProvider.delete({ where: { id: f.provider.id } })).rejects.toMatchObject({ code: "P2003" });
});
test("SSO DB 참조: 기존 providerId 쓰기로 FK를 채우고 위조 참조는 무시", async () => {
  const f = await fixture();
  const row = await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "linked" } });
  expect(row.ssoProviderId).toBe(f.provider.id);
  const changed = await db.account.update({ where: { id: row.id }, data: { ssoProviderId: randomUUID() } });
  expect(changed.ssoProviderId).toBe(f.provider.id);
  expect((await db.account.update({ where: { id: row.id }, data: { ssoProviderId: null } })).ssoProviderId).toBe(f.provider.id);
  expect((await db.account.findUniqueOrThrow({ where: { id: row.id }, include: { ssoProvider: true } })).ssoProvider?.tenantId).toBe(f.company.id);
});
test("SSO DB 참조: 비 SSO 계정은 공급자 FK 없이 유지", async () => {
  const f = await fixture();
  for (const providerId of ["credential", "google"]) {
    const account = await db.account.create({ data: { userId: f.user.id, providerId, accountId: providerId, ssoProviderId: f.provider.id } });
    expect(account.ssoProviderId).toBeNull();
  }
  await db.ssoProvider.delete({ where: { id: f.provider.id } });
  expect(await db.account.count({ where: { userId: f.user.id } })).toBe(2);
});
test("SSO DB 참조: 존재하지 않는 공급자로 변경 및 참조 중 ID 변경 거부", async () => {
  const f = await fixture();
  const row = await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "linked" } });
  await expect(db.account.update({ where: { id: row.id }, data: { providerId: "sso:" + randomUUID() } })).rejects.toMatchObject({ code: "P2003" });
  await expect(db.ssoProvider.update({ where: { id: f.provider.id }, data: { id: randomUUID() } })).rejects.toMatchObject({ code: "P2003" });
  expect((await db.account.findUniqueOrThrow({ where: { id: row.id } })).ssoProviderId).toBe(f.provider.id);
});
test("SSO DB 참조: 계정 제거 후 공급자 삭제 허용, 일반 계정 보존", async () => {
  const f = await fixture();
  const row = await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "linked" } });
  const credential = await db.account.create({ data: { userId: f.user.id, providerId: "credential", accountId: f.user.id } });
  await db.$transaction(async tx => { await tx.account.delete({ where: { id: row.id } }); await tx.ssoProvider.delete({ where: { id: f.provider.id } }); });
  expect(await db.account.findUnique({ where: { id: credential.id } })).not.toBeNull();
});
test("SSO DB 참조: 계정 INSERT와 공급자 DELETE 경합에서도 고아 계정 없음", async () => {
  const f = await fixture();
  let signal!: () => void, release!: () => void;
  const inserted = new Promise<void>(resolve => { signal = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const writing = db.$transaction(async tx => {
    await tx.account.create({ data: { userId: f.user.id, providerId: "sso:" + f.provider.id, accountId: "concurrent" } });
    signal(); await gate;
  });
  await inserted;
  try {
    await expect(db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
      await tx.$executeRaw`DELETE FROM "SsoProvider" WHERE id=${f.provider.id}`;
    })).rejects.toMatchObject({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "55P03" } } } });
  } finally { release(); await writing; }
  await expect(db.ssoProvider.delete({ where: { id: f.provider.id } })).rejects.toMatchObject({ code: "P2003" });
  const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "Account" a LEFT JOIN "SsoProvider" p ON p.id=a."ssoProviderId"
    WHERE left(a."providerId",4)='sso:' AND p.id IS NULL`;
  expect(Number(rows[0].count)).toBe(0);
});
