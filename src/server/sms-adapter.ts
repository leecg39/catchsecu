import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { fail } from "./http";

const receiptBody = z.object({
  deliveryId: z.uuid(),
  receiptId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  outcome: z.enum(["accepted", "failed", "timeout"]),
}).strict();
export type SmsReceiptResult = { deliveryId: string; receiptId: string; status: "provider_accepted" | "failed" | "unknown"; duplicate: boolean };

export function classifySms(text: string) {
  if (text.length === 0 || text.length > 2000) fail(422, "MESSAGE_TOO_LONG", "문자는 1자 이상 2,000자 이하여야 합니다.");
  return text.length <= 45 ? "sms" : "lms";
}
export async function smsReceiptFile(jobId: string) {
  try { return (await stat(resolve(env.LOCAL_SMS_DIR, jobId + ".json"))).mtime; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function deliverSms(input: { transport: "unconfigured" | "local"; jobId: string; to: string; from: string; text: string }) {
  if (input.transport !== "local") fail(503, "SMS_PROVIDER_REQUIRED", "문자 전송·요금 공급자를 연결한 뒤 발송할 수 있습니다.");
  const kind = classifySms(input.text);
  await mkdir(env.LOCAL_SMS_DIR, { recursive: true });
  const receipt = { jobId: input.jobId, to: input.to, from: input.from, kind, status: "local_delivered", at: new Date().toISOString() };
  await writeFile(resolve(env.LOCAL_SMS_DIR, input.jobId + ".json"), JSON.stringify(receipt));
  return { status: "local_delivered" as const, receiptId: "local:" + input.jobId, kind };
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function applySmsReceipt(raw: string, signature: string, secret: string | undefined): Promise<SmsReceiptResult> {
  if (!secret) fail(503, "SMS_PROVIDER_REQUIRED", "문자 결과 수신 비밀이 설정되지 않았습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "SMS_SIGNATURE_INVALID", "문자 결과 서명을 확인할 수 없습니다.");
  const input = receiptBody.parse(JSON.parse(raw));
  const status = input.outcome === "accepted" ? "provider_accepted" : input.outcome === "timeout" ? "unknown" : "failed";
  return db.$transaction(async tx => {
    const delivery = await tx.campaignDelivery.findUnique({ where: { id: input.deliveryId } });
    if (!delivery) fail(404, "NOT_FOUND", "문자 발송 기록을 찾을 수 없습니다.");
    const existing = await tx.smsReceipt.findUnique({ where: { deliveryId: delivery.id } });
    if (existing) {
      if (existing.receiptId !== input.receiptId) fail(409, "DUPLICATE_WEBHOOK", "이미 다른 문자 결과가 기록되어 있습니다.");
      return { deliveryId: delivery.id, receiptId: existing.receiptId, status: existing.status as SmsReceiptResult["status"], duplicate: true };
    }
    await tx.smsReceipt.create({ data: { tenantId: delivery.tenantId, deliveryId: delivery.id, receiptId: input.receiptId, status } });
    const deliveryStatus = status === "provider_accepted" ? "accepted" : status;
    if (["queued", "sending", "local_delivered"].includes(delivery.status) && (deliveryStatus !== "accepted" || delivery.preferenceId)) {
      await tx.campaignDelivery.update({ where: { id: delivery.id }, data: { status: deliveryStatus, reason: deliveryStatus === "accepted" ? null : input.outcome.toUpperCase(), ...(deliveryStatus === "accepted" ? { acceptedAt: new Date() } : {}) } });
    }
    return { deliveryId: delivery.id, receiptId: input.receiptId, status, duplicate: false };
  });
}
