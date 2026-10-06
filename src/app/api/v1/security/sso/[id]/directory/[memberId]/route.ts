import { z } from "zod";
import { orgMemberRemove } from "@/contracts/sso";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { removeOrgMember } from "@/server/org-auth";

const idsOf = (request: Request) => {
  const parts = new URL(request.url).pathname.split("/");
  return { providerId: z.uuid().parse(parts[5]), memberId: z.uuid().parse(parts[7]) };
};
export const DELETE = route(async (request, requestId) => {
  const { providerId, memberId } = idsOf(request);
  return json(await removeOrgMember(await requireContext(request.headers, "security.write"),
    providerId, memberId, (await body(request, orgMemberRemove)).version, requestId));
});
