// R24-T04 수용: 운영자 공지/가이드 CRUD·첨부→회원 조회·문의 A/B 격리→재시작 영속.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R24-T04/acceptance");
const SERVICE = "20000000-0000-4000-8000-000000000001";
const mode = process.argv[2] ?? "run";
const results: { step: string; detail: unknown }[] = [];
const step = (n: string, d: unknown) => { results.push({ step: n, detail: d }); console.log("PASS", n, JSON.stringify(d)); };

const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const adminCred = JSON.parse(await readFile(".local/requested-admin-credentials.json", "utf8")) as { email: string; password: string };
pw[adminCred.email] = adminCred.password;
async function signIn(email: string) {
  let login: Response | null = null;
  for (let i = 0; i < 6; i++) {
    login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw[email] }) });
    if (login.status !== 429) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  assert.equal(login!.status, 200, `sign-in ${email} → ${login!.status}`);
  return login!.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { origin: base, "content-type": "application/json", ...headers };
  if (cookie) h.cookie = cookie;
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
  if (r.status === 204) return { status: 204, body: {}, headers: r.headers };
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) { const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, body: { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") }, headers: r.headers }; }
  let payload: unknown = null; try { payload = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: payload as Record<string, unknown>, headers: r.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });

if (mode === "run") {
  const stamp = Date.now();
  const admin = await signIn(adminCred.email);
  const member = await signIn("owner@catchsecu.local.test");
  const memberB = await signIn("owner-b@catchsecu.local.test");
  await api(member, "/context", "POST", { serviceId: SERVICE });
  await api(memberB, "/context", "POST", { serviceId: "20000000-0000-4000-8000-000000000003" });
  await mkdir(outDir, { recursive: true });

  // 1) 공지: 운영자 초안→게시→회원 조회→수정·정렬→보관→회원 404
  const notice = await api(admin, "/notices", "POST", { category: "점검", title: "R24 공지 " + stamp,
    bodyHtml: "<p>R24 <strong>본문</strong></p><script>alert(1)</script>", sortOrder: 100 }, ik());
  assert.equal(notice.status, 201, JSON.stringify(notice.body));
  const nid = notice.body.id as string;
  assert.ok(!String(notice.body.bodyHtml).includes("<script"), "bodyHtml sanitized");
  const memberDraft = await api(member, `/notices/${nid}`);
  assert.equal(memberDraft.status, 404, "member cannot read draft");
  let nv = (await api(admin, `/notices/${nid}?preview=1`)).body as { version: number };
  const pub = await api(admin, `/notices/${nid}`, "PATCH", { version: nv.version, status: "published" });
  assert.equal(pub.status, 200);
  const listed = await api(member, "/notices?scope=published&search=R24");
  assert.ok((listed.body.items as { id: string }[]).some(i => i.id === nid), "published in member list");
  const memberRead = await api(member, `/notices/${nid}`);
  assert.equal(memberRead.status, 200);
  assert.equal(memberRead.body.status, "published");
  const stalePatch = await api(admin, `/notices/${nid}`, "PATCH", { version: nv.version, title: "구버전" });
  assert.equal(stalePatch.status, 409, "stale version 409");
  nv = (await api(admin, `/notices/${nid}?preview=1`)).body;
  step("notice-lifecycle", { noticeId: nid, draftHidden: 404, published: memberRead.status, stale: stalePatch.status });

  // 2) 첨부: 운영자 업로드(SHA-256 검증)→회원 다운로드 해시 일치→삭제 (if-match = 공지 버전)
  const fileBytes = Buffer.from("R24 첨부 본문 " + stamp), fileHash = createHash("sha256").update(fileBytes).digest("hex"), attId = randomUUID();
  const up = await api(admin, `/notices/${nid}/attachments/${attId}`, "PUT", fileBytes, {
    "content-type": "text/plain", "if-match": String(nv.version), "x-file-size": String(fileBytes.length),
    "x-file-sha256": fileHash, "x-file-name": encodeURIComponent("r24-note.txt") });
  assert.equal(up.status, 200, `upload → ${up.status} ${JSON.stringify(up.body)}`);
  const dl = await api(member, `/notices/${nid}/attachments/${attId}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.body.sha256, fileHash, "download bytes identical");
  const memberUp = await api(member, `/notices/${nid}/attachments/${randomUUID()}`, "PUT", fileBytes, {
    "content-type": "text/plain", "if-match": "1", "x-file-size": String(fileBytes.length),
    "x-file-sha256": fileHash, "x-file-name": "x.txt" });
  assert.equal(memberUp.status, 403, "member attachment upload denied");
  const del = await api(admin, `/notices/${nid}/attachments/${attId}`, "DELETE", undefined,
    { "if-match": String(up.body.noticeVersion) });
  assert.ok([200, 204].includes(del.status), `attachment delete → ${del.status}`);
  step("notice-attachment", { downloadMatch: true, memberDenied: 403, deleted: del.status });

  // 3) 회원 권한 거부 + 보관
  const memberCreate = await api(member, "/notices", "POST", { category: "x", title: "x", bodyHtml: "x", sortOrder: 0 }, ik());
  assert.equal(memberCreate.status, 403, "member create denied");
  const memberAdminList = await api(member, "/notices?scope=admin");
  assert.equal(memberAdminList.status, 403, "member admin scope denied");
  nv = (await api(admin, `/notices/${nid}?preview=1`)).body;
  const arch = await api(admin, `/notices/${nid}`, "DELETE", undefined, { "if-match": String(nv.version) });
  assert.equal(arch.status, 204);
  assert.equal((await api(member, `/notices/${nid}`)).status, 404, "archived hidden from member");
  step("notice-denial-archive", { memberCreate: 403, adminScope: 403, archived: 404 });

  // 4) 가이드: 등록→PDF 파일 등록→게시→회원 조회/다운로드→보관
  const guide = await api(admin, "/guides", "POST", { category: "시작하기", categoryOrder: 1, title: "R24 가이드 " + stamp, sortOrder: 10 }, ik());
  assert.equal(guide.status, 201, JSON.stringify(guide.body));
  const gid = guide.body.id as string;
  const noFile = await api(admin, `/guides/${gid}`, "PATCH", { version: 1, status: "published" });
  assert.equal(noFile.status, 409, "publish without PDF → FILE_REQUIRED 409");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"), pdfHash = createHash("sha256").update(pdf).digest("hex");
  const gfile = await api(admin, `/guides/${gid}/file`, "PUT", pdf, {
    "content-type": "application/pdf", "if-match": "1", "x-file-size": String(pdf.length),
    "x-file-sha256": pdfHash, "x-file-name": encodeURIComponent("r24-guide.pdf") });
  assert.equal(gfile.status, 200, `guide file → ${gfile.status} ${JSON.stringify(gfile.body)}`);
  const gv = (await api(admin, `/guides/${gid}?preview=1`)).body as { version: number };
  const gpub = await api(admin, `/guides/${gid}`, "PATCH", { version: gv.version, status: "published" });
  assert.ok([200, 201].includes(gpub.status), `guide publish → ${gpub.status} ${JSON.stringify(gpub.body)}`);
  const glist = await api(member, "/guides?scope=published&search=R24");
  assert.ok((glist.body.items as { id: string }[]).some(i => i.id === gid), "guide in member list");
  const memberG = await api(member, `/guides/${gid}`);
  assert.equal(memberG.status, 200);
  const gdl = await api(member, `/guides/${gid}/download`);
  assert.equal(gdl.status, 200, `guide download → ${gdl.status}`);
  assert.equal(gdl.body.sha256, pdfHash, "guide download bytes identical");
  step("guide-lifecycle", { guideId: gid, fileRequired: 409, published: memberG.status, downloadMatch: true });

  // 5) 문의: 회원 생성→운영자 답변→회원 종결 요청→운영자 재개→A/B 격리→보관
  const ticket = await api(member, "/support-tickets", "POST", { kind: "inquiry", subject: "R24 문의 " + stamp, body: "문의 본문", serviceId: SERVICE }, ik());
  assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
  const tid = ticket.body.id as string;
  let tv = (await api(member, `/support-tickets/${tid}`)).body as { version: number };
  const reply = await api(admin, `/support-tickets/${tid}/reply`, "POST", { version: tv.version, reply: "R24 답변" }, ik());
  assert.ok([200, 201].includes(reply.status), `reply → ${reply.status} ${JSON.stringify(reply.body)}`);
  tv = (await api(member, `/support-tickets/${tid}`)).body;
  const close = await api(member, `/support-tickets/${tid}/close`, "POST", { version: tv.version });
  assert.ok([200, 201].includes(close.status), `close → ${close.status} ${JSON.stringify(close.body)}`);
  const memberReopen = await api(member, `/support-tickets/${tid}/reopen`, "POST", { version: close.body.version ?? tv.version + 1 });
  assert.equal(memberReopen.status, 403, "reopen requires platform admin");
  tv = (await api(admin, `/support-tickets/${tid}?scope=admin`)).body as { version: number };
  const reopen = await api(admin, `/support-tickets/${tid}/reopen?scope=admin`, "POST", { version: tv.version });
  assert.ok([200, 201].includes(reopen.status), `admin reopen → ${reopen.status}`);
  const otherB = await api(memberB, `/support-tickets/${tid}`);
  assert.equal(otherB.status, 404, "tenant B cannot read tenant A ticket");
  const mineA = await api(member, "/support-tickets?scope=mine&pageSize=100");
  assert.equal(mineA.status, 200, JSON.stringify(mineA.body));
  assert.ok((mineA.body.items as { id: string }[]).some(i => i.id === tid), "own ticket in mine list");
  const mineB = await api(memberB, "/support-tickets?scope=mine&pageSize=100");
  assert.equal(mineB.status, 200, JSON.stringify(mineB.body));
  assert.ok(!(mineB.body.items as { id: string }[]).some(i => i.id === tid), "not in tenant B list");
  step("ticket-lifecycle", { ticketId: tid, reply: reply.status, close: close.status, memberReopen: 403, adminReopen: reopen.status, crossTenant: 404 });

  await writeFile(resolve(outDir, "fixture.json"), JSON.stringify({ noticeId: nid, guideId: gid, ticketId: tid, fileHash }, null, 2) + "\n", { mode: 0o600 });
  await writeFile(resolve(outDir, "http-run.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R24 acceptance:", results.length, "cases passed");
} else if (mode === "restart") {
  const fx = JSON.parse(await readFile(resolve(outDir, "fixture.json"), "utf8"));
  const notice = await db.notice.findUniqueOrThrow({ where: { id: fx.noticeId } });
  const guide = await db.guide.findUniqueOrThrow({ where: { id: fx.guideId } });
  const ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: fx.ticketId } });
  assert.ok(["published", "archived"].includes(notice.status) && ticket.replyCipher && ticket.answeredAt, "persisted state");
  results.push({ step: "restart-persist", detail: { notice: notice.status, guide: guide.status, ticket: ticket.status, answered: !!ticket.answeredAt } });
  await writeFile(resolve(outDir, "restart.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R24 restart check passed");
}
