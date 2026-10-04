import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterEach, afterAll, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireActor } from "@/server/context";
import { privateFiles } from "@/server/file-storage";
import { sha256 } from "@/server/file-validation";
import { downloadGuide } from "@/server/guides";
import { downloadNoticeAttachment } from "@/server/notice-attachments";
import { route } from "@/server/http";

const fault = vi.hoisted(() => ({ expire: false }));
vi.mock("@/server/file-storage", async original => {
  const actual = await original<typeof import("@/server/file-storage")>();
  return { ...actual, privateFiles: { ...actual.privateFiles, read: async (key: string) => {
    const bytes = await actual.privateFiles.read(key);
    if (fault.expire) vi.setSystemTime(Date.now() + 60000);
    return bytes;
  } } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const pdf = await readFile("assets/help-pdfs/0-0.pdf"), hash = sha256(pdf), keys: string[] = [];
let actor: Awaited<ReturnType<typeof requireActor>>, noticeId: string, attachmentId: string, guideId: string;
const action = (kind: string) => kind === "notice" ? "notice.attachment_downloaded" : "guide.downloaded";
function read(kind: string, preview = false) {
  return route(async (_request, requestId) => kind === "notice"
    ? downloadNoticeAttachment(actor, noticeId, attachmentId, preview, requestId)
    : downloadGuide(actor, guideId, preview, requestId))(new Request(origin + "/download-audit"));
}
async function requestEvents(r: Response) { return db.auditEvent.findMany({ where: { requestId: r.headers.get("x-request-id") ?? "missing" } }); }
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Notice", "Guide", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord" CASCADE');
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_download_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action=(SELECT split_part(name,'fail:',2) FROM "User" WHERE id=NEW."actorId") THEN RAISE EXCEPTION 'synthetic download audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_download_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_download_audit_failure()');
});
beforeEach(async () => {
  vi.useRealTimers(); fault.expire = false; await db.rateLimit.deleteMany();
  const email = randomUUID() + "@download-audit.example.test", password = "Download-audit!123456";
  const call = (path: string) => auth.handler(new Request(origin + "/api/v1/auth" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "다운로드 감사", email, password }) }));
  expect((await call("/sign-up/email")).status).toBe(200);
  await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: true } });
  const login = await call("/sign-in/email"); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "); actor = await requireActor(new Headers({ cookie }));
  const storageKey = randomUUID(); keys.push(storageKey); await privateFiles.write(storageKey, pdf);
  const notice = await db.notice.create({ data: { category: "공지사항", title: "감사 검증", bodyHtml: "<p>감사 검증</p>", status: "published", publishedAt: new Date(), attachments: { create: { fileName: "검증.pdf", mime: "application/pdf", fileSize: pdf.length, fileSha256: hash, storageKey } } }, include: { attachments: true } });
  noticeId = notice.id; attachmentId = notice.attachments[0].id;
  guideId = (await db.guide.create({ data: { category: "검증", title: "감사 가이드", status: "published", publishedAt: new Date(), fileName: "검증.pdf", fileSize: pdf.length, fileSha256: hash, storageKey } })).id;
});
afterEach(() => { fault.expire = false; vi.useRealTimers(); });
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER qa_download_audit_failure ON "AuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION qa_download_audit_failure()');
  for (const key of keys) await privateFiles.remove(key); await db.$disconnect();
});

test.each(["notice", "guide"])("%s returns real PDF bytes with one request-linked safe event", async kind => {
  const r = await read(kind); expect(r.status).toBe(200); expect(Buffer.from(await r.arrayBuffer()).equals(pdf)).toBe(true);
  const rows = await requestEvents(r); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ actorId: actor.user.id, action: action(kind) });
  expect(JSON.stringify(rows).includes(actor.user.email)).toBe(false);
});
test.each(["notice", "guide"])("%s rejects an account revoked after the actor snapshot without a download event", async kind => {
  await db.user.update({ where: { id: actor.user.id }, data: { status: "suspended" } });
  const r = await read(kind); expect(r.status).toBe(401); expect(await requestEvents(r)).toHaveLength(0);
});
test.each(["notice", "guide"])("%s rejects a session revoked after the actor snapshot without a download event", async kind => {
  await db.session.delete({ where: { id: actor.session.id } });
  const r = await read(kind); expect(r.status).toBe(401); expect(await requestEvents(r)).toHaveLength(0);
});
test.each(["notice", "guide"])("%s rechecks platform administration for preview", async kind => {
  await db.user.update({ where: { id: actor.user.id }, data: { platformAdmin: false } });
  const r = await read(kind, true); expect(r.status).toBe(403); expect(await requestEvents(r)).toHaveLength(0);
});
test.each(["notice", "guide"])("%s rolls back the event when its session deadline ends during file preparation", async kind => {
  await db.session.update({ where: { id: actor.session.id }, data: { expiresAt: new Date(Date.now() + 10000) } });
  // Both file sources exercise the actual encrypted storage reader.
  if (kind === "guide") await db.guide.update({ where: { id: guideId }, data: { assetKey: null, storageKey: keys.at(-1) } });
  fault.expire = true; const r = await read(kind); fault.expire = false; vi.useRealTimers();
  expect(r.status).toBe(401); expect(await requestEvents(r)).toHaveLength(0);
});
test.each(["notice", "guide"])("%s audit persistence failure cannot return successful file bytes", async kind => {
  await db.user.update({ where: { id: actor.user.id }, data: { name: "fail:" + action(kind) } });
  const r = await read(kind); expect(r.status).toBe(500); expect(await requestEvents(r)).toHaveLength(0);
});
