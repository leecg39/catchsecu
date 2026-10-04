import { createHmac, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { applySmsReceipt, deliverSms } from "@/server/sms-adapter";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const secret = "sms-webhook-secret-0123456789abcdef";
function sign(body: string) { return createHmac("sha256", secret).update(body).digest("hex"); }
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("공급자가 없으면 문자를 보내지 않고 로컬 영수증과 서명된 결과만 기록한다", async () => {
  const jobId = randomUUID();
  await expect(deliverSms({ transport: "unconfigured", jobId, to: "01000000000", from: "0212345678", text: "안내" })).rejects.toMatchObject({ code: "SMS_PROVIDER_REQUIRED" });
  const local = await deliverSms({ transport: "local", jobId, to: "01000000000", from: "0212345678", text: "안내" });
  expect(local.status).toBe("local_delivered");
  const file = await readFile(resolve(env.LOCAL_SMS_DIR, jobId + ".json"), "utf8");
  expect(file).not.toContain("sent");
  await rm(resolve(env.LOCAL_SMS_DIR, jobId + ".json"));
  const company = await db.company.create({ data: { name: "문자 회사", publicName: "문자", policy: { create: {} }, services: { create: { name: "문자 서비스", externalName: "문자" } } }, include: { services: true } });
  const user = await db.user.create({ data: { name: "문자", email: "sms-" + randomUUID() + "@catchsecu.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const delivery = await db.$transaction(async tx => {
    const campaign = await tx.campaign.create({ data: { tenantId: company.id, serviceId: company.services[0].id, creatorId: user.id, channel: "sms", source: "direct", title: "문자", expiresAt: new Date(Date.now() + 86400000) } });
    await tx.campaignEvent.create({ data: { tenantId: company.id, campaignId: campaign.id, version: 1, kind: "created", actorId: user.id } });
    return tx.campaignDelivery.create({ data: { tenantId: company.id, serviceId: company.services[0].id, campaignId: campaign.id, position: 1, contactHash: "a".repeat(64), status: "draft" } });
  });
  const body = JSON.stringify({ deliveryId: delivery.id, receiptId: "provider-receipt-1", outcome: "accepted" });
  await expect(applySmsReceipt(body, "00", secret)).rejects.toMatchObject({ status: 401 });
  const applied = await applySmsReceipt(body, sign(body), secret);
  expect(applied).toMatchObject({ status: "provider_accepted", duplicate: false });
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("draft");
  expect(await applySmsReceipt(body, sign(body), secret)).toMatchObject({ duplicate: true, status: "provider_accepted" });
  const other = JSON.stringify({ deliveryId: delivery.id, receiptId: "provider-receipt-2", outcome: "failed" });
  await expect(applySmsReceipt(other, sign(other), secret)).rejects.toMatchObject({ status: 409 });
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).not.toBe("sent");
});
