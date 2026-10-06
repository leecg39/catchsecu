import { createHmac, randomUUID } from "node:crypto";


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
async function send(cookie: string, id: string, key = randomUUID()) {
  const row = await db.kakaoTemplate.findUniqueOrThrow({ where: { id } });
  return create(req("/kakao/templates/" + id + "/send", cookie, "POST", { version: row.version }, key));
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
  expect((await send(cookie, template.id)).status).toBe(409);
  const approvedBody = JSON.stringify({ kind: "template", id: template.id, version: template.version + 1, outcome: "approved", note: "" });
  await expect(applyKakaoReview(approvedBody, "00", secret)).rejects.toMatchObject({ status: 401 });
  expect((await applyKakaoReview(approvedBody, sign(approvedBody), secret)).status).toBe("approved");
  expect((await send(cookie, template.id)).status).toBe(409);
  const verifiedBody = JSON.stringify({ kind: "channel", id: channel.id, version: channel.version, outcome: "verified", note: "" });
  expect((await applyKakaoReview(verifiedBody, sign(verifiedBody), secret)).status).toBe("verified");
  expect((await send(cookie, template.id)).status).toBe(503);
  const current = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const edited = await update(req("/kakao/templates/" + template.id, cookie, "PATCH", { name: "접수", body: "#{name}님 변경", buttons: [], version: current.version }));
  expect((await edited.json()).status).toBe("draft");
  expect((await send(cookie, template.id)).status).toBe(409);
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
    const sent = await send(cookie, template.id);
    expect(sent.status).toBe(200);
    const delivery = await sent.json();
    expect(delivery.status).toBe("local_delivered");
    expect(delivery.receiptId).toBe("local-kakao:" + delivery.id);
    const receipt = await db.kakaoMockReceipt.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(receipt).toMatchObject({ templateId: template.id, channelId: channel.id, status: "local_delivered" });
    const rejected = await (await create(req("/kakao/templates", cookie, "POST", { serviceId, channelId: channel.id, name: "반려", body: "#반려 마커", buttons: [] }, randomUUID()))).json();
    const rejectedSubmit = await create(req("/kakao/templates/" + rejected.id + "/submit", cookie, "POST", { version: rejected.version }));
    expect((await rejectedSubmit.json()).status).toBe("rejected");
    expect((await db.kakaoTemplate.findUniqueOrThrow({ where: { id: rejected.id } })).reviewNote).toContain("반려");
    expect((await send(cookie, rejected.id)).status).toBe(409);
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
import { readKakaoTemplate, requestKakaoChannelVerification, sendKakaoTemplate } from "@/server/kakao";
test("이전에 읽은 회사 컨텍스트도 강화된 MFA·세션 정책을 다시 적용한다", async () => {
  const { cookie, template, companyId } = await detailFixture();
  const ctx = await requireContext(req("/context", cookie).headers, "message.manage");
  await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: true } });
  await expect(readKakaoTemplate(ctx, template.id)).rejects.toMatchObject({ status: 403 });
  await expect(requestKakaoChannelVerification(ctx, template.channelId)).rejects.toMatchObject({ status: 403 });
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


