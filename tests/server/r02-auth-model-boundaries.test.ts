import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("R02 authentication model tests require the isolated catchsecu_test database");

const marker = "r02-model-" + randomUUID();
async function user(sequence: string) {
  return db.user.create({ data: {
    id: randomUUID(), name: "R02 모델 " + sequence,
    email: `${marker}-${sequence}@example.test`, emailVerified: true,
  } });
}

const clean = () => db.$executeRawUnsafe(
  'TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE',
);
beforeAll(clean);
afterAll(async () => { await clean(); await db.$disconnect(); });

describe("R02-T01 authentication model boundaries", () => {
  test("normalized email and credential identities remain unique", async () => {
    const first = await user("identity-a");
    await expect(db.user.create({ data: {
      id: randomUUID(), name: "대문자 거부", email: `${marker}-UPPER@example.test`, emailVerified: true,
    } })).rejects.toThrow();
    await expect(db.user.create({ data: {
      id: randomUUID(), name: "중복 거부", email: first.email, emailVerified: true,
    } })).rejects.toThrow();

    await db.account.create({ data: { userId: first.id, providerId: "credential", accountId: first.id, password: "hash-0" } });
    await expect(db.account.create({ data: {
      userId: first.id, providerId: "credential", accountId: randomUUID(), password: "hash-other",
    } })).rejects.toThrow();

    const second = await user("identity-b");
    await expect(db.account.create({ data: {
      userId: second.id, providerId: "credential", accountId: first.id, password: "hash-second",
    } })).rejects.toThrow();
  });

  test("verification consumption is atomic and expired proofs cannot be consumed", async () => {
    const valid = await db.verification.create({ data: {
      identifier: marker + ":valid", value: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    const consumed = await Promise.all([
      db.verification.deleteMany({ where: { id: valid.id, expiresAt: { gt: new Date() } } }),
      db.verification.deleteMany({ where: { id: valid.id, expiresAt: { gt: new Date() } } }),
    ]);
    expect(consumed.map(item => item.count).sort()).toEqual([0, 1]);
    expect(await db.verification.findUnique({ where: { id: valid.id } })).toBeNull();

    const expired = await db.verification.create({ data: {
      identifier: marker + ":expired", value: randomUUID(), expiresAt: new Date(Date.now() - 1),
    } });
    expect((await db.verification.deleteMany({ where: { id: expired.id, expiresAt: { gt: new Date() } } })).count).toBe(0);
    expect(await db.verification.findUnique({ where: { id: expired.id } })).not.toBeNull();
    await db.verification.delete({ where: { id: expired.id } });
  });

  test("password deferral enforces membership scope, mode, positive revision and one row per member", async () => {
    const first = await user("deferral-a"), second = await user("deferral-b");
    const company = await db.company.create({ data: {
      name: marker + " company", publicName: "R02 model",
      memberships: { create: { userId: first.id, role: "owner" } }, policy: { create: {} },
    }, include: { memberships: true } });
    const member = company.memberships[0];
    const base = {
      tenantId: company.id, memberId: member.id, userId: first.id,
      passwordChangedAt: new Date(), passwordRevision: 1, expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(db.passwordDeferral.create({ data: { ...base, userId: second.id, mode: "period" } })).rejects.toThrow();
    await expect(db.passwordDeferral.create({ data: { ...base, mode: "session", sessionId: null } })).rejects.toThrow();
    await expect(db.passwordDeferral.create({ data: { ...base, mode: "period", sessionId: randomUUID() } })).rejects.toThrow();
    await expect(db.passwordDeferral.create({ data: { ...base, mode: "period", passwordRevision: 0 } })).rejects.toThrow();

    await db.passwordDeferral.create({ data: { ...base, mode: "period" } });
    await expect(db.passwordDeferral.create({ data: { ...base, id: randomUUID(), mode: "period" } })).rejects.toThrow();
  });

  test("credential change atomically records history, clears proofs and deferrals, and revokes every session", async () => {
    const accountUser = await user("credential-change");
    const company = await db.company.create({ data: {
      name: marker + " credential company", publicName: "R02 credential",
      memberships: { create: { userId: accountUser.id, role: "owner" } }, policy: { create: {} },
    }, include: { memberships: true } });
    const account = await db.account.create({ data: {
      userId: accountUser.id, providerId: "credential", accountId: accountUser.id, password: "hash-before",
    } });
    const sessions = await Promise.all([0, 1].map(() => db.session.create({ data: {
      userId: accountUser.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000), activeCompanyId: company.id,
    } })));
    await db.verification.create({ data: {
      identifier: marker + ":reset", value: accountUser.id, expiresAt: new Date(Date.now() + 60_000),
    } });
    await db.passwordDeferral.create({ data: {
      tenantId: company.id, memberId: company.memberships[0].id, userId: accountUser.id,
      passwordChangedAt: new Date(), passwordRevision: 1, mode: "session", sessionId: sessions[0].id,
      expiresAt: new Date(Date.now() + 60_000),
    } });
    const requestId = randomUUID();

    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.auth_request_id', ${requestId}, true)`;
      await tx.account.update({ where: { id: account.id }, data: { password: "hash-after" } });
    });

    expect(await db.passwordHistory.findMany({ where: { userId: accountUser.id }, select: { passwordHash: true } }))
      .toEqual([{ passwordHash: "hash-before" }]);
    expect(await db.session.count({ where: { userId: accountUser.id } })).toBe(0);
    expect(await db.verification.count({ where: { value: accountUser.id } })).toBe(0);
    expect(await db.passwordDeferral.count({ where: { userId: accountUser.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: accountUser.id } })).passwordChangedAt).not.toBeNull();
    const events = await db.auditEvent.findMany({ where: { actorId: accountUser.id, requestId }, orderBy: { action: "asc" } });
    expect(events.map(item => item.action)).toEqual(["password.changed", "session.ended", "session.ended"]);
    expect(events.filter(item => item.action === "session.ended").map(item => item.resourceId).sort())
      .toEqual(sessions.map(item => item.id).sort());
  });

  test("credential history retains the latest nine prior hashes", async () => {
    const accountUser = await user("history");
    const account = await db.account.create({ data: {
      userId: accountUser.id, providerId: "credential", accountId: accountUser.id, password: "hash-0",
    } });
    for (let index = 1; index <= 11; index += 1)
      await db.account.update({ where: { id: account.id }, data: { password: `hash-${index}` } });
    const history = await db.passwordHistory.findMany({
      where: { userId: accountUser.id }, orderBy: { id: "asc" }, select: { passwordHash: true },
    });
    expect(history.map(item => item.passwordHash)).toEqual(Array.from({ length: 9 }, (_, index) => `hash-${index + 2}`));
  });

  test("audit immutability blocks direct account deletion so R05 must use a state transition", async () => {
    const deleted = await user("delete-cascade");
    await db.account.create({ data: { userId: deleted.id, providerId: "credential", accountId: deleted.id, password: "hash" } });
    await db.session.create({ data: { userId: deleted.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    await db.twoFactor.create({ data: { userId: deleted.id, secret: "encrypted-secret", backupCodes: "encrypted-codes" } });
    await db.passwordHistory.create({ data: { userId: deleted.id, passwordHash: "older-hash" } });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { actorId: deleted.id, action: "password.created" } });

    await expect(db.user.delete({ where: { id: deleted.id } })).rejects.toThrow(/Audit events are immutable/);

    expect(await db.account.count({ where: { userId: deleted.id } })).toBe(1);
    expect(await db.session.count({ where: { userId: deleted.id } })).toBe(1);
    expect(await db.twoFactor.count({ where: { userId: deleted.id } })).toBe(1);
    expect(await db.passwordHistory.count({ where: { userId: deleted.id } })).toBe(1);
    expect((await db.auditEvent.findUniqueOrThrow({ where: { id: audit.id } })).actorId).toBe(deleted.id);
  });
});
