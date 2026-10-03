import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { POST as createService, GET as listServices } from "@/app/api/v1/services/route";
import { GET as readService } from "@/app/api/v1/services/[id]/route";
import { POST as transfer } from "@/app/api/v1/members/[...segments]/route";
import { POST as createForm } from "@/app/api/v1/forms/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, password = "Tenant-boundary-password!1";
const companyA = randomUUID(), companyB = randomUUID();
let ownerCookie = "", viewerCookie = "", adminCookie = "", foreignCookie = "", serviceId = "", formId = "", ownerMemberId = "";
const secrets = () => [companyA, serviceId, formId, ownerMemberId].filter(Boolean);
function request(path: string, method = "GET", cookie = "", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}), ...(value !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookieOf(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function signin(email: string) {
  const response = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  expect(response.status).toBe(200);
  return cookieOf(response);
}
async function user(email: string, tenantId: string, role: "owner" | "admin" | "viewer") {
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: role, email, password }))).status).toBe(200);
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: row.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { userId: row.id, tenantId, role } });
  return member.id;
}
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith("route.ts") ? [path] : [];
  }))).flat();
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: companyA, name: "A", publicName: "A", policy: { create: {} } } });
  await db.company.create({ data: { id: companyB, name: "B", publicName: "B", policy: { create: {} } } });
  ownerMemberId = await user("owner-a@tenant.test", companyA, "owner");
  await user("admin-a@tenant.test", companyA, "admin");
  await user("viewer-a@tenant.test", companyA, "viewer");
  await user("owner-b@tenant.test", companyB, "owner");
  ownerCookie = await signin("owner-a@tenant.test");
  adminCookie = await signin("admin-a@tenant.test");
  viewerCookie = await signin("viewer-a@tenant.test");
  foreignCookie = await signin("owner-b@tenant.test");
  const created = await createService(request("/services", "POST", ownerCookie, { name: "회사 A 서비스", externalName: "회사 A 서비스" }));
  expect(created.status).toBe(201);
  serviceId = (await created.json()).id;
  const form = await createForm(request("/forms", "POST", ownerCookie, { serviceId, title: "회사 A 폼", content: { body: "", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 } }, { "idempotency-key": randomUUID() }));
  expect(form.status).toBe(201);
  formId = (await form.json()).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("tenant boundary", () => {
  test("another company cannot read or list company A resources, and only the owner can transfer ownership", async () => {
    expect((await readService(request("/services/" + serviceId, "GET", foreignCookie))).status).toBe(404);
    expect((await readService(request("/services/" + serviceId, "GET", viewerCookie))).status).toBe(403);
    const viewer = await db.membership.findFirstOrThrow({ where: { tenantId: companyA, role: "viewer" } });
    await db.serviceGrant.create({ data: { tenantId: companyA, memberId: viewer.id, serviceId, capabilities: ["service.read", "form.read", "document.read"] } });
    expect((await readService(request("/services/" + serviceId, "GET", viewerCookie))).status).toBe(200);
    const foreignList = await (await listServices(request("/services?status=all", "GET", foreignCookie))).json();
    expect(foreignList.total).toBe(0);
    expect(JSON.stringify(foreignList)).not.toContain(serviceId);
    expect((await createService(request("/services", "POST", viewerCookie, { name: "금지", externalName: "금지" }))).status).toBe(403);
    expect((await transfer(request("/members/" + ownerMemberId + "/transfer", "POST", adminCookie, { version: 1, password }))).status).toBe(403);
    expect((await transfer(request("/members/" + ownerMemberId + "/transfer", "POST", foreignCookie, { version: 1, password }))).status).toBe(404);
    const foreignMember = await db.membership.findFirstOrThrow({ where: { tenantId: companyB } });
    await expect(db.serviceGrant.create({ data: { tenantId: companyA, memberId: foreignMember.id, serviceId, capabilities: ["service.read"] } })).rejects.toThrow();
  });

  test("every protected route hides company A identifiers from company B", async () => {
    const leaks: string[] = [];
    for (const file of await files("src/app/api/v1")) {
      const loaded = await import(pathToFileURL(join(process.cwd(), file)).href) as Record<string, (request: Request) => Promise<Response>>;
      const suffix = relative("src/app/api/v1", file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
      const url = "/" + suffix.replace(/\[\[\.\.\.[^\]]+\]\]/g, serviceId).replace(/\[\.\.\.[^\]]+\]/g, serviceId).replace(/\[[^\]]+\]/g, serviceId);
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const handler = loaded[method];
        if (typeof handler !== "function" || url.startsWith("/auth") || url.startsWith("/public") || url.startsWith("/health") || url.startsWith("/ready") || url.startsWith("/email-unsubscribe")) continue;
        let status = 500, body = "";
        try {
          const response = await handler(request(url, method, foreignCookie, method === "GET" ? undefined : {}));
          status = response.status; body = await response.text();
        } catch (error) { body = error instanceof Error ? error.message : ""; }
        const targeted = secrets().some(secret => url.includes(secret));
        const exposed = secrets().some(secret => body.includes(secret));
        if (status < 400 && (targeted || exposed)) leaks.push(method + " " + url + " " + status);
      }
    }
    expect(leaks).toEqual([]);
  });
});
