import { z } from "zod";
import { senderCreate, senderEvidenceInput, senderList, senderPatch, senderVersion } from "@/contracts/senders";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { changeSenderEvidence, checkSenderProof, confirmSenderEmail, createSender, initSenderEvidence, listSenders, readSender, senderAction, startDnsVerification, startEmailVerification, updateSender } from "@/server/senders";
import { downloadFile } from "@/server/file-download";
const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
export const GET = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "sender.read"), s = parts(request);
  if (!s.length) return json(await listSenders(ctx, senderList.parse(Object.fromEntries(new URL(request.url).searchParams)), requestId));
  const id = z.uuid().parse(s[0]);
  if (s.length === 1) return json(await readSender(ctx, id, requestId));
  if (s.length === 4 && s[1] === "evidence" && s[3] === "download") return downloadFile(ctx, z.uuid().parse(s[2]), { senderId: id }, requestId);
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "sender.manage"), s = parts(request);
  if (!s.length) { const result = await createSender(ctx, await body(request, senderCreate), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  const id = z.uuid().parse(s[0]), action = s[1];
  await rateLimit("sender:change:" + ctx.member.id + ":" + id, 30);
  if (s.length === 2 && action === "evidence") { const result = await initSenderEvidence(ctx, id, await body(request, senderEvidenceInput), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  if (s.length === 4 && action === "evidence" && s[3] === "attach") { const v = await body(request, senderVersion); return json(await changeSenderEvidence(ctx, id, z.uuid().parse(s[2]), v.version, false, requestId)); }
  if (s.length === 2 && action === "confirm-email") return json(await confirmSenderEmail(ctx, id, await body(request, senderVersion.extend({ verificationId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict()), requestId));
  if (s.length !== 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const { version } = await body(request, senderVersion);
  if (action === "request-email") return json(await startEmailVerification(ctx, id, version, requestId), 202);
  if (action === "dns") return json(await startDnsVerification(ctx, id, version, requestId), 201);
  if (action === "check") return json(await checkSenderProof(ctx, id, version, requestId));
  if (action === "default" || action === "disable" || action === "renew") return json(await senderAction(ctx, id, version, action, requestId));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const s = parts(request); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateSender(await requireContext(request.headers, "sender.manage"), z.uuid().parse(s[0]), await body(request, senderPatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "sender.manage"), s = parts(request), id = z.uuid().parse(s[0]), { version } = await body(request, senderVersion);
  if (s.length === 1) return json(await senderAction(ctx, id, version, "delete", requestId));
  if (s.length === 3 && s[1] === "evidence") return json(await changeSenderEvidence(ctx, id, z.uuid().parse(s[2]), version, true, requestId));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