test("이전 서명된 심사 결과는 재신청을 승인하지 않고 중복 결과는 감사를 늘리지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  const path = "/kakao/templates/" + template.id;
  const first = await (await create(req(path + "/submit", cookie, "POST", { version: template.version }))).json();
  const old = JSON.stringify({ kind: "template", id: template.id, version: first.version, outcome: "approved", note: "" });
  await applyKakaoReview(old, sign(old), secret);
  await expect(applyKakaoReview(old, sign(old), secret)).rejects.toMatchObject({ status: 409 });
  const approved = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const draft = await (await update(req(path, cookie, "PATCH", { name: template.name, body: "수정된 새 본문", buttons: [], version: approved.version }))).json();
  const second = await (await create(req(path + "/submit", cookie, "POST", { version: draft.version }))).json();
  await expect(applyKakaoReview(old, sign(old), secret)).rejects.toMatchObject({ status: 409 });
  expect((await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } })).status).toBe("submitted");
  const fresh = JSON.stringify({ kind: "template", id: template.id, version: second.version, outcome: "approved", note: "" });
  expect((await applyKakaoReview(fresh, sign(fresh), secret)).status).toBe("approved");
  expect(await db.auditEvent.count({ where: { resourceId: template.id, action: "kakao.template_approved" } })).toBe(2);
});
test("채널 검색 ID 변경은 확인을 해제하고 예전 확인 콜백을 거절한다", async () => {
  const { cookie, template } = await detailFixture();
  const channel = await db.kakaoChannel.findUniqueOrThrow({ where: { id: template.channelId } });
  const raw = JSON.stringify({ kind: "channel", id: channel.id, version: channel.version, outcome: "verified", note: "" });
  await applyKakaoReview(raw, sign(raw), secret);
  const verified = await db.kakaoChannel.findUniqueOrThrow({ where: { id: channel.id } });
  await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
  const changed = await update(req("/kakao/channels/" + channel.id, cookie, "PATCH", { name: channel.name, searchId: "@changed", status: "pending", version: verified.version }));
  expect(changed.status).toBe(200); expect((await changed.json()).status).toBe("pending");
  const reset = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } });
  expect(reset.status).toBe("draft"); expect(reset.version).toBe(template.version + 1);
  expect(await db.auditEvent.count({ where: { resourceId: template.id, action: "kakao.template_review_reset" } })).toBe(1);
  await expect(applyKakaoReview(raw, sign(raw), secret)).rejects.toMatchObject({ status: 409 });
  expect(await db.auditEvent.count({ where: { resourceId: channel.id, action: "kakao.channel_verified" } })).toBe(1);
});
test("사용 중인 채널 삭제는 보관 우회로 처리하지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  const request = new Request(origin + "/api/v1/kakao/channels/" + template.channelId, { method: "DELETE", headers: { origin, cookie, "if-match": "1" } });
  expect((await remove(request)).status).toBe(409);
  expect((await db.kakaoChannel.findUniqueOrThrow({ where: { id: template.channelId } })).status).toBe("pending");
  expect(await db.auditEvent.count({ where: { resourceId: template.channelId, action: "kakao.channel_archived" } })).toBe(0);
});
test("채널 동시 수정은 한 번만 성공하고 같은 확인 콜백도 한 번만 반영한다", async () => {
  const { cookie, template } = await detailFixture();
  const path = "/kakao/channels/" + template.channelId;
  const replies = await Promise.all(["첫 채널", "둘째 채널"].map(name => update(req(path, cookie, "PATCH", { name, searchId: "@detail", status: "pending", version: 1 }))));
  expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
  const channel = await db.kakaoChannel.findUniqueOrThrow({ where: { id: template.channelId } });
  const raw = JSON.stringify({ kind: "channel", id: channel.id, version: channel.version, outcome: "verified", note: "" });
  const callbacks = await Promise.allSettled([applyKakaoReview(raw, sign(raw), secret), applyKakaoReview(raw, sign(raw), secret)]);
  expect(callbacks.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.auditEvent.count({ where: { resourceId: channel.id, action: "kakao.channel_verified" } })).toBe(1);
});


