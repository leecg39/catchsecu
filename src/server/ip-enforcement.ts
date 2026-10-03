import { db, type Transaction } from "./db";
import { containsAddress } from "./ip-network";
import { fail } from "./http";
export async function assertCompanyIp(tenantId: string, ip: string | null | undefined, client: Transaction = db) {
  const policy = await client.ipAccessPolicy.findUnique({ where: { tenantId } });
  if (!policy?.enabled) return;
  if (!ip) fail(403, "IP_ADDRESS_UNAVAILABLE", "접속 IP를 확인할 수 없어 회사에 접근할 수 없습니다.");
  const rules = await client.ipRule.findMany({ where: { tenantId, enabled: true }, select: { cidr: true } });
  if (!rules.some(rule => containsAddress(rule.cidr, ip))) fail(403, "IP_NOT_ALLOWED", "회사에서 허용한 IP에서 접속해주세요.");
}
