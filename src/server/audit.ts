import { type Transaction } from "./db";
import type { AuditEventKind } from "@/contracts/audit-events";
export type MailOutcomeMetadata = {
  status: "done" | "cancelled" | "retry" | "dead";
  attempt: number;
  transport: "local" | "smtp";
  errorCode?: "DELIVERY_FAILED" | "SUPPRESSED" | "RECEIPT_PERSISTENCE_FAILED" | "LEASE_EXHAUSTED";
};
export async function audit(tx: Transaction, ctx: { tenantId: string | null; user: { id: string | null } }, requestId: string,
  action: string, resource: string, resourceId?: string, changedFields: string[] = [], serviceId?: string, metadata?: { count: number } | MailOutcomeMetadata) {
  // Store field names and operational enums/counts; never form values, emails, tokens, or secrets.
  await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id,
    action, resource, resourceId, serviceId, requestId, detail: { changedFields, ...metadata } } });
}

type AuditAccessDetail = {
  scope: "company" | "mine"; kind: AuditEventKind; rowCount: number;
  hasSearch: boolean; hasFrom: boolean; hasTo: boolean; hasActorFilter?: boolean;
};
export async function auditAccess(tx: Transaction, ctx: { tenantId: string | null; user: { id: string } },
  requestId: string, action: "audit.viewed" | "audit.exported", detail: AuditAccessDetail, serviceId?: string) {
  // Query values and returned rows are deliberately absent from access metadata.
  await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, requestId,
    action, resource: "auditEvent", serviceId, detail: { ...detail } } });
}
