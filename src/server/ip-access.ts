import type { z } from "zod";
import type { IpRule } from "@/generated/prisma/client";
import type { ipRuleInput, ipRulePatch, ipRuleQuery } from "@/contracts/ip-access";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { assertCompanyIp } from "./ip-enforcement";
import { containsAddress, parseNetwork } from "./ip-network";
import { audit } from "./audit";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import { lockSecurityEntitlements } from "./feature-entitlements";
function dto(row: IpRule) { return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function tenant(ctx: Context, tenantId: string) {
  if (ctx.tenantId !== tenantId) fail(409, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 다시 불러와주세요.");
}
async function locked(tx: Transaction, ctx: Context, write = false) {
  if (write) await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', ctx.tenantId);
  const actor = await lockServiceActor(tx, ctx, write ? "security.write" : "security.read");
  if (actor.member.accessKind !== "direct") fail(403, "FORBIDDEN", "일반 회사 구성원만 IP 규칙을 확인할 수 있습니다.");
  if (write && (actor.member.role !== "owner" || actor.member.accessKind !== "direct")) fail(403, "FORBIDDEN", "최상위 관리자만 IP 규칙을 변경할 수 있습니다.");
  await assertCompanyIp(ctx.tenantId, ctx.clientIp, tx);
  const access = await lockSecurityEntitlements(tx, ctx.tenantId);
  if (write) access.assert("security.ip_access");
  return { ...actor, access };
}
async function policy(tx: Transaction, ctx: Context, canManage: boolean, access: Awaited<ReturnType<typeof lockSecurityEntitlements>>) {
  const row = await tx.ipAccessPolicy.findUnique({ where: { tenantId: ctx.tenantId } });
  return { tenantId: ctx.tenantId, enabled: !!row?.enabled, version: row?.version ?? 0, currentIp: ctx.clientIp ?? null, canManage: canManage && access.snapshot()["security.ip_access"].available, entitlement: access.snapshot()["security.ip_access"] };
}
async function canonical(tx: Transaction, input: string) {
  const network = parseNetwork(input);
  if (!network) fail(422, "INVALID_CIDR", "올바른 IPv4·IPv6 주소 또는 CIDR 범위를 입력해주세요.");
  const rows = await tx.$queryRawUnsafe<{ cidr: string }[]>("SELECT $1::cidr::text AS cidr", network.cidr);
  return rows[0].cidr;
}
async function selfAllowed(tx: Transaction, ctx: Context, excludeId?: string, candidate?: { cidr: string; enabled: boolean }) {
  const row = await tx.ipAccessPolicy.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!row?.enabled) return;
  const rules = await tx.ipRule.findMany({ where: { tenantId: ctx.tenantId, enabled: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (candidate?.enabled) rules.push(candidate as typeof rules[number]);
  if (!ctx.clientIp || !rules.some(r => containsAddress(r.cidr, ctx.clientIp!))) fail(409, "IP_LOCKOUT", "현재 관리자의 접속 IP를 허용하는 규칙을 유지해주세요.");
}
export async function listIpRules(ctx: Context, query: z.infer<typeof ipRuleQuery>) {
  return db.$transaction(async tx => {
    const actor = await locked(tx, ctx);
    const where = { tenantId: ctx.tenantId, ...(query.status === "all" ? {} : { enabled: query.status === "enabled" }),
      ...(query.search ? { OR: [{ cidr: { contains: query.search, mode: "insensitive" as const } }, { description: { contains: query.search, mode: "insensitive" as const } }] } : {}) };
    const total = await tx.ipRule.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.ipRule.findMany({ where, orderBy: [{ [query.sort]: query.direction }, { id: query.direction }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    const result = { items: rows.map(dto), total, page, pageSize: query.pageSize, policy: await policy(tx, ctx, actor.member.role === "owner" && actor.member.accessKind === "direct", actor.access) };
    assertFileDeadlines(actor.deadlines); return result;
  }, { timeout: 15000 });
}
export async function readIpRule(ctx: Context, id: string) {
  return db.$transaction(async tx => {
    const actor = await locked(tx, ctx); const row = await tx.ipRule.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "IP 규칙을 찾을 수 없습니다.");
    assertFileDeadlines(actor.deadlines); return dto(row);
  });
}
export async function createIpRule(ctx: Context, input: z.infer<typeof ipRuleInput>, key: string | null, requestId: string) {
  tenant(ctx, input.tenantId);
  let featureCheck: (() => void) | undefined;
  let deadlines: Awaited<ReturnType<typeof lockServiceActor>>["deadlines"] | undefined;
  return idempotent("ip-rule:create:" + ctx.tenantId + ":" + ctx.user.id, key, input, async tx => {
    const actor = await locked(tx, ctx, true); deadlines = actor.deadlines; featureCheck = () => actor.access.assert("security.ip_access");
    if (await tx.ipRule.count({ where: { tenantId: ctx.tenantId } }) >= 100) fail(409, "IP_RULE_LIMIT", "IP 규칙은 회사당 최대 100개입니다.");
    const cidr = await canonical(tx, input.cidr);
    const row = await tx.ipRule.create({ data: { tenantId: ctx.tenantId, cidr, description: input.description, enabled: input.enabled } });
    await selfAllowed(tx, ctx);
    await audit(tx, ctx, requestId, "ip_rule.created", "ipRule", row.id, ["cidr","description","enabled"]);
    return { status: 201, body: dto(row), resource: { tenantId: ctx.tenantId, resourceType: "ip-rule" as const, resourceId: row.id } };
  }, async tx => { const actor = await locked(tx, ctx, true); deadlines = actor.deadlines; featureCheck = () => actor.access.assert("security.ip_access"); }, async (tx, cached) => {
    const row = await tx.ipRule.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId } });
    if (!row) fail(410, "IP_RULE_DELETED", "이미 삭제된 IP 규칙의 요청입니다."); return dto(row);
  }, async () => { if (deadlines) assertFileDeadlines(deadlines); featureCheck?.(); });
}
export async function updateIpRule(ctx: Context, id: string, input: z.infer<typeof ipRulePatch>, requestId: string) {
  tenant(ctx, input.tenantId);
  return db.$transaction(async tx => {
    const actor = await locked(tx, ctx, true);
    const row = await tx.ipRule.findFirst({ where: { id, tenantId: ctx.tenantId } }); if (!row) fail(404,"NOT_FOUND","IP 규칙을 찾을 수 없습니다.");
    requireVersion(input, row); const cidr = await canonical(tx, input.cidr);
    await selfAllowed(tx, ctx, id, { cidr, enabled: input.enabled });
    const saved = await tx.ipRule.update({ where: { id }, data: { cidr, description: input.description, enabled: input.enabled, version: { increment: 1 } } });
    await selfAllowed(tx, ctx);
    await audit(tx, ctx, requestId, "ip_rule.updated", "ipRule", id, ["cidr","description","enabled"]);
    assertFileDeadlines(actor.deadlines); actor.access.assert("security.ip_access"); return dto(saved);
  }, { timeout: 15000 });
}
export async function deleteIpRule(ctx: Context, id: string, input: { tenantId: string; version: number }, requestId: string) {
  tenant(ctx,input.tenantId);
  return db.$transaction(async tx => {
    const actor = await locked(tx,ctx,true); const row = await tx.ipRule.findFirst({ where: { id,tenantId:ctx.tenantId } });
    if (!row) fail(404,"NOT_FOUND","IP 규칙을 찾을 수 없습니다."); requireVersion(input,row);
    await selfAllowed(tx, ctx, id);
    await tx.ipRule.delete({where:{id}}); await selfAllowed(tx,ctx);
    await tx.idempotencyRecord.updateMany({ where:{tenantId:ctx.tenantId,resourceType:"ip-rule",resourceId:id}, data:{invalidatedAt:new Date(),responseCipher:null,requestHash:null} });
    await audit(tx,ctx,requestId,"ip_rule.deleted","ipRule",id,[]);
    assertFileDeadlines(actor.deadlines); actor.access.assert("security.ip_access");
  }, { timeout:15000 });
}
export async function changeIpAccess(ctx: Context, input: { tenantId: string; version: number; enabled: boolean }, requestId: string) {
  tenant(ctx,input.tenantId);
  return db.$transaction(async tx => {
    const actor=await locked(tx,ctx,true); const current=await tx.ipAccessPolicy.findUnique({where:{tenantId:ctx.tenantId}});
    if ((current?.version ?? 0)!==input.version) fail(409,"VERSION_CONFLICT","다른 곳에서 수정되었습니다. 최신 설정을 불러와주세요.");
    if (input.enabled) {
      if (!ctx.clientIp) fail(409,"IP_ADDRESS_UNAVAILABLE","접속 IP를 확인한 후 접근 제한을 켤 수 있습니다.");
      const rules=await tx.ipRule.findMany({where:{tenantId:ctx.tenantId,enabled:true}});
      if (!rules.some(r=>containsAddress(r.cidr,ctx.clientIp!))) fail(409,"IP_LOCKOUT","현재 접속 IP를 허용하는 규칙을 먼저 등록해주세요.");
    }
    const saved=current ? await tx.ipAccessPolicy.update({where:{tenantId:ctx.tenantId},data:{enabled:input.enabled,version:{increment:1}}})
      : await tx.ipAccessPolicy.create({data:{tenantId:ctx.tenantId,enabled:input.enabled}});
    await audit(tx,ctx,requestId,"ip_access.updated","ipAccessPolicy",ctx.tenantId,["enabled"]);
    const result={tenantId:ctx.tenantId,enabled:saved.enabled,version:saved.version,currentIp:ctx.clientIp??null,canManage:true,entitlement:actor.access.snapshot()["security.ip_access"]};
    assertFileDeadlines(actor.deadlines); actor.access.assert("security.ip_access"); return result;
  }, { timeout:15000 });
}
