import { z } from "zod";
import { requireContext } from "@/server/context";
import { fail, json, route } from "@/server/http";
import { readCertificate } from "@/server/destruction";
export const GET = route(async (request, requestId) => {
  const [rawId, action, ...extra] = new URL(request.url).pathname.split("/").slice(4);
  if (extra.length || (action && action !== "download")) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const certificate = await readCertificate(await requireContext(request.headers, "audit.read"), z.uuid().parse(rawId), requestId);
  if (!certificate.integrityVerified) fail(409, "CERTIFICATE_INTEGRITY", "증명서 무결성을 확인하지 못했습니다.");
  if (!action) return json(certificate);
  return new Response(JSON.stringify(certificate, null, 2), { headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="destruction-' + certificate.id + '.json"',
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  } });
});
