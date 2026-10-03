import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { json, route } from "@/server/http";
export const GET = route(async request => {
  const actor = await requireActor(request.headers);
  const sessions = await db.session.findMany({ where: { userId: actor.user.id, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, userAgent: true },
    orderBy: { updatedAt: "desc" } });
  return json({ items: sessions.map(session => ({ ...session, current: session.id === actor.session.id })) });
});
