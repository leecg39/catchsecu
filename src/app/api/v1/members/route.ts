import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, listQuery, route } from "@/server/http";
import { listMembers } from "@/server/members";
const query = listQuery.extend({ status: z.enum(["active", "suspended", "revoked", "all"]).optional() });
export const GET = route(async request => json(await listMembers(await requireContext(request.headers, "member.manage"),
  query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
