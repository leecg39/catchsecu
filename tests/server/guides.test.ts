import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { sha256 } from "@/server/file-validation";
import { requireFileScanner } from "@/server/file-scanner";
import { GET, POST, PATCH, PUT, DELETE } from "@/app/api/v1/guides/[[...segments]]/route";
import type { GuideListResponse, GuideRecord } from "@/contracts/guides";
import { GET as listAdminGuides, POST as createAdminGuide } from "@/app/api/v1/admin/guides/route";
import {
  DELETE as deleteAdminGuide,
  GET as readAdminGuide,
  PATCH as updateAdminGuide,
} from "@/app/api/v1/admin/guides/[id]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");
const origin = env.BETTER_AUTH_URL;
const cookies: Record<string, string> = {};
const companyId = randomUUID();
const source = await readFile("assets/help-pdfs/0-0.pdf");
function req(path: string, method = "GET", who = "reader", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function pdfReq(id: string, version: number, who = "operator", bytes = source, extra: Record<string, string> = {}) {
  return new Request(origin + `/api/v1/guides/${id}/file`, { method: "PUT", body: new Uint8Array(bytes),
    headers: { origin, cookie: cookies[who] ?? "", "content-type": "application/pdf", "if-match": String(version),
      "x-file-name": encodeURIComponent("검증 가이드.pdf"), "x-file-size": String(bytes.length),
      "x-file-sha256": sha256(bytes), ...extra } });
}
async function answer<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status);
  return response.json();
}
async function signup(name: string) {
  const email = `${name}-${randomUUID()}@guide.local.test`, password = "Synthetic-guide-2026-password!";
  await answer(await auth.handler(req("/auth/sign-up/email", "POST", name, { name, email, password })));
  await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: name === "operator" } });
  if (name === "reader") await db.membership.create({ data: { tenantId: companyId,
    userId: (await db.user.findUniqueOrThrow({ where: { email } })).id, role: "viewer" } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", name, { email, password }));
  expect(login.status).toBe(200);
  cookies[name] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await requireFileScanner();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Guide", "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: companyId, name: "가이드 시험 회사", publicName: "가이드 시험 회사" } });
  await signup("reader"); await signup("operator"); await signup("outsider");
});
afterAll(async () => { await db.$disconnect(); });

