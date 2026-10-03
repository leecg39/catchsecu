import type { Transaction } from "./db";
import { decrypt } from "./crypto";

export async function invalidateTemplateCache(tx: Transaction, tenantId: string, templateId: string) {
  const data = { responseCipher: null, requestHash: null, invalidatedAt: new Date() };
  await tx.idempotencyRecord.updateMany({ where: { tenantId, resourceType: "template", resourceId: templateId }, data });
  const members = await tx.membership.findMany({ where: { tenantId }, select: { id: true } });
  for (let offset = 0; offset < members.length; offset += 100) {
    const scopes = members.slice(offset, offset + 100).map(member => "template:create:" + member.id);
    let cursor: string | undefined;
    for (;;) {
      const records = await tx.idempotencyRecord.findMany({ where: { resourceType: null, responseCipher: { not: null }, scope: { in: scopes } },
        orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const ids = records.filter(record => decrypt<{ id?: string }>(record.responseCipher!).id === templateId).map(record => record.id);
      if (ids.length) await tx.idempotencyRecord.updateMany({ where: { id: { in: ids } }, data });
      if (records.length < 200) break;
      cursor = records.at(-1)!.id;
    }
  }
}
