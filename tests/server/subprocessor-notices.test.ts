import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { GET as listPeople, POST as createPerson } from "@/app/api/v1/services/[id]/subprocessors/route";
import { PATCH as updatePerson } from "@/app/api/v1/services/[id]/subprocessors/[subId]/route";
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
const notice = (subprocessorId: string) => ({ subprocessorId, subject: "재위탁 안내", body: "개인정보 처리 재위탁 내용을 안내합니다." });
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
