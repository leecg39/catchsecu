import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { env } from "../src/server/env";
import { db } from "../src/server/db";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Audit HTTP QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running audit HTTP QA.");
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const ownerEmail = "owner@catchsecu.local.test", viewerEmail = "viewer@catchsecu.local.test";
const otherEmail = "owner-b@catchsecu.local.test";
const serviceA = "20000000-0000-4000-8000-000000000001";
let ownerCookie = "", viewerCookie = "", otherCookie = "";
const started = new Date(Date.now() - 5000).toISOString();
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
async function login(email: string) {
  const response = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ email, password: passwords[email] }) });
  check(response.status === 200, `QA login failed for ${email}: ${response.status}`);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function get(path: string, cookie: string) {
  return fetch(base + path, { headers: { cookie }, redirect: "manual" });
}
try {
  ownerCookie = await login(ownerEmail);
  viewerCookie = await login(viewerEmail);
  otherCookie = await login(otherEmail);
  const access = await get("/api/v1/audit-events?kind=access", ownerCookie);
  const accessBody = await access.json();
  check(access.status === 200 && accessBody.items.some((item: { action: string; actorName: string }) =>
    item.action === "session.created" && item.actorName === "owner A"), "Owner login event was not found in company audit");
  check(!JSON.stringify(accessBody).includes("detail"), "Raw audit detail leaked to HTTP DTO");
  const filter = "kind=access&from=" + encodeURIComponent(started) + "&pageSize=100";
  const filtered = await get("/api/v1/audit-events?" + filter, ownerCookie);
  const filteredBody = await filtered.json();
  check(filtered.status === 200 && filteredBody.total > 0 && filteredBody.total <= 100,
    "Recent company audit filter did not return the new login event");
  const exported = await get("/api/v1/audit-events/export?" + filter, ownerCookie);
  const csvBytes = Buffer.from(await exported.arrayBuffer());
  check(exported.status === 200 && exported.headers.get("content-disposition")?.includes("audit-events.csv") &&
    csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "Audit CSV headers or UTF-8 BOM are missing");
  const csvRows = parse(csvBytes, { bom: true }) as string[][];
  check(JSON.stringify(csvRows.slice(1).map(row => row[0])) === JSON.stringify(filteredBody.items.map((item: { id: string }) => item.id)),
    "CSV rows do not match the filtered audit list");
  const exportEvent = await db.auditEvent.findFirst({ where: { requestId: exported.headers.get("x-request-id")! } });
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  check(exportEvent?.action === "audit.exported" && exportEvent.actorId === owner?.id &&
    (exportEvent.detail as { rowCount?: number }).rowCount === csvRows.length - 1,
  "Successful audit CSV download was not recorded with the actor and row count");
  const denied = await get("/log/member", viewerCookie);
  check(denied.status === 307 && denied.headers.get("location") === "/access-not-allow?reason=role",
    "Viewer log screen was not denied by the server");
  const viewerApi = await get("/api/v1/audit-events", viewerCookie);
  check(viewerApi.status === 403, "Viewer company audit API was not denied");
  const viewerExport = await get("/api/v1/audit-events/export?" + filter, viewerCookie);
  check(viewerExport.status === 403, "Viewer company audit CSV was not denied");
  const mine = await get("/api/v1/audit-events?scope=mine&kind=access", viewerCookie);
  const mineBody = await mine.json();
  check(mine.status === 200 && mineBody.items.some((item: { action: string }) => item.action === "session.created"),
    "Viewer own login activity is missing");
  const foreign = await get("/api/v1/audit-events?serviceId=" + serviceA, otherCookie);
  check(foreign.status === 404, "Other company service audit was exposed");
  const foreignExport = await get("/api/v1/audit-events/export?serviceId=" + serviceA, otherCookie);
  check(foreignExport.status === 404, "Other company service audit CSV was exposed");
  const paths = ["/log/service", "/log/info-monitoring", "/log/member", "/log/access-history", "/my-page/activity-log"];
  for (const path of paths) check((await get(path, ownerCookie)).status === 200, "Audit page did not render: " + path);
  for (const method of ["PATCH", "DELETE"]) {
    const response = await fetch(base + "/api/v1/audit-events", { method, redirect: "manual",
      headers: { origin: base, cookie: ownerCookie } });
    check(response.status === 405, `${method} must not mutate audit events: ${response.status}`);
  }
  console.log(JSON.stringify({ companyAccessLog: access.status, viewerPage: denied.status,
    viewerApi: viewerApi.status, viewerOwnActivity: mine.status, foreignService: foreign.status,
    renderedPages: paths.length, mutationMethods: 405, csvStatus: exported.status,
    csvRowsMatchList: true, csvAuditEvent: true, viewerCsv: viewerExport.status, foreignCsv: foreignExport.status }));
} finally {
  for (const cookie of [ownerCookie, viewerCookie, otherCookie]) if (cookie)
    await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
  await db.$disconnect();
}
