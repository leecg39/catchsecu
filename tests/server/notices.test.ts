import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET, POST, PATCH, PUT, DELETE } from "@/app/api/v1/notices/[[...segments]]/route";
import type { NoticeListResponse, NoticeRecord } from "@/contracts/notices";
import { sha256 } from "@/server/file-validation";
import { requireFileScanner } from "@/server/file-scanner";
import { cleanupNoticeAttachments } from "@/server/notice-attachments";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
const origin = env.BETTER_AUTH_URL;
const cookies: Record<string, string> = {};
const pdf = await readFile("assets/help-pdfs/0-0.pdf");
function req(path: string, method = "GET", who = "reader", input?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function answer<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status);
  return response.json();
}
async function signup(name: string) {
  const email = `${name}-${randomUUID()}@notice.local.test`, password = "Synthetic-notice-2026-password!";
  await answer(await auth.handler(req("/auth/sign-up/email", "POST", name, { name, email, password })));
  await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: name === "operator" } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", name, { email, password }));
  expect(login.status).toBe(200);
  cookies[name] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
function attachmentReq(noticeId: string, fileId: string, version: number, who = "operator", extra: Record<string, string> = {}) {
  return new Request(origin + `/api/v1/notices/${noticeId}/attachments/${fileId}`, { method: "PUT", body: new Uint8Array(pdf),
    headers: { origin, cookie: cookies[who] ?? "", "content-type": "application/pdf", "if-match": String(version),
      "x-file-name": encodeURIComponent("공지 첨부.pdf"), "x-file-size": String(pdf.length),
      "x-file-sha256": sha256(pdf), ...extra } });
}
beforeAll(async () => {
  await requireFileScanner();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Notice", "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await signup("reader"); await signup("operator");
});
afterAll(async () => { await db.$disconnect(); });

