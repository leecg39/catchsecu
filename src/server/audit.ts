import { type Transaction } from "./db";
export async function audit(tx: Transaction, ctx: { tenantId: string; user: { id: string } }, requestId: string,
  action: string, resource: string, resourceId?: string, changedFields: string[] = [], serviceId?: string) {
  // Store changed field names only; never form values, email addresses, tokens, or secrets.
  await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id,
    action, resource, resourceId, serviceId, requestId, detail: { changedFields } } });
}
