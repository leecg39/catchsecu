import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { db, type Transaction } from "./db";
import { encrypt } from "./crypto";
import { env } from "./env";
import { eraseCampaignContacts } from "./campaign-erasure";
/** Caller locks the source submission before erasing its queued and local delivery copies. */
export async function eraseMarketingJobs(tx: Transaction, filter: { marketingSubmissionId: string } | { marketingPreferenceId: { in: string[] } }, options?: { deferLocalRemoval: boolean }) {
  await eraseCampaignContacts(tx, "marketingSubmissionId" in filter ? { sourceSubmissionId: filter.marketingSubmissionId } : { preferenceId: filter.marketingPreferenceId });
  const rows = await tx.job.findMany({ where: { ...filter, OR: [{ payloadErasedAt: null }, { localCopyErasedAt: null }] }, orderBy: { id: "asc" } });
  for (const job of rows) {
    if (!options?.deferLocalRemoval) await removeLocalCopy(job.id);
    await tx.job.update({ where: { id: job.id }, data: { ...(!job.payloadErasedAt ? { payloadCipher: encrypt({ erased: true }), payloadErasedAt: new Date() } : {}),
      ...(!options?.deferLocalRemoval && !job.localCopyErasedAt ? { localCopyErasedAt: new Date() } : {}),
      status: job.status === "done" ? "done" : "cancelled", leaseOwner: null, leaseUntil: null,
      lastError: job.status === "done" ? null : "DATA_ERASED" } });
  }
  return rows.length;
}
async function removeLocalCopy(id: string) {
  try { await unlink(resolve(env.LOCAL_MAIL_DIR, id + ".json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
/** SQL erasure commits first. A failed filesystem removal remains a durable, retryable record. */
export async function cleanupMarketingLocalCopies(scope?: { tenantId: string; preferenceIds?: string[]; jobIds?: string[] }) {
  const where = { payloadErasedAt: { not: null }, localCopyErasedAt: null,
    ...(scope ? { tenantId: scope.tenantId, ...(scope.preferenceIds ? { marketingPreferenceId: { in: scope.preferenceIds } } : {}),
      ...(scope.jobIds ? { id: { in: scope.jobIds } } : {}) } : {}) };
  const rows = await db.job.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: 100 });
  let cleaned = 0;
  for (const row of rows) {
    try { cleaned += await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${row.id} FOR UPDATE`;
      const current = await tx.job.findFirst({ where: { ...where, id: row.id } });
      if (!current || !["done", "cancelled", "dead"].includes(current.status)) return 0;
      await removeLocalCopy(current.id);
      await tx.job.update({ where: { id: current.id }, data: { localCopyErasedAt: new Date() } });
      return 1;
    }); } catch { /* The committed pending marker survives; a later call retries it. */ }
  }
  return { cleaned, pending: await db.job.count({ where }) };
}
export async function cleanupMarketingJobs() {
  const jobs = await db.job.findMany({ where: { marketingSubmissionId: { not: null }, payloadErasedAt: null, OR: [
    { marketingSubmission: { retentionUntil: { lte: new Date() } } }, { marketingPreference: { status: "erased" } },
    { marketingSubmission: { status: { in: ["destroying", "destroyed"] } } },
  ] }, select: { marketingSubmissionId: true }, distinct: ["marketingSubmissionId"], take: 100 });
  const contacts = await db.campaignDelivery.findMany({ where: { sourceSubmissionId: { not: null }, erasedAt: null, OR: [
    { sourceSubmission: { retentionUntil: { lte: new Date() } } }, { preference: { status: "erased" } },
    { sourceSubmission: { status: { in: ["destroying", "destroyed"] } } },
  ] }, select: { sourceSubmissionId: true }, distinct: ["sourceSubmissionId"], take: 100 });
  const candidates = [...new Set([...jobs.map(j => j.marketingSubmissionId!), ...contacts.map(c => c.sourceSubmissionId!)])];
  let erased = 0;
  for (const candidate of candidates) erased += await db.$transaction(async tx => {
    const id = candidate;
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR UPDATE`;
    const source = await tx.submission.findUnique({ where: { id } });
    if (!source) return 0;
    if (source.retentionUntil <= new Date() || ["destroying", "destroyed"].includes(source.status)) return eraseMarketingJobs(tx, { marketingSubmissionId: id });
    const rows = await tx.marketingPreference.findMany({ where: { sourceSubmissionId: id, status: "erased" }, select: { id: true } });
    return eraseMarketingJobs(tx, { marketingPreferenceId: { in: rows.map(r => r.id) } });
  });
  await cleanupMarketingLocalCopies();
  return erased;
}
