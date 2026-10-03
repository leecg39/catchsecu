import type { Transaction } from "./db";
import { decrypt } from "./crypto";

export async function invalidateShareCache(tx: Transaction, tenantId: string, memberId: string, grantId: string) {
  const data = { responseCipher: null, requestHash: null, invalidatedAt: new Date() };
  await tx.idempotencyRecord.updateMany({ where: { tenantId, resourceType: "shareGrant", resourceId: grantId }, data });
  let cursor: string | undefined;
  for (;;) {
    const rows = await tx.idempotencyRecord.findMany({ where: { scope: "share:create:" + tenantId + ":" + memberId, resourceType: null, responseCipher: { not: null } },
      orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const ids = rows.filter(row => decrypt<{ id?: string }>(row.responseCipher!).id === grantId).map(row => row.id);
    if (ids.length) await tx.idempotencyRecord.updateMany({ where: { id: { in: ids } }, data });
    if (rows.length < 200) break;
    cursor = rows.at(-1)!.id;
  }
}
