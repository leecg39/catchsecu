import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as create } from "@/app/api/v1/forms/route";
import { PATCH, GET, POST as action } from "@/app/api/v1/forms/[...segments]/route";
import { encrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Draft-save-test!123";
function req(path: string, method: string, cookie: string, value?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) },
    ...(value ? { body: JSON.stringify(value) } : {}) });
}
async function setup() {
  const company = await db.company.create({ data: { name: "편집기 저장 시험", publicName: "편집기", policy: { create: {} },
    services: { create: { name: "저장 서비스", externalName: "저장 서비스" } } }, include: { services: true } });
  const email = "draft-save-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: "편집자", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "editor" } });
  const serviceId = company.services[0].id;
  await db.serviceGrant.create({ data: { tenantId: company.id, serviceId, memberId: member.id, capabilities: ["service.read", "form.read", "form.write"] } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const result = await create(req("/forms", "POST", cookie, { serviceId, title: "단계별 폼", content: {
    body: "첫 본문", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 50,
  } }, randomUUID()));
  expect(result.status).toBe(201);
  return { company, serviceId, user, member, cookie, form: await result.json() };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("같은 키의 동시 초안 저장은 한 번의 version 증가와 감사만 만든다", async () => {
  const f = await setup(), key = randomUUID(), value = { version: f.form.version, title: "자동저장한 제목" };
  const responses = await Promise.all([0, 1].map(() => PATCH(req("/forms/" + f.form.id + "/draft", "PATCH", f.cookie, value, key))));
  expect(responses.map(x => x.status)).toEqual([200, 200]);
  const [a,b] = await Promise.all(responses.map(x => x.json())); expect(a).toEqual(b); expect(a.version).toBe(2);
  expect(await db.auditEvent.count({ where: { resourceId: f.form.id, action: "form.draft_updated" } })).toBe(1);
});
test("성공 응답을 잃어버린 저장은 같은 키/내용으로 복구하고 후속 변경과 분리된다", async () => {
  const f = await setup(), key = randomUUID(), value = { version: 1, content: { ...f.form.content, body: "잃어버린 응답" } };
  expect((await PATCH(req("/forms/" + f.form.id + "/draft", "PATCH", f.cookie, value, key))).status).toBe(200);
  const replay = await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key)); expect(replay.status).toBe(200);
  const saved = await replay.json(); expect(saved.version).toBe(2);
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 2, title: "후속 입력" }, randomUUID()))).status).toBe(200);
  const current = await GET(req("/forms/" + f.form.id, "GET", f.cookie)); const record = await current.json();
  expect(record.version).toBe(3); expect(record.content.body).toBe("잃어버린 응답"); expect(record.title).toBe("후속 입력");
});
test("같은 저장 키에 다른 내용은 키 불일치로 거부하고 원문을 유지한다", async () => {
  const f = await setup(), key = randomUUID();
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 1, title: "첫 변경" }, key))).status).toBe(200);
  const result = await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 2, title: "키 오용" }, key));
  expect(result.status).toBe(409); expect((await result.json()).error.code).toBe("IDEMPOTENCY_MISMATCH");
  expect((await db.form.findUniqueOrThrow({ where: { id: f.form.id } })).title).toBe("첫 변경");
});
test("다른 기기의 같은 version 저장은 하나만 반영되고 최신본을 다시 읽을 수 있다", async () => {
  const f = await setup();
  const results = await Promise.all(["기기 A", "기기 B"].map(title => PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 1, title }, randomUUID()))));
  expect(results.map(x => x.status).sort()).toEqual([200,409]);
  const current = await GET(req("/forms/" + f.form.id, "GET", f.cookie)); expect(current.status).toBe(200);
  expect((await current.json()).version).toBe(2);
  expect(await db.auditEvent.count({ where: { resourceId: f.form.id, action: "form.draft_updated" } })).toBe(1);
});
test("로그아웃 후 저장 재전송은 이전 결과를 열람할 수 없다", async () => {
  const f = await setup(), key = randomUUID(), value = { version: 1, title: "회수 전 저장" };
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key))).status).toBe(200);
  await db.session.deleteMany({ where: { userId: f.user.id } });
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key))).status).toBe(401);
});
test("서비스 권한 회수와 보관은 저장 재전송을 차단한다", async () => {
  const f = await setup(), key = randomUUID(), value = { version: 1, title: "권한 회수 전" };
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key))).status).toBe(200);
  await db.serviceGrant.updateMany({ where: { memberId: f.member.id }, data: { capabilities: ["service.read", "form.read"] } });
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key))).status).toBe(403);
  await db.serviceGrant.updateMany({ where: { memberId: f.member.id }, data: { capabilities: ["service.read", "form.read", "form.write"] } });
  await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, value, key))).status).toBe(409);
});
test("키 없는 수동 저장의 version 충돌 계약도 유지한다", async () => {
  const f = await setup();
  expect((await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 1, title: "수동 변경" }))).status).toBe(200);
  const conflict = await PATCH(req("/forms/" + f.form.id, "PATCH", f.cookie, { version: 1, title: "이전 버전" }));
  expect(conflict.status).toBe(409); expect((await conflict.json()).error.code).toBe("VERSION_CONFLICT");
});
test("게시 권한 회수 후 이전 초안 저장 캐시에서 게시 토큰을 받을 수 없다", async () => {
  const f = await setup();
  await db.serviceGrant.updateMany({ where:{ memberId:f.member.id },data:{ capabilities:["service.read","form.read","form.write","form.publish"] } });
  const published = await action(req("/forms/"+f.form.id+"/publish","POST",f.cookie,{ version:1 },randomUUID())); expect(published.status).toBe(201);
  const live = await published.json(), key = randomUUID(), input={ version:2,title:"게시 이후 새 초안" };
  const saved = await PATCH(req("/forms/"+f.form.id+"/draft","PATCH",f.cookie,input,key)); expect(saved.status).toBe(200);
  const data = await saved.json();
  // Simulate a response encrypted by the previous implementation before deployment.
  await db.idempotencyRecord.update({ where:{ scope_key:{ scope:"form:draft:"+f.member.id+":"+f.form.id,key } },
    data:{ responseCipher:encrypt({ ...data,publication:{ ...data.publication,token:live.token } }) } });
  const authorized = await GET(req("/forms/"+f.form.id,"GET",f.cookie)); expect(!!(await authorized.json()).publication?.token).toBe(true);
  await db.serviceGrant.updateMany({ where:{ memberId:f.member.id },data:{ capabilities:["service.read","form.read","form.write"] } });
  const current = await GET(req("/forms/"+f.form.id,"GET",f.cookie)); expect(!!(await current.json()).publication?.token).toBe(false);
  const replay = await PATCH(req("/forms/"+f.form.id+"/draft","PATCH",f.cookie,input,key)); expect(replay.status).toBe(200);
  expect(!!(await replay.json()).publication?.token).toBe(false);
  expect(await db.auditEvent.count({ where:{ resourceId:f.form.id,action:"form.draft_updated" } })).toBe(1);
});
