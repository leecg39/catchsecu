import type { Sender } from "@/generated/prisma/client";
import type { Transaction } from "./db";
import { decrypt } from "./crypto";
import { fail } from "./http";
import { emailTransportDenial, solapiConfigured } from "./sender-providers";

export function senderDenial(row: Sender) {
  if (row.status !== "verified") return "인증을 완료한 발신자만 사용할 수 있습니다.";
  if (!row.expiresAt || row.expiresAt <= new Date()) return "발신자 인증이 만료되었습니다.";
  return row.channel === "email" ? emailTransportDenial(row.domain!, row.environment) : solapiConfigured(row.tenantId) && row.environment === "live" ? null : "이 회사의 문자 공급자 연결이 필요합니다.";
}
export async function requireVerifiedSender(tx: Transaction, input: { tenantId: string; serviceId: string; id: string; version: number; channel: "email" | "sms" }) {
  await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${input.id} AND "tenantId"=${input.tenantId} FOR SHARE`;
  const row = await tx.sender.findFirst({ where: { id: input.id, tenantId: input.tenantId, serviceId: input.serviceId, channel: input.channel, version: input.version, service: { status: "active", tenant: { status: "active" } } } });
  if (!row || senderDenial(row)) fail(409, "SENDER_UNAVAILABLE", "현재 인증된 발신자와 최신 버전을 선택해주세요.");
  return { row, address: decrypt<string>(row.addressCipher!) };
}
export async function lockSenderForFile(tx: Transaction, file: { senderId: string | null; tenantId: string; serviceId: string }) {
  await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${file.senderId} AND "tenantId"=${file.tenantId} FOR SHARE`;
  const row = await tx.sender.findFirst({ where: { id: file.senderId!, tenantId: file.tenantId, serviceId: file.serviceId, channel: "sms", status: { not: "deleted" } } });
  if (!row) fail(410, "SENDER_UNAVAILABLE", "발신번호의 증빙을 사용할 수 없습니다.");
}
