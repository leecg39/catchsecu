import type { FileObject } from "@/generated/prisma/client";
import type { Transaction } from "./db";
import { fail } from "./http";

/** Called after company/member/service scope checks and before locking a file. */
export async function lockCampaignForFile(tx: Transaction, file: Pick<FileObject, "campaignId" | "tenantId" | "serviceId">, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${file.campaignId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${file.campaignId} FOR SHARE`;
  const row = await tx.campaign.findFirst({ where: { id: file.campaignId!, tenantId: file.tenantId, serviceId: file.serviceId, channel: "email" } });
  if (!row) fail(404, "NOT_FOUND", "첨부파일의 캠페인을 찾을 수 없습니다.");
  if (["deleted", "expired"].includes(row.status) || row.expiresAt <= new Date()) fail(410, "CAMPAIGN_UNAVAILABLE", "캠페인 첨부파일의 보관 기간이 끝났습니다.");
  if (write && row.status !== "draft") fail(409, "DRAFT_REQUIRED", "초안의 첨부파일만 변경할 수 있습니다.");
  return row;
}
