import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { documentOptions } from "@/server/documents";
export const GET = route(async request => json(await documentOptions(await requireContext(request.headers, "document.read"), z.uuid().parse(new URL(request.url).searchParams.get("serviceId")))));
