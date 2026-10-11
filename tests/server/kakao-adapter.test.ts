import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { applyKakaoReceipt, deliverKakaoAlimtalk, fetchKakaoTemplateStatus, registerKakaoTemplate, resolveKakaoChannelPfId } from "@/server/kakao-adapter";
import { POST as kakaoReceiptRoute } from "@/app/api/v1/kakao/receipts/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const secret = "kakao-webhook-secret-0123456789abcdef";
function sign(body: string, key = secret) { return createHmac("sha256", key).update(body).digest("hex"); }
function receiptRequest(body: string, signature: string) {
  return new Request(new URL("/api/v1/kakao/receipts", env.BETTER_AUTH_URL), { method: "POST", body,
    headers: { "content-type": "application/json", "x-kakao-signature": signature } });
}
function solapiEnv(tenantId: string) {
  const saved = [env.KAKAO_PROVIDER, env.SOLAPI_TENANT_ID, env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET] as const;
  env.KAKAO_PROVIDER = "solapi"; env.SOLAPI_TENANT_ID = tenantId;
  env.SOLAPI_API_KEY = "test-kakao-key"; env.SOLAPI_API_SECRET = "test-kakao-secret";
  return () => { [env.KAKAO_PROVIDER, env.SOLAPI_TENANT_ID, env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET] = saved; };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("solapi 채널·템플릿·발송은 HMAC 서명과 페이로드를 검증하고 거부를 매핑한다", async () => {
  const tenantId = randomUUID(), restore = solapiEnv(tenantId);
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const path = String(url);
    if (path.includes("/kakao/v2/channels")) {
      const body = JSON.parse((init as RequestInit)?.body as string ?? "null");
      expect(body).toBeNull();
      return new Response(JSON.stringify({ channelList: [{ pfId: "pf-1", channelId: "@other" }, { pfId: "pf-hit", channelId: "@catchsecu" }] }), { status: 200 });
    }
    if (path.includes("/kakao/v2/templates/"))
      return new Response(JSON.stringify({ status: "A" }), { status: 200 });
    if (path.endsWith("/kakao/v2/templates")) {
      expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ pfId: "pf-hit", name: "환영", content: "#{name}님 안녕", buttons: [{ buttonName: "확인", buttonType: "WL", linkMo: "https://example.com", linkPc: "https://example.com" }] });
      return new Response(JSON.stringify({ templateId: "pt-99" }), { status: 200 });
    }
    if (path.endsWith("/messages/v4/send")) {
      const to = JSON.parse((init as RequestInit).body as string).message.to;
      if (to === "reject-me") return new Response(JSON.stringify({ statusCode: "4000", statusMessage: "rejected" }), { status: 200 });
      return new Response(JSON.stringify({ groupId: "kg-1", messageId: "km-1", statusCode: "2000" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    await expect(deliverKakaoAlimtalk({ tenantId: randomUUID(), to: "010", pfId: "pf", templateId: "pt", variables: {} }))
      .rejects.toMatchObject({ code: "KAKAO_PROVIDER_REQUIRED" });
    await expect(resolveKakaoChannelPfId(tenantId, "@cached", "cached-pf")).resolves.toBe("cached-pf");
    expect(calls).toHaveLength(0);
    const pfId = await resolveKakaoChannelPfId(tenantId, "@catchsecu");
    expect(pfId).toBe("pf-hit");
    expect(calls[0].url).toBe("https://api.solapi.com/kakao/v2/channels?searchId=" + encodeURIComponent("@catchsecu"));
    await expect(resolveKakaoChannelPfId(tenantId, "@missing")).rejects.toMatchObject({ code: "KAKAO_CHANNEL_NOT_LINKED" });
    const templateId = await registerKakaoTemplate(tenantId, { pfId: "pf-hit", name: "환영", body: "#{name}님 안녕", buttons: [{ name: "확인", type: "WL", link: "https://example.com" }] });
    expect(templateId).toBe("pt-99");
    expect((await fetchKakaoTemplateStatus(tenantId, "pt-99")).status).toBe("approved");
    const sent = await deliverKakaoAlimtalk({ tenantId, to: "01000000000", pfId: "pf-hit", templateId: "pt-99", variables: { "#{name}": "길동" } });
    expect(sent).toMatchObject({ status: "provider_accepted", receiptId: "solapi-kakao:kg-1:km-1" });
    const sendCall = calls.find(c => c.url.endsWith("/messages/v4/send"))!;
    const auth = (sendCall.init.headers as Record<string, string>).Authorization;
    const m = /date=([^,]+), salt=([0-9a-f]{32}), signature=([0-9a-f]{64})/.exec(auth)!;
    expect(m[3]).toBe(createHmac("sha256", "test-kakao-secret").update(m[1] + m[2]).digest("hex"));
    expect(JSON.parse(sendCall.init.body as string).message).toMatchObject({ to: "01000000000", kakaoOptions: { pfId: "pf-hit", templateId: "pt-99", variables: { "#{name}": "길동" }, disableSms: true } });
    await expect(deliverKakaoAlimtalk({ tenantId, to: "reject-me", pfId: "pf", templateId: "pt", variables: {} })).rejects.toMatchObject({ code: "KAKAO_PROVIDER_REJECTED" });
    globalThis.fetch = async () => new Response("<html>500</html>", { status: 500 });
    await expect(deliverKakaoAlimtalk({ tenantId, to: "010", pfId: "pf", templateId: "pt", variables: {} })).rejects.toMatchObject({ code: "KAKAO_PROVIDER_UNAVAILABLE" });
  } finally { restore(); globalThis.fetch = originalFetch; }
});

test("서명된 카카오 영수증은 멱등 저장하고 중복·회차 불일치를 차단한다", async () => {
  const company = await db.company.create({ data: { name: "카카오 회사", publicName: "카카오", policy: { create: {} }, services: { create: { name: "카카오 서비스", externalName: "카카오" } } }, include: { services: true } });
  const user = await db.user.create({ data: { name: "카카오", email: "kakao-" + randomUUID() + "@catchsecu.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const delivery = await db.$transaction(async tx => {
    const campaign = await tx.campaign.create({ data: { tenantId: company.id, serviceId: company.services[0].id, creatorId: user.id, channel: "kakao", source: "direct", title: "카카오", expiresAt: new Date(Date.now() + 86400000) } });
    await tx.campaignEvent.create({ data: { tenantId: company.id, campaignId: campaign.id, version: 1, kind: "created", actorId: user.id } });
    return tx.campaignDelivery.create({ data: { tenantId: company.id, serviceId: company.services[0].id, campaignId: campaign.id, position: 1, contactHash: "a".repeat(64), status: "draft" } });
  });
  const body = JSON.stringify({ deliveryId: delivery.id, receiptId: "kakao-receipt-1", outcome: "accepted" });
  const savedSecret = env.KAKAO_WEBHOOK_SECRET;
  let applied: { status: string; duplicate: boolean };
  try {
    env.KAKAO_WEBHOOK_SECRET = secret;
    expect((await kakaoReceiptRoute(receiptRequest(body, "00"))).status).toBe(401);
    const response = await kakaoReceiptRoute(receiptRequest(body, sign(body)));
    expect(response.status).toBe(202);
    applied = await response.json();
  } finally { env.KAKAO_WEBHOOK_SECRET = savedSecret; }
  expect(applied).toMatchObject({ status: "provider_accepted", duplicate: false });
  const row = await db.kakaoReceipt.findUniqueOrThrow({ where: { deliveryId_attempt: { deliveryId: delivery.id, attempt: 1 } } });
  expect(row.status).toBe("provider_accepted");
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("draft");
  expect(await applyKakaoReceipt(body, sign(body), secret)).toMatchObject({ duplicate: true, status: "provider_accepted" });
  const other = JSON.stringify({ deliveryId: delivery.id, receiptId: "kakao-receipt-2", outcome: "failed" });
  await expect(applyKakaoReceipt(other, sign(other), secret)).rejects.toMatchObject({ status: 409 });
  const stale = JSON.stringify({ deliveryId: delivery.id, receiptId: "kakao-receipt-3", outcome: "failed", attempt: 2 });
  await expect(applyKakaoReceipt(stale, sign(stale), secret)).rejects.toMatchObject({ code: "STALE_KAKAO_RECEIPT" });
  await expect(applyKakaoReceipt(body, sign(body), undefined)).rejects.toMatchObject({ code: "KAKAO_PROVIDER_REQUIRED" });
});
