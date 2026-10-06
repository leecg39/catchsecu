import type { Transaction } from "./db";

/** 최초 발송/최초 대체발송의 기존 키는 유지하고, 수동 재요청은 새 예약을 사용한다. */
export async function campaignLedgerSource(tx: Transaction, tenantId: string, deliveryId: string,
  attempt: number, channel: string, transport: string | null) {
  const fallback = channel === "kakao" && (transport === "sms-local" || transport === "sms-solapi");
  const legacy = deliveryId + (fallback ? ":fallback" : "");
  if (attempt === (fallback ? 2 : 1)) return legacy;
  const source = legacy + ":attempt:" + attempt;
  // 이전 빌드가 이미 예약/청구한 진행 건은 같은 원장으로 복구한다. 해제한 예약은 재사용하지 않는다.
  const holds = await tx.ledgerTransaction.findMany({ where: { tenantId, kind: "reserve", sourceKind: "campaign_delivery", sourceId: { in: [source, legacy] } } });
  if (holds.some(hold => hold.sourceId === source)) return source;
  const old = holds.find(hold => hold.sourceId === legacy);
  if (old && !await tx.ledgerTransaction.findFirst({ where: { reservationId: old.id, kind: "release" } })) return legacy;
  return source;
}
