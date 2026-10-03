import { db, type Transaction } from "./db";
import { fail } from "./http";
export async function mfaState(tenantId: string, memberId: string, enrolled: boolean, required: boolean, client: Pick<Transaction,"mfaException"> = db, now = new Date()) {
  if (!required || enrolled) return { required: false, deadline: null as Date|null };
  const exception = await client.mfaException.findUnique({ where: { tenantId_memberId: { tenantId, memberId } } });
  if (exception && exception.expiresAt > now) return { required: false, deadline: exception.expiresAt };
  return { required: true, deadline: null as Date|null };
}
export async function assertCompanyMfa(tenantId: string, memberId: string, enrolled: boolean, required: boolean, client: Pick<Transaction,"mfaException"> = db) {
  const state = await mfaState(tenantId, memberId, enrolled, required, client);
  if (state.required) fail(403, "MFA_REQUIRED", "2단계 인증 등록이 필요합니다. 임시 예외는 만료 시 바로 종료됩니다.");
  return state.deadline;
}
