import { readFile } from "node:fs/promises";
import type { AnalyticsDashboard } from "../src/contracts/analytics";
import type { MarketingSummary } from "../src/contracts/marketing";
import { env } from "../src/server/env";
import { db } from "../src/server/db";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Analytics HTTP QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running analytics HTTP QA.");
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const serviceA = "20000000-0000-4000-8000-000000000001";
const serviceA2 = "20000000-0000-4000-8000-000000000002";
const serviceB = "20000000-0000-4000-8000-000000000003";
const companyA = "10000000-0000-4000-8000-000000000001";
const cookies: string[] = [];
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function login(email: string) {
  const response = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ email, password: passwords[email] }) });
  check(response.status === 200, `QA login failed for ${email}: ${response.status}`);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  cookies.push(cookie);
  return cookie;
}
const get = (path: string, cookie: string) => fetch(base + path, { headers: { cookie }, redirect: "manual" });
try {
  const owner = await login("owner@catchsecu.local.test");
  const viewer = await login("viewer@catchsecu.local.test");
  const privacy = await login("privacy@catchsecu.local.test");
  const foreign = await login("owner-b@catchsecu.local.test");
  const main = await get("/api/v1/analytics/dashboard", owner);
  check(main.status === 200, "Owner analytics API failed: " + main.status);
  const data = await main.json() as AnalyticsDashboard;
  const ids = data.services.map(row => row.id);
  check(ids.includes(serviceA) && ids.includes(serviceA2) && !ids.includes(serviceB), "Owner service scope is wrong");
  const asOf = new Date(data.asOf);
  const [formCount, retainedCount, consentCount, policyCount] = await Promise.all([
    db.form.count({ where: { tenantId: companyA, serviceId: { in: ids }, sourceType: "form", status: { not: "deleted" } } }),
    db.submission.count({ where: { tenantId: companyA, formVersion: { form: { serviceId: { in: ids } } },
      status: { notIn: ["destroying", "destroyed"] }, OR: [{ legalHold: true }, { retentionUntil: { gt: asOf } }] } }),
    db.document.count({ where: { tenantId: companyA, serviceId: { in: ids }, type: "consent", status: { not: "archived" } } }),
    db.document.count({ where: { tenantId: companyA, serviceId: { in: ids }, type: "privacy_policy", status: { not: "archived" } } }),
  ]);
  check(data.totals.services === ids.length && data.totals.forms === formCount &&
    data.totals.retainedSubmissions === retainedCount && data.totals.consentDocuments === consentCount &&
    data.totals.policyDocuments === policyCount, "Analytics totals differ from independent DB queries");
  const limited = await get("/api/v1/analytics/dashboard", viewer);
  check(limited.status === 200 && JSON.stringify((await limited.json() as AnalyticsDashboard).services.map(row => row.id)) === JSON.stringify([serviceA]),
    "Viewer scope was not limited to its service");
  const deniedService = await get("/api/v1/analytics/dashboard?serviceId=" + serviceA2, viewer);
  const deniedTenant = await get("/api/v1/analytics/dashboard?serviceId=" + serviceB, owner);
  const foreignDenied = await get("/api/v1/analytics/dashboard?serviceId=" + serviceA, foreign);
  check(deniedService.status === 404 && deniedTenant.status === 404 && foreignDenied.status === 404,
    "Unauthorized analytics service was exposed");
  const marketingFrom = new Date(Date.now() - 30 * 86400000).toISOString();
  const marketingTo = new Date(Date.now() + 86400000).toISOString();
  const marketing = await get("/api/v1/marketing/summary?" + new URLSearchParams({ serviceId: serviceA, from: marketingFrom, to: marketingTo }), privacy);
  check(marketing.status === 200, "Service-scoped marketing summary failed: " + marketing.status);
  const marketingData = await marketing.json() as MarketingSummary;
  check(marketingData.items.length === 1 && marketingData.items[0].id === serviceA, "Service-scoped marketing summary returned the wrong service");
  const grants = await db.marketingEvent.count({ where: { tenantId: companyA, preference: { serviceId: serviceA },
    kind: { in: ["granted", "reconsented"] }, createdAt: { gte: new Date(marketingData.period.from), lt: new Date(marketingData.period.to) } } });
  const grantedEmail = await db.marketingPreference.findMany({ where: { tenantId: companyA, serviceId: serviceA,
    status: "granted", channel: "email" }, select: { contactHash: true } });
  const hashes = grantedEmail.map(row => row.contactHash);
  const [subjectBlocks, emailBlocks] = await Promise.all([
    db.suppression.findMany({ where: { tenantId: companyA, serviceId: serviceA, emailHash: { in: hashes } }, select: { emailHash: true } }),
    db.emailSuppression.findMany({ where: { tenantId: companyA, serviceId: serviceA, contactHash: { in: hashes } }, select: { contactHash: true } }),
  ]);
  const blockedHashes = new Set([...subjectBlocks.map(row => row.emailHash), ...emailBlocks.map(row => row.contactHash)]);
  check(marketingData.items[0].periodGrants === grants && marketingData.items[0].suppressed === blockedHashes.size,
    "Marketing period or suppression totals differ from independent DB queries");
  const marketingDenied = await get("/api/v1/marketing/summary?serviceId=" + serviceA2, privacy);
  check(marketingDenied.status === 404, "Marketing summary exposed a service outside its grant");
  const paths = ["/dashboard", "/dashboard/" + serviceA, "/privacy-detail", "/privacy-detail/" + serviceA,
    "/marketing-detail", "/marketing-detail/" + serviceA, "/compliance"];
  for (const path of paths) check((await get(path, owner)).status === 200, "Analytics page did not render: " + path);
  console.log(JSON.stringify({ totalsMatchDatabase: true, services: ids.length, retainedSubmissions: retainedCount,
    viewerScope: [serviceA], otherService: deniedService.status, otherTenant: deniedTenant.status,
    foreignTenant: foreignDenied.status,
    marketingScope: marketing.status, marketingDenied: marketingDenied.status,
    marketingEventsMatchDatabase: true, suppressedMatchDatabase: true, renderedPages: paths.length }));
} finally {
  for (const cookie of cookies) await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
  await db.$disconnect();
}
