import { z } from "zod";
import { db } from "./db";
import { audit } from "./audit";
import { roleCan } from "./permissions";
import type { Context } from "./context";
import { LEGACY_SECTIONS, type LegacyImportInput, type LegacyImportResult, type LegacySectionPlan } from "@/contracts/migration";

const SECRET_FIELD = /password|passwd|secret|credential|api[_-]?key|private[_-]?key|token|토큰|비밀|인증키|주민등록|session[_-]?key/i;
const profileFields = {
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30),
  department: z.string().trim().max(100),
  jobTitle: z.string().trim().max(100),
} as const;
const companyFields = {
  address: z.string().trim().max(300),
  phone: z.string().trim().max(30),
  businessNo: z.string().regex(/^\d{3}-\d{2}-\d{5}$/, "사업자등록번호 형식이 아닙니다."),
  billingEmail: z.email("이메일 형식이 아닙니다."),
  billingContactName: z.string().trim().max(100),
  billingContactPhone: z.string().trim().max(30),
} as const;
type FieldSchemas = Record<string, z.ZodType<string>>;

function planSection(raw: Record<string, unknown>, schemas: FieldSchemas, current: Record<string, string | null>, rejected: { section: string; field: string }[], section: string): { plan: LegacySectionPlan; writes: Record<string, string> } {
  const plan: LegacySectionPlan = { status: "ready", changes: [], unchanged: [], quarantined: [] };
  const writes: Record<string, string> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (SECRET_FIELD.test(field)) { rejected.push({ section, field }); continue; }
    const schema = schemas[field];
    if (!schema) { plan.quarantined.push({ field, reason: "이관 대상이 아닌 필드입니다." }); continue; }
    const parsed = schema.safeParse(typeof value === "string" ? value : "");
    if (!parsed.success) { plan.quarantined.push({ field, reason: parsed.error.issues[0]?.message ?? "형식이 올바르지 않습니다." }); continue; }
    const before = current[field] ?? "";
    if (before === parsed.data) plan.unchanged.push(field);
    else { plan.changes.push({ field, from: before || null, to: parsed.data }); writes[field] = parsed.data; }
  }
  return { plan, writes };
}

export async function migrateLegacy(ctx: Context, input: LegacyImportInput, requestId: string): Promise<LegacyImportResult> {
  const rejectedSecrets: { section: string; field: string }[] = [];
  const unknownSections = Object.keys(input.sections).filter(name => !(LEGACY_SECTIONS as readonly string[]).includes(name));
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true, phone: true, department: true, jobTitle: true } });
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { address: true, phone: true, businessNo: true, billingEmail: true, billingContactName: true, billingContactPhone: true } });
  const result: LegacyImportResult = { dryRun: input.dryRun, applied: false, rejectedSecrets, unknownSections };
  const writes: { profile: Record<string, string>; company: Record<string, string> } = { profile: {}, company: {} };
  if (input.sections.profile) {
    const { plan, writes: w } = planSection(input.sections.profile, profileFields, user, rejectedSecrets, "profile");
    result.profile = plan; writes.profile = w;
  }
  if (input.sections.company) {
    if (!roleCan(ctx.member.role, "company.manage")) result.company = { status: "skipped", skippedReason: "회사 관리 권한이 필요합니다.", changes: [], unchanged: [], quarantined: [] };
    else {
      const { plan, writes: w } = planSection(input.sections.company, companyFields, company, rejectedSecrets, "company");
      result.company = plan; writes.company = w;
    }
  }
  if (!input.dryRun) {
    await db.$transaction(async tx => {
      if (Object.keys(writes.profile).length) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR UPDATE`;
        await tx.user.update({ where: { id: ctx.user.id }, data: { ...writes.profile, version: { increment: 1 } } });
      }
      if (Object.keys(writes.company).length) {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR UPDATE`;
        await tx.company.update({ where: { id: ctx.tenantId }, data: { ...writes.company, version: { increment: 1 } } });
      }
      await audit(tx, ctx, requestId, "migration.legacy_imported", "company", ctx.tenantId,
        [...Object.keys(writes.profile).map(f => "profile." + f), ...Object.keys(writes.company).map(f => "company." + f)]);
    });
    result.applied = true;
  }
  return result;
}
