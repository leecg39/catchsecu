import { Prisma } from "@/generated/prisma/client";
import type { Transaction } from "./db";

export const retainedSubjectSubmission = (): Prisma.SubmissionWhereInput => ({
  status: { in: ["submitted", "corrected", "withdrawn"] }, retentionUntil: { gt: new Date() }, receipts: { some: {} },
  formVersion: { form: { service: { status: "active", tenant: { status: "active" } } } },
});
export async function lockSubjectScopes(tx: Transaction, requestId: string) {
  const scopes = await tx.subjectAccessScope.findMany({ where: { requestId }, include: { subject: { select: { serviceId: true } } } });
  const companies = [...new Set(scopes.map(s => s.tenantId))].sort(), services = [...new Set(scopes.map(s => s.subject.serviceId))].sort();
  if (companies.length) await tx.$queryRaw`SELECT id FROM "Company" WHERE id IN (${Prisma.join(companies)}) ORDER BY id FOR SHARE`;
  if (services.length) await tx.$queryRaw`SELECT id FROM "Service" WHERE id IN (${Prisma.join(services)}) ORDER BY id FOR SHARE`;
}
