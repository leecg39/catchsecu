import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as create, GET as read, PATCH as update, DELETE as remove } from "@/app/api/v1/kakao/[...segments]/route";
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

test("로컬 공급자는 채널 확인·심사·발송을 영수증과 함께 완료하고 반려 표지를 반려한다", async () => {
  const saved = { provider: env.KAKAO_PROVIDER, dir: env.LOCAL_KAKAO_DIR };
  env.KAKAO_PROVIDER = "local"; env.LOCAL_KAKAO_DIR = ".local/catchsecu_test/kakao-" + randomUUID();
  try {
    const email = "kakao-local-" + randomUUID() + "@catchsecu.test";
    expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "알림톡", email, password }))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const company = await db.company.create({ data: { name: "로컬 알림톡", publicName: "로컬", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "로컬 서비스", externalName: "로컬" } } }, include: { services: true } });
    const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const serviceId = company.services[0].id;
    const channel = await (await create(req("/kakao/channels", cookie, "POST", { serviceId, name: "안내", searchId: "@local" }, randomUUID()))).json();
    const verified = await create(req("/kakao/channels/" + channel.id + "/verify", cookie, "POST", {}));
    expect(verified.status).toBe(200);
    expect((await verified.json()).status).toBe("verified");
    expect((await create(req("/kakao/channels/" + channel.id + "/verify", cookie, "POST", {}))).status).toBe(409);
    const template = await (await create(req("/kakao/templates", cookie, "POST", { serviceId, channelId: channel.id, name: "접수", body: "#{name}님 안내", buttons: [] }, randomUUID()))).json();
    const submitted = await create(req("/kakao/templates/" + template.id + "/submit", cookie, "POST", { version: template.version }));
    expect((await submitted.json()).status).toBe("approved");
    expect(((await (await read(req("/kakao/templates/" + template.id + "/review?serviceId=" + serviceId, cookie))).json()).providerMatched)).toBe(true);
    const sent = await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", {}));
    expect(sent.status).toBe(200);
    const delivery = await sent.json();
    expect(delivery.status).toBe("local_delivered");
    expect(delivery.receiptId).toBe("local-kakao:" + template.id);
    const receipt = JSON.parse(await readFile(resolve(env.LOCAL_KAKAO_DIR, template.id + ".json"), "utf8"));
    expect(receipt).toMatchObject({ templateId: template.id, channelId: channel.id, status: "local_delivered" });
    const rejected = await (await create(req("/kakao/templates", cookie, "POST", { serviceId, channelId: channel.id, name: "반려", body: "#반려 마커", buttons: [] }, randomUUID()))).json();
    const rejectedSubmit = await create(req("/kakao/templates/" + rejected.id + "/submit", cookie, "POST", { version: rejected.version }));
    expect((await rejectedSubmit.json()).status).toBe("rejected");
    expect((await db.kakaoTemplate.findUniqueOrThrow({ where: { id: rejected.id } })).reviewNote).toContain("반려");
    expect((await create(req("/kakao/templates/" + rejected.id + "/send", cookie, "POST", {}))).status).toBe(409);
  } finally { env.KAKAO_PROVIDER = saved.provider; env.LOCAL_KAKAO_DIR = saved.dir; }
});

async function detailFixture() {
  const email = "kakao-detail-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "템플릿 상세", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "상세 시험", publicName: "상세", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "상세 서비스", externalName: "상세" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const serviceId = company.services[0].id;
  const channel = await (await create(req("/kakao/channels", cookie, "POST", { serviceId, name: "상세", searchId: "@detail" }, randomUUID()))).json();
  const template = await (await create(req("/kakao/templates", cookie, "POST", { serviceId, channelId: channel.id, name: "접수", body: "#{name}님 안내", buttons: [] }, randomUUID()))).json();
  return { cookie, template, companyId: company.id };
}
test("같은 버전의 동시 수정은 한 건만 저장하고 충돌 요청은 원문·감사를 바꾸지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  const replies = await Promise.all(["첫 변경", "둘째 변경"].map(body => update(req("/kakao/templates/" + template.id, cookie, "PATCH", { name: template.name, body, buttons: [], version: template.version }))));
  expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
  const row = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } }); expect(row.version).toBe(template.version + 1);
  expect(await db.auditEvent.count({ where: { resourceId: template.id, action: "kakao.template_updated" } })).toBe(1);
});
test("심사 중·보관 템플릿은 수정으로 초안에 복귀할 수 없다", async () => {
  const { cookie, template } = await detailFixture();
  const submitted = await (await create(req("/kakao/templates/" + template.id + "/submit", cookie, "POST", { version: template.version }))).json();
  expect(submitted.status).toBe("submitted");
  const path = "/kakao/templates/" + template.id, patch = { name: template.name, body: "심사 중 덮어쓰기", buttons: [], version: submitted.version };
  expect((await update(req(path, cookie, "PATCH", patch))).status).toBe(409);
  await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "archived", version: { increment: 1 } } });
  expect((await update(req(path, cookie, "PATCH", { ...patch, version: submitted.version + 1 }))).status).toBe(409);
  expect((await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } })).status).toBe("archived");
});
test("알 수 없는 상세 하위 경로를 정상 조회·수정으로 처리하지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  for (const suffix of ["/unknown", "/review/extra"]) expect((await read(req("/kakao/templates/" + template.id + suffix, cookie))).status).toBe(404);
  expect((await update(req("/kakao/templates/" + template.id + "/unknown", cookie, "PATCH", { name: template.name, body: template.body, buttons: [], version: template.version }))).status).toBe(404);
});

import { requireContext } from "@/server/context";
import { readKakaoTemplate } from "@/server/kakao";
test("이전에 읽은 회사 컨텍스트도 강화된 MFA·세션 정책을 다시 적용한다", async () => {
  const { cookie, template, companyId } = await detailFixture();
  const ctx = await requireContext(req("/context", cookie).headers, "message.manage");
  await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: true } });
  await expect(readKakaoTemplate(ctx, template.id)).rejects.toMatchObject({ status: 403 });
  await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: false, sessionMinutes: 5 } });
  await db.session.update({ where: { id: ctx.session.id }, data: { updatedAt: new Date(Date.now() - 360000) } });
  await expect(readKakaoTemplate(ctx, template.id)).rejects.toMatchObject({ status: 401 });
});


test("동시 초안 삭제는 한 번만 성공하고 보관은 최신 버전으로 검사한다", async () => {
  const { cookie, template } = await detailFixture();
  const request = () => new Request(origin + "/api/v1/kakao/templates/" + template.id, { method: "DELETE", headers: { origin, cookie, "if-match": String(template.version) } });
  const replies = await Promise.all([remove(request()), remove(request())]);
  expect(replies.filter(r => r.status === 204)).toHaveLength(1);
  expect(replies.filter(r => [404, 409].includes(r.status))).toHaveLength(1);
  expect(await db.kakaoTemplate.count({ where: { id: template.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: template.id, action: "kakao.template_deleted" } })).toBe(1);
});
