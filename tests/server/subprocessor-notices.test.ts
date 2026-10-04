import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt, encrypt } from "@/server/crypto";
import { contactEmailHash } from "@/server/suppression";
import { runOneJob } from "@/server/jobs";
import { GET as listPeople, POST as createPerson } from "@/app/api/v1/services/[id]/subprocessors/route";
import { GET as getPerson, PATCH as updatePerson } from "@/app/api/v1/services/[id]/subprocessors/[subId]/route";
import { GET as listNotices, POST as sendNotice } from "@/app/api/v1/services/[id]/subprocessor-notices/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Subprocessor-notice!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }),
    ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function account(tenantId: string, role: "owner" | "editor") {
  const email = "subprocessor-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "재위탁 " + role, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  expect(login.status).toBe(200);
  return { member, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const company = await db.company.create({ data: { name: "재위탁 회사", publicName: "재위탁", policy: { create: {} }, services: { create: [{ name: "재위탁 서비스", externalName: "재위탁" }, { name: "다른 서비스", externalName: "다른" }] } }, include: { services: true } });
  const owner = await account(company.id, "owner");
  const editor = await account(company.id, "editor");
  const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른", policy: { create: {} }, services: { create: { name: "외부 서비스", externalName: "외부" } } }, include: { services: true } });
  return { company, owner, editor, serviceId: company.services[0].id, otherId: other.services[0].id };
}
const person = { name: "위탁 담당", email: "controller@example.com", changeSummary: "보관 업무를 추가 수탁합니다." };
const notice = (subprocessorId: string, recipientVersion = 1) => ({ subprocessorId, recipientVersion, subject: "재위탁 안내", body: "개인정보 처리 재위탁 내용을 안내합니다." });
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("다른 회사·권한 없는 구성원·중복 수신자와 같은 안내를 거부하고 발송 대기열에 한 번만 넣는다", async () => {
  const f = await fixture();
  expect((await createPerson(req("/services/" + f.otherId + "/subprocessors", f.owner.cookie, "POST", person, randomUUID()))).status).toBe(404);
  expect((await createPerson(req("/services/" + f.serviceId + "/subprocessors", f.editor.cookie, "POST", person, randomUUID()))).status).toBe(403);
  const created = await createPerson(req("/services/" + f.serviceId + "/subprocessors", f.owner.cookie, "POST", person, randomUUID()));
  expect(created.status).toBe(201);
  const row = await created.json();
  expect(row.email).toBe("controller@example.com");
  expect(JSON.stringify(row)).not.toContain("emailCipher");
  expect((await createPerson(req("/services/" + f.serviceId + "/subprocessors", f.owner.cookie, "POST", person, randomUUID()))).status).toBe(409);
  const key = randomUUID();
  const first = await sendNotice(req("/services/" + f.serviceId + "/subprocessor-notices", f.owner.cookie, "POST", notice(row.id), key));
  expect(first.status).toBe(201);
  const sent = await first.json();
  const replay = await sendNotice(req("/services/" + f.serviceId + "/subprocessor-notices", f.owner.cookie, "POST", notice(row.id), key));
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(sent);
  expect((await sendNotice(req("/services/" + f.serviceId + "/subprocessor-notices", f.owner.cookie, "POST", notice(row.id), randomUUID()))).status).toBe(409);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subprocessor-notice:" + sent.id } });
  expect(decrypt<{ to: string; subject: string }>(job.payloadCipher).to).toBe("controller@example.com");
  const history = await listNotices(req("/services/" + f.serviceId + "/subprocessor-notices", f.owner.cookie));
  expect(history.status).toBe(200);
  const listed = await history.json();
  expect(listed.total).toBe(1);
  expect(JSON.stringify(listed)).not.toContain("bodyCipher");
  expect(listed.items[0].email).toBe("controller@example.com");
  const archived = await updatePerson(req("/services/" + f.serviceId + "/subprocessors/" + row.id, f.owner.cookie, "PATCH", { ...person, version: row.version, status: "archived" }));
  expect(archived.status).toBe(200);
  expect((await sendNotice(req("/services/" + f.serviceId + "/subprocessor-notices", f.owner.cookie, "POST", { ...notice(row.id), subject: "다른 안내" }, randomUUID()))).status).toBe(409);
  expect((await listPeople(req("/services/" + f.serviceId + "/subprocessors", f.owner.cookie))).status).toBe(200);
});

async function queuedNotice() {
  const f = await fixture();
  const peoplePath = "/services/" + f.serviceId + "/subprocessors";
  const noticePath = "/services/" + f.serviceId + "/subprocessor-notices";
  const created = await createPerson(req(peoplePath, f.owner.cookie, "POST", person, randomUUID()));
  expect(created.status).toBe(201);
  const recipient = await created.json();
  const queued = await sendNotice(req(noticePath, f.owner.cookie, "POST", notice(recipient.id), randomUUID()));
  expect(queued.status).toBe(201);
  const row = await queued.json();
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subprocessor-notice:" + row.id } });
  return { ...f, peoplePath, noticePath, recipient, row, job };
}

test("수신자 변경 후에도 발송 당시 주소를 표시하고 로컬 작업 완료를 수신 완료로 오인하지 않는다", async () => {
  const f = await queuedNotice();
  expect((await updatePerson(req(f.peoplePath + "/" + f.recipient.id, f.owner.cookie, "PATCH", {
    ...person, email: "changed@example.test", version: f.recipient.version, status: "active",
  }))).status).toBe(200);
  expect(await runOneJob("subprocessor-history-test", { tenantId: f.company.id, jobId: f.job.id })).toBe(true);
  expect((await db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("done");
  const history = await (await listNotices(req(f.noticePath, f.owner.cookie))).json();
  expect(history.items[0]).toMatchObject({ email: person.email, status: "processed" });
  expect(history.items[0].completedAt).toBeTruthy();
  expect(JSON.stringify(history)).not.toContain("payloadCipher");
  expect(JSON.stringify(history)).not.toContain(notice(f.recipient.id).body);
});

test("재시도·실패·취소·작업 누락을 구분하며 삭제된 발송 주소를 현재 주소로 대체하지 않는다", async () => {
  const f = await queuedNotice();
  for (const [jobStatus, expected] of [["retry", "retry"], ["dead", "failed"], ["cancelled", "suppressed"], ["leased", "processing"]] as const) {
    await db.job.update({ where: { id: f.job.id }, data: { status: jobStatus } });
    const history = await (await listNotices(req(f.noticePath, f.owner.cookie))).json();
    expect(history.items[0].status).toBe(expected);
  }
  await db.job.update({ where: { id: f.job.id }, data: { status: "cancelled", payloadErasedAt: new Date() } });
  expect((await (await listNotices(req(f.noticePath, f.owner.cookie))).json()).items[0].email).toBeNull();
  await db.subprocessorNotice.update({ where: { id: f.row.id }, data: { jobId: null } });
  expect((await (await listNotices(req(f.noticePath, f.owner.cookie))).json()).items[0]).toMatchObject({ email: null, status: "unknown" });
});

test("50건 이후의 이력을 조회하고 범위를 벗어난 페이지를 보정하며 다른 서비스와 회사는 섞지 않는다", async () => {
  const f = await queuedNotice();
  const original = await db.subprocessorNotice.findUniqueOrThrow({ where: { id: f.row.id } });
  await db.subprocessorNotice.createMany({ data: Array.from({ length: 51 }, (_, index) => ({
    tenantId: f.company.id, serviceId: f.serviceId, subprocessorId: f.recipient.id,
    subject: "페이지 검증 " + index, bodyCipher: original.bodyCipher, contentHash: randomUUID(), actorId: f.owner.member.userId,
    createdAt: new Date(Date.now() + (index + 1) * 1000),
  })) });
  const first = await (await listNotices(req(f.noticePath + "?pageSize=10", f.owner.cookie))).json();
  const last = await (await listNotices(req(f.noticePath + "?page=6&pageSize=10", f.owner.cookie))).json();
  expect(first.total).toBe(52);
  expect(last).toMatchObject({ total: 52, page: 6, pageSize: 10 });
  expect(last.items).toHaveLength(2);
  expect(last.items.some((item: { id: string }) => first.items.some((row: { id: string }) => row.id === item.id))).toBe(false);
  const clamped = await (await listNotices(req(f.noticePath + "?page=999&pageSize=10", f.owner.cookie))).json();
  expect(clamped.items).toEqual(last.items);
  expect(clamped.page).toBe(6);
  const otherService = f.company.services.find(service => service.id !== f.serviceId)!;
  expect((await (await listNotices(req("/services/" + otherService.id + "/subprocessor-notices", f.owner.cookie))).json()).total).toBe(0);
  expect((await listNotices(req("/services/" + f.otherId + "/subprocessor-notices", f.owner.cookie))).status).toBe(404);
});

test("다른 발송 작업을 참조한 이력에서 해당 작업의 주소나 상태를 노출하지 않는다", async () => {
  const f = await queuedNotice();
  await db.job.update({ where: { id: f.job.id }, data: { dedupeKey: "mail:unrelated:" + randomUUID() } });
  expect((await (await listNotices(req(f.noticePath, f.owner.cookie))).json()).items[0]).toMatchObject({ email: null, status: "unknown" });
  const otherService = await db.service.findUniqueOrThrow({ where: { id: f.otherId } });
  const unrelated = await db.job.create({ data: { type: "mail", dedupeKey: "mail:subprocessor-notice:" + f.row.id,
    tenantId: otherService.tenantId, payloadCipher: f.job.payloadCipher } });
  await db.subprocessorNotice.update({ where: { id: f.row.id }, data: { jobId: unrelated.id } });
  expect((await (await listNotices(req(f.noticePath, f.owner.cookie))).json()).items[0]).toMatchObject({ email: null, status: "unknown" });
});

test("수신자 상세는 서비스·권한 범위를 지키고 수정·보관·복원 시 최신 버전만 저장한다", async () => {
  const f = await queuedNotice(), path = f.peoplePath + "/" + f.recipient.id;
  expect((await getPerson(req(path, f.editor.cookie))).status).toBe(403);
  const otherService = f.company.services.find(service => service.id !== f.serviceId)!;
  expect((await getPerson(req("/services/" + otherService.id + "/subprocessors/" + f.recipient.id, f.owner.cookie))).status).toBe(404);
  expect((await getPerson(req("/services/" + f.otherId + "/subprocessors/" + f.recipient.id, f.owner.cookie))).status).toBe(404);
  const initial = await (await getPerson(req(path, f.owner.cookie))).json();
  expect(initial).toMatchObject({ id: f.recipient.id, version: 1, status: "active" });
  expect(JSON.stringify(initial)).not.toContain("Cipher");
  const archived = await updatePerson(req(path, f.owner.cookie, "PATCH", { ...person, version: 1, status: "archived" }));
  expect(archived.status).toBe(200);
  expect((await getPerson(req(path, f.owner.cookie))).status).toBe(200);
  expect((await updatePerson(req(path, f.owner.cookie, "PATCH", { ...person, version: 1, status: "active" }))).status).toBe(409);
  expect((await createPerson(req(f.peoplePath, f.owner.cookie, "POST", person, randomUUID()))).status).toBe(409);
  const restored = await updatePerson(req(path, f.owner.cookie, "PATCH", { ...person, version: 2, status: "active" }));
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({ id: f.recipient.id, version: 3, status: "active" });
  expect(await db.subprocessor.count({ where: { tenantId: f.company.id, serviceId: f.serviceId } })).toBe(1);
  expect(await db.subprocessorNotice.count({ where: { subprocessorId: f.recipient.id } })).toBe(1);
});

test("선택 후 주소가 바뀌면 발송을 거부하고 최신 버전을 확인한 요청만 새 주소로 대기열에 넣는다", async () => {
  const f = await queuedNotice();
  const updated = await updatePerson(req(f.peoplePath + "/" + f.recipient.id, f.owner.cookie, "PATCH", {
    ...person, email: "confirmed@example.test", version: 1, status: "active",
  }));
  expect(updated.status).toBe(200);
  const input = { ...notice(f.recipient.id), subject: "변경 후 안내" };
  const jobsBefore = await db.job.count();
  const stale = await sendNotice(req(f.noticePath, f.owner.cookie, "POST", input, randomUUID()));
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
  expect(await db.job.count()).toBe(jobsBefore);
  const { recipientVersion: omitted, ...withoutVersion } = input;
  expect(omitted).toBe(1);
  expect((await sendNotice(req(f.noticePath, f.owner.cookie, "POST", withoutVersion, randomUUID()))).status).toBe(422);
  const fresh = await sendNotice(req(f.noticePath, f.owner.cookie, "POST", { ...input, recipientVersion: 2 }, randomUUID()));
  expect(fresh.status).toBe(201);
  const row = await fresh.json();
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subprocessor-notice:" + row.id } });
  expect(decrypt<{ to: string }>(job.payloadCipher).to).toBe("confirmed@example.test");
});

test("101번째 이후 수신자도 검색과 페이지로 조회한다", async () => {
  const f = await queuedNotice();
  await db.subprocessor.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
    tenantId: f.company.id, serviceId: f.serviceId, name: "페이지 수신자 " + index,
    emailCipher: encrypt(`page-${index}@example.test`), emailHash: contactEmailHash(`page-${index}@example.test`), changeSummary: "페이지 시험",
    createdAt: new Date(Date.now() + (index + 1) * 1000),
  })) });
  const page = await (await listPeople(req(f.peoplePath + "?page=2&pageSize=100", f.owner.cookie))).json();
  expect(page).toMatchObject({ page: 2, total: 102 });
  expect(page.items).toHaveLength(2);
  const found = await (await listPeople(req(f.peoplePath + "?search=" + encodeURIComponent(person.name), f.owner.cookie))).json();
  expect(found.total).toBe(1);
  expect(found.items[0].id).toBe(f.recipient.id);
});