test("채널 삭제와 새 템플릿 생성은 활성 템플릿의 보관 채널을 만들지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  const existing = await db.kakaoChannel.findUniqueOrThrow({ where: { id: template.channelId } });
  const channel = await db.kakaoChannel.create({ data: { tenantId: existing.tenantId, serviceId: existing.serviceId, name: "동시 삭제", searchId: "@race" } });
  const request = new Request(origin + "/api/v1/kakao/channels/" + channel.id, { method: "DELETE", headers: { origin, cookie, "if-match": "1" } });
  const [deletion, creation] = await Promise.all([remove(request), create(req("/kakao/templates", cookie, "POST", { serviceId: channel.serviceId, channelId: channel.id, name: "동시 생성", body: "안내", buttons: [] }, randomUUID()))]);
  expect([204, 409]).toContain(deletion.status); expect([201, 404]).toContain(creation.status);
  const saved = await db.kakaoChannel.findUnique({ where: { id: channel.id } });
  const count = await db.kakaoTemplate.count({ where: { channelId: channel.id } });
  if (creation.status === 201) { expect(saved?.status).toBe("pending"); expect(count).toBe(1); expect(deletion.status).toBe(409); }
  else { expect(saved).toBeNull(); expect(count).toBe(0); expect(deletion.status).toBe(204); }
});
test("로컬 즉시 심사 감사 실패는 초안과 신청 감사까지 함께 롤백한다", async () => {
  const { cookie, template } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_kakao_local_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='kakao.template_approved' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_kakao_local_fault BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_kakao_local_fault()');
  try {
    expect((await create(req("/kakao/templates/" + template.id + "/submit", cookie, "POST", { version: template.version }))).status).toBe(500);
    const row = await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(row.status).toBe("draft"); expect(row.version).toBe(template.version);
    expect(await db.auditEvent.count({ where: { resourceId: template.id, action: { in: ["kakao.template_submitted", "kakao.template_approved"] } } })).toBe(0);
  } finally {
    env.KAKAO_PROVIDER = previous;
    await db.$executeRawUnsafe('DROP TRIGGER qa_kakao_local_fault ON "AuditEvent"');
    await db.$executeRawUnsafe('DROP FUNCTION qa_kakao_local_fault()');
  }
});


import { POST as reviewWebhook } from "@/app/api/v1/kakao/reviews/route";
test("버전 없는 서명된 콜백은 HTTP422로 거절하고 심사 상태를 보존한다", async () => {
  const { cookie, template } = await detailFixture();
  const submitted = await (await create(req("/kakao/templates/" + template.id + "/submit", cookie, "POST", { version: template.version }))).json();
  const raw = JSON.stringify({ kind: "template", id: template.id, outcome: "approved", note: "" }), previous = env.KAKAO_REVIEW_SECRET;
  env.KAKAO_REVIEW_SECRET = secret;
  try {
    const result = await reviewWebhook(new Request(origin + "/api/v1/kakao/reviews", { method: "POST", headers: { "content-type": "application/json", "x-kakao-signature": sign(raw) }, body: raw }));
    expect(result.status).toBe(422);
    expect((await db.kakaoTemplate.findUniqueOrThrow({ where: { id: template.id } })).version).toBe(submitted.version);
    expect(await db.auditEvent.count({ where: { resourceId: template.id, action: "kakao.template_approved" } })).toBe(0);
  } finally { env.KAKAO_REVIEW_SECRET = previous; }
});


