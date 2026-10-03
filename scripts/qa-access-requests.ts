import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (database.hostname !== "localhost" && database.hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev")
  throw new Error("This QA script only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (base !== "http://localhost:3100" && base !== "http://127.0.0.1:3100")
  throw new Error("Start the local app on port 3100 before running access QA.");
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const ownerEmail = "owner@catchsecu.local.test", viewerEmail = "viewer@catchsecu.local.test";
const companyId = "10000000-0000-4000-8000-000000000001";
const serviceId = randomUUID();
let requestId = "", ownerCookie = "", viewerCookie = "", serviceCreated = false;
async function call(path: string, method = "GET", cookie = "", value?: unknown) {
  const response = await fetch(base + path, { method, redirect: "manual", headers: {
    ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin: base } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}),
  }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, response };
}
async function login(email: string) {
  const result = await call("/api/v1/auth/sign-in/email", "POST", "", { email, password: passwords[email] });
  if (result.status !== 200) throw new Error("QA login failed: " + result.status);
  return result.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
try {
  ownerCookie = await login(ownerEmail);
  viewerCookie = await login(viewerEmail);
  await db.service.create({ data: { id: serviceId, tenantId: companyId, name: "권한 요청 HTTP QA " + serviceId.slice(0, 8), externalName: "QA" } });
  serviceCreated = true;
  const before = await call("/api/v1/context", "GET", viewerCookie);
  check(before.status === 200 && !before.body.services.some((item: { id: string }) => item.id === serviceId), "Viewer already has QA service");
  const page = await call("/service/none", "GET", viewerCookie);
  check(page.status === 200, "Service access page did not render");
  const created = await call("/api/v1/access-requests", "POST", viewerCookie, { serviceId, reason: "HTTP QA" });
  check(created.status === 201, "Access request was not created"); requestId = created.body.id;
  const duplicate = await call("/api/v1/access-requests", "POST", viewerCookie, { serviceId, reason: "HTTP QA" });
  check(duplicate.status === 200 && duplicate.body.id === requestId, "Duplicate request was not idempotent");
  const review = await call("/api/v1/access-requests?scope=review&status=pending&pageSize=100", "GET", ownerCookie);
  check(review.status === 200 && review.body.items.some((item: { id: string }) => item.id === requestId), "Manager cannot see request");
  const approved = await call("/api/v1/access-requests/" + requestId, "PATCH", ownerCookie, { version: 1, decision: "approve", note: "HTTP QA 승인" });
  check(approved.status === 200 && approved.body.status === "approved", "Manager approval failed");
  const after = await call("/api/v1/context", "GET", viewerCookie);
  check(after.status === 200 && after.body.services.some((item: { id: string }) => item.id === serviceId), "Approved service missing from context");
  const logoutPage = await call("/logout", "GET", viewerCookie);
  const stillSignedIn = await call("/api/v1/context", "GET", viewerCookie);
  check(logoutPage.status === 200 && stillSignedIn.status === 200, "GET logout changed session");
  console.log(JSON.stringify({ login: 200, page: page.status, create: created.status, duplicate: duplicate.status,
    review: review.status, approve: approved.status, contextAfterApproval: after.status, serviceGranted: true,
    getLogout: logoutPage.status, sessionAfterGetLogout: stillSignedIn.status, cleanup: "pending" }));
} finally {
  if (ownerCookie) await call("/api/v1/auth/sign-out", "POST", ownerCookie).catch(() => null);
  if (viewerCookie) await call("/api/v1/auth/sign-out", "POST", viewerCookie).catch(() => null);
  if (requestId) await db.accessRequest.deleteMany({ where: { id: requestId, tenantId: companyId } });
  if (serviceCreated) {
    await db.serviceGrant.deleteMany({ where: { tenantId: companyId, serviceId } });
    await db.service.delete({ where: { id: serviceId } });
  }
  await db.$disconnect();
  console.log(JSON.stringify({ cleanup: "complete", temporaryServiceRemoved: serviceCreated }));
}
