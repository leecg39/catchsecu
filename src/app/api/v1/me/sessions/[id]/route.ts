import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { fail, route } from "@/server/http";
import { lockAccountActor } from "@/server/account-actor";
import { assertFileDeadlines } from "@/server/file-access";
export const DELETE = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const id = new URL(request.url).pathname.split("/").pop();
  await db.$transaction(async tx => {
    // Serialize mutually revoking sessions before either actor session is locked.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.user.id} FOR UPDATE`;
    const current = await lockAccountActor(tx, actor);
    const result = await tx.session.deleteMany({ where: { id, userId: actor.user.id } });
    if (!result.count) fail(404, "NOT_FOUND", "세션을 찾을 수 없습니다.");
    await tx.auditEvent.create({ data: { tenantId: current.session.activeCompanyId, actorId: actor.user.id, action: "session.revoked", resource: "session",
      resourceId: id, requestId, detail: {} } });
    assertFileDeadlines(current.deadlines);
  });
  return new Response(null, { status: 204 });
});
