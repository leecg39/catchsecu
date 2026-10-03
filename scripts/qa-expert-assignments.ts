import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Expert HTTP QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running expert HTTP QA.");

const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const ownerEmail = "owner@catchsecu.local.test", expertEmail = "viewer@catchsecu.local.test";
const companyId = "10000000-0000-4000-8000-000000000002";
const serviceId = "20000000-0000-4000-8000-000000000003";
let ownerCookie = "", expertCookie = "", assignmentId = "", ownerId = "", expertId = "";
let originalAdmin = false;
async function call(path: string, method = "GET", cookie = "", value?: unknown, extra: Record<string, string> = {}) {
  const response = await fetch(base + path, { method, redirect: "manual", headers: {
    ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin: base } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}), ...extra,
  }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null), response };
}
async function login(email: string) {
  const result = await call("/api/v1/auth/sign-in/email", "POST", "", { email, password: passwords[email] });
  if (result.status !== 200) throw new Error(`QA login failed for ${email}: ${result.status}`);
  return result.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
function check(value: unknown, message: string) { if (!value) throw new Error(message); }

try {
  const owner = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const expert = await db.user.findUniqueOrThrow({ where: { email: expertEmail } });
  ownerId = owner.id; expertId = expert.id; originalAdmin = owner.platformAdmin;
  check(!await db.membership.findUnique({ where: { tenantId_userId: { tenantId: companyId, userId: expertId } } }),
    "QA expert already belongs to company B");
  check(!await db.expertAssignment.findUnique({ where: { tenantId_expertUserId: { tenantId: companyId, expertUserId: expertId } } }),
    "QA expert already has an assignment in company B");
  check(await db.service.count({ where: { id: serviceId, tenantId: companyId, status: "active" } }) === 1,
    "Seed service B is missing");
  await db.user.update({ where: { id: ownerId }, data: { platformAdmin: true } });
  ownerCookie = await login(ownerEmail);
  expertCookie = await login(expertEmail);
  const page = await call("/expert/select-company", "GET", expertCookie);
  check(page.status === 200, "Expert selection page did not render");
  const adminPage = await call("/admin/expert-assignments", "GET", ownerCookie);
  check(adminPage.status === 200, "Assignment admin page did not render");
  const created = await call("/api/v1/expert-assignments", "POST", ownerCookie,
    { companyId, expertEmail, serviceIds: [serviceId], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  check(created.status === 201, `Assignment create failed: ${created.status} ${JSON.stringify(created.body)}`);
  assignmentId = created.body.id;
  const mine = await call("/api/v1/expert-assignments?scope=mine", "GET", expertCookie);
  check(mine.status === 200 && mine.body.items.some((item: { id: string; canSelect: boolean }) =>
    item.id === assignmentId && item.canSelect), "Expert cannot list/select assignment");
  const selected = await call("/api/v1/context", "POST", expertCookie, { companyId });
  check(selected.status === 200, `Expert company selection failed: ${selected.status}`);
  const context = await call("/api/v1/context", "GET", expertCookie);
  check(context.status === 200 && context.body.company?.id === companyId &&
    context.body.services.some((item: { id: string }) => item.id === serviceId), "Expert context lacks company or scoped service");
  const visible = await call("/api/v1/services", "GET", expertCookie);
  check(visible.status === 200 && visible.body.items.length === 1 && visible.body.items[0].id === serviceId,
    "Expert service API scope is wrong");
  const revoked = await call("/api/v1/expert-assignments/" + assignmentId, "DELETE", ownerCookie, undefined,
    { "if-match": String(created.body.version) });
  check(revoked.status === 204, `Assignment revoke failed: ${revoked.status}`);
  const after = await call("/api/v1/context", "GET", expertCookie);
  const denied = await call("/api/v1/services", "GET", expertCookie);
  const reselect = await call("/api/v1/context", "POST", expertCookie, { companyId });
  check(after.status === 200 && after.body.company?.id !== companyId &&
    !after.body.services.some((item: { id: string }) => item.id === serviceId) &&
    denied.status === 200 && !denied.body.items.some((item: { id: string }) => item.id === serviceId) &&
    reselect.status === 404,
    "Expert retained company access after revoke");
  console.log(JSON.stringify({ selectionPage: page.status, adminPage: adminPage.status, created: created.status,
    mine: mine.status, selected: selected.status, scopedService: visible.status, revoked: revoked.status,
    afterRevocation: denied.status, reselectAfterRevocation: reselect.status, cleanup: "pending" }));
} finally {
  if (ownerCookie) await call("/api/v1/auth/sign-out", "POST", ownerCookie).catch(() => null);
  if (expertCookie) await call("/api/v1/auth/sign-out", "POST", expertCookie).catch(() => null);
  if (assignmentId) await db.$transaction(async tx => {
    const member = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: companyId, userId: expertId } } });
    if (member?.expertAssignmentId === assignmentId) {
      await tx.serviceGrant.deleteMany({ where: { tenantId: companyId, memberId: member.id } });
      await tx.membership.delete({ where: { id: member.id } });
    }
    await tx.expertAssignmentService.deleteMany({ where: { assignmentId } });
    await tx.expertAssignment.delete({ where: { id: assignmentId } });
  });
  if (ownerId) await db.user.update({ where: { id: ownerId }, data: { platformAdmin: originalAdmin } });
  await db.$disconnect();
  console.log(JSON.stringify({ cleanup: "complete", qaAssignmentRemoved: !!assignmentId,
    originalAdminRestored: !!ownerId }));
}
