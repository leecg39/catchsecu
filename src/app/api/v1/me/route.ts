import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { profilePatch } from "@/server/schemas";
const select = { id: true, name: true, email: true, phone: true, department: true, jobTitle: true, locale: true, version: true, twoFactorEnabled: true, createdAt: true } as const;
export const GET = route(async request => {
  const actor = await requireActor(request.headers);
  return json(await db.user.findUniqueOrThrow({ where: { id: actor.user.id }, select }));
});
export const PATCH = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const { version, ...data } = await body(request, profilePatch);
  const user = await db.$transaction(async tx => {
    const result = await tx.user.updateMany({ where: { id: actor.user.id, version }, data: { ...data, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "프로필이 변경되었습니다. 새로 불러와주세요.");
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "profile.updated", resource: "user",
      resourceId: actor.user.id, requestId, detail: { changedFields: Object.keys(data) } } });
    return tx.user.findUniqueOrThrow({ where: { id: actor.user.id }, select });
  });
  return json(user);
});
