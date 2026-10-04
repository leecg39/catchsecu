import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { GET as readClose, POST as closeMonth } from "@/app/api/v1/analytics/closes/route";
import { GET as exportClose } from "@/app/api/v1/analytics/closes/[id]/export/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Compliance-close!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("같은 월 마감은 이후 자료가 생겨도 합계를 유지하고 준수 통과나 수식 셀을 만들지 않는다", async () => {
  const email = "close-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "마감", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "마감 회사", publicName: "마감", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "=합계", externalName: "마감" } } }, include: { services: true } });
  const other = await db.company.create({ data: { name: "다른 마감", publicName: "다른", policy: { create: {} }, services: { create: { name: "다른", externalName: "다른" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const month = "2026-10";
  expect((await closeMonth(req("/analytics/closes", cookie, "POST", { month: "2099-01" }))).status).toBe(422);
  expect((await closeMonth(req("/analytics/closes", cookie, "POST", { month, serviceId: other.services[0].id }))).status).toBe(404);
  const first = await closeMonth(req("/analytics/closes", cookie, "POST", { month }));
  expect(first.status).toBe(200);
  const closed = await first.json();
  expect(closed.created).toBe(true);
  expect(closed.close.verdict).toBe("not_assessed");
  expect(closed.close.totals.forms).toBe(0);
  expect(JSON.stringify(closed)).not.toContain("\"passed\":true");
  const serviceId = company.services[0].id;
  const form = await createForm(req("/forms", cookie, "POST", { serviceId, title: "마감 이후", content: { body: "본문", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5 } }, randomUUID()));
  expect(form.status).toBe(201);
  const second = await closeMonth(req("/analytics/closes", cookie, "POST", { month }));
  const again = await second.json();
  expect(again.created).toBe(false);
  expect(again.close.id).toBe(closed.close.id);
  expect(again.close.totals.forms).toBe(0);
  const csv = await exportClose(req("/analytics/closes/" + closed.close.id + "/export", cookie));
  expect(csv.status).toBe(200);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(bytes.subarray(3));
  expect(text).toContain("미판정");
  expect(text).toContain("\"'=합계\"");
  expect((await readClose(req("/analytics/closes?month=" + month, cookie))).status).toBe(200);
});
