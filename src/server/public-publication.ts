import type { Transaction } from "./db";
import { fail } from "./http";

async function lockedPublicPublication(tx: Transaction, id: string, write: boolean) {
  const initial = await tx.publication.findUnique({ where: { id }, include: { form: { select: { serviceId: true } } } });
  if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${initial.formId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${initial.form.serviceId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR SHARE`;
  return tx.publication.findUniqueOrThrow({ where: { id }, include: {
    formVersion: { include: { questions: true } }, form: { include: { service: { include: { tenant: true } } } },
  } });
}

// Public reads, writes and replay checks share the same company/form/service gate.
// A successful replay may remain valid after its last response slot was consumed.
export async function lockPublicPublication(tx: Transaction, id: string, write = false) {
  const live = await lockedPublicPublication(tx, id, write);
  const now = new Date();
  if (live.status !== "active" || live.form.status !== "published" || live.form.service.status !== "active" ||
    live.form.service.tenant.status !== "active" || live.formVersion.status !== "published" ||
    live.form.publishedVersionId !== live.formVersionId || (live.expiresAt && live.expiresAt <= now))
    fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  if (live.opensAt && live.opensAt > now) fail(425, "PUBLICATION_NOT_OPEN", "아직 응답 수집이 시작되지 않은 폼입니다.");
  return live;
}

export async function lockPublicPublicationView(tx: Transaction, id: string) {
  const live = await lockedPublicPublication(tx, id, false);
  if (live.status !== "active" || !["published", "paused"].includes(live.form.status) || live.form.service.status !== "active" ||
    live.form.service.tenant.status !== "active" || live.formVersion.status !== "published" || live.form.publishedVersionId !== live.formVersionId)
    fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  const now = new Date();
  const closedReason = live.expiresAt && live.expiresAt <= now ? "expired" as const
    : live.form.status === "paused" ? "paused" as const
    : live.responseCount >= live.maxResponses ? "response_limit" as const
    : undefined;
  if (closedReason) return { publication: live, state: "closed" as const, closedReason };
  if (live.opensAt && live.opensAt > now) return { publication: live, state: "scheduled" as const };
  return { publication: live, state: "active" as const };
}
