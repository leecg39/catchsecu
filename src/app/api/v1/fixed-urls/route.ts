import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createFixedUrl, fixedUrlInput, fixedUrlQuery, listFixedUrls } from "@/server/fixed-urls";
import { lockCurrentForm } from "@/server/forms";
import { idempotent } from "@/server/idempotency";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  const query = fixedUrlQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listFixedUrls(ctx, query));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.publish");
  const input = await body(request, fixedUrlInput);
  const result = await idempotent("fixed-url:create:" + ctx.member.id, request.headers.get("idempotency-key"), input, async tx => ({
    status: 201, body: await createFixedUrl(ctx, input, requestId, tx),
  }),tx => lockCurrentForm(tx,ctx,input.formId,"form.publish"));
  return json(result.body, result.status);
});
