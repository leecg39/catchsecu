import type { Context } from "./context";
import type { Transaction } from "./db";
import { currentServiceScope } from "./service-access";
import { fail } from "./http";
import type { Capability } from "./permissions";

export const formScope = currentServiceScope;

export async function lockFormService(tx: Transaction, ctx: Context, id: string, capability: Capability, activeOnly = true) {
  const scope = await formScope(tx, ctx, capability);
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { AND: [scope, { id }] } });
  if (!service) {
    if (!await tx.service.count({ where: { id, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (activeOnly && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 폼과 템플릿을 변경할 수 없습니다.");
  return service;
}
