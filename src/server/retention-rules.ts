import type { z } from "zod";
import type { RetentionRule } from "@/generated/prisma/client";
import { retentionRuleList } from "@/contracts/retention-rules";
import type { retentionRuleCreate, retentionRulePatch } from "@/contracts/retention-rules";
import { db } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { idempotent } from "./idempotency";
import { formScope, lockFormService } from "./form-access";

function dto(row: RetentionRule) {
  return { id: row.id, serviceId: row.serviceId, retentionDays: row.retentionDays, reason: row.reason,
    status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listRetentionRules(ctx: Context, raw: unknown) {
  const input = retentionRuleList.parse(raw);
  return db.$transaction(async tx => {
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
  return db.$transaction(async tx => {
    const row = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    await lockFormService(tx, ctx, row.serviceId, "security.read", false);
    return dto(row);
  });
}
export async function createRetentionRule(ctx: Context, input: z.infer<typeof retentionRuleCreate>, key: string | null, requestId: string) {
  return idempotent("retention-rule:create:" + ctx.member.id, key, input, async tx => {
    await lockFormService(tx, ctx, input.serviceId, "security.write");
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
  });
}
export async function updateRetentionRule(ctx: Context, id: string, input: z.infer<typeof retentionRulePatch>, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    if (current.status === "archived") fail(409, "RULE_ARCHIVED", "보관된 규칙은 변경할 수 없습니다.");
    await lockFormService(tx, ctx, current.serviceId, "security.write");
    const { version, ...fields } = input;
    const result = await tx.retentionRule.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" },
      data: { ...fields, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "규칙이 변경되었습니다. 다시 불러와주세요.");
    await audit(tx, ctx, requestId, "retention_rule.updated", "retentionRule", id, Object.keys(fields), current.serviceId);
    return dto(await tx.retentionRule.findUniqueOrThrow({ where: { id } }));
  });
}
export async function archiveRetentionRule(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.retentionRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "보유 기간 규칙을 찾을 수 없습니다.");
    await lockFormService(tx, ctx, current.serviceId, "security.write");
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
