import type { Transaction } from "./db";
import { decrypt } from "./crypto";

export async function invalidateFormCache(tx: Transaction, tenantId: string, formId: string) {
  const data = { responseCipher: null, requestHash: null, invalidatedAt: new Date() };
  await tx.idempotencyRecord.updateMany({ where: { tenantId, resourceType: "form", resourceId: formId }, data });
  // Earlier records had no resource metadata. Limit inspection to this company's members.
  const members = await tx.membership.findMany({ where: { tenantId }, select: { id: true } });
  for (let offset = 0; offset < members.length; offset += 100) {
    const scopes = members.slice(offset, offset + 100).flatMap(member => [
      { scope: "form:create:" + member.id }, { scope: { startsWith: "form:copy:" + member.id + ":" } },
      { scope: { startsWith: "template:use:" + member.id + ":" } },
      { scope: "form:draft:" + member.id + ":" + formId },
    ]);
    let cursor: string | undefined;
    for (;;) {
      const records = await tx.idempotencyRecord.findMany({ where: { resourceType: null, responseCipher: { not: null }, OR: scopes },
        orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const ids = records.filter(record => record.scope.startsWith("form:draft:") ||
        decrypt<{ id?: string }>(record.responseCipher!).id === formId).map(record => record.id);
      if (ids.length) await tx.idempotencyRecord.updateMany({ where: { id: { in: ids } }, data });
      if (records.length < 200) break;
      cursor = records[records.length - 1].id;
    }
  }
}
