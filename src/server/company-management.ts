import { reserveQuota } from "./file-quota";
import { containsAddress } from "./ip-network";
import { randomUUID } from "node:crypto";
import type { Company, CompanyBusinessFile } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { roleCan } from "./permissions";
import { audit } from "./audit";
import { decrypt, encrypt } from "./crypto";
import { fail } from "./http";
import { privateFiles } from "./file-storage";
import { scanFile } from "./file-scanner";
import { sha256, validateFileBytes } from "./file-validation";
import { activeMembershipWhere } from "./context";
import { lockManagementActor } from "./service-management";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { ssoSessionState } from "./sso-policy-enforcement";

export function businessFileDto(file: CompanyBusinessFile) {
  return { id: file.id, name: decrypt<string>(file.nameCipher!), mime: file.mime!, size: file.size,
    sha256: file.sha256!, scannedAt: file.scannedAt.toISOString() };
}
export function companyDto(company: Company, canManage: boolean, file?: CompanyBusinessFile | null) {
  return { id: company.id, name: company.name, publicName: company.publicName, address: company.address,
    phone: company.phone, website: company.website, businessNo: company.businessNo,
    billingEmail: company.billingEmail, billingContactName: company.billingContactName,
    billingContactPhone: company.billingContactPhone, status: company.status, version: company.version,
    closureRequestedAt: company.closureRequestedAt?.toISOString() ?? null,
    ...(canManage ? { closureReason: company.closureReasonCipher ? decrypt<string>(company.closureReasonCipher) : null,
      businessFile: file ? businessFileDto(file) : null } : {}) };
}
export async function getCompany(ctx: Context) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "service.read");
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.tenantId },
      include: { businessFiles: { where: { status: "active" } } } });
    const result = companyDto(company, roleCan(actor.member.role, "company.manage"), company.businessFiles[0]);
    assertFileDeadlines(actor.deadlines);
    return result;
  });
}
export async function listCompanies(userId: string, query: { page: number; pageSize: number; search: string }, clientIp: string | null = null, sessionId?: string) {
  const membership = activeMembershipWhere(userId);
  const base = { status: "active", name: { contains: query.search, mode: "insensitive" as const }, memberships: { some: membership } };
  return db.$transaction(async tx => {
    const candidates = await tx.company.findMany({ where: base, select: { id: true }, orderBy: { id: "asc" } });
    for (const row of candidates) await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR SHARE', row.id);
    let deadline: number | undefined;
    if (sessionId) {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR SHARE', userId);
      await tx.$queryRawUnsafe('SELECT id FROM "Session" WHERE id=$1 AND "userId"=$2 FOR SHARE', sessionId, userId);
      const session = await tx.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } });
      if (!session || !await tx.user.findFirst({ where: { id: userId, status: "active", emailVerified: true } })) fail(401, "SESSION_EXPIRED", "다시 로그인해주세요.");
      const selectedPolicy = session.activeCompanyId ? await tx.securityPolicy.findUnique({ where: { tenantId: session.activeCompanyId } }) : null;
      deadline = Math.min(session.expiresAt.getTime(), selectedPolicy ? session.updatedAt.getTime() + selectedPolicy.sessionMinutes * 60000 : Infinity);
    }
    const current = await tx.company.findMany({ where: base, select: { id: true, ipAccessPolicy: true, ipRules: { where: { enabled: true }, select: { cidr: true } } } });
    const ssoAccess = new Map<string, boolean>();
    for (const row of current) ssoAccess.set(row.id, !(await ssoSessionState(row.id, userId, sessionId, tx)).required);
    const allowed = current.filter(row => ssoAccess.get(row.id) && (!row.ipAccessPolicy?.enabled || !!clientIp && row.ipRules.some(rule => containsAddress(rule.cidr, clientIp))));
    const total = allowed.length, page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const companies = await tx.company.findMany({ where: { ...base, id: { in: allowed.map(row => row.id) } }, include: { memberships: { where: membership, select: { role: true } }, businessFiles: { where: { status: "active" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    if (deadline !== undefined && deadline <= Date.now()) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
    return { items: companies.map(company => ({ ...companyDto(company, roleCan(company.memberships[0].role, "company.manage"), company.businessFiles[0]), role: company.memberships[0].role })),
      total, page, pageSize: query.pageSize, blockedTotal: current.length - total };
  }, { timeout: 15000 });
}
export async function lockCompany(tx: Transaction, ctx: Context, version?: number, ownerOnly = false) {
  const actor = await lockManagementActor(tx, ctx, "company.manage");
  if (ownerOnly && actor.member.role !== "owner") fail(403, "FORBIDDEN", "회사 소유자만 폐쇄 요청을 관리할 수 있습니다.");
  const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  if (company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
  if (version !== undefined && version !== company.version) fail(409, "VERSION_CONFLICT", "회사 정보가 변경되었습니다. 새로 불러와주세요.");
  return { company, deadlines: actor.deadlines };
}
export async function requestCompanyClosure(ctx: Context, input: { version: number; confirmation: string; reason: string }, requestId: string) {
  await db.$transaction(async tx => {
    const { company, deadlines } = await lockCompany(tx, ctx, input.version, true);
    if (input.confirmation !== company.name) fail(422, "COMPANY_CONFIRMATION", "회사명을 정확하게 입력해주세요.");
    if (company.closureRequestedAt) fail(409, "CLOSURE_ALREADY_REQUESTED", "이미 폐쇄를 요청한 회사입니다.");
    await tx.company.update({ where: { id: ctx.tenantId }, data: { closureRequestedAt: new Date(),
      closureReasonCipher: encrypt(input.reason), closureRequestedById: ctx.user.id, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "company.closure_requested", "company", ctx.tenantId, ["closureRequestedAt"]);
    assertFileDeadlines(deadlines);
  });
}
export async function cancelCompanyClosure(ctx: Context, version: number, requestId: string) {
  await db.$transaction(async tx => {
    const { company, deadlines } = await lockCompany(tx, ctx, version, true);
    if (!company.closureRequestedAt) fail(409, "CLOSURE_NOT_REQUESTED", "진행 중인 폐쇄 요청이 없습니다.");
    await tx.company.update({ where: { id: ctx.tenantId }, data: { closureRequestedAt: null,
      closureReasonCipher: null, closureRequestedById: null, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "company.closure_cancelled", "company", ctx.tenantId, ["closureRequestedAt"]);
    assertFileDeadlines(deadlines);
  });
}
export async function finishBusinessFileDeletion(id: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "CompanyBusinessFile" WHERE id=${id} FOR UPDATE`;
    const file = await tx.companyBusinessFile.findUnique({ where: { id } });
    if (!file || file.status === "deleted") return;
    if (file.status !== "deleting" || !file.storageKey) fail(409, "FILE_NOT_DELETING", "삭제 요청이 필요합니다.");
    await privateFiles.remove(file.storageKey);
    await tx.companyBusinessFile.update({ where: { id }, data: { status: "deleted", nameCipher: null,
      mime: null, size: 0, sha256: null, storageKey: null } });
  });
}
export async function cleanupBusinessFiles() {
  const files = await db.companyBusinessFile.findMany({ where: { status: "deleting" }, select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
  let deleted = 0, retry = 0;
  for (const file of files) { try { await finishBusinessFileDeletion(file.id); deleted++; } catch { retry++; } }
  return { deleted, retry };
}
export async function uploadBusinessFile(ctx: Context, version: number, name: string, mime: string, bytes: Buffer, requestId: string) {
  if (!roleCan(ctx.member.role, "company.manage")) fail(403, "FORBIDDEN", "회사 관리 권한이 필요합니다.");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(mime)) fail(415, "FILE_CONTENT_TYPE", "사업자등록증은 PDF, PNG, JPG로 첨부해주세요.");
  if (!name || name.length > 200 || /[/\\\x00-\x1f\x7f]/.test(name)) fail(422, "FILE_NAME", "파일 이름을 확인해주세요.");
  const hash = sha256(bytes);
  validateFileBytes(bytes, { name, mime, size: bytes.length, sha256: hash });
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  if (company.version !== version) fail(409, "VERSION_CONFLICT", "회사 정보가 변경되었습니다. 새로 불러와주세요.");
  const scan = await scanFile(bytes);
  if (!scan.clean) fail(422, "FILE_INFECTED", "안전하지 않은 파일입니다.");
  const storageKey = randomUUID();
  await privateFiles.write(storageKey, bytes);
  let oldId: string | undefined;
  try {
    const result = await db.$transaction(async tx => {
      const { deadlines } = await lockCompany(tx, ctx, version);
      await reserveQuota(tx, ctx.tenantId, bytes.length);
      const old = await tx.companyBusinessFile.findFirst({ where: { tenantId: ctx.tenantId, status: "active" } });
      if (old) { oldId = old.id; await tx.companyBusinessFile.update({ where: { id: old.id }, data: { status: "deleting" } }); }
      const file = await tx.companyBusinessFile.create({ data: { tenantId: ctx.tenantId, nameCipher: encrypt(name),
        mime, size: bytes.length, sha256: hash, storageKey, scanEngine: scan.engine, scannedAt: new Date() } });
      await tx.company.update({ where: { id: ctx.tenantId }, data: { version: { increment: 1 } } });
      await audit(tx, ctx, requestId, "company.business_file_uploaded", "company", ctx.tenantId, ["businessFile"]);
      assertFileDeadlines(deadlines);
      return { businessFile: businessFileDto(file), version: version + 1 };
    });
    if (oldId) await finishBusinessFileDeletion(oldId).catch(() => {}); // The worker retries storage deletion; access is already revoked.
    return result;
  } catch (error) { await privateFiles.remove(storageKey); throw error; }
}
export async function deleteBusinessFile(ctx: Context, version: number, requestId: string) {
  const id = await db.$transaction(async tx => {
    const { deadlines } = await lockCompany(tx, ctx, version);
    const file = await tx.companyBusinessFile.findFirst({ where: { tenantId: ctx.tenantId, status: "active" } });
    if (!file) fail(404, "NOT_FOUND", "사업자등록증을 찾을 수 없습니다.");
    await tx.companyBusinessFile.update({ where: { id: file.id }, data: { status: "deleting" } });
    await tx.company.update({ where: { id: ctx.tenantId }, data: { version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "company.business_file_removed", "company", ctx.tenantId, ["businessFile"]);
    assertFileDeadlines(deadlines);
    return file.id;
  });
  try { await finishBusinessFileDeletion(id); }
  catch { fail(503, "FILE_DELETE_PENDING", "파일 접근을 차단했습니다. 저장소 삭제를 다시 처리하고 있습니다."); }
}
export async function downloadBusinessFile(ctx: Context, fileId: string | undefined, requestId: string) {
  return db.$transaction(async tx => {
    const { deadlines } = await lockCompany(tx, ctx);
    const file = await tx.companyBusinessFile.findFirst({ where: { tenantId: ctx.tenantId, status: "active", ...(fileId ? { id: fileId } : {}) } });
    if (!file || !file.storageKey || !file.nameCipher || !file.mime || !file.sha256) fail(404, "NOT_FOUND", "사업자등록증을 찾을 수 없습니다.");
    const bytes = await privateFiles.read(file.storageKey), name = decrypt<string>(file.nameCipher);
    validateFileBytes(bytes, { name, mime: file.mime, size: file.size, sha256: file.sha256 });
    await audit(tx, ctx, requestId, "company.business_file_downloaded", "company", ctx.tenantId, []);
    assertFileDeadlines(deadlines);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": file.mime, "Content-Length": String(bytes.length),
      "Content-Disposition": "attachment; filename=\"business-registration\"; filename*=UTF-8''" + encodeURIComponent(name).replaceAll("'", "%27"),
      "X-Content-SHA256": file.sha256, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store" } });
  }, { timeout: 15000 });
}
