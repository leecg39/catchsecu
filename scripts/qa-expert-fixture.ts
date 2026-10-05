// P13-T02: 전문가 배정 픽스처 — 활성 ExpertAssignment + viewer 멤버십을 회사 A에 만든다.
import { db } from "../src/server/db";
import { auth } from "../src/server/auth";
import { roleCapabilities } from "../src/server/permissions";
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../src/server/env";

const base = env.BETTER_AUTH_URL;
const email = "qa-expert-" + Date.now().toString(36) + "@catchsecu.local.test";
const password = "Expert-Test!" + Date.now().toString(36);

const su = await auth.handler(new Request(base + "/api/v1/auth/sign-up/email", {
  method: "POST", headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ name: "QA 전문가", email, password }) }));
if (su.status !== 200) throw new Error("signup " + su.status);
const user = await db.user.update({ where: { email }, data: { emailVerified: true } });

const companyId = "10000000-0000-4000-8000-000000000001";
const serviceId = "20000000-0000-4000-8000-000000000001";
const admin = await db.user.findFirstOrThrow({ where: { platformAdmin: true } });
const assignment = await db.expertAssignment.create({ data: { tenantId: companyId, expertUserId: user.id, assignedById: admin.id, expiresAt: new Date(Date.now() + 30 * 864e5) } });
const member = await db.membership.create({ data: { tenantId: companyId, userId: user.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
await db.expertAssignmentService.create({ data: { tenantId: companyId, assignmentId: assignment.id, serviceId } });
await db.serviceGrant.create({ data: { tenantId: companyId, memberId: member.id, serviceId, capabilities: [...roleCapabilities("viewer")] } });

const f = ".local/catchsecu_dev-accounts.json";
const pw = JSON.parse(readFileSync(f, "utf8")); pw[email] = password; writeFileSync(f, JSON.stringify(pw, null, 2));
console.log(JSON.stringify({ email, password, assignment: assignment.id }));
await db.$disconnect();
