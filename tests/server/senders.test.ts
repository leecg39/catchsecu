import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { decrypt } from "@/server/crypto";
import { roleCapabilities } from "@/server/permissions";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/senders/[[...segments]]/route";
import { POST as uploadPost, PUT as uploadPut } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as fileGet } from "@/app/api/v1/files/[...segments]/route";
import { POST as formPost } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { runOneJob, enqueueMarketingMail, SENDER_MAIL_JOB_TYPE } from "@/server/jobs";
import { cleanupSenderVerificationMail, listSenders } from "@/server/senders";
import { requireContext } from "@/server/context";
import { requireVerifiedSender } from "@/server/sender-access";
import { privateFiles } from "@/server/file-storage";
import { cleanupExpiredFiles } from "@/server/files";
import { localSenderDns } from "../helpers/sender-dns";
import { senderList, type SenderRecord } from "@/contracts/senders";
import type { FileInfo } from "@/contracts/files";
import type { FormRecord, Paged } from "@/contracts/forms";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), other = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
const records = new Map<string, string>(); let dns: Awaited<ReturnType<typeof localSenderDns>>;
const original = { dns: env.SENDER_DNS_SERVER, mail: env.MAIL_TRANSPORT, solapiTenant: env.SOLAPI_TENANT_ID, key: env.SOLAPI_API_KEY, secret: env.SOLAPI_API_SECRET };
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? who, ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
async function signUp(name: string, tenantId: string, role: Role) {
  await db.rateLimit.deleteMany(); const email = name + "@senders.local.test", password = "Sender-synthetic-password-2026!";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password })));
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  for (const serviceId of tenantId === tenant ? [service] : [other]) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "발신자 QA", policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [other, foreign]]) await db.service.create({ data: { id, tenantId, name: id, externalName: "발신자 검증" } });
  for (const [name, role] of [["owner", "owner"], ["sender", "sender"], ["viewer", "viewer"], ["privacy", "privacy"]] as [string, Role][]) await signUp(name, tenant, role);
  await signUp("foreign", foreign, "owner"); await db.job.updateMany({ where: { status: "queued" }, data: { status: "cancelled" } });
  dns = await localSenderDns(records); env.SENDER_DNS_SERVER = dns.server;
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); env.MAIL_TRANSPORT = original.mail; env.SOLAPI_TENANT_ID = original.solapiTenant; env.SOLAPI_API_KEY = original.key; env.SOLAPI_API_SECRET = original.secret; });
afterAll(async () => { await dns.close(); env.SENDER_DNS_SERVER = original.dns; await db.$disconnect(); });
async function create(channel: "email" | "sms" = "email", serviceId = service, who = "owner", address = channel === "email" ? "sender@" + randomUUID() + ".test" : "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0")) {
  const out = await ok<{ id: string }>(await POST(req("/senders", "POST", who, { serviceId, channel, address, label: "합성 발신자", description: "테스트" }, { "idempotency-key": randomUUID() })), 201);
  return read(out.id, who);
}
async function read(id: string, who = "owner") { return ok<SenderRecord>(await GET(req("/senders/" + id, "GET", who))); }
async function act(row: SenderRecord, action: string, extra: object = {}, expected = 200, who = "owner") { await ok(await POST(req("/senders/" + row.id + "/" + action, "POST", who, { version: row.version, ...extra })), expected); return read(row.id, who); }
async function emailCode(row: SenderRecord) {
  const out = await ok<{ id: string; version: number }>(await POST(req("/senders/" + row.id + "/request-email", "POST", "owner", { version: row.version })), 202);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + out.id } });
  for (let i = 0; i < 30; i++) { await runOneJob("sender-qa"); if ((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status === "done") break; }
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
  expect(mail.to).toBe(row.address); const code = /인증번호: (\d{6})/.exec(mail.text)![1];
  return { row: await read(row.id), id: out.id, code, jobId: job.id };
}
async function verifyEmail(row = undefined as SenderRecord | undefined) {
  let r = row ?? await create(); r = await act(r, "dns", {}, 201); const proof = r.verifications!.find(p => p.method === "dns")!; records.set(proof.recordName!, proof.recordValue!);
  r = await act(r, "check"); expect(r.status).toBe("pending"); const sent = await emailCode(r);
  r = await act(sent.row, "confirm-email", { verificationId: sent.id, code: sent.code }); expect(r.status).toBe("verified"); expect(r.environment).toBe("local"); return r;
}
function provider(status = "ACTIVE", expireAt: string | null = new Date(Date.now() + 86400000).toISOString(), address = "01012345678") {
  env.SOLAPI_TENANT_ID = tenant; env.SOLAPI_API_KEY = "syntheticKey"; env.SOLAPI_API_SECRET = "syntheticSecret-123456789";
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://api.solapi.com/senderid/v1/numbers"); expect(init?.redirect).toBe("error");
    const header = (init!.headers as Record<string, string>).Authorization, parts = Object.fromEntries([...header.matchAll(/(apiKey|date|salt|signature)=([^, ]+)/g)].map(m => [m[1], m[2]]));
    expect(parts.signature).toBe(createHmac("sha256", env.SOLAPI_API_SECRET!).update(parts.date + parts.salt).digest("hex"));
    return Response.json({ accountId: "synthetic-account", senderIds: [{ handleKey: "synthetic-reference", phoneNumber: address, status, expireAt }] });
  });
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5eEAAAAASUVORK5CYII=", "base64");
async function evidence(row: SenderRecord) {
  const input = { version: row.version, name: "합성 증빙.png", mime: "image/png", size: png.length, sha256: createHash("sha256").update(png).digest("hex") };
  const file = await ok<FileInfo>(await POST(req("/senders/" + row.id + "/evidence", "POST", "owner", input, { "idempotency-key": randomUUID() })), 201);
  await ok(await uploadPut(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { origin, cookie: cookies.owner, "content-type": "image/png" }, body: png })));
  await ok(await uploadPost(req("/uploads/" + file.id + "/complete", "POST")));
  const r = await act(row, "evidence/" + file.id + "/attach"); return { row: r, file: (await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })) };
}
async function recipient() {
  const name = randomUUID(), email = randomUUID(), contact = "recipient-" + randomUUID() + "@senders.local.test";
  const form = await ok<FormRecord>(await formPost(req("/forms", "POST", "owner", { serviceId: service, title: "발신자 발송 검증", content: { body: "합성 자료", consentPurpose: "시험", consentRequired: true, retentionDays: 30, maxResponses: 10, questions: [{ id: name, label: "이름", type: "단문형 답변", required: true }, { id: email, label: "이메일", type: "단문형 답변", required: true }], marketing: { purpose: "소식 안내", nameQuestionId: name, emailQuestionId: email } } }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok<{ token: string }>(await formAction(req("/forms/" + form.id + "/publish", "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  const token = pub.token;
  await ok(await publicPost(req("/public/forms/" + token + "/submissions", "POST", "anonymous", { answers: { [name]: "합성 수신자", [email]: contact }, consent: true, marketingChannels: ["email"] }, { "idempotency-key": randomUUID() })), 201); return contact;
}
describe("service scoped sender CRUD, verification and delivery", () => {
  test("registration is persistent, normalized, idempotent, searchable and versioned", async () => {
    const input = { serviceId: service, channel: "email", address: " SALES@normalized-sender.test ", label: "고유 검색 이름", description: "등록" }, key = randomUUID();
    const a = await ok<{ id: string }>(await POST(req("/senders", "POST", "owner", input, { "idempotency-key": key })), 201);
    expect((await ok<{ id: string }>(await POST(req("/senders", "POST", "owner", input, { "idempotency-key": key })), 201)).id).toBe(a.id);
    expect((await POST(req("/senders", "POST", "owner", input, { "idempotency-key": randomUUID() }))).status).toBe(409);
    const r = await read(a.id); expect(r.address).toBe("sales@normalized-sender.test"); expect(r.status).toBe("pending"); expect(r.eligible).toBe(false);
    const query = await ok<Paged<SenderRecord>>(await GET(req("/senders?" + new URLSearchParams({ serviceId: service, channel: "email", search: "고유 검색" })))); expect(query.items.map(r => r.id)).toEqual([a.id]);
    await ok(await PATCH(req("/senders/" + a.id, "PATCH", "owner", { version: 1, address: r.address, label: "수정됨", description: "수정 설명" })));
    expect((await PATCH(req("/senders/" + a.id, "PATCH", "owner", { version: 1, address: r.address, label: "오래됨", description: "" }))).status).toBe(409);
    expect((await read(a.id)).events!.map(e => e.kind)).toEqual(["updated", "created"]);
  });
  test("unknown actors, roles and cross-company/service access are rejected", async () => {
    const r = await create(), secondRow = await create("email", second);
    for (const who of ["viewer", "privacy"]) expect((await GET(req("/senders/" + r.id, "GET", who))).status).toBe(403);
    expect((await GET(req("/senders/" + r.id, "GET", "anonymous"))).status).toBe(401);
    expect((await GET(req("/senders/" + r.id, "GET", "foreign"))).status).toBe(404);
    expect((await GET(req("/senders/" + secondRow.id, "GET", "sender"))).status).toBe(403);
    await create("sms", service, "sender");
    const grant = await db.serviceGrant.findFirstOrThrow({ where: { memberId: members.sender, serviceId: service } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["service.read"] } });
    expect((await GET(req("/senders/" + r.id, "GET", "sender"))).status).toBe(403);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: [...roleCapabilities("sender")] } });
  });
  test("invalid addresses, consumer domains, forged activation and foreign origin fail", async () => {
    for (const [channel, address] of [["email", "person@gmail.com"], ["email", "bad\r\n@domain.test"], ["sms", "123"], ["sms", "+99912345"]]) expect((await POST(req("/senders", "POST", "owner", { serviceId: service, channel, address, label: "합성" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await POST(req("/senders", "POST", "owner", { serviceId: service, channel: "sms", address: "0212345678", label: "합성", status: "verified" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await POST(req("/senders", "POST", "owner", {}, { origin: "https://foreign.invalid" }))).status).toBe(403);
  });
  test("real TXT queries and actual local code mail are both required, code is consumed once", async () => {
    let r = await create(); r = await act(r, "dns", {}, 201); const dnsProof = r.verifications![0];
    const wrong = await ok<{ verified: boolean }>(await POST(req("/senders/" + r.id + "/check", "POST", "owner", { version: r.version }))); expect(wrong.verified).toBe(false);
    r = await read(r.id); const sent = await emailCode(r); r = await act(sent.row, "confirm-email", { verificationId: sent.id, code: sent.code }); expect(r.status).toBe("pending");
    expect((await POST(req("/senders/" + r.id + "/confirm-email", "POST", "owner", { version: r.version, verificationId: sent.id, code: sent.code }))).status).toBe(422);
    await expect(access(resolve(env.LOCAL_MAIL_DIR, sent.jobId + ".json"))).rejects.toThrow();
    records.set(dnsProof.recordName!, dnsProof.recordValue!); r = await act(r, "check"); expect(r.status).toBe("verified"); expect(r.eligible).toBe(true);
  });
  test("five wrong codes are committed and never become a valid proof", async () => {
    const sent = await emailCode(await create()); const wrong = sent.code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) expect((await POST(req("/senders/" + sent.row.id + "/confirm-email", "POST", "owner", { version: sent.row.version, verificationId: sent.id, code: wrong }))).status).toBe(422);
    const proof = await db.senderVerification.findUniqueOrThrow({ where: { id: sent.id } }); expect(proof.attempts).toBe(5); expect(proof.status).toBe("failed"); expect(proof.tokenHash).toBeNull();
    expect((await POST(req("/senders/" + sent.row.id + "/confirm-email", "POST", "owner", { version: sent.row.version, verificationId: sent.id, code: sent.code }))).status).toBe(422);
  });
  test("expired code fails and cleanup erases queued/local authentication copies", async () => {
    const sent = await emailCode(await create()); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60000);
    expect((await POST(req("/senders/" + sent.row.id + "/confirm-email", "POST", "owner", { version: sent.row.version, verificationId: sent.id, code: sent.code }))).status).toBe(422);
    await cleanupSenderVerificationMail(); const job = await db.job.findUniqueOrThrow({ where: { id: sent.jobId } }); expect(decrypt(job.payloadCipher)).toEqual({ erased: true }); expect(job.payloadErasedAt).not.toBeNull();
    await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  });
  test("address change and renewal revoke old challenges and require fresh proofs", async () => {
    const sent = await emailCode(await create());
    await ok(await PATCH(req("/senders/" + sent.row.id, "PATCH", "owner", { version: sent.row.version, address: "new@" + randomUUID() + ".test", label: "변경", description: "" })));
    let r = await read(sent.row.id); expect(r.generation).toBe(2); expect(r.status).toBe("pending");
    expect((await POST(req("/senders/" + r.id + "/confirm-email", "POST", "owner", { version: r.version, verificationId: sent.id, code: sent.code }))).status).toBe(422);
    await expect(access(resolve(env.LOCAL_MAIL_DIR, sent.jobId + ".json"))).rejects.toThrow();
    r = await verifyEmail(r); r = await act(r, "renew"); expect(r.status).toBe("pending"); expect(r.verifiedAt).toBeNull(); expect(r.isDefault).toBe(false);
  });
  test("only verified senders become the exclusive service/channel default", async () => {
    let a = await create(); expect((await POST(req("/senders/" + a.id + "/default", "POST", "owner", { version: a.version }))).status).toBe(409);
    a = await verifyEmail(a); let b = await verifyEmail(); a = await act(a, "default"); b = await act(b, "default"); expect((await read(a.id)).isDefault).toBe(false); expect(b.isDefault).toBe(true);
    b = await act(b, "disable"); expect(b.isDefault).toBe(false); expect(b.status).toBe("disabled"); expect(b.eligible).toBe(false);
  });
  test("provider absence and foreign company configuration cannot activate a phone", async () => {
    const r = await create("sms"); env.SOLAPI_API_KEY = undefined;
    expect((await POST(req("/senders/" + r.id + "/check", "POST", "owner", { version: r.version }))).status).toBe(503); expect((await read(r.id)).status).toBe("pending");
    const call = provider(); env.SOLAPI_TENANT_ID = foreign;
    expect((await POST(req("/senders/" + r.id + "/check", "POST", "owner", { version: r.version }))).status).toBe(503); expect(call).not.toHaveBeenCalled();
  });
  test("provider activation requires the exact phone, active status and future expiry", async () => {
    let r = await create("sms", service, "owner", "01012345678");
    for (const [status, expiry, phone] of [["PENDING", new Date(Date.now()+86400000).toISOString(), r.address!], ["ACTIVE", new Date(Date.now()-60000).toISOString(), r.address!], ["ACTIVE", null, "01011111111"]] as [string,string|null,string][]) { const call=provider(status,expiry,phone); r=await act(r,"check"); expect(r.status).toBe("pending"); call.mockRestore(); }
    provider("ACTIVE",new Date(Date.now()+86400000).toISOString(),r.address!); r=await act(r,"check"); expect(r.status).toBe("verified"); expect(r.environment).toBe("live"); expect(r.eligible).toBe(true);
    expect(r.verifications!.some(p=>p.resultCode==='VERIFIED')).toBe(true);
  });
  test("provider failures and privilege withdrawal during I/O keep the sender unverified", async () => {
    const r = await create("sms"); provider().mockResolvedValue(new Response("secret provider error",{status:403}));
    expect((await POST(req("/senders/"+r.id+"/check","POST","owner",{version:r.version}))).status).toBe(503); vi.restoreAllMocks();
    const grant=await db.serviceGrant.findFirstOrThrow({where:{memberId:members.sender,serviceId:service}});
    provider("ACTIVE",null,r.address!).mockImplementation(async()=>{await db.serviceGrant.update({where:{id:grant.id},data:{capabilities:["service.read"]}}); return Response.json({accountId:"qa",senderIds:[{handleKey:"qa",phoneNumber:r.address,status:"ACTIVE",expireAt:null}]});});
    expect((await POST(req("/senders/"+r.id+"/check","POST","sender",{version:r.version}))).status).toBe(403); expect((await read(r.id)).status).toBe("pending");
    await db.serviceGrant.update({where:{id:grant.id},data:{capabilities:[...roleCapabilities("sender")]}});
  });
  test("local email verification cannot authorize live SMTP after transport changes", async () => {
    const r=await verifyEmail(); env.MAIL_TRANSPORT="smtp"; const current=await read(r.id); expect(current.eligible).toBe(false); expect(current.denial).toContain("다시 인증");
  });
  test("evidence uses actual scanning, encrypted bytes, bound download and actual removal", async () => {
    const {row,file}=await evidence(await create("sms")); expect(file.status).toBe("attached"); expect(file.scanStatus).toBe("clean"); expect(file.senderId).toBe(row.id);
    const download=await GET(req(`/senders/${row.id}/evidence/${file.id}/download`)); expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
    expect((await fileGet(req(`/files/${file.id}/download`))).status).toBe(404); expect((await GET(req(`/senders/${row.id}/evidence/${file.id}/download`,"GET","foreign"))).status).toBe(404);
    const wrong=await create("sms"); expect((await GET(req(`/senders/${wrong.id}/evidence/${file.id}/download`))).status).toBe(404);
    await ok(await DELETE(req(`/senders/${row.id}/evidence/${file.id}`,"DELETE","owner",{version:row.version}))); expect((await db.fileObject.findUniqueOrThrow({where:{id:file.id}})).status).toBe("deleted"); await expect(privateFiles.read(file.storageKey)).rejects.toThrow();
  });
  test("deleting a sender removes attached evidence and cannot revive its tombstone", async () => {
    const {row,file}=await evidence(await create("sms")); await ok(await DELETE(req("/senders/"+row.id,"DELETE","owner",{version:row.version})));
    const stored=await db.sender.findUniqueOrThrow({where:{id:row.id}}); expect(stored.addressCipher).toBeNull(); expect(stored.status).toBe("deleted"); await expect(privateFiles.read(file.storageKey)).rejects.toThrow();
    expect((await POST(req("/senders/"+row.id+"/renew","POST","owner",{version:stored.version}))).status).toBe(410); await expect(db.sender.update({where:{id:row.id},data:{status:"pending",version:{increment:1}}})).rejects.toThrow();
  });
  test("storage deletion failure is explicit and the worker retries the real object", async () => {
    const {row,file}=await evidence(await create("sms")); const failure=vi.spyOn(privateFiles,"remove").mockRejectedValueOnce(new Error("storage unavailable"));
    const result=await ok<{cleanupPending:boolean}>(await DELETE(req(`/senders/${row.id}/evidence/${file.id}`,"DELETE","owner",{version:row.version}))); expect(result.cleanupPending).toBe(true); failure.mockRestore();
    await cleanupExpiredFiles(); expect((await db.fileObject.findUniqueOrThrow({where:{id:file.id}})).status).toBe("deleted"); await expect(privateFiles.read(file.storageKey)).rejects.toThrow();
  });
  test("database rejects missing history, unverified defaults and unverified jobs", async () => {
    const r=await create(); await expect(db.sender.update({where:{id:r.id},data:{label:"no event",version:{increment:1}}})).rejects.toThrow();
    await expect(db.sender.update({where:{id:r.id},data:{status:"verified",isDefault:true,verifiedAt:new Date(),expiresAt:new Date(Date.now()+60000),environment:"local",version:{increment:1}}})).rejects.toThrow();
    await expect(db.job.create({data:{tenantId:tenant,senderId:r.id,type:"mail",payloadCipher:"invalid",dedupeKey:randomUUID()}})).rejects.toThrow();
    await expect(db.senderEvent.deleteMany({where:{senderId:r.id}})).rejects.toThrow(); expect((await read(r.id)).label).toBe(r.label);
  });
  test("actual delivery uses verified From and queued use blocks sender deletion", async () => {
    const sender=await verifyEmail(),to=await recipient();
    const sent=await enqueueMarketingMail({to,subject:"실제 발신자 검증",text:"합성 메시지"},{tenantId:tenant,serviceId:service},undefined,new Date(Date.now()+3600000),{id:sender.id,version:sender.version}); expect(sent.id).toBeTruthy();
    expect((await DELETE(req("/senders/"+sender.id,"DELETE","owner",{version:sender.version}))).status).toBe(409);
    await db.job.update({where:{id:sent.id!},data:{dueAt:new Date()}}); await runOneJob("sender-delivery");
    const job=await db.job.findUniqueOrThrow({where:{id:sent.id!}}); expect(job.status).toBe("done");
    const mail=JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR,job.id+".json"),"utf8")); expect(mail.from).toEqual({name:sender.label,address:sender.address});
  });
  test("a sender disabled before the due time cancels delivery without a local mail file", async () => {
    const sender=await verifyEmail(),to=await recipient(),sent=await enqueueMarketingMail({to,subject:"중지 후 차단",text:"합성"},{tenantId:tenant,serviceId:service},undefined,new Date(Date.now()+3600000),{id:sender.id,version:sender.version});
    await act(sender,"disable"); await db.job.update({where:{id:sent.id!},data:{dueAt:new Date()}}); await runOneJob("sender-block");
    expect((await db.job.findUniqueOrThrow({where:{id:sent.id!}})).status).toBe("cancelled"); await expect(access(resolve(env.LOCAL_MAIL_DIR,sent.id+".json"))).rejects.toThrow();
  });
  test("expired sender and another service cannot enqueue a branded message", async () => {
    const sender=await verifyEmail(),to=await recipient();
    await expect(enqueueMarketingMail({to,subject:"교차 범위",text:"합성"},{tenantId:tenant,serviceId:service},undefined,new Date(),{id:(await verifyEmail(await create("email",second))).id,version:5})).rejects.toThrow();
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+91*86400000);
    await expect(db.$transaction(tx => requireVerifiedSender(tx, { tenantId: tenant, serviceId: service, channel: "email", id: sender.id, version: sender.version }))).rejects.toMatchObject({ code: "SENDER_UNAVAILABLE" });
    // Recipient retention has also ended: no message is created from either invalid source.
    expect(await enqueueMarketingMail({to,subject:"만료",text:"합성"},{tenantId:tenant,serviceId:service},undefined,new Date(),{id:sender.id,version:sender.version})).toEqual({id:null,suppressed:true});
  });
  test("audit and verification output omit address plaintext, code hashes and provider secrets", async () => {
    const r=await verifyEmail(),out=JSON.stringify(r),audits=JSON.stringify(await db.auditEvent.findMany({where:{resource:"sender",resourceId:r.id}}));
    expect(out).not.toContain("tokenHash"); expect(out).not.toContain("addressCipher"); expect(audits).not.toContain(r.address!); expect(audits).not.toContain("catchsecu-sender="); expect(audits).not.toContain("syntheticSecret");
  });
  test("phone evidence cannot silently move to a different number", async () => {
    const {row}=await evidence(await create("sms"));
    expect((await PATCH(req("/senders/"+row.id,"PATCH","owner",{version:row.version,address:"0311234567",label:row.label,description:row.description}))).status).toBe(409);
    expect((await read(row.id)).address).toBe(row.address);
  });
  test("verification evidence is immutable after consumption", async () => {
    const row=await verifyEmail(),proof=await db.senderVerification.findFirstOrThrow({where:{senderId:row.id,method:"email",status:"verified"}});
    await expect(db.senderVerification.update({where:{id:proof.id},data:{validUntil:new Date(Date.now()+365*86400000)}})).rejects.toThrow();
    await expect(db.senderVerification.update({where:{id:proof.id},data:{tokenHash:"0".repeat(64)}})).rejects.toThrow();
  });
  test("server pagination is disjoint and verified filters exclude clock-expired rows", async () => {
    const label="page-"+randomUUID();
    for(let i=0;i<3;i++){const row=await create();await ok(await PATCH(req("/senders/"+row.id,"PATCH","owner",{version:row.version,address:row.address,label,description:""})));}
    const list=(page:number)=>GET(req("/senders?"+new URLSearchParams({serviceId:service,channel:"email",search:label,page:String(page),pageSize:"2"})));
    const a=await ok<Paged<SenderRecord>>(await list(1)),b=await ok<Paged<SenderRecord>>(await list(2));expect(a.total).toBe(3);expect(a.items.length).toBe(2);expect(b.items.length).toBe(1);expect(new Set([...a.items,...b.items].map(r=>r.id)).size).toBe(3);
    const verified = await verifyEmail();
    const filtered = (status: string) => GET(req("/senders?" + new URLSearchParams({ serviceId: service, channel: "email", search: verified.address!, status })));
    expect((await ok<Paged<SenderRecord>>(await filtered("verified"))).items.map(r => r.id)).toEqual([verified.id]);
    const ctx = await requireContext(req("/senders").headers, "sender.read");
    // Expire the sender clock without consuming the unrelated 90-day-old login session.
    const expiredList = (status: string) => listSenders(ctx, senderList.parse({ serviceId: service, channel: "email", search: verified.address!, status }), randomUUID());
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 91 * 86400000);
    expect((await expiredList("verified")).total).toBe(0);
    const expired = await expiredList("expired");
    expect(expired.items.map(r => [r.id, r.status])).toEqual([[verified.id, "expired"]]);
  });
  test("renewal cancels an undelivered authentication mail and clears its secret", async()=>{
    let r=await create();const out=await ok<{id:string}>(await POST(req("/senders/"+r.id+"/request-email","POST","owner",{version:r.version})),202);r=await read(r.id);
    const job=await db.job.findUniqueOrThrow({where:{dedupeKey:"mail:sender-verification:"+out.id}});expect(job.status).toBe("queued");
    await act(r,"renew");const saved=await db.job.findUniqueOrThrow({where:{id:job.id}});expect(saved.status).toBe("cancelled");expect(decrypt(saved.payloadCipher)).toEqual({erased:true});expect((await db.senderVerification.findUniqueOrThrow({where:{id:out.id}})).tokenHash).toBeNull();
    await expect(access(resolve(env.LOCAL_MAIL_DIR,job.id+".json"))).rejects.toThrow();
  });
  test("a pending local challenge requires renewal after changing to SMTP", async () => {
    const sent = await emailCode(await create()); const row = await act(sent.row, "dns", {}, 201);
    env.MAIL_TRANSPORT = "smtp";
    for (const [action, extra] of [["check", {}], ["confirm-email", { verificationId: sent.id, code: sent.code }]] as const) {
      const response = await POST(req("/senders/" + row.id + "/" + action, "POST", "owner", { version: row.version, ...extra }));
      expect(response.status).toBe(409); expect((await response.json()).error.code).toBe("VERIFICATION_ENVIRONMENT");
    }
    expect((await read(row.id)).status).toBe("pending"); expect((await read(row.id)).version).toBe(row.version);
  });
  test("sender messages cannot be dispatched or downgraded through the legacy mail protocol", async () => {
    const sender = await verifyEmail(), to = await recipient();
    const queued = await enqueueMarketingMail({ to, subject: "프로토콜 보호", text: "합성" }, { tenantId: tenant, serviceId: service }, undefined, new Date(Date.now() + 3600000), { id: sender.id, version: sender.version });
    const job = await db.job.findUniqueOrThrow({ where: { id: queued.id! } });
    expect(job.type).toBe(SENDER_MAIL_JOB_TYPE); expect(job.type).not.toBe("mail");
    await expect(db.job.update({ where: { id: job.id }, data: { type: "mail" } })).rejects.toThrow();
    await expect(db.job.create({ data: { tenantId: tenant, type: "mail", senderId: sender.id, payloadCipher: job.payloadCipher, dedupeKey: randomUUID() } })).rejects.toThrow();
    const pending = await create(); const challenge = await ok<{ id: string }>(await POST(req("/senders/" + pending.id + "/request-email", "POST", "owner", { version: pending.version })), 202);
    const authJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + challenge.id } });
    expect(authJob.type).toBe(SENDER_MAIL_JOB_TYPE);
    await expect(db.job.update({ where: { id: authJob.id }, data: { type: "mail" } })).rejects.toThrow();
    await act(await read(pending.id), "renew");
  });
});
