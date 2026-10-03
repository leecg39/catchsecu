import { db } from "@/server/db";
import { route, json } from "@/server/http";
export const runtime = "nodejs";
export const GET = route(async () => {
  await db.$queryRaw`SELECT 1`;
  return json({ status: "ok", database: "ready" });
});