test("단건 Mock 발송은 같은 키의 동시 재시도에 한 영수증과 감사만 저장한다", async () => {
  const { cookie, template } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  try {
    await db.kakaoChannel.update({ where: { id: template.channelId }, data: { status: "verified" } });
    await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
    const key = randomUUID(), replies = await Promise.all([send(cookie, template.id, key), send(cookie, template.id, key)]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(replies.map(r => r.json())); expect(first).toEqual(second); expect(first.mock).toBe(true);
    const rows = await db.kakaoMockReceipt.findMany({ where: { templateId: template.id } }); expect(rows).toHaveLength(1);
    expect(rows[0].contentHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(rows)).not.toContain(template.body);
    const events = await db.auditEvent.findMany({ where: { resourceId: first.id, action: "kakao.mock_delivered" } }); expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe(rows[0].requestId); expect(events[0].actorId).not.toBeNull(); expect(JSON.stringify(events)).not.toContain(template.body);
    const modified = await update(req("/kakao/templates/" + template.id, cookie, "PATCH", { name: template.name, body: "새 초안", buttons: [], version: template.version })); expect(modified.status).toBe(200);
    const replay = await create(req("/kakao/templates/" + template.id + "/send", cookie, "POST", { version: template.version }, key)); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(first);
    const fresh = await send(cookie, template.id); expect(fresh.status).toBe(409); expect(await db.kakaoMockReceipt.count()).toBe(1);
  } finally { env.KAKAO_PROVIDER = previous; }
});
test("Mock 발송의 버전·키 계약을 검사하고 현재 정책 회수 후 재생도 거절한다", async () => {
  const { cookie, template, companyId } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  try {
    await db.kakaoChannel.update({ where: { id: template.channelId }, data: { status: "verified" } });
    await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
    const path = "/kakao/templates/" + template.id + "/send";
    expect((await create(req(path, cookie, "POST", { version: template.version }))).status).toBe(400);
    expect((await create(req(path, cookie, "POST", {}, randomUUID()))).status).toBe(422);
    expect((await create(req(path, cookie, "POST", { version: template.version + 1 }, randomUUID()))).status).toBe(409);
    const key = randomUUID(); expect((await send(cookie, template.id, key)).status).toBe(200);
    expect((await create(req(path, cookie, "POST", { version: template.version + 1 }, key))).status).toBe(409);
    await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: true } });
    expect((await create(req(path, cookie, "POST", { version: template.version }, key))).status).toBe(403);
    expect(await db.kakaoMockReceipt.count()).toBe(1);
  } finally { env.KAKAO_PROVIDER = previous; }
});
test("Mock 발송 감사 실패는 영수증·요청 키를 롤백하고 복구 후 같은 키로 처리한다", async () => {
  const { cookie, template } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  await db.kakaoChannel.update({ where: { id: template.channelId }, data: { status: "verified" } });
  await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
  const key = randomUUID();
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_kakao_send_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='kakao.mock_delivered' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_kakao_send_fault BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_kakao_send_fault()');
  try {
    expect((await send(cookie, template.id, key)).status).toBe(500); expect(await db.kakaoMockReceipt.count()).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
  } catch (cause) { env.KAKAO_PROVIDER = previous; throw cause; }
  finally { await db.$executeRawUnsafe('DROP TRIGGER qa_kakao_send_fault ON "AuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION qa_kakao_send_fault()'); }
  try { expect((await send(cookie, template.id, key)).status).toBe(200); expect(await db.kakaoMockReceipt.count()).toBe(1); }
  finally { env.KAKAO_PROVIDER = previous; }
});


test("Mock 영수증 이력이 있는 초안은 삭제하지 않고 보관하며 기록을 변경할 수 없다", async () => {
  const { cookie, template } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  try {
    await db.kakaoChannel.update({ where: { id: template.channelId }, data: { status: "verified" } });
    await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
    const delivered = await (await send(cookie, template.id)).json();
    await expect(db.kakaoMockReceipt.update({ where: { id: delivered.id }, data: { contentHash: "0".repeat(64) } })).rejects.toThrow();
    await expect(db.kakaoMockReceipt.delete({ where: { id: delivered.id } })).rejects.toThrow();
    const draft = await (await update(req("/kakao/templates/" + template.id, cookie, "PATCH", { name: template.name, body: "재심사 초안", buttons: [], version: template.version }))).json();
    const removed = await remove(new Request(origin + "/api/v1/kakao/templates/" + template.id, { method: "DELETE", headers: { origin, cookie, "if-match": String(draft.version) } }));
    expect(removed.status).toBe(200); expect((await removed.json()).status).toBe("archived"); expect(await db.kakaoMockReceipt.count()).toBe(1);
  } finally { env.KAKAO_PROVIDER = previous; }
});


