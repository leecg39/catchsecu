import { z } from "zod";
import { db, type Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";
import { activeMembershipWhere } from "./context";
import { lockFileIssuer } from "./file-access";
import { deliverMail, type ClaimedJob } from "./jobs";
import { HttpError, fail } from "./http";

export const ACTIVITY_REVIEW_MAIL = "mail.activity-review.v1";
const payloadSchema = z.object({ reviewId: z.uuid(), version: z.number().int().positive(), issuerId: z.uuid(), issuerUserId: z.string(), recipientId: z.uuid(), recipientUserId: z.string(), to: z.email(), transport: z.enum(["local", "smtp"]) }).strict();
export const activityMailKey = (id: string, version: number) => `activity-review:${id}:${version}`;
export async function lockReviewRecipient(tx: Transaction, tenantId: string, memberId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${memberId} AND "tenantId"=${tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
  const initial = await tx.membership.findUnique({ where: { id: memberId } });
  if (initial?.expertAssignmentId) await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${initial.expertAssignmentId} AND "tenantId"=${tenantId} FOR SHARE`;
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(userId, tenantId), id: memberId, user: { status: "active", emailVerified: true } }, include: { user: true, expertAssignment: true } });
  if (!member) fail(422, "REVIEW_RECIPIENT_UNAVAILABLE", "현재 회사 구성원에게만 알림을 보낼 수 있습니다.");
  return { email: member.user.email, expiresAt: member.accessKind === "expert" ? member.expertAssignment!.expiresAt : null };
}
export function recipientCurrent(expiresAt: Date | null) {
  if (expiresAt && expiresAt <= new Date()) fail(422, "REVIEW_RECIPIENT_UNAVAILABLE", "대상자의 전문가 배정이 만료되었습니다.");
}
export async function enqueueReviewMail(tx: Transaction, tenantId: string, input: z.infer<typeof payloadSchema>) {
  const payload = payloadSchema.parse(input), key = activityMailKey(payload.reviewId, payload.version);
  const existing = await tx.job.findUnique({ where: { dedupeKey: key } });
  if (existing) fail(409, "REVIEW_NOTIFICATION_EXISTS", "이 검토 상태의 알림은 이미 요청했습니다. 발송 상태를 확인해주세요.");
  return tx.job.create({ data: { tenantId, type: ACTIVITY_REVIEW_MAIL, dedupeKey: key, payloadCipher: encrypt(payload) } });
}
export async function deliverReviewMail(job: ClaimedJob, workerId: string) {
  const payload = payloadSchema.parse(decrypt(job.payloadCipher));
  if (job.type !== ACTIVITY_REVIEW_MAIL || !job.tenantId || job.dedupeKey !== activityMailKey(payload.reviewId, payload.version) || payload.transport !== env.MAIL_TRANSPORT) return false;
  try { return await db.$transaction(async tx => {
    const initial = await tx.activityReview.findFirst({ where: { id: payload.reviewId, tenantId: job.tenantId! } });
    if (!initial) return false;
    const issuer = await lockFileIssuer(tx, { tenantId: initial.tenantId, member: { id: payload.issuerId }, user: { id: payload.issuerUserId } }, initial.serviceId, ["service.read", "security.write", "audit.read"]);
    await tx.$queryRaw`SELECT id FROM "ActivityReview" WHERE id=${initial.id} FOR SHARE`;
    const review = await tx.activityReview.findUniqueOrThrow({ where: { id: initial.id } });
    const recipient = await lockReviewRecipient(tx, initial.tenantId, payload.recipientId, payload.recipientUserId);
    if (review.status !== "requested" || review.version !== payload.version || review.recipientId !== payload.recipientId || review.recipientUserId !== payload.recipientUserId || recipient.email !== payload.to || payload.issuerId === review.recipientId) return false;
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.job.findFirst({ where: { id: job.id, tenantId: review.tenantId, type: ACTIVITY_REVIEW_MAIL, status: "leased", leaseOwner: workerId, attempts: job.attempts, payloadErasedAt: null } });
    if (!current?.leaseUntil || current.leaseUntil <= new Date()) return false;
    const beforeDispatch = async () => {
      recipientCurrent(recipient.expiresAt);
      if (issuer.member.accessKind === "expert") recipientCurrent(issuer.member.expertAssignment!.expiresAt);
      if (current.leaseUntil! <= new Date()) throw new Error("LEASE_EXPIRED");
    };
    const url = new URL("/my-page/info-activity-log", env.BETTER_AUTH_URL); url.searchParams.set("reviewId", review.id);
    await deliverMail(job, { to: payload.to, subject: "[캐치시큐] 개인정보 활동 검토 요청 안내", text: "개인정보 활동 검토 요청이 있습니다. 로그인 후 해당 회사를 선택해 확인해주세요.\n" + url.toString() }, undefined, beforeDispatch);
    return true;
  }, { timeout: 45000 }); } catch (error) { if (error instanceof HttpError) return false; throw error; }
}
