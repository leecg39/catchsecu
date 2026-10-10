import { json, route, rateLimit } from "@/server/http";
import { resolveFixedUrl } from "@/server/fixed-urls";
import { tokenHash } from "@/server/crypto";
export const GET = route(async request => {
  const slug = new URL(request.url).pathname.split("/").at(-1) ?? "";
  await rateLimit("fixed-url:" + tokenHash(slug), 300);
  return json(await resolveFixedUrl(slug, request.headers.get("x-participation-proof") ?? undefined));
});
