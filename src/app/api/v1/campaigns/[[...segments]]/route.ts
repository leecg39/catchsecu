import { feedbackLabels } from "@/contracts/email-feedback";
import { z } from "zod";
import { messageTemplateApply } from "@/contracts/message-templates";
import { applyMessageTemplate } from "@/server/message-templates";
import { campaignFileInput } from "@/contracts/campaign-files";
import { initCampaignFile, changeCampaignFile } from "@/server/campaign-files";
import { downloadFile } from "@/server/file-download";
import { campaignCreate, campaignPatch, campaignTargets, campaignList, campaignSourceList, campaignVersion, campaignSchedule, campaignReschedule, campaignRetry, deliveryList, deliveryStatuses, deliveryReasons } from "@/contracts/campaigns";
import { scheduleCampaign, rescheduleCampaign, cancelCampaign, archiveCampaign, retryCampaign } from "@/server/campaign-scheduling";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { createCampaign, deleteCampaign, listCampaigns, listCampaignSources, listCampaignDeliveries, readCampaign, replaceCampaignRecipients, updateCampaign, previewCampaign } from "@/server/campaigns";
const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);
export const GET = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "message.read"), s = parts(request);
  if (!s.length) return json(await listCampaigns(ctx, campaignList.parse(query(request)), requestId));
  if (s.length === 1 && s[0] === "sources") return json(await listCampaignSources(ctx, campaignSourceList.parse(query(request)), requestId));
  const id = z.uuid().parse(s[0]);
  if (s.length === 1) return json(await readCampaign(ctx, id, requestId));
  if (s.length === 4 && s[1] === "files" && s[3] === "download") return downloadFile(ctx, z.uuid().parse(s[2]), { campaignId: id }, requestId);
  if (s.length === 2 && ["recipients", "deliveries", "export"].includes(s[1])) {
    const result = await listCampaignDeliveries(ctx, id, deliveryList.parse(query(request)), requestId, s[1] === "export");
    if (s[1] !== "export") return json(result);
    const cell = (v: unknown) => { let text = String(v ?? ""); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    const rows = [["순서", "이름", "연락처", "상태", "사유", "처리 시도", "접수 시각", "원문 삭제 시각", "수신 결과", "수신 결과 시각"], ...result.items.map(r => [r.position, r.name, r.contact, deliveryStatuses[r.status], r.reason ? deliveryReasons[r.reason] ?? r.reason : "", r.attempt, r.acceptedAt, r.erasedAt, r.feedback ? feedbackLabels[r.feedback.outcome] : "", r.feedback?.occurredAt ?? ""])];
    return new Response("\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="campaign-recipients.csv"' } });
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "message.manage"), s = parts(request);
  if (!s.length) { const result = await createCampaign(ctx, await body(request, campaignCreate), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  if (s[1] === "files") {
    const id = z.uuid().parse(s[0]); await rateLimit("campaign:files:" + ctx.member.id, 30);
    if (s.length === 2) { const result = await initCampaignFile(ctx, id, await body(request, campaignFileInput), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
    if (s.length === 4 && s[3] === "attach") return json(await changeCampaignFile(ctx, id, z.uuid().parse(s[2]), (await body(request, campaignVersion)).version, false, requestId));
  }
  if (s.length !== 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const id = z.uuid().parse(s[0]); await rateLimit("campaign:change:" + ctx.member.id + ":" + id, 30);
  if (s[1] === "apply-template") return json(await applyMessageTemplate(ctx, id, await body(request, messageTemplateApply), requestId));
  if (s[1] === "recipients") return json(await replaceCampaignRecipients(ctx, id, await body(request, campaignTargets), requestId));
  if (s[1] === "preview") return json(await previewCampaign(ctx, id, (await body(request, campaignVersion)).version, requestId));
  if (s[1] === "schedule") { const result = await scheduleCampaign(ctx, id, await body(request, campaignSchedule), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  if (s[1] === "reschedule") return json(await rescheduleCampaign(ctx, id, await body(request, campaignReschedule), requestId));
  if (s[1] === "cancel") return json(await cancelCampaign(ctx, id, (await body(request, campaignVersion)).version, requestId));
  if (s[1] === "archive") return json(await archiveCampaign(ctx, id, (await body(request, campaignVersion)).version, requestId));
  if (s[1] === "retry") { const result = await retryCampaign(ctx, id, await body(request, campaignRetry), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const s = parts(request); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateCampaign(await requireContext(request.headers, "message.manage"), z.uuid().parse(s[0]), await body(request, campaignPatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const s = parts(request);
  if (s.length === 3 && s[1] === "files") return json(await changeCampaignFile(await requireContext(request.headers, "message.manage"), z.uuid().parse(s[0]), z.uuid().parse(s[2]), (await body(request, campaignVersion)).version, true, requestId));
  if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await deleteCampaign(await requireContext(request.headers, "message.manage"), z.uuid().parse(s[0]), (await body(request, campaignVersion)).version, requestId));
});
