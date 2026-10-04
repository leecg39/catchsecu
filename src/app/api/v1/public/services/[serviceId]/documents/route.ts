import { z } from "zod";
import { json, route } from "@/server/http";
import { listPublicServiceDocuments } from "@/server/public-service-documents";

export const GET = route(async request => {
  const url = new URL(request.url);
  const serviceId = z.uuid().parse(url.pathname.split("/")[5]);
  const response = json(await listPublicServiceDocuments(serviceId, Object.fromEntries(url.searchParams)));
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
});
