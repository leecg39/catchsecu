import { z } from "zod";
import { route } from "@/server/http";
import { startSso } from "@/server/sso";

export const GET = route(async request => {
  const url = new URL(request.url);
  const providerId = z.uuid().parse(url.pathname.split("/")[5]);
  const mode = z.enum(["login", "link", "invite"]).default("login").parse(url.searchParams.get("mode") ?? "login");
  const invitationId = url.searchParams.get("invitation") ?? undefined;
  const { redirect } = await startSso(providerId, mode, request.headers, invitationId);
  return new Response(null, { status: 302, headers: { location: redirect } });
});
