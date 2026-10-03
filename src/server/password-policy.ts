import { APIError } from "better-auth/api";
import type { SecurityPolicy } from "@/generated/prisma/client";
import { db } from "./db";

// Calendar months in the service's Korea time zone, clipped at month end.
export function addPolicyMonths(date: Date, months: number) {
  const shifted = new Date(date.getTime() + 9 * 3600000), day = shifted.getUTCDate();
  shifted.setUTCDate(1); shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return new Date(shifted.getTime() - 9 * 3600000);
}
export async function effectivePasswordRules(userId: string, client: Pick<typeof db, "membership"> = db) {
  const members = await client.membership.findMany({ where: { userId, status: "active", tenant: { status: "active" } },
    select: { tenant: { select: { policy: { select: { minPassword: true, passwordReuse: true } } } } } });
  return { minPassword: Math.max(12, ...members.map(member => member.tenant.policy?.minPassword ?? 12)),
    passwordReuse: Math.max(0, ...members.map(member => member.tenant.policy?.passwordReuse ?? 1)) };
}
export async function assertNextPassword(userId: string, password: string, verify: (data: { hash: string; password: string }) => Promise<boolean>) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== "active") throw new APIError("FORBIDDEN", { code: "ACCOUNT_UNAVAILABLE", message: "사용할 수 없는 계정입니다." });
  const rules = await effectivePasswordRules(userId);
  if (password.length < rules.minPassword || password.length > 128) throw new APIError("BAD_REQUEST", {
    code: "PASSWORD_POLICY", message: "새 비밀번호는 " + rules.minPassword + "~128자로 입력해주세요.",
  });
  if (!rules.passwordReuse) return;
  const current = await db.account.findFirst({ where: { userId, providerId: "credential" }, select: { password: true } });
  const history = rules.passwordReuse > 1 ? await db.passwordHistory.findMany({ where: { userId }, orderBy: { id: "desc" },
    take: rules.passwordReuse - 1, select: { passwordHash: true } }) : [];
  const hashes = [current?.password, ...history.map(row => row.passwordHash)].filter((value): value is string => !!value);
  // Verify sequentially so a single request does not fan out many expensive hashes.
  for (const hash of hashes) if (await verify({ hash, password })) throw new APIError("BAD_REQUEST", {
    code: "PASSWORD_REUSED", message: rules.passwordReuse === 1 ? "현재 비밀번호와 다른 비밀번호를 입력해주세요." : "최근 10개 비밀번호와 다른 비밀번호를 입력해주세요.",
  });
}
type PasswordActor = { id: string; passwordChangedAt: Date | null };
type PasswordSession = { id: string; expiresAt: Date };
type PasswordMember = { id: string; tenantId: string; tenant: { name: string; policy: SecurityPolicy | null } };
export async function passwordState(user: PasswordActor, session: PasswordSession, member: PasswordMember, now = new Date(), client: Pick<typeof db, "passwordDeferral"> = db) {
  const policy = member.tenant.policy, changedAt = user.passwordChangedAt;
  const deadline = policy?.passwordMonths && changedAt ? addPolicyMonths(changedAt, policy.passwordMonths) : null;
  const expired = !!deadline && deadline.getTime() <= now.getTime();
  const saved = expired ? await client.passwordDeferral.findUnique({ where: { tenantId_memberId: { tenantId: member.tenantId, memberId: member.id } } }) : null;
  const validDeferral = saved && policy && changedAt && policy.passwordDeferral !== "never"
    && saved.passwordRevision === policy.passwordRevision && saved.passwordChangedAt.getTime() === changedAt.getTime()
    && saved.mode === policy.passwordDeferral && saved.expiresAt > now
    && (saved.mode === "period" || saved.sessionId === session.id);
  return { tenantId: member.tenantId, companyName: member.tenant.name, passwordChangedAt: changedAt, deadline,
    expired, required: expired && !validDeferral, canDefer: expired && !validDeferral && policy?.passwordDeferral !== "never",
    deferralMode: policy?.passwordDeferral ?? "never", deferredUntil: validDeferral ? saved!.expiresAt : null,
    passwordMonths: policy?.passwordMonths ?? 0, passwordRevision: policy?.passwordRevision ?? 1 };
}
