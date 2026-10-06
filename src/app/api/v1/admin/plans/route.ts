import { adminPlanCreate } from "@/contracts/admin-plans";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createAdminPlan, listAdminPlans } from "@/server/admin-plans";

export const GET = route(async request => json(await listAdminPlans(await requireActor(request.headers))));
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const result = await createAdminPlan(actor, await body(request, adminPlanCreate), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/admin/plans/" + result.body.id);
  return response;
});
