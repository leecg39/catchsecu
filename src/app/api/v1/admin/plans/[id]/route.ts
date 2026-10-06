import { z } from "zod";
import { adminPlanPatch } from "@/contracts/admin-plans";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { archiveAdminPlan, readAdminPlan, updateAdminPlan } from "@/server/admin-plans";

const planId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const id = (request: Request) => planId.parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async request => json(await readAdminPlan(await requireActor(request.headers), id(request))));
export const PATCH = route(async (request, requestId) =>
  json(await updateAdminPlan(await requireActor(request.headers), id(request), await body(request, adminPlanPatch), requestId)));
export const DELETE = route(async (request, requestId) => {
  await archiveAdminPlan(await requireActor(request.headers), id(request), requestId);
  return new Response(null, { status: 204 });
});
