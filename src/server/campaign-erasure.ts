import type { Transaction } from "./db";
/** Source locks are held by the caller. Never acquire a campaign lock after a delivery lock. */
export async function eraseCampaignContacts(tx: Transaction, filter: { sourceSubmissionId: string } | { preferenceId: { in: string[] } }) {
  const rows = await tx.campaignDelivery.findMany({ where: { ...filter, erasedAt: null }, orderBy: { id: "asc" } });
  for (const row of rows) await tx.campaignDelivery.update({ where: { id: row.id }, data: { contactCipher: null, erasedAt: new Date(),
    ...(["accepted", "local_delivered", "unknown"].includes(row.status) ? {} : row.status === "sending" ? { status: "unknown", reason: "DELIVERY_UNCERTAIN" } : { status: "cancelled", reason: "DATA_ERASED" }) } });
  return rows.length;
}
