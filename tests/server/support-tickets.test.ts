import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/support-tickets/[[...segments]]/route";
import type { SupportTicketListResponse, SupportTicketRecord } from "@/contracts/support-tickets";
import { GET as listFeedback, POST as createFeedback } from "@/app/api/v1/feedback/route";
import {
  DELETE as deleteFeedback,
  GET as readFeedback,
  PATCH as updateFeedback,
} from "@/app/api/v1/feedback/[id]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");
const origin = env.BETTER_AUTH_URL;
const cookies: Record<string, string> = {};
const tenantA = randomUUID(), tenantB = randomUUID(), foreignService = randomUUID();
function req(path: string, method = "GET", who = "author", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function answer<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status);
  return response.json();
}
async function signup(name: string, tenant?: string) {
  const email = `${name}-${randomUUID()}@support.local.test`, password = "Synthetic-support-2026-password!";
  await answer(await auth.handler(req("/auth/sign-up/email", "POST", name, { name, email, password })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: name === "operator" } });
  if (tenant) await db.membership.create({ data: { tenantId: tenant, userId: user.id, role: "viewer" } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", name, { email, password }));
  expect(login.status).toBe(200);
  cookies[name] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return user;
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "SupportTicket", "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [
    { id: tenantA, name: "문의 시험 회사 A", publicName: "문의 시험 회사 A" },
    { id: tenantB, name: "문의 시험 회사 B", publicName: "문의 시험 회사 B" },
  ] });
  await db.service.create({ data: { id: foreignService, tenantId: tenantB, name: "타사 서비스", externalName: "foreign" } });
  await signup("author", tenantA); await signup("coworker", tenantA);
  await signup("outsider", tenantB); await signup("operator");
});
afterAll(async () => { await db.$disconnect(); });

