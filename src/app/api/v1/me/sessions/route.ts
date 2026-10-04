import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { json, route } from "@/server/http";
import { lockAccountActor } from "@/server/account-actor";
import { assertFileDeadlines } from "@/server/file-access";
export const GET = route(async request => {
  const actor = await requireActor(request.headers);
  return json(await db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const sessions = await tx.session.findMany({ where: { userId: actor.user.id, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, userAgent: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
    assertFileDeadlines(current.deadlines);
    return { items: sessions.map(session => ({ ...session, current: session.id === current.session.id })) };
  }));
});
