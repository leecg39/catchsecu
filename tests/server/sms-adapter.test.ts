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

test("solapi 전송은 키 없으면 거부하고 응답 코드를 매핑한다", async () => {
  const jobId = randomUUID();
  if (env.SOLAPI_API_KEY) {
    expect(env.SOLAPI_API_SECRET).toBeTruthy();
    return;
  }
  await expect(deliverSms({ transport: "solapi", jobId, to: "01000000000", from: "0212345678", text: "안내" })).rejects.toMatchObject({ code: "SMS_PROVIDER_REQUIRED" });
});

test("solapi mock fetch는 HMAC 서명·페이로드·영수증 매핑을 검증한다", async () => {
  const key = "test-solapi-key", apiSecret = "test-solapi-secret";
  const saved = [env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET];
  env.SOLAPI_API_KEY = key; env.SOLAPI_API_SECRET = apiSecret;
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init as RequestInit });
    if (init && init.body && JSON.parse(init.body as string).message.to === "reject-me") {
      return new Response(JSON.stringify({ messageId: "m1", groupId: "g1", to: "01000000000", type: "SMS", statusCode: "4000", statusMessage: "rejected" }), { status: 200 });
    }
    return new Response(JSON.stringify({ messageId: "mid-1", groupId: "gid-1", to: "01000000000", type: "SMS", statusCode: "2000", statusMessage: "ok" }), { status: 200 });
  };
  try {
    const sent = await deliverSms({ transport: "solapi", jobId: randomUUID(), to: "01000000000", from: "0212345678", text: "안녕" });
    expect(sent.receiptId).toBe("solapi:gid-1:mid-1");
    expect(sent.status).toBe("provider_accepted");
    const call = calls[0];
    expect(call.url).toBe("https://api.solapi.com/messages/v4/send");
    const auth = (call.init.headers as Record<string, string>).Authorization;
    expect(auth).toContain(`apiKey=${key}`);
    expect(auth).toMatch(/^HMAC-SHA256 /);
    const m = /date=([^,]+), salt=([0-9a-f]{32}), signature=([0-9a-f]{64})/.exec(auth)!;
    const expected = createHmac("sha256", apiSecret).update(m[1] + m[2]).digest("hex");
    expect(m[3]).toBe(expected);
    const payload = JSON.parse(call.init.body as string);
    expect(payload.message).toMatchObject({ to: "01000000000", from: "0212345678", text: "안녕", type: "SMS" });
    await deliverSms({ transport: "solapi", jobId: randomUUID(), to: "01000000000", from: "0212345678", text: "가".repeat(100) });
    expect(JSON.parse(calls[1].init.body as string).message.type).toBe("LMS");
    await expect(deliverSms({ transport: "solapi", jobId: randomUUID(), to: "reject-me", from: "0212345678", text: "x" })).rejects.toMatchObject({ code: "SMS_PROVIDER_REJECTED" });
    globalThis.fetch = async () => new Response("<html>500</html>", { status: 500 });
    await expect(deliverSms({ transport: "solapi", jobId: randomUUID(), to: "01000000000", from: "0212345678", text: "x" })).rejects.toMatchObject({ code: "SMS_PROVIDER_UNAVAILABLE" });
  } finally { [env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET] = saved; globalThis.fetch = originalFetch; }
});