describe("tenant-scoped support requests", () => {
  let id = "", key = "", version = 1;
  const input = { kind: "suggestion", subject: "메뉴 정렬 제안", body: "긴 목록에서 메뉴를 정렬하고 싶습니다." };
  test("validates creation, isolates authors and encrypts content", async () => {
    await answer(await GET(req("/support-tickets", "GET", "anonymous")), 401);
    await answer(await GET(req("/support-tickets?scope=admin", "GET", "author")), 403);
    await answer(await POST(req("/support-tickets", "POST", "author", input)), 400);
    await answer(await POST(req("/support-tickets", "POST", "author", { ...input, body: " " },
      { "idempotency-key": randomUUID() })), 422);
    await answer(await POST(req("/support-tickets", "POST", "author", { ...input, serviceId: foreignService },
      { "idempotency-key": randomUUID() })), 404);
    key = randomUUID();
    const created = await answer<{ id: string; version: number }>(await POST(req("/support-tickets", "POST", "author", input,
      { "idempotency-key": key })), 201);
    id = created.id;
    expect(created.version).toBe(1);
    const replay = await answer<{ id: string }>(await POST(req("/support-tickets", "POST", "author", input,
      { "idempotency-key": key })), 201);
    expect(replay.id).toBe(id);
    await answer(await POST(req("/support-tickets", "POST", "author", { ...input, body: "다른 내용" },
      { "idempotency-key": key })), 409);
    const stored = await db.supportTicket.findUniqueOrThrow({ where: { id } });
    expect(stored.subjectCipher).not.toContain(input.subject);
    expect(stored.bodyCipher).not.toContain(input.body);
    expect(stored.tenantId).toBe(tenantA);
    const mineResponse = await GET(req("/support-tickets"));
    const mine = await answer<SupportTicketListResponse>(mineResponse);
    expect(mine.total).toBe(1); expect(mine.items[0].subject).toBe(input.subject);
    expect(await db.auditEvent.findFirstOrThrow({ where: { requestId: mineResponse.headers.get("x-request-id")! } }))
      .toMatchObject({ tenantId: tenantA, action: "support-ticket.list_viewed" });
    expect((await answer<SupportTicketListResponse>(await GET(req("/support-tickets", "GET", "coworker")))).total).toBe(0);
    expect((await answer<SupportTicketListResponse>(await GET(req("/support-tickets", "GET", "outsider")))).total).toBe(0);
    const denied = await GET(req(`/support-tickets/${id}`, "GET", "coworker"));
    await answer(denied, 404);
    expect(await db.auditEvent.count({ where: { requestId: denied.headers.get("x-request-id")! } })).toBe(0);
    await answer(await GET(req(`/support-tickets/${id}`, "GET", "outsider")), 404);
    await answer(await GET(req(`/support-tickets/${id}?scope=admin`, "GET", "author")), 403);
    await answer(await DELETE(req(`/support-tickets/${id}`, "DELETE", "coworker", undefined, { "if-match": "1" })), 404);
    const adminList = await GET(req("/support-tickets?scope=admin", "GET", "operator"));
    expect((await answer<SupportTicketListResponse>(adminList)).total).toBe(1);
    expect(await db.auditEvent.findFirstOrThrow({ where: { requestId: adminList.headers.get("x-request-id")! } }))
      .toMatchObject({ tenantId: tenantA, action: "support-ticket.list_viewed", resourceId: id });
    const detailResponse = await GET(req(`/support-tickets/${id}?scope=admin`, "GET", "operator"));
    expect((await answer<SupportTicketRecord>(detailResponse)).body).toBe(input.body);
    expect(await db.auditEvent.findFirstOrThrow({ where: { requestId: detailResponse.headers.get("x-request-id")! } }))
      .toMatchObject({ tenantId: tenantA, action: "support-ticket.viewed", resourceId: id });
  });
  test("owner edits pending request with optimistic locking; operator answers", async () => {
    await answer(await PATCH(req(`/support-tickets/${id}`, "PATCH", "coworker", { version, body: "변경" })), 404);
    const changed = await answer<SupportTicketRecord>(await PATCH(req(`/support-tickets/${id}`, "PATCH", "author",
      { version, subject: "새 제목", body: "새 내용" })));
    version = changed.version;
    expect(changed).toMatchObject({ subject: "새 제목", body: "새 내용", version: 2 });
    await answer(await PATCH(req(`/support-tickets/${id}`, "PATCH", "author", { version: 1, body: "오래된 수정" })), 409);
    await answer(await POST(req(`/support-tickets/${id}/reply`, "POST", "author", { version, reply: "감사합니다" })), 403);
    const replied = await answer<SupportTicketRecord>(await POST(req(`/support-tickets/${id}/reply`, "POST", "operator",
      { version, reply: "다음 배포에서 반영하겠습니다." })));
    version = replied.version;
    expect(replied.status).toBe("answered");
    expect(replied.reply).toBe("다음 배포에서 반영하겠습니다.");
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id } })).replyCipher).not.toContain("다음 배포");
    await answer(await PATCH(req(`/support-tickets/${id}`, "PATCH", "author", { version, body: "뒤늦은 수정" })), 409);
  });
  test("close, reopen and archive enforce state and erase sensitive fields", async () => {
    await answer(await POST(req(`/support-tickets/${id}/reopen`, "POST", "author", { version })), 403);
    const closed = await answer<SupportTicketRecord>(await POST(req(`/support-tickets/${id}/close`, "POST", "author", { version })));
    version = closed.version; expect(closed.status).toBe("closed");
    await answer(await POST(req(`/support-tickets/${id}/reply`, "POST", "operator", { version, reply: "추가 답변" })), 409);
    const reopened = await answer<SupportTicketRecord>(await POST(req(`/support-tickets/${id}/reopen?scope=admin`, "POST", "operator", { version })));
    version = reopened.version; expect(reopened.status).toBe("answered");
    await answer(await DELETE(req(`/support-tickets/${id}`, "DELETE", "author", undefined, { "if-match": String(version - 1) })), 409);
    expect((await DELETE(req(`/support-tickets/${id}`, "DELETE", "author", undefined, { "if-match": String(version) }))).status).toBe(204);
    const archived = await db.supportTicket.findUniqueOrThrow({ where: { id } });
    expect(archived).toMatchObject({ status: "archived", subjectCipher: null, bodyCipher: null,
      replyCipher: null, answeredAt: null, answeredById: null });
    await answer(await GET(req(`/support-tickets/${id}`)), 404);
    await answer(await POST(req("/support-tickets", "POST", "author", input, { "idempotency-key": key })), 410);
    expect((await answer<SupportTicketListResponse>(await GET(req("/support-tickets?status=archived")))).total).toBe(1);
    expect(await db.auditEvent.count({ where: { resourceId: id, action: { in: ["support-ticket.created", "support-ticket.updated",
      "support-ticket.answered", "support-ticket.closed", "support-ticket.reopened", "support-ticket.archived"] } } })).toBe(6);
    await expect(db.supportTicket.update({ where: { id }, data: { status: "unsafe" } })).rejects.toThrow();
    await expect(db.supportTicket.update({ where: { id }, data: { serviceId: foreignService } })).rejects.toThrow();
  });
  test("origin and operator scope are enforced", async () => {
    const invalid = req("/support-tickets", "POST", "author", input, { "idempotency-key": randomUUID(), origin: "https://evil.test" });
    await answer(await POST(invalid), 403);
    await answer(await GET(req(`/support-tickets/${id}?scope=admin`, "GET", "author")), 404);
  });
});

test("피드백 별칭 경로가 작성자 범위와 PostgreSQL CRUD 수명주기를 사용한다", async () => {
  const input = { kind: "suggestion", subject: "피드백 별칭 검증", body: "피드백 경로의 전체 수명주기를 확인합니다." };
  const createdResponse = await createFeedback(req("/feedback", "POST", "author", input,
    { "idempotency-key": randomUUID() }));
  const created = await answer<SupportTicketRecord>(createdResponse, 201);
  expect(createdResponse.headers.get("location")).toBe(`/api/v1/feedback/${created.id}`);

  const listed = await answer<SupportTicketListResponse>(await listFeedback(req("/feedback", "GET", "author")));
  expect(listed.items.some(item => item.id === created.id)).toBe(true);
  expect((await answer<SupportTicketRecord>(await readFeedback(req(`/feedback/${created.id}`, "GET", "author")))).id)
    .toBe(created.id);

  const changed = await answer<SupportTicketRecord>(await updateFeedback(req(`/feedback/${created.id}`, "PATCH", "author",
    { version: 1, subject: "피드백 별칭 수정" })));
  expect(changed).toMatchObject({ subject: "피드백 별칭 수정", version: 2 });
  expect((await deleteFeedback(req(`/feedback/${created.id}`, "DELETE", "author", undefined,
    { "if-match": "2" }))).status).toBe(204);
  expect((await db.supportTicket.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("archived");
});
