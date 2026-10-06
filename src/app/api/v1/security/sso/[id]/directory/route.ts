import { z } from "zod";
import { orgMemberCreate } from "@/contracts/sso";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { addOrgMember, listOrgMembers } from "@/server/org-auth";

const idOf = (request: Request) => z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
export const GET = route(async request =>
  json(await listOrgMembers(await requireContext(request.headers, "security.read"), idOf(request))));
export const POST = route(async (request, requestId) => json(
  await addOrgMember(await requireContext(request.headers, "security.write"), idOf(request), await body(request, orgMemberCreate), requestId), 201));
