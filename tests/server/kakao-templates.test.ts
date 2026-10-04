import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as create, GET as read, PATCH as update } from "@/app/api/v1/kakao/[...segments]/route";
import { applyKakaoReview } from "@/server/kakao";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Kakao-template!123", secret = "kakao-review-secret-0123456789abcdef";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
function sign(body: string) { return createHmac("sha256", secret).update(body).digest("hex"); }
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("승인되지 않은 알림톡은 발송하지 않고 수정하면 심사를 다시 요구한다", async () => {
  const email = "kakao-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "알림톡", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "알림톡 회사", publicName: "알림톡", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "알림톡 서비스", externalName: "알림톡" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const serviceId = company.services[0].id;
  const channelResponse = await create(req("/kakao/channels", cookie, "POST", { serviceId, name: "안내", searchId: "@guide" }, randomUUID()));
  expect(channelResponse.status).toBe(201);
  const channel = await channelResponse.json();
  expect((await create(req("/kakao/channels", cookie, "POST", { serviceId, name: "중복", searchId: "@guide" }, randomUUID()))).status).toBe(409);
  expect((await create(req("/kakao/channels/" + channel.id + "/verify", cookie, "POST", {}))).status).toBe(503);
  expect((await db.kakaoChannel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("pending");
  const templateResponse = await create(req("/kakao/templates", cookie, "POST", { serviceId, channelId: channel.id, name: "접수", body: "#{name}님 안내", buttons: [] }, randomUUID()));
  expect(templateResponse.status).toBe(201);
  const template = await templateResponse.json();
  const submitted = await create(req("/kakao/templates/" + template.id + "/submit", cookie, "POST", { version: template.version }));
  expect(submitted.status).toBe(200);
  expect((await submitted.json()).status).toBe("submitted");
  expect((await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", {}))).status).toBe(409);
  const approvedBody = JSON.stringify({ kind: "template", id: template.id, outcome: "approved", note: "" });
  await expect(applyKakaoReview(approvedBody, "00", secret)).rejects.toMatchObject({ status: 401 });
  expect((await applyKakaoReview(approvedBody, sign(approvedBody), secret)).status).toBe("approved");
  expect((await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", {}))).status).toBe(409);
  const verifiedBody = JSON.stringify({ kind: "channel", id: channel.id, outcome: "verified", note: "" });
  expect((await applyKakaoReview(verifiedBody, sign(verifiedBody), secret)).status).toBe("verified");
  expect((await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", {}))).status).toBe(503);
  const current = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const edited = await update(req("/kakao/templates/" + template.id, cookie, "PATCH", { name: "접수", body: "#{name}님 변경", buttons: [], version: current.version }));
  expect((await edited.json()).status).toBe("draft");
  expect((await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", {}))).status).toBe(409);
  expect((await read(req("/kakao/templates?serviceId=" + serviceId, cookie))).status).toBe(200);
});
