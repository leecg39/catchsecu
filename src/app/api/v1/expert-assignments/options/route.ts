import { z } from "zod";
import { requireActor } from "@/server/context";
import { expertOptions } from "@/server/expert-assignments";
import { json, route } from "@/server/http";

const query = z.object({ companyId: z.uuid().optional(), search: z.string().max(100).default("") });
export const GET = route(async request => json(await expertOptions(await requireActor(request.headers),
  query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
