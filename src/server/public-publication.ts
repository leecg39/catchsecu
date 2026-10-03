import type { Transaction } from "./db";
import { fail } from "./http";

// Public reads, writes and replay checks share the same company/form/service gate.
// A successful replay may remain valid after its last response slot was consumed.
export async function lockPublicPublication(tx: Transaction, id: string, write = false) {
  const initial = await tx.publication.findUnique({ where: { id }, include: { form: { select: { serviceId: true } } } });
  if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${initial.formId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${initial.form.serviceId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR SHARE`;
  const live = await tx.publication.findUniqueOrThrow({ where: { id }, include: {
    formVersion: { include: { questions: true } }, form: { include: { service: { include: { tenant: true } } } },
  } });
  if (live.status !== "active" || live.form.status !== "published" || live.form.service.status !== "active" ||
    live.form.service.tenant.status !== "active" || live.formVersion.status !== "published" ||
    live.form.publishedVersionId !== live.formVersionId || (live.expiresAt && live.expiresAt <= new Date()))
    fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  return live;
}
