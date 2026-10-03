import type { VerificationIntegration } from "@/generated/prisma/client";
import type { VerificationConfiguration, VerificationState } from "@/contracts/verification";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { audit } from "./audit";
import { assertFileDeadlines, lockFileContext } from "./file-access";
import { fail, requireVersion } from "./http";
import { roleCan } from "./permissions";

export async function lockVerificationContext(tx: Transaction, ctx: Context, serviceId: string, write = false) {
  return lockFileContext(tx, ctx, serviceId, [write ? "integration.manage" : "form.read"]);
}
async function lockConfiguration(tx: Transaction, tenantId: string, serviceId: string, write = false) {
  // Also serialize create/restore when no configuration row exists yet.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"verification:" + tenantId + ":" + serviceId}, 0))`;
  if (write) await tx.$queryRaw`SELECT id FROM "VerificationIntegration" WHERE "tenantId"=${tenantId} AND "serviceId"=${serviceId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "VerificationIntegration" WHERE "tenantId"=${tenantId} AND "serviceId"=${serviceId} FOR SHARE`;
  return tx.verificationIntegration.findUnique({ where: { tenantId_serviceId: { tenantId, serviceId } } });
}
async function state(tx: Transaction, ctx: Context, serviceId: string, row: VerificationIntegration | null): Promise<VerificationState> {
  const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, include: { grants: true } });
  const canManage = roleCan(member.role, "integration.manage") && (["owner", "admin"].includes(member.role) ||
    member.grants.some(grant => grant.serviceId === serviceId && grant.capabilities.includes("integration.manage")));
  const history = row ? await tx.verificationIntegrationRevision.findMany({ where: { tenantId: ctx.tenantId, serviceId, integrationId: row.id }, orderBy: { version: "desc" }, take: 20 }) : [];
  const reason = !row || row.status === "deleted" ? "NOT_CONFIGURED" : row.status === "disabled" ? "DISABLED" : "PROVIDER_ADAPTER_REQUIRED";
  const messages = { NOT_CONFIGURED: "공급자 설정을 등록해주세요.", DISABLED: "본인인증·전자서명 연동을 사용 중지했습니다.",
    PROVIDER_ADAPTER_REQUIRED: "공급자 연결과 sandbox 검증이 필요합니다. 인증을 사용하는 폼은 아직 게시할 수 없습니다." };
  return { integration: row ? { id: row.id, identityProvider: row.identityProvider, signatureProvider: row.signatureProvider,
    environment: row.environment as "sandbox" | "production", status: row.status as "pending" | "disabled" | "deleted", version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } : null,
    readiness: { ready: false, reason, message: messages[reason], sandboxVerified: false }, permissions: { canManage },
    history: history.map(item => ({ version: item.version, identityProvider: item.identityProvider, signatureProvider: item.signatureProvider,
      environment: item.environment as "sandbox" | "production", status: item.status as "pending" | "disabled" | "deleted", createdAt: item.createdAt.toISOString() })) };
}
async function recordRevision(tx: Transaction, row: VerificationIntegration) {
  await tx.verificationIntegrationRevision.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, integrationId: row.id,
    version: row.version, identityProvider: row.identityProvider, signatureProvider: row.signatureProvider, environment: row.environment, status: row.status } });
}
async function invalidatePrevious(tx: Transaction, row: VerificationIntegration) {
  await tx.verificationAttempt.updateMany({ where: { tenantId: row.tenantId, serviceId: row.serviceId, integrationId: row.id, status: { in: ["pending", "verified"] } },
    data: { status: "cancelled", version: { increment: 1 } } });
  await tx.idempotencyRecord.updateMany({ where: { tenantId: row.tenantId, resourceType: "verificationIntegration", resourceId: row.id, invalidatedAt: null },
    data: { responseCipher: null, requestHash: null, invalidatedAt: new Date() } });
}
export async function getVerificationState(ctx: Context, serviceId: string, existingTx?: Transaction) {
  const read = async (tx: Transaction) => {
    const deadline = await lockVerificationContext(tx, ctx, serviceId);
    const result = await state(tx, ctx, serviceId, await lockConfiguration(tx, ctx.tenantId, serviceId));
    assertFileDeadlines(deadline); return result;
  };
  return existingTx ? read(existingTx) : db.$transaction(read, { timeout: 15000 });
}
export async function createVerificationIntegration(ctx: Context, serviceId: string, input: VerificationConfiguration, requestId: string, tx: Transaction) {
  const deadline = await lockVerificationContext(tx, ctx, serviceId, true);
  const current = await lockConfiguration(tx, ctx.tenantId, serviceId, true);
  if (current && current.status !== "deleted") fail(409, "ALREADY_EXISTS", "이미 연동 설정이 있습니다. 최신 설정을 불러와 수정해주세요.");
  const row = current ? await tx.verificationIntegration.update({ where: { id: current.id }, data: { ...input, version: { increment: 1 } } }) :
    await tx.verificationIntegration.create({ data: { tenantId: ctx.tenantId, serviceId, ...input } });
  await recordRevision(tx, row);
  await audit(tx, ctx, requestId, current ? "restore" : "create", "VerificationIntegration", row.id, Object.keys(input), serviceId);
  const result = await state(tx, ctx, serviceId, row); assertFileDeadlines(deadline); return result;
}
export async function replayVerificationIntegration(tx: Transaction, ctx: Context, serviceId: string, cached: VerificationState) {
  const deadline = await lockVerificationContext(tx, ctx, serviceId, true), row = await lockConfiguration(tx, ctx.tenantId, serviceId);
  if (!row || row.status === "deleted" || row.id !== cached.integration?.id || row.version !== cached.integration.version)
    fail(410, "IDEMPOTENCY_EXPIRED", "변경되거나 삭제된 연동 설정 요청입니다. 최신 설정을 확인해주세요.");
  const result = await state(tx, ctx, serviceId, row); assertFileDeadlines(deadline); return result;
}
export async function updateVerificationIntegration(ctx: Context, serviceId: string, input: VerificationConfiguration & { version: number }, requestId: string) {
  return db.$transaction(async tx => {
    const deadline = await lockVerificationContext(tx, ctx, serviceId, true), current = await lockConfiguration(tx, ctx.tenantId, serviceId, true);
    if (!current || current.status === "deleted") fail(404, "NOT_FOUND", "연동 설정을 찾을 수 없습니다.");
    requireVersion(input, current);
    const configuration = { identityProvider: input.identityProvider, signatureProvider: input.signatureProvider, environment: input.environment, status: input.status };
    const changed = (Object.keys(configuration) as (keyof VerificationConfiguration)[]).filter(key => current[key] !== configuration[key]);
    let row = current;
    if (changed.length) {
      await invalidatePrevious(tx, current);
      row = await tx.verificationIntegration.update({ where: { id: current.id }, data: { ...configuration, version: { increment: 1 } } });
      await recordRevision(tx, row);
      await audit(tx, ctx, requestId, "update", "VerificationIntegration", row.id, changed, serviceId);
    }
    const result = await state(tx, ctx, serviceId, row); assertFileDeadlines(deadline); return result;
  }, { timeout: 15000 });
}
export async function deleteVerificationIntegration(ctx: Context, serviceId: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const deadline = await lockVerificationContext(tx, ctx, serviceId, true), row = await lockConfiguration(tx, ctx.tenantId, serviceId, true);
    if (!row || row.status === "deleted") fail(404, "NOT_FOUND", "연동 설정을 찾을 수 없습니다.");
    requireVersion({ version }, row);
    await invalidatePrevious(tx, row);
    const deleted = await tx.verificationIntegration.update({ where: { id: row.id }, data: { status: "deleted", identityProvider: null, signatureProvider: null, version: { increment: 1 } } });
    await recordRevision(tx, deleted);
    await audit(tx, ctx, requestId, "delete", "VerificationIntegration", row.id, ["status", "identityProvider", "signatureProvider"], serviceId);
    assertFileDeadlines(deadline);
  }, { timeout: 15000 });
}
