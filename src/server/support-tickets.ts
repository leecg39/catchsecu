import type { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import type { supportTicketCreate, supportTicketList, supportTicketPatch, supportTicketReply,
  SupportTicketKind, SupportTicketListResponse, SupportTicketRecord, SupportTicketStatus, SupportTicketSummary } from "@/contracts/support-tickets";
import type { Context } from "./context";
import { requireService } from "./context";
import { audit } from "./audit";
import { encrypt, decrypt } from "./crypto";
import { db } from "./db";
import { fail } from "./http";
import { idempotent } from "./idempotency";

type Actor = { user: { id: string; platformAdmin: boolean } };
const include = { tenant: { select: { name: true } }, service: { select: { name: true } },
  author: { select: { name: true, email: true } }, answeredBy: { select: { name: true } } } as const;
type Row = Prisma.SupportTicketGetPayload<{ include: typeof include }>;
const iso = (date: Date | null) => date?.toISOString() ?? null;
const summary = (row: Row): SupportTicketSummary => ({
  id: row.id, kind: row.kind as SupportTicketKind, status: row.status as SupportTicketStatus,
  subject: row.subjectCipher ? decrypt<string>(row.subjectCipher) : null,
  tenantId: row.tenantId, tenantName: row.tenant.name, serviceId: row.serviceId,
  serviceName: row.service?.name ?? null, authorId: row.authorId,
  authorName: row.author.name, authorEmail: row.author.email,
  answeredAt: iso(row.answeredAt), closedAt: iso(row.closedAt), version: row.version,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const detail = (row: Row): SupportTicketRecord => ({ ...summary(row),
  body: row.bodyCipher ? decrypt<string>(row.bodyCipher) : null,
  reply: row.replyCipher ? decrypt<string>(row.replyCipher) : null,
  answeredByName: row.answeredBy?.name ?? null,
});
function requireAdmin(actor: Actor) {
  if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다.");
}
function canRead(actor: Actor, row: Row, admin: boolean, ctx?: Context) {
  if (admin) requireAdmin(actor);
  else if (!ctx || row.tenantId !== ctx.tenantId || row.authorId !== ctx.user.id)
    fail(404, "NOT_FOUND", "요청을 찾을 수 없습니다.");
}
async function ticket(id: string) {
  const row = await db.supportTicket.findUnique({ where: { id }, include });
  if (!row || row.status === "archived") fail(404, "NOT_FOUND", "요청을 찾을 수 없습니다.");
  return row;
}
export async function listSupportTickets(actor: Actor, input: z.infer<typeof supportTicketList>, requestId: string, ctx?: Context): Promise<SupportTicketListResponse> {
  if (input.scope === "admin") requireAdmin(actor);
  else if (!ctx) fail(403, "COMPANY_REQUIRED", "회사를 선택해주세요.");
  const where: Prisma.SupportTicketWhereInput = {
    ...(input.scope === "mine" ? { tenantId: ctx!.tenantId, authorId: actor.user.id } : {}),
    ...(input.kind ? { kind: input.kind } : {}), ...(input.status ? { status: input.status } : { status: { not: "archived" } }),
  };
  return db.$transaction(async tx => {
    const items = await tx.supportTicket.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize, take: input.pageSize });
    const total = await tx.supportTicket.count({ where });
    const safe = items.map(summary);
    if (input.scope === "mine") await audit(tx, ctx!, requestId, "support-ticket.list_viewed", "support-ticket");
    else if (items.length) await tx.auditEvent.createMany({ data: items.map(item => ({
      tenantId: item.tenantId, actorId: actor.user.id, serviceId: item.serviceId,
      requestId, action: "support-ticket.list_viewed", resource: "support-ticket", resourceId: item.id,
      detail: { changedFields: [] },
    })) });
    return { items: safe, total, page: input.page, pageSize: input.pageSize };
  });
}
export async function readSupportTicket(actor: Actor, id: string, admin: boolean, requestId: string, ctx?: Context) {
  return db.$transaction(async tx => {
    const row = await tx.supportTicket.findUnique({ where: { id }, include });
    if (!row || row.status === "archived") fail(404, "NOT_FOUND", "요청을 찾을 수 없습니다.");
    canRead(actor, row, admin, ctx);
    const safe = detail(row);
    await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId,
      "support-ticket.viewed", "support-ticket", id, [], row.serviceId ?? undefined);
    return safe;
  });
}
export async function createSupportTicket(ctx: Context, input: z.infer<typeof supportTicketCreate>, key: string | null, requestId: string) {
  if (input.serviceId) await requireService(ctx, input.serviceId, "service.read");
  return idempotent("support-ticket:create:" + ctx.user.id, key, input, async tx => {
    const row = await tx.supportTicket.create({ data: {
      tenantId: ctx.tenantId, authorId: ctx.user.id, serviceId: input.serviceId ?? null,
      kind: input.kind, subjectCipher: encrypt(input.subject), bodyCipher: encrypt(input.body),
    } });
    await audit(tx, ctx, requestId, "support-ticket.created", "support-ticket", row.id,
      ["kind", "subject", "body", "serviceId"], row.serviceId ?? undefined);
    return { status: 201, body: { id: row.id, status: row.status, version: row.version },
      resource: { tenantId: row.tenantId, resourceType: "support-ticket" as const, resourceId: row.id } };
  });
}
export async function updateSupportTicket(ctx: Context, id: string, input: z.infer<typeof supportTicketPatch>, requestId: string) {
  const current = await ticket(id);
  canRead(ctx, current, false, ctx);
  if (current.status !== "submitted") fail(409, "STATUS_CONFLICT", "접수 상태에서만 수정할 수 있습니다.");
  return db.$transaction(async tx => {
    const changed = await tx.supportTicket.updateMany({ where: { id, tenantId: ctx.tenantId, authorId: ctx.user.id,
      version: input.version, status: "submitted" }, data: {
      ...(input.subject !== undefined ? { subjectCipher: encrypt(input.subject) } : {}),
      ...(input.body !== undefined ? { bodyCipher: encrypt(input.body) } : {}),
      version: { increment: 1 },
    } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "요청이 변경되었습니다. 다시 불러와주세요.");
    const row = await tx.supportTicket.findUniqueOrThrow({ where: { id }, include });
    await audit(tx, ctx, requestId, "support-ticket.updated", "support-ticket", id,
      [input.subject !== undefined ? "subject" : "", input.body !== undefined ? "body" : ""].filter(Boolean), row.serviceId ?? undefined);
    return detail(row);
  });
}
export async function replySupportTicket(actor: Actor, id: string, input: z.infer<typeof supportTicketReply>, requestId: string) {
  requireAdmin(actor);
  const current = await ticket(id);
  if (current.status === "closed") fail(409, "STATUS_CONFLICT", "종료된 요청은 다시 열어주세요.");
  return db.$transaction(async tx => {
    const changed = await tx.supportTicket.updateMany({ where: { id, version: input.version,
      status: { in: ["submitted", "answered"] } }, data: {
      status: "answered", replyCipher: encrypt(input.reply), answeredAt: new Date(),
      answeredById: actor.user.id, version: { increment: 1 },
    } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "요청이 변경되었습니다. 다시 불러와주세요.");
    const row = await tx.supportTicket.findUniqueOrThrow({ where: { id }, include });
    await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId,
      "support-ticket.answered", "support-ticket", id, ["reply", "status"], row.serviceId ?? undefined);
    return detail(row);
  });
}
export async function changeSupportTicketState(actor: Actor, id: string, version: number, action: "close" | "reopen", requestId: string, ctx?: Context) {
  const current = await ticket(id);
  if (ctx) canRead(actor, current, false, ctx);
  else requireAdmin(actor);
  if (action === "reopen" && !actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다.");
  if (action === "close" && current.status === "closed") fail(409, "STATUS_CONFLICT", "이미 종료된 요청입니다.");
  if (action === "close" && ctx && current.status !== "answered") fail(409, "STATUS_CONFLICT", "답변된 요청만 종료할 수 있습니다.");
  if (action === "reopen" && current.status !== "closed") fail(409, "STATUS_CONFLICT", "종료된 요청만 다시 열 수 있습니다.");
  return db.$transaction(async tx => {
    const changed = await tx.supportTicket.updateMany({ where: { id, version, status: current.status }, data: {
      status: action === "close" ? "closed" : current.replyCipher ? "answered" : "submitted",
      closedAt: action === "close" ? new Date() : null, version: { increment: 1 },
    } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "요청이 변경되었습니다. 다시 불러와주세요.");
    const row = await tx.supportTicket.findUniqueOrThrow({ where: { id }, include });
    await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId,
      `support-ticket.${action === "close" ? "closed" : "reopened"}`, "support-ticket", id, ["status"], row.serviceId ?? undefined);
    return detail(row);
  });
}
export async function archiveSupportTicket(actor: Actor, id: string, version: number, requestId: string, ctx?: Context) {
  const current = await ticket(id);
  if (ctx) canRead(actor, current, false, ctx);
  else requireAdmin(actor);
  await db.$transaction(async tx => {
    const changed = await tx.supportTicket.updateMany({ where: { id, version, status: { not: "archived" } }, data: {
      status: "archived", subjectCipher: null, bodyCipher: null, replyCipher: null,
      answeredAt: null, answeredById: null, closedAt: null, version: { increment: 1 },
    } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "요청이 변경되었습니다. 다시 불러와주세요.");
    await tx.idempotencyRecord.updateMany({ where: { resourceType: "support-ticket", resourceId: id, invalidatedAt: null },
      data: { requestHash: null, responseCipher: null, invalidatedAt: new Date() } });
    await audit(tx, { tenantId: current.tenantId, user: actor.user }, requestId,
      "support-ticket.archived", "support-ticket", id, ["status", "subject", "body", "reply"], current.serviceId ?? undefined);
  });
}
