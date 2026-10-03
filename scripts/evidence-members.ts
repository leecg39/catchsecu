import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const email = "browser-member-20261002@catchsecu.local.test";
const user = await db.user.findUniqueOrThrow({ where: { email } });
const invite = await db.invitation.findFirstOrThrow({ where: { email }, orderBy: { createdAt: "desc" } });
const member = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } }, include: { grants: true } });
assert.equal(user.emailVerified, true); assert.equal(invite.status, "accepted"); assert.equal(invite.acceptedBy, user.id);
assert.equal(member.role, "editor"); assert.equal(member.status, "revoked"); assert.equal(member.version, 3); assert.equal(member.grants.length, 0);
const events = await db.auditEvent.findMany({ where: { resourceId: { in: [member.id, invite.id] } }, orderBy: { createdAt: "asc" }, select: { action: true } });
for (const action of ["invitation.created", "invitation.accepted", "member.updated", "member.removed"]) assert(events.some(event => event.action === action));
const mail = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + invite.id + ":1" } }); assert.equal(mail.status, "done");
assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
await writeFile("docs/qa/members/database-evidence.json", JSON.stringify({
  checkedAt: new Date().toISOString(), userId: user.id, invitationId: invite.id, memberId: member.id,
  verifiedEmail: true, invitationStatus: invite.status, mailDeliveredLocally: true, memberRole: member.role, memberStatus: member.status,
  memberVersion: member.version, remainingServiceGrants: member.grants.length, remainingSessions: 0, auditActions: events.map(event => event.action),
}, null, 2));
console.log("Browser invitation, membership update/removal and session revocation verified in PostgreSQL.");
await db.$disconnect();