describe("notice publication", () => {
  let id = "", creationKey = "";
  let creationInput: { category: string; title: string; sortOrder: number; bodyHtml: string };
  test("requires authentication and platform operator for changes and previews", async () => {
    await answer(await GET(req("/notices", "GET", "anonymous")), 401);
    expect((await answer<NoticeListResponse>(await GET(req("/notices")))).total).toBe(0);
    await answer(await GET(req("/notices?scope=admin")), 403);
    await answer(await POST(req("/notices", "POST", "reader", { category: "일반공지", title: "금지", bodyHtml: "본문", sortOrder: 1 },
      { "idempotency-key": randomUUID() })), 403);
  });
  test("creates one draft for repeated key, sanitizes HTML and hides it from readers", async () => {
    const key = randomUUID(), input = { category: "일반공지", title: "합성 공지", sortOrder: 2,
      bodyHtml: '<p>안내</p><script>alert(1)</script><a href="javascript:alert(2)">위험</a><a href="https://example.test">안전</a>' };
    creationKey = key; creationInput = input;
    const created = await answer<NoticeRecord>(await POST(req("/notices", "POST", "operator", input, { "idempotency-key": key })), 201);
    id = created.id;
    expect(created).toMatchObject({ status: "draft", version: 1, publishedAt: null });
    expect(created.bodyHtml).toContain("https://example.test");
    expect(created.bodyHtml).not.toMatch(/<script|javascript:/i);
    const replay = await answer<NoticeRecord>(await POST(req("/notices", "POST", "operator", input, { "idempotency-key": key })), 201);
    expect(replay.id).toBe(id);
    await answer(await POST(req("/notices", "POST", "operator", { ...input, title: "다른 제목" }, { "idempotency-key": key })), 409);
    expect((await answer<NoticeListResponse>(await GET(req("/notices")))).total).toBe(0);
    expect((await answer<NoticeListResponse>(await GET(req("/notices?scope=admin", "GET", "operator")))).items[0].id).toBe(id);
    await answer(await GET(req(`/notices/${id}`)), 404);
    await answer(await GET(req(`/notices/${id}?preview=1`)), 403);
    expect((await answer<NoticeRecord>(await GET(req(`/notices/${id}?preview=1`, "GET", "operator")))).id).toBe(id);
    expect((await db.auditEvent.findMany({ where: { resourceId: id } })).map(row => row.action)).toEqual(["notice.created"]);
  });
  test("publishes, searches, handles stale edits, unpublishes and archives consistently", async () => {
    const published = await answer<NoticeRecord>(await PATCH(req(`/notices/${id}`, "PATCH", "operator", { version: 1, status: "published" })));
    expect(published.status).toBe("published"); expect(published.publishedAt).toBeTruthy();
    expect((await answer<NoticeListResponse>(await GET(req("/notices?search=%ED%95%A9%EC%84%B1&pageSize=1")))).total).toBe(1);
    expect((await answer<NoticeListResponse>(await GET(req("/notices?search=%EC%97%86%EB%8A%94")))).total).toBe(0);
    expect((await answer<NoticeRecord>(await GET(req(`/notices/${id}`)))).title).toBe("합성 공지");
    await answer(await PATCH(req(`/notices/${id}`, "PATCH", "operator", { version: 1, title: "오래된 수정" })), 409);
    const changed = await answer<NoticeRecord>(await PATCH(req(`/notices/${id}`, "PATCH", "operator", { version: 2, title: "수정된 공지" })));
    expect(changed.version).toBe(3);
    const hidden = await answer<NoticeRecord>(await PATCH(req(`/notices/${id}`, "PATCH", "operator", { version: 3, status: "draft" })));
    expect(hidden.publishedAt).toBeNull();
    await answer(await GET(req(`/notices/${id}`)), 404);
    const republished = await answer<NoticeRecord>(await PATCH(req(`/notices/${id}`, "PATCH", "operator", { version: 4, status: "published" })));
    expect(republished.publishedAt).toBeTruthy();
    await answer(await DELETE(req(`/notices/${id}`, "DELETE", "reader", undefined, { "if-match": "5" })), 403);
    await answer(await DELETE(req(`/notices/${id}`, "DELETE", "operator", undefined, { "if-match": "1" })), 409);
    const archived = await DELETE(req(`/notices/${id}`, "DELETE", "operator", undefined, { "if-match": "5" }));
    expect(archived.status).toBe(204);
    await answer(await GET(req(`/notices/${id}`)), 404);
    await answer(await POST(req("/notices", "POST", "operator", creationInput, { "idempotency-key": creationKey })), 410);
    expect((await answer<NoticeListResponse>(await GET(req("/notices")))).total).toBe(0);
    expect((await answer<NoticeListResponse>(await GET(req("/notices?scope=admin", "GET", "operator")))).items[0].status).toBe("archived");
    expect((await db.notice.findUniqueOrThrow({ where: { id } })).publishedAt).toBeNull();
    expect((await db.auditEvent.findMany({ where: { resourceId: id } })).map(row => row.action)).toEqual([
      "notice.created", "notice.updated", "notice.updated", "notice.updated", "notice.updated", "notice.archived",
    ]);
    await expect(db.notice.update({ where: { id }, data: { status: "unsafe", version: { increment: 1 } } })).rejects.toThrow();
  });
  test("scans, protects, downloads and deletes notice attachments with the notice lifecycle", async () => {
    const created = await answer<NoticeRecord>(await POST(req("/notices", "POST", "operator",
      { category: "일반공지", title: "첨부 시험", bodyHtml: "<p>첨부 시험</p>", sortOrder: 3 },
      { "idempotency-key": randomUUID() })), 201);
    const fileId = randomUUID(), filePath = `/notices/${created.id}/attachments/${fileId}`;
    await answer(await PUT(attachmentReq(created.id, fileId, 1, "reader")), 403);
    await answer(await PUT(attachmentReq(created.id, fileId, 1, "operator", { "x-file-sha256": "0".repeat(64) })), 422);
    const attached = await answer<{ noticeVersion: number; attachment: { id: string } }>(await PUT(attachmentReq(created.id, fileId, 1)));
    expect(attached.noticeVersion).toBe(2); expect(attached.attachment.id).toBe(fileId);
    const storageKey = (await db.noticeAttachment.findUniqueOrThrow({ where: { id: fileId } })).storageKey!;
    const replay = await answer<{ noticeVersion: number }>(await PUT(attachmentReq(created.id, fileId, 1)));
    expect(replay.noticeVersion).toBe(2);
    expect(await db.noticeAttachment.count({ where: { noticeId: created.id, status: "active" } })).toBe(1);
    await answer(await GET(req(filePath)), 404);
    await answer(await GET(req(filePath + "?preview=1")), 403);
    const preview = await GET(req(filePath + "?preview=1", "GET", "operator"));
    expect(preview.status).toBe(200); expect(Buffer.from(await preview.arrayBuffer()).equals(pdf)).toBe(true);
    const published = await answer<NoticeRecord>(await PATCH(req(`/notices/${created.id}`, "PATCH", "operator",
      { version: 2, status: "published" })));
    expect(published.version).toBe(3); expect(published.attachments.map(file => file.id)).toEqual([fileId]);
    const detail = await answer<NoticeRecord>(await GET(req(`/notices/${created.id}`)));
    expect(detail.attachments[0].fileName).toBe("공지 첨부.pdf");
    const downloaded = await GET(req(filePath));
    expect(downloaded.headers.get("content-type")).toBe("application/pdf");
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(pdf)).toBe(true);
    await answer(await DELETE(req(filePath, "DELETE", "operator", undefined, { "if-match": "2" })), 409);
    expect((await DELETE(req(filePath, "DELETE", "operator", undefined, { "if-match": "3" }))).status).toBe(204);
    await answer(await GET(req(filePath)), 404);
    expect((await answer<NoticeRecord>(await GET(req(`/notices/${created.id}`)))).attachments).toEqual([]);
    await expect(lstat(join(env.PRIVATE_STORAGE_DIR, "objects", storageKey + ".enc"))).rejects.toMatchObject({ code: "ENOENT" });
    const secondId = randomUUID();
    const second = await answer<{ noticeVersion: number }>(await PUT(attachmentReq(created.id, secondId, 4)));
    expect(second.noticeVersion).toBe(5);
    const secondKey = (await db.noticeAttachment.findUniqueOrThrow({ where: { id: secondId } })).storageKey!;
    expect((await DELETE(req(`/notices/${created.id}`, "DELETE", "operator", undefined, { "if-match": "5" }))).status).toBe(204);
    await answer(await GET(req(`/notices/${created.id}`)), 404);
    await answer(await GET(req(`/notices/${created.id}/attachments/${secondId}`)), 404);
    await expect(lstat(join(env.PRIVATE_STORAGE_DIR, "objects", secondKey + ".enc"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.noticeAttachment.findUniqueOrThrow({ where: { id: secondId } })).status).toBe("deleted");
    await expect(db.noticeAttachment.update({ where: { id: secondId }, data: { status: "unsafe" } })).rejects.toThrow();
  });
  test("worker finishes an interrupted private-file deletion", async () => {
    const created = await answer<NoticeRecord>(await POST(req("/notices", "POST", "operator",
      { category: "일반공지", title: "삭제 재처리", bodyHtml: "<p>재처리</p>", sortOrder: 4 },
      { "idempotency-key": randomUUID() })), 201);
    const fileId = randomUUID();
    await answer(await PUT(attachmentReq(created.id, fileId, 1)));
    const storageKey = (await db.noticeAttachment.findUniqueOrThrow({ where: { id: fileId } })).storageKey!;
    await db.noticeAttachment.update({ where: { id: fileId }, data: { status: "deleting" } });
    expect(await cleanupNoticeAttachments()).toMatchObject({ deleted: 1, retry: 0 });
    expect((await db.noticeAttachment.findUniqueOrThrow({ where: { id: fileId } })).status).toBe("deleted");
    await expect(lstat(join(env.PRIVATE_STORAGE_DIR, "objects", storageKey + ".enc"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await DELETE(req(`/notices/${created.id}`, "DELETE", "operator", undefined, { "if-match": "2" }))).status).toBe(204);
  });
});
