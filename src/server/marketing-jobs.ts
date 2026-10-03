import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { db, type Transaction } from "./db";
import { encrypt } from "./crypto";
import { env } from "./env";
import { eraseCampaignContacts } from "./campaign-erasure";
/** Caller locks the source submission before erasing its queued and local delivery copies. */
export async function eraseMarketingJobs(tx: Transaction, filter: { marketingSubmissionId: string } | { marketingPreferenceId: { in: string[] } }) {
  await eraseCampaignContacts(tx, "marketingSubmissionId" in filter ? { sourceSubmissionId: filter.marketingSubmissionId } : { preferenceId: filter.marketingPreferenceId });
  const rows = await tx.job.findMany({ where: { ...filter, payloadErasedAt: null }, orderBy: { id: "asc" } });
  for (const job of rows) {
    try { await unlink(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await tx.job.update({ where: { id: job.id }, data: { payloadCipher: encrypt({ erased: true }), payloadErasedAt: new Date(),
      status: job.status === "done" ? "done" : "cancelled", leaseOwner: null, leaseUntil: null,
      lastError: job.status === "done" ? null : "DATA_ERASED" } });
  }
  return rows.length;
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
  return erased;
}
