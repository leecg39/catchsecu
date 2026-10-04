import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { profilePatch } from "@/server/schemas";
import { lockAccountActor } from "@/server/account-actor";
import { assertFileDeadlines } from "@/server/file-access";
import { audit } from "@/server/audit";
const select = { id: true, name: true, email: true, phone: true, department: true, jobTitle: true, locale: true, version: true, twoFactorEnabled: true, createdAt: true } as const;
export const GET = route(async request => {
  const actor = await requireActor(request.headers);
  return json(await db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const profile = await tx.user.findUniqueOrThrow({ where: { id: current.user.id }, select });
    assertFileDeadlines(current.deadlines);
    return profile;
  }));
});
export const PATCH = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const { version, ...data } = await body(request, profilePatch);
  const user = await db.$transaction(async tx => {
    // Serialize profile writes before taking the shared actor lock; two writers
    // must not both hold a shared User lock and then wait to upgrade it.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.user.id} FOR UPDATE`;
    const current = await lockAccountActor(tx, actor);
    const result = await tx.user.updateMany({ where: { id: actor.user.id, version }, data: { ...data, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "프로필이 변경되었습니다. 새로 불러와주세요.");
    await audit(tx, { tenantId: null, user: current.user }, requestId, "profile.updated", "user", current.user.id, Object.keys(data));
    const profile = await tx.user.findUniqueOrThrow({ where: { id: current.user.id }, select });
    assertFileDeadlines(current.deadlines);
    return profile;
  });
  return json(user);
});
