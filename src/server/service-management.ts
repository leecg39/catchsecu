import type { Transaction } from "./db";
import { fail } from "./http";
export async function assertServiceArchivable(tx: Transaction, tenantId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
  const row = await tx.service.findFirst({ where: { id, tenantId }, select: { _count: { select: {
    forms: true, templates: true, files: true, documents: true, dataSubjects: true, campaigns: true,
    senders: true, importJobs: true, destructions: true, processingPurposes: true, recipients: true,
    clauseTemplates: true, messageTemplates: true, supportTickets: true,
    ledgerTransactions: true, notificationIntegrations: true, notificationEvents: true, emailFeedback: true,
    marketingPreferences: true, certificates: true, consentDisplays: true, suppressions: true,
  } } } });
  if (!row) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
  if (Object.values(row._count).some(count => count > 0))
    fail(409, "SERVICE_IN_USE", "연결된 업무 데이터가 있어 서비스를 보관할 수 없습니다.");
}
