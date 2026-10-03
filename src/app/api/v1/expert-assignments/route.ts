import { z } from "zod";
import { requireActor } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { createExpertAssignment, createExpertInput, listExpertAssignments } from "@/server/expert-assignments";

const query = listQuery.pick({ page: true, pageSize: true, search: true }).extend({ scope: z.enum(["mine", "admin"]).default("mine") });
export const GET = route(async request => json(await listExpertAssignments(await requireActor(request.headers),
  query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const result = await createExpertAssignment(await requireActor(request.headers), await body(request, createExpertInput), requestId);
  return json(result.body, result.status);
});
