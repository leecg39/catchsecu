import { publicDocument } from "@/server/documents";
import { tokenHash } from "@/server/crypto";
import { json, rateLimit, route } from "@/server/http";
export const GET = route(async request => {
  const token = new URL(request.url).pathname.split("/").pop() ?? "";
  await rateLimit("document:" + tokenHash(token), 120);
  const response = json(await publicDocument(token)); response.headers.set("Referrer-Policy", "no-referrer"); response.headers.set("X-Robots-Tag", "noindex, nofollow"); return response;
});
