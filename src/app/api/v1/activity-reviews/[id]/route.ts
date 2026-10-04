import { z } from "zod";
import { readActivityReview } from "@/server/activity-reviews";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
export const GET = route(async request => json(await readActivityReview(await requireContext(request.headers, "service.read"), z.uuid().parse(new URL(request.url).pathname.split("/")[4]))));