describe("guide publication and protected PDFs", () => {
  let id = "", storageKey = "", creationKey = "";
  let creationInput: { category: string; categoryOrder: number; title: string; sortOrder: number };
  test("reads a seeded source PDF only through an authenticated published guide", async () => {
    await db.guide.create({ data: { id: "guide-0-0", category: "회원가입 및 등록", categoryOrder: 0,
      title: "회원가입 가이드", sortOrder: 0, status: "published", fileName: "회원가입.pdf",
      fileSize: source.length, fileSha256: sha256(source), assetKey: "0-0", publishedAt: new Date() } });
    await answer(await GET(req("/guides", "GET", "anonymous")), 401);
    await answer(await GET(req("/guides", "GET", "outsider")), 403);
    await answer(await GET(req("/guides?scope=admin")), 403);
    const list = await answer<GuideListResponse>(await GET(req("/guides?search=회원가입")));
    expect(list.total).toBe(1); expect(list.items[0].id).toBe("guide-0-0");
    await answer(await GET(req("/guides/guide-0-0/download", "GET", "anonymous")), 401);
    const download = await GET(req("/guides/guide-0-0/download"));
    expect(download.status).toBe(200); expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("x-content-sha256")).toBe(sha256(source));
    expect(Buffer.from(await download.arrayBuffer()).equals(source)).toBe(true);
  });
  test("requires operator role and file before publishing; creation is idempotent", async () => {
    const input = { category: "시험", categoryOrder: 30, title: "합성 가이드", sortOrder: 1 }, key = randomUUID();
    creationKey = key; creationInput = input;
    await answer(await POST(req("/guides", "POST", "reader", input, { "idempotency-key": key })), 403);
    const created = await answer<GuideRecord>(await POST(req("/guides", "POST", "operator", input, { "idempotency-key": key })), 201);
    id = created.id; expect(created).toMatchObject({ status: "draft", version: 1, fileName: null });
    const repeat = await answer<GuideRecord>(await POST(req("/guides", "POST", "operator", input, { "idempotency-key": key })), 201);
    expect(repeat.id).toBe(id);
    await answer(await POST(req("/guides", "POST", "operator", { ...input, title: "충돌" }, { "idempotency-key": key })), 409);
    await answer(await GET(req(`/guides/${id}`)), 404);
    await answer(await GET(req(`/guides/${id}?preview=1`)), 403);
    await answer(await PATCH(req(`/guides/${id}`, "PATCH", "operator", { version: 1, status: "published" })), 409);
    await answer(await PUT(pdfReq(id, 1, "reader")), 403);
  });
  test("validates, scans, replaces, publishes, sorts and archives one PDF", async () => {
    await answer(await PUT(pdfReq(id, 1, "operator", source, { "x-file-sha256": "0".repeat(64) })), 422);
    const attached = await answer<GuideRecord>(await PUT(pdfReq(id, 1)));
    expect(attached.version).toBe(2); expect(attached.fileSha256).toBe(sha256(source));
    storageKey = (await db.guide.findUniqueOrThrow({ where: { id } })).storageKey!;
    expect(storageKey).toBeTruthy();
    await answer(await PUT(pdfReq(id, 1)), 409);
    const published = await answer<GuideRecord>(await PATCH(req(`/guides/${id}`, "PATCH", "operator", {
      version: 2, status: "published", categoryOrder: 2, sortOrder: 3 })));
    expect(published.status).toBe("published"); expect(published.version).toBe(3);
    expect((await GET(req(`/guides/${id}`))).status).toBe(200);
    const list = await answer<GuideListResponse>(await GET(req("/guides?search=합성")));
    expect(list.total).toBe(1); expect(list.items[0].id).toBe(id);
    const download = await GET(req(`/guides/${id}/download`));
    expect(Buffer.from(await download.arrayBuffer()).equals(source)).toBe(true);
    await answer(await PATCH(req(`/guides/${id}`, "PATCH", "operator", { version: 1, title: "오래된 수정" })), 409);
    await answer(await DELETE(req(`/guides/${id}`, "DELETE", "operator", undefined, { "if-match": "1" })), 409);
    expect((await DELETE(req(`/guides/${id}`, "DELETE", "operator", undefined, { "if-match": "3" }))).status).toBe(204);
    await answer(await GET(req(`/guides/${id}/download`)), 404);
    await answer(await POST(req("/guides", "POST", "operator", creationInput, { "idempotency-key": creationKey })), 410);
    const archived = await db.guide.findUniqueOrThrow({ where: { id } });
    expect(archived).toMatchObject({ status: "archived", fileName: null, storageKey: null, version: 4 });
    await expect(lstat(join(env.PRIVATE_STORAGE_DIR, "objects", storageKey + ".enc"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.auditEvent.findMany({ where: { resourceId: id } })).map(row => row.action)).toEqual([
      "guide.created", "guide.file_replaced", "guide.updated", "guide.downloaded", "guide.archived",
    ]);
    await expect(db.guide.update({ where: { id }, data: { status: "unsafe" } })).rejects.toThrow();
  });
});

test("관리자 가이드 별칭 경로가 동일한 PostgreSQL CRUD와 운영자 권한을 사용한다", async () => {
  const input = { category: "시험", categoryOrder: 90, title: "관리자 별칭 검증", sortOrder: 90 };
  const createdResponse = await createAdminGuide(req("/admin/guides", "POST", "operator", input,
    { "idempotency-key": randomUUID() }));
  const created = await answer<GuideRecord>(createdResponse, 201);
  expect(createdResponse.headers.get("location")).toBe(`/api/v1/admin/guides/${created.id}`);

  const listed = await answer<GuideListResponse>(await listAdminGuides(req("/admin/guides", "GET", "operator")));
  expect(listed.items.some(item => item.id === created.id)).toBe(true);
  expect((await answer<GuideRecord>(await readAdminGuide(req(`/admin/guides/${created.id}`, "GET", "operator")))).id).toBe(created.id);

  const changed = await answer<GuideRecord>(await updateAdminGuide(req(`/admin/guides/${created.id}`, "PATCH", "operator",
    { version: 1, title: "관리자 별칭 수정" })));
  expect(changed).toMatchObject({ title: "관리자 별칭 수정", version: 2 });
  expect((await deleteAdminGuide(req(`/admin/guides/${created.id}`, "DELETE", "operator", undefined,
    { "if-match": "2" }))).status).toBe(204);
  expect((await db.guide.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("archived");
});
