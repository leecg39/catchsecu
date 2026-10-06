import type { Transaction } from "./db";

/** 채널 → 템플릿 순서로 잠그고 다시 읽는다. 호출자는 회사·서비스·현재 권한을 먼저 잠근다. */
export async function lockKakaoBinding(tx: Transaction, tenantId: string, serviceId: string, id: string | null) {
  if (!id) return null;
  const initial = await tx.kakaoTemplate.findFirst({ where: { id, tenantId, serviceId }, select: { channelId: true } });
  if (!initial) return null;
  await tx.$queryRaw`SELECT id FROM "KakaoChannel" WHERE id=${initial.channelId} AND "tenantId"=${tenantId} AND "serviceId"=${serviceId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "KakaoTemplate" WHERE id=${id} AND "tenantId"=${tenantId} AND "serviceId"=${serviceId} FOR SHARE`;
  const row = await tx.kakaoTemplate.findFirst({ where: { id, tenantId, serviceId }, include: { channel: true } });
  if (!row || row.channelId !== initial.channelId || row.channel.serviceId !== serviceId) return null;
  return row;
}
