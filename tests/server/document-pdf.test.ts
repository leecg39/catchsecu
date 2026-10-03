import { beforeAll, beforeEach, afterAll, describe, test, expect } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext } from "@/server/context";
import { roleCapabilities } from "@/server/permissions";
import { encrypt, opaqueToken, tokenHash } from "@/server/crypto";
import { renderPdf, sha256, PDF_FONT_HASH } from "@/server/pdf-renderer";
import { privateDocumentPdf } from "@/server/document-pdf";
import { GET as internal } from "@/app/api/v1/documents/[id]/versions/[number]/pdf/route";
import { GET as external } from "@/app/api/v1/public/documents/[token]/pdf/route";
import { POST as create } from "@/app/api/v1/documents/route";
import { PATCH as edit, POST as action, DELETE as archive } from "@/app/api/v1/documents/[...segments]/route";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";
import type { DocumentInput, DocumentRecord } from "@/contracts/documents";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function request(path: string, who = "owner", method = "GET", value?: unknown, headers = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "", ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function json<T>(response: Response, status = 200): Promise<T> { expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json(); }
const download = (id: string, number = 1, who = "owner") => internal(request(`/documents/${id}/versions/${number}/pdf`, who));
const publicDownload = (url: string) => external(request("/public/documents/" + url.split("/").pop() + "/pdf", "anonymous"));
const value = (patch: Partial<DocumentInput> = {}): DocumentInput => ({ serviceId: service, title: "한글 문서 " + randomUUID(), type: "consent", body: "상담을 위한 개인정보 처리 안내입니다.\n<script>alert(1)</script>", refusalNotice: "동의를 거부할 수 있습니다.", rightsContact: "시험 문의", effectiveDate: "2026-10-03", purposeIds: [], recipientIds: [], ...patch });
async function publish(row: DocumentRecord) { return json<{ document: DocumentRecord; number: number; url: string; publicationId: string }>(await action(request(`/documents/${row.id}/publish`, "owner", "POST", { version: row.version, expiresAt: null })), 201); }
async function ready(patch: Partial<DocumentInput> = {}) {
  const input = value(patch);
  const purpose = await json<{id:string}>(await createPurpose(request("/processing-purposes", "owner", "POST", { serviceId: input.serviceId, name: "PDF 목적 " + randomUUID(), purpose: "합성 상담", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, { "idempotency-key": randomUUID() })), 201);
  input.purposeIds = [purpose.id];
  const row = await json<DocumentRecord>(await create(request("/documents", "owner", "POST", input, { "idempotency-key": randomUUID() })), 201);
  return { input, ...await publish(row) };
}
async function parsedPdf(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), text = await page.getTextContent();
      pages.push(text.items.map(item => "str" in item ? item.str : "").join(" ")); page.cleanup();
    }
    expect(await pdf.getJSActions()).toBeNull(); expect(await pdf.getAttachments()).toBeNull();
    return { pages: pdf.numPages, text: pages.join("\n"), pageTexts: pages };
  } finally { await task.destroy(); }
}
async function signup(name: string, role: "owner" | "viewer", tenantId = tenant) {
  await db.rateLimit.deleteMany(); const email = name + "@document-pdf.local.test", password = "Pdf-testing-password!123";
  expect((await auth.handler(request("/auth/sign-up/email", "anonymous", "POST", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  if (tenantId === tenant) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(request("/auth/sign-in/email", "anonymous", "POST", { email, password })); expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: "회사 " + id, publicName: "공개 회사", policy: { create: {} } } });
  for (const id of [service, second]) await db.service.create({ data: { id, tenantId: tenant, name: id, externalName: "공개 서비스" } });
  await signup("owner", "owner"); await signup("viewer", "viewer"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("stored document PDF with real PostgreSQL", () => {
  test("produces actual PDF bytes and returns the identical file through authorized and public routes", async () => {
    const row = await ready(), response = await download(row.document.id); expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer()), hash = sha256(bytes);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(5000);
    expect(response.headers.get("content-type")).toBe("application/pdf"); expect(response.headers.get("x-pdf-sha256")).toBe(hash);
    expect(response.headers.get("content-disposition")).toContain("attachment;"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.document.id } });
    const stored = await db.documentPdf.findUniqueOrThrow({ where: { documentVersionId: version.id } });
    expect(stored).toMatchObject({ contentHash: version.contentHash, pdfHash: hash, rendererVersion: 1, fontHash: PDF_FONT_HASH, pageCount: 1 });
    expect(response.headers.get("x-document-sha256")).toBe(version.contentHash);
    const parsed = await parsedPdf(bytes); expect(parsed.pages).toBe(1);
    expect(parsed.text.replace(/\s/g, "")).toContain("<script>alert(1)</script>");
    expect(parsed.text).toContain(version.contentHash);
    for (const next of [await download(row.document.id, 1, "viewer"), await publicDownload(row.url)]) {
      expect(next.status).toBe(200); expect(Buffer.from(await next.arrayBuffer())).toEqual(bytes);
    }
    expect(await db.auditEvent.count({ where: { resourceId: version.id, action: "document.pdf_downloaded" } })).toBe(2);
  });
  test("older version stays byte-identical after revision and public revocation", async () => {
    const row = await ready(), original = Buffer.from(await (await download(row.document.id)).arrayBuffer());
    const changed = await json<DocumentRecord>(await edit(request(`/documents/${row.document.id}`, "owner", "PATCH", { ...row.input, body: "개정한 두 번째 본문", version: row.document.version })));
    const secondVersion = await publish(changed), secondFile = await download(row.document.id, 2); expect(secondFile.status).toBe(200);
    expect(sha256(Buffer.from(await secondFile.arrayBuffer()))).not.toBe(sha256(original));
    expect((await archive(request(`/documents/${row.document.id}`, "owner", "DELETE", undefined, { "if-match": String(secondVersion.document.version) }))).status).toBe(204);
    expect((await publicDownload(row.url)).status).toBe(410); expect((await publicDownload(secondVersion.url)).status).toBe(410);
    expect(Buffer.from(await (await download(row.document.id)).arrayBuffer())).toEqual(original);
    expect(await db.documentPdf.count({ where: { documentId: row.document.id } })).toBe(2);
  });
  test("requires current tenant, service grant and membership even for a cached PDF", async () => {
    const row = await ready(); expect((await download(row.document.id)).status).toBe(200);
    expect((await download(row.document.id, 1, "anonymous")).status).toBe(401);
    expect((await download(row.document.id, 1, "foreign")).status).toBe(404);
    const unassigned = await ready({ serviceId: second }); expect((await download(unassigned.document.id, 1, "viewer")).status).toBe(403);
    const ctx = await requireContext(request("/context", "viewer").headers, "document.read");
    await db.serviceGrant.updateMany({ where: { memberId: members.viewer }, data: { capabilities: [] } });
    try { expect((await download(row.document.id, 1, "viewer")).status).toBe(403); await expect(privateDocumentPdf(ctx, row.document.id, 1, randomUUID())).rejects.toMatchObject({ status: 403 }); }
    finally { await db.serviceGrant.updateMany({ where: { memberId: members.viewer }, data: { capabilities: [...roleCapabilities("viewer")] } }); }
  });
  test("expired tokens and closed tenant/service cannot read already generated PDFs", async () => {
    const row = await ready(); expect((await publicDownload(row.url)).status).toBe(200);
    const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: row.document.id } }), token = opaqueToken();
    await db.documentPublication.create({ data: { tenantId: tenant, serviceId: service, documentId: row.document.id, documentVersionId: version.id, tokenHash: tokenHash(token), tokenCipher: encrypt(token), createdAt: new Date(Date.now()-120000), expiresAt: new Date(Date.now()-60000) } });
    expect((await publicDownload("/document/view/" + token)).status).toBe(410);
    await db.service.update({ where: { id: service }, data: { status: "archived", version: { increment: 1 } } });
    try { expect((await publicDownload(row.url)).status).toBe(410); } finally { await db.service.update({ where: { id: service }, data: { status: "active", version: { increment: 1 } } }); }
    await db.company.update({ where: { id: tenant }, data: { status: "closed", version: { increment: 1 } } });
    try { expect((await publicDownload(row.url)).status).toBe(410); expect((await download(row.document.id)).status).toBe(403); }
    finally { await db.company.update({ where: { id: tenant }, data: { status: "active", version: { increment: 1 } } }); }
  });
  test("concurrent first downloads create one immutable artifact", async () => {
    const row = await ready(); const responses = await Promise.all([download(row.document.id), download(row.document.id, 1, "viewer"), publicDownload(row.url)]);
    expect(responses.map(item => item.status)).toEqual([200,200,200]);
    const hashes = await Promise.all(responses.map(async item => sha256(Buffer.from(await item.arrayBuffer())))); expect(new Set(hashes).size).toBe(1);
    expect(await db.documentPdf.count({ where: { documentId: row.document.id } })).toBe(1);
  });
  test("database rejects changed files, deletion, wrong source hash and cross-service binding", async () => {
    const row = await ready(); await download(row.document.id);
    const stored = await db.documentPdf.findFirstOrThrow({ where: { documentId: row.document.id } });
    await expect(db.documentPdf.update({ where: { documentVersionId: stored.documentVersionId }, data: { rendererVersion: 2 } })).rejects.toThrow();
    await expect(db.documentPdf.delete({ where: { documentVersionId: stored.documentVersionId } })).rejects.toThrow();
    const next = await ready(), version = await db.documentVersion.findFirstOrThrow({ where: { documentId: next.document.id } });
    const draft = { ...stored, documentVersionId: version.id, documentId: next.document.id, contentHash: version.contentHash };
    await expect(db.documentPdf.create({ data: { ...draft, contentHash: "f".repeat(64) } })).rejects.toThrow();
    await expect(db.documentPdf.create({ data: { ...draft, serviceId: second } })).rejects.toThrow();
    await expect(db.documentPdf.create({ data: { ...draft, pdfHash: "f".repeat(64) } })).rejects.toThrow();
    await expect(db.documentPdf.create({ data: { ...draft, bytes: Buffer.from("invalid") } })).rejects.toThrow();
    expect(await db.documentPdf.count({ where: { documentId: next.document.id } })).toBe(0);
  });
  test("malformed paths, missing versions and excessive requests return JSON errors", async () => {
    const row = await ready();
    for (const number of [0, -1, 1.5]) expect((await download(row.document.id, number)).status).toBe(422);
    expect((await download(row.document.id, 100)).status).toBe(404);
    expect((await download(randomUUID())).status).toBe(404);
    expect((await publicDownload("not-a-token")).status).toBe(404);
    await db.apiRateLimit.upsert({ where: { key: "document-pdf:member:" + members.owner }, create: { key: "document-pdf:member:" + members.owner, count: 30, resetAt: new Date(Date.now()+60000) }, update: { count: 30 } });
    const blocked = await download(row.document.id); expect(blocked.status).toBe(429); expect(blocked.headers.get("content-type")).toContain("json");
    expect(await db.documentPdf.count({ where: { documentId: row.document.id } })).toBe(0);
  });
  test("unsupported glyphs fail explicitly without saving a damaged document", async () => {
    const row = await ready({ body: "지원되지 않는 문자 시험 💩" });
    const result = await download(row.document.id); expect(result.status).toBe(422); expect((await result.json()).error.code).toBe("PDF_UNSUPPORTED_CHARACTER");
    expect(await db.documentPdf.count({ where: { documentId: row.document.id } })).toBe(0);
  });
  test("multi-page Korean rendering is deterministic and includes safe attachment naming", async () => {
    const row = await ready({ title: '한글 "문서" / 시험', body: Array.from({length:90}, (_,i)=>`검증 문단 ${i+1}: 한글과 English 개인정보 안내를 그대로 보존합니다.`).join("\n") });
    const result = await download(row.document.id); expect(result.status).toBe(200);
    expect(result.headers.get("content-disposition")).not.toContain('\r');
    expect(decodeURIComponent(result.headers.get("content-disposition")!.split("UTF-8''")[1])).toBe('한글 "문서" _ 시험-v1.pdf');
    const stored = await db.documentPdf.findFirstOrThrow({ where: { documentId: row.document.id } }); expect(stored.pageCount).toBeGreaterThan(2);
    const v = await db.documentVersion.findUniqueOrThrow({where:{id:stored.documentVersionId}});
    const regenerated = await renderPdf({ title:row.input.title, author:"공개 회사", text:v.renderedText,contentHash:v.contentHash,version:1,publishedAt:v.createdAt });
    expect(regenerated.pdfHash).toBe(stored.pdfHash);
    expect(Buffer.from(regenerated.bytes)).toEqual(Buffer.from(stored.bytes));
    const parsed = await parsedPdf(regenerated.bytes); expect(parsed.pages).toBe(stored.pageCount);
    expect(parsed.pageTexts.every(text => text.replace(/v\d+\s*\|\s*\d+\s*\/\s*\d+/g, "").trim().length > 0)).toBe(true);
    for (let i = 1; i <= 90; i++) expect(parsed.text).toContain("검증 문단 " + i + ":");
    const clean = (text: string) => text.replace(/v\d+\s*\|\s*\d+\s*\/\s*\d+/g, "").replace(/\s/g, "");
    expect(clean(parsed.text)).toContain(clean(v.renderedText));
  });
  test("oversized text and excessive page count stop before persisting a file", async () => {
    const source = { title:"길이 시험",author:"회사",text:"a".repeat(500001),contentHash:"a".repeat(64),version:1,publishedAt:new Date("2026-10-03T00:00:00Z") };
    await expect(renderPdf(source)).rejects.toMatchObject({ code:"PDF_TOO_LARGE" });
    await expect(renderPdf({...source,text:"검사\n".repeat(11000)})).rejects.toMatchObject({ code:"PDF_TOO_LARGE" });
  });
});
