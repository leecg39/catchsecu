import type { z } from "zod";
import type { RetentionRule } from "@/generated/prisma/client";
import { retentionRuleList } from "@/contracts/retention-rules";
import type { retentionRuleCreate, retentionRulePatch } from "@/contracts/retention-rules";
import { db, type Transaction } from "./db";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { idempotent } from "./idempotency";
import { formScope, lockFormService } from "./form-access";

async function withRuleAccess<T>(ctx: Context, capability: "security.read" | "security.write", operation: (tx: Transaction) => Promise<T>) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, capability, { lockServices: capability === "security.read" });
    const result = await operation(tx);
    assertFileDeadlines(actor.deadlines);
    return result;
  }, { timeout: 15000 });
}
async function lockRuleService(tx: Transaction, ctx: Context, serviceId: string) {
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  await lockFormService(tx, ctx, serviceId, "security.write");
}

function dto(row: RetentionRule) {
  return { id: row.id, serviceId: row.serviceId, retentionDays: row.retentionDays, reason: row.reason,
    status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listRetentionRules(ctx: Context, raw: unknown) {
  const input = retentionRuleList.parse(raw);
  return withRuleAccess(ctx, "security.read", async tx => {
    const scope = await formScope(tx, ctx, "security.read");
    const where = { tenantId: ctx.tenantId, status: input.status, service: scope,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}) };
    if (input.serviceId) await lockFormService(tx, ctx, input.serviceId, "security.read", false);
    const [rows, total] = await Promise.all([
      tx.retentionRule.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      tx.retentionRule.count({ where })]);
    return { items: rows.map(dto), total, page: input.page, pageSize: input.pageSize };
  });
}
export async function readRetentionRule(ctx: Context, id: string) {
  return withRuleAccess(ctx, "security.read", async tx => {
    const row = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    await lockFormService(tx, ctx, row.serviceId, "security.read", false);
    return dto(row);
  });
}
export async function createRetentionRule(ctx: Context, input: z.infer<typeof retentionRuleCreate>, key: string | null, requestId: string) {
  let deadlines: Awaited<ReturnType<typeof lockServiceActor>>["deadlines"];
  const authorize = async (tx: Transaction) => {
    deadlines = (await lockServiceActor(tx, ctx, "security.write", { lockServices: false })).deadlines;
    await lockRuleService(tx, ctx, input.serviceId);
  };
  return idempotent("retention-rule:create:" + ctx.member.id, key, input, async tx => {
    await authorize(tx);
    const existing = await tx.retentionRule.findUnique({ where: { tenantId_serviceId: { tenantId: ctx.tenantId, serviceId: input.serviceId } } });
    if (existing?.status === "active") fail(409, "RULE_EXISTS", "해당 서비스의 보유 기간 규칙이 이미 있습니다.");
    try {
      const row = existing
        ? await tx.retentionRule.update({ where: { id: existing.id },
            data: { retentionDays: input.retentionDays, reason: input.reason, status: "active", version: { increment: 1 } } })
        : await tx.retentionRule.create({ data: { tenantId: ctx.tenantId, ...input } });
      await audit(tx, ctx, requestId, "retention_rule.created", "retentionRule", row.id, ["serviceId", "retentionDays"], input.serviceId);
      return { status: 201, body: dto(row) };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") fail(409, "RULE_EXISTS", "해당 서비스의 보유 기간 규칙이 이미 있습니다.");
      throw error;
    }
  }, authorize, async (tx, cached) => {
    const current = await tx.retentionRule.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId, serviceId: input.serviceId } });
    if (!current || current.status !== "active") fail(410, "RULE_ARCHIVED", "기존 보유 기간 규칙은 보관되었습니다.");
    return dto(current);
  }, async () => { assertFileDeadlines(deadlines); });
}
export async function updateRetentionRule(ctx: Context, id: string, input: z.infer<typeof retentionRulePatch>, requestId: string) {
  return withRuleAccess(ctx, "security.write", async tx => {
    const current = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    if (current.status === "archived") fail(409, "RULE_ARCHIVED", "보관된 규칙은 변경할 수 없습니다.");
    await lockRuleService(tx, ctx, current.serviceId);
    const { version, ...fields } = input;
    const result = await tx.retentionRule.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" },
      data: { ...fields, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "규칙이 변경되었습니다. 다시 불러와주세요.");
    await audit(tx, ctx, requestId, "retention_rule.updated", "retentionRule", id, Object.keys(fields), current.serviceId);
    return dto(await tx.retentionRule.findUniqueOrThrow({ where: { id } }));
  });
}
export async function archiveRetentionRule(ctx: Context, id: string, version: number, requestId: string) {
  return withRuleAccess(ctx, "security.write", async tx => {
    const current = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    await lockRuleService(tx, ctx, current.serviceId);
    const result = await tx.retentionRule.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" },
      data: { status: "archived", version: { increment: 1 } } });
    if (!result.count) {
      if (current.status === "archived") fail(409, "RULE_ARCHIVED", "이미 보관된 규칙입니다.");
      fail(409, "VERSION_CONFLICT", "규칙이 변경되었습니다. 다시 불러와주세요.");
    }
    await audit(tx, ctx, requestId, "retention_rule.archived", "retentionRule", id, ["status"], current.serviceId);
    return { archived: true };
  });
}
