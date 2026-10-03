import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, listQuery, route } from "@/server/http";
import { formDocumentOptions } from "@/server/form-documents";
const querySchema = listQuery.pick({ page: true, pageSize: true, search: true }).extend({ serviceId: z.uuid() }).strict();
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await formDocumentOptions(ctx, query.serviceId, query));
});