test("발송 헬퍼는 오래된 컨텍스트의 MFA 강화와 세션 파기를 다시 검사한다", async () => {
  const { cookie, template, companyId } = await detailFixture(), previous = env.KAKAO_PROVIDER;
  env.KAKAO_PROVIDER = "local";
  try {
    await db.kakaoChannel.update({ where: { id: template.channelId }, data: { status: "verified" } });
    await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
    const ctx = await requireContext(req("/context", cookie).headers, "message.manage");
    await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: true } });
    await expect(sendKakaoTemplate(ctx, template.id, template.version, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await db.securityPolicy.update({ where: { tenantId: companyId }, data: { requireMfa: false } });
    await db.session.delete({ where: { id: ctx.session.id } });
    await expect(sendKakaoTemplate(ctx, template.id, template.version, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 401 });
    expect(await db.kakaoMockReceipt.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "kakao.mock_delivered" } })).toBe(0);
  } finally { env.KAKAO_PROVIDER = previous; }
});
test("영수증 DB 경계는 다른 서비스·채널·승인 버전의 직접 삽입을 거절한다", async () => {
  const { template } = await detailFixture();
  const channel = await db.kakaoChannel.findUniqueOrThrow({ where: { id: template.channelId } });
  const data = { tenantId: channel.tenantId, serviceId: channel.serviceId, templateId: template.id, templateVersion: template.version, channelId: channel.id, channelVersion: channel.version, contentHash: "0".repeat(64), requestId: randomUUID() };
  await expect(db.kakaoMockReceipt.create({ data })).rejects.toThrow();
  await db.kakaoChannel.update({ where: { id: channel.id }, data: { status: "verified" } });
  await db.kakaoTemplate.update({ where: { id: template.id }, data: { status: "approved" } });
  for (const patch of [{ serviceId: randomUUID() }, { channelId: randomUUID() }, { templateVersion: data.templateVersion + 1 }, { channelVersion: data.channelVersion + 1 }]) await expect(db.kakaoMockReceipt.create({ data: { ...data, ...patch } })).rejects.toThrow();
  expect(await db.kakaoMockReceipt.count()).toBe(0);
});


test("보관한 채널·템플릿은 반복 삭제나 수정으로 상태·감사를 바꾸지 않는다", async () => {
  const { cookie, template } = await detailFixture();
  const archivedTemplate = await remove(new Request(origin + "/api/v1/kakao/templates/" + template.id, { method: "DELETE", headers: { origin, cookie, "if-match": String(template.version) } }));
  expect(archivedTemplate.status).toBe(204);
  const second = await (await create(req("/kakao/templates", cookie, "POST", { serviceId: template.serviceId, channelId: template.channelId, name: "보관 검증", body: "안내", buttons: [] }, randomUUID()))).json();
  await db.kakaoTemplate.update({ where: { id: second.id }, data: { status: "archived", version: { increment: 1 } } });
  const channel = await (await remove(new Request(origin + "/api/v1/kakao/channels/" + template.channelId, { method: "DELETE", headers: { origin, cookie, "if-match": "1" } }))).json();
  expect(channel.status).toBe("archived");
  const count = await db.auditEvent.count();
  expect((await remove(new Request(origin + "/api/v1/kakao/channels/" + channel.id, { method: "DELETE", headers: { origin, cookie, "if-match": String(channel.version) } }))).status).toBe(409);
  expect((await update(req("/kakao/channels/"+channel.id,cookie,"PATCH",{name:channel.name,searchId:channel.searchId,status:"pending",version:channel.version}))).status).toBe(409);
  expect((await remove(new Request(origin + "/api/v1/kakao/templates/" + second.id, { method: "DELETE", headers: { origin, cookie, "if-match": "2" } }))).status).toBe(409);
  expect(await db.auditEvent.count()).toBe(count);
  expect((await db.kakaoChannel.findUniqueOrThrow({where:{id:channel.id}})).version).toBe(channel.version);
});
