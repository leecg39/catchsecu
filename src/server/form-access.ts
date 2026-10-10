import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { fail } from "./http";
import type { Capability } from "./permissions";

type FormActor = Awaited<ReturnType<typeof lockServiceActor>>;
// Hold current actor/policy rows through the operation, then check natural
// expiry again after its final query, audit write or cached-response lookup.
export async function withFormAccess<T>(tx: Transaction, ctx: Context, capability: Capability, operation: (actor: FormActor) => Promise<T>) {
  const actor = await lockServiceActor(tx, ctx, capability, { lockServices: false });
  const result = await operation(actor);
  assertFileDeadlines(actor.deadlines);
  return result;
}
export function formTransaction<T>(ctx: Context, capability: Capability, operation: (tx: Transaction) => Promise<T>, options: { timeout?: number } = {}) {
  return db.$transaction(tx => withFormAccess(tx, ctx, capability, () => operation(tx)), { timeout: 15000, ...options });
}
export async function formScope(tx: Transaction, ctx: Context, capability: Capability) {
  return withFormAccess(tx, ctx, capability, async actor => actor.scope);
}
export async function recheckFormAccess(tx: Transaction, ctx: Context, capability: Capability) {
  await withFormAccess(tx, ctx, capability, async () => undefined);
}

export async function lockFormService(tx: Transaction, ctx: Context, id: string, capability: Capability, activeOnly = true) {
  return withFormAccess(tx, ctx, capability, async ({ scope, member }) => {
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    // Check status separately so an assigned expert's archived detail retains
    // its existing 404 contract; list scopes still exclude archived services.
    const service = await tx.service.findFirst({ where: { AND: [{ tenantId: scope.tenantId, id: scope.id }, { id }] } });
    if (!service) {
      if (!await tx.service.count({ where: { id, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
      fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
    }
    if (activeOnly && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 폼과 템플릿을 변경할 수 없습니다.");
    if (member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
    return service;
  });
}
