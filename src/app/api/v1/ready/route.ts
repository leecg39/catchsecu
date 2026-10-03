import { db } from "@/server/db";
import { json, route } from "@/server/http";

export const runtime = "nodejs";
export const GET = route(async () => {
  const rows = await db.$queryRaw<{ ready: boolean }[]>`SELECT EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ready`;
  if (!rows[0]?.ready) return json({ status: "unavailable" }, 503);
  return json({ status: "ready" });
});
