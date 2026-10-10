import { db } from "./db";
import { fail } from "./http";
import { audit } from "./audit";
import type { Transaction } from "./db";
import type { BillingPlan, BillingPlanVersion } from "@/generated/prisma/client";
import type { z } from "zod";
import type { adminPlanCreate, adminPlanPatch } from "@/contracts/admin-plans";

import type { requireActor } from "./context";
import { lockAccountActor } from "./account-actor";
import { assertFileDeadlines } from "./file-access";

type Actor = Awaited<ReturnType<typeof requireActor>>;
async function withAdmin<T>(actor: Actor, operation: (tx: Transaction) => Promise<T>) {
  return db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    if (!current.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다.");
    const result = await operation(tx);
    assertFileDeadlines(current.deadlines);
    return result;
  }, { timeout: 15000 });
}
type VersionInput = z.infer<typeof adminPlanCreate>["version"];
const versionDto = (v: BillingPlanVersion) => ({ id: v.id, number: v.number, cycle: v.cycle, priceKrw: v.priceKrw,
  currency: v.currency, serviceLimit: v.serviceLimit, memberLimit: v.memberLimit, subjectLimit: v.subjectLimit,
  formLimit: v.formLimit, features: v.features, capabilities: v.capabilities, orderable: v.orderable,
  effectiveFrom: v.effectiveFrom.toISOString(), effectiveTo: v.effectiveTo?.toISOString() ?? null });
const dto = (row: BillingPlan & { versions: BillingPlanVersion[]; _count?: { subscriptions: number } }) => ({
  id: row.id, name: row.name, description: row.description, createdAt: row.createdAt.toISOString(),
  subscriptionCount: row._count?.subscriptions ?? 0, versions: row.versions.map(versionDto) });
const include = { versions: { orderBy: [{ number: "desc" as const }, { cycle: "asc" as const }] }, _count: { select: { subscriptions: true } } };

export async function listAdminPlans(actor: Actor) {
  return withAdmin(actor, async tx => ({ items: (await tx.billingPlan.findMany({ include, orderBy: { createdAt: "asc" } })).map(dto) }));
}
export async function readAdminPlan(actor: Actor, id: string) {
  return withAdmin(actor, async tx => {
    const row = await tx.billingPlan.findFirst({ where: { id }, include });
    if (!row) fail(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    return dto(row);
  });
}
function versionData(planId: string, input: VersionInput) {
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    fail(422, "INVALID_PERIOD", "버전 종료일은 시작일 이후여야 합니다.");
  return { planId, number: input.number, cycle: input.cycle, priceKrw: input.priceKrw ?? null,
    currency: input.currency, serviceLimit: input.serviceLimit ?? null, memberLimit: input.memberLimit ?? null,
    subjectLimit: input.subjectLimit ?? null, formLimit: input.formLimit ?? null, features: input.features,
    capabilities: input.capabilities, orderable: input.orderable, effectiveFrom, effectiveTo };
}
export async function createAdminPlan(actor: Actor, input: z.infer<typeof adminPlanCreate>, requestId: string) {
  const row = await withAdmin(actor, async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"admin-plan:" + input.id}, 0))::text`;
    if (await tx.billingPlan.findUnique({ where: { id: input.id } })) fail(409, "PLAN_EXISTS", "같은 식별자의 상품이 있습니다.");
    const plan = await tx.billingPlan.create({ data: { id: input.id, name: input.name, description: input.description } });
    await tx.billingPlanVersion.create({ data: versionData(plan.id, input.version) });
    await audit(tx, { tenantId: null, user: { id: actor.user.id } }, requestId, "plan.created", "billingPlan", plan.id, ["name", "version"]);
    return tx.billingPlan.findUniqueOrThrow({ where: { id: plan.id }, include });
  });
  return { status: 201 as const, body: dto(row) };
}
export async function updateAdminPlan(actor: Actor, id: string, input: z.infer<typeof adminPlanPatch>, requestId: string) {
  return withAdmin(actor, async tx => {
    await tx.$queryRaw`SELECT id FROM "BillingPlan" WHERE id=${id} FOR UPDATE`;
    const plan = await tx.billingPlan.findFirst({ where: { id }, include });
    if (!plan) fail(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    if (input.name !== undefined || input.description !== undefined)
      await tx.billingPlan.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
    if (input.version) {
      if (await tx.billingPlanVersion.findUnique({ where: { planId_number_cycle: { planId: id, number: input.version.number, cycle: input.version.cycle } } }))
        fail(409, "VERSION_CONFLICT", "같은 번호·주기의 버전이 이미 있습니다. 판매된 가격은 바꾸지 않고 새 버전을 추가합니다.");
      await tx.billingPlanVersion.create({ data: versionData(id, input.version) });
    }
    await audit(tx, { tenantId: null, user: { id: actor.user.id } }, requestId, "plan.updated", "billingPlan", id,
      Object.keys(input).filter(key => input[key as keyof typeof input] !== undefined));
    return dto(await tx.billingPlan.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function archiveAdminPlan(actor: Actor, id: string, requestId: string) {
  return withAdmin(actor, async tx => {
    await tx.$queryRaw`SELECT id FROM "BillingPlan" WHERE id=${id} FOR UPDATE`;
    const plan = await tx.billingPlan.findFirst({ where: { id }, include });
    if (!plan) fail(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    if (plan._count.subscriptions) fail(409, "PLAN_IN_USE", "구독이 연결된 상품은 삭제할 수 없습니다.");
    if (await tx.billingPlanVersion.count({ where: { planId: id, orderable: true } }))
      fail(409, "PLAN_ORDERABLE", "주문 가능한 버전은 삭제할 수 없습니다. 미판매 상품만 삭제할 수 있습니다.");
    await tx.billingPlanVersion.deleteMany({ where: { planId: id } });
    await tx.billingPlan.delete({ where: { id } });
    await audit(tx, { tenantId: null, user: { id: actor.user.id } }, requestId, "plan.deleted", "billingPlan", id, ["name", "versions"]);
    return { deleted: true };
  });
}
