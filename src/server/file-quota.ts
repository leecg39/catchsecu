import type { AuthorAssetUsage } from "@/contracts/author-assets";
import type { Transaction } from "./db";
import { env } from "./env";
import { fail } from "./http";

/** Acquire this before actor SHARE locks when the caller will reserve storage. */
export async function lockFileQuota(tx: Transaction, tenantId: string) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${tenantId} FOR UPDATE`;
}
export async function fileQuotaUsage(tx: Transaction, tenantId: string): Promise<AuthorAssetUsage> {
  const normal = await tx.fileObject.aggregate({ where: { tenantId, status: { not: "deleted" } }, _sum: { size: true } });
  const business = await tx.companyBusinessFile.aggregate({ where: { tenantId, status: { not: "deleted" } }, _sum: { size: true } });
  const assets = await tx.authorAsset.aggregate({ where: { tenantId, status: { not: "deleted" } }, _sum: { size: true } });
  return { usedBytes: (normal._sum.size ?? 0) + (business._sum.size ?? 0) + (assets._sum.size ?? 0), limitBytes: env.FILE_TENANT_QUOTA_BYTES };
}
export async function reserveQuota(tx: Transaction, tenantId: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid quota reservation");
  await lockFileQuota(tx, tenantId);
  const usage = await fileQuotaUsage(tx, tenantId);
  if (usage.usedBytes + bytes > usage.limitBytes) fail(409, "FILE_QUOTA_EXCEEDED", "회사의 파일 저장 한도에 도달했습니다.");
  return usage;
}
