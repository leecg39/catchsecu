import { randomInt, timingSafeEqual } from "node:crypto";
import { participationChallengeInput, participationChallengeVerifyInput, participationProofSchema,
  type ParticipationAccessPolicy } from "@/contracts/form-participation-access";
import type { z } from "zod";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail } from "./http";
import { enqueueMail } from "./jobs";
import { lockPublicPublication } from "./public-publication";

type StoredParticipationVersion = {
  participationAccessSchemaVersion: number;
  useParticipationAccess: boolean;
  participationAccessMethod: string;
  participationTargetScope: string;
  participationUseOtp: boolean;
  participationSocialProvider: string;
  restrictDuplicateReplies: boolean;
};

type ParticipationPublication = {
  id: string;
  tenantId: string;
  formId: string;
  expiresAt: Date | null;
  form: { serviceId: string };
  formVersion: StoredParticipationVersion;
};

export function storedParticipationPolicy(version: StoredParticipationVersion): ParticipationAccessPolicy {
  if (version.participationAccessSchemaVersion !== 1) return {
    enabled: false, method: "EMAIL", targetScope: "ALL", useOtp: false, socialProvider: "KAKAO", limitDuplicate: false,
  };
  return {
    enabled: version.useParticipationAccess,
    method: version.participationAccessMethod as "EMAIL" | "SOCIAL",
    targetScope: version.participationTargetScope as "ALL" | "WHITELIST",
    useOtp: version.participationUseOtp,
    socialProvider: version.participationSocialProvider as "KAKAO" | "NAVER",
    limitDuplicate: version.restrictDuplicateReplies,
  };
}

export const PARTICIPATION_COOKIE = "cs_participation";
export function participationProofFromRequest(request: Request) {
  const value = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim())
    .find(part => part.startsWith(PARTICIPATION_COOKIE + "="))?.slice(PARTICIPATION_COOKIE.length + 1);
  return value && participationProofSchema.safeParse(value).success ? value : undefined;
}

function identityHash(email: string) { return tokenHash("publication-participant-email:" + email); }
function targetHash(email: string) { return tokenHash("form-participant-email:" + email); }
async function publicationIdForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  const publication = await db.publication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true } });
  if (!publication) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return publication.id;
}

async function assertTarget(tx: Transaction, publication: ParticipationPublication, policy: ParticipationAccessPolicy, email: string) {
  if (policy.targetScope !== "WHITELIST") return;
  if (!await tx.formAccessTarget.count({ where: { tenantId: publication.tenantId, formId: publication.formId, emailHash: targetHash(email) } }))
    fail(403, "PARTICIPATION_TARGET_DENIED", "등록된 참여 대상 이메일이 아닙니다. 폼 담당자에게 문의해주세요.");
}

async function createSession(tx: Transaction, publication: ParticipationPublication, challengeId: string, email: string,
  policy: ParticipationAccessPolicy, requestId: string) {
  const hash = identityHash(email);
  let participant = await tx.publicationParticipant.findUnique({ where: { tenantId_formId_identityHash: {
    tenantId: publication.tenantId, formId: publication.formId, identityHash: hash,
  } } });
  if (participant && policy.limitDuplicate && participant.submissionCount > 0)
    fail(409, "PARTICIPATION_DUPLICATED", "이미 참여를 완료하셨습니다. 본 설문은 중복 참여가 제한됩니다.");
  participant ??= await tx.publicationParticipant.create({ data: { tenantId: publication.tenantId, formId: publication.formId,
    identityHash: hash, identityCipher: encrypt(email), method: "EMAIL" } });
  await tx.participationSession.updateMany({ where: { tenantId: publication.tenantId, publicationId: publication.id,
    participantId: participant.id, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = opaqueToken(), now = new Date();
  const expiresAt = new Date(Math.min(now.getTime() + 30 * 60_000, publication.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
  if (expiresAt <= now) fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  const session = await tx.participationSession.create({ data: { tenantId: publication.tenantId, publicationId: publication.id,
    participantId: participant.id, challengeId, tokenHash: tokenHash(token), expiresAt } });
  await tx.auditEvent.create({ data: { tenantId: publication.tenantId, serviceId: publication.form.serviceId, requestId,
    action: "form.participation_authenticated", resource: "publication", resourceId: publication.id,
    detail: { participantId: participant.id, sessionId: session.id, method: "EMAIL" } } });
  return { proof: token, expiresAt: expiresAt.toISOString() };
}

export async function startParticipationChallenge(token: string, raw: z.infer<typeof participationChallengeInput>, requestId: string) {
  const input = participationChallengeInput.parse(raw), publicationId = await publicationIdForToken(token);
  return db.$transaction(async tx => {
    const live = await lockPublicPublication(tx, publicationId, true) as ParticipationPublication;
    const currentPolicy = storedParticipationPolicy(live.formVersion);
    if (!currentPolicy.enabled) fail(422, "PARTICIPATION_ACCESS_DISABLED", "이 폼은 참여 인증을 사용하지 않습니다.");
    if (currentPolicy.method !== "EMAIL") fail(503, "SOCIAL_PARTICIPATION_PROVIDER_REQUIRED", "소셜 참여 인증 공급자 연결이 필요합니다.");
    await assertTarget(tx, live, currentPolicy, input.email);
    const hash = identityHash(input.email);
    const participant = await tx.publicationParticipant.findUnique({ where: { tenantId_formId_identityHash: {
      tenantId: live.tenantId, formId: live.formId, identityHash: hash,
    } } });
    if (participant && currentPolicy.limitDuplicate && participant.submissionCount > 0)
      fail(409, "PARTICIPATION_DUPLICATED", "이미 참여를 완료하셨습니다. 본 설문은 중복 참여가 제한됩니다.");
    const old = await tx.participationChallenge.findMany({ where: { tenantId: live.tenantId, publicationId: live.id,
      emailHash: hash, consumedAt: null }, select: { id: true } });
    await tx.participationChallenge.updateMany({ where: { id: { in: old.map(value => value.id) }, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.job.updateMany({ where: { tenantId: live.tenantId, dedupeKey: { in: old.map(value => "mail:participation:" + value.id) },
      status: { in: ["queued", "retry"] } }, data: { status: "cancelled", completedAt: new Date() } });
    const id = opaqueToken(), client = opaqueToken(), expiresAt = new Date(Date.now() + 10 * 60_000);
    const code = currentPolicy.useOtp ? String(randomInt(0, 1_000_000)).padStart(6, "0") : null;
    await tx.participationChallenge.create({ data: { id, tenantId: live.tenantId, publicationId: live.id,
      emailHash: hash, emailCipher: encrypt(input.email), clientHash: tokenHash(client),
      codeHash: code ? tokenHash(id + ":" + code) : null, expiresAt } });
    await tx.auditEvent.create({ data: { tenantId: live.tenantId, serviceId: live.form.serviceId, requestId,
      action: "form.participation_challenge_requested", resource: "publication", resourceId: live.id,
      detail: { challengeId: id, method: "EMAIL", otp: !!code } } });
    if (code) {
      await enqueueMail({ to: input.email, subject: "캐치폼 참여 인증번호",
        text: "참여 인증번호: " + code + "\n\n이 코드는 10분간 유효하며 한 번만 사용할 수 있습니다. 요청한 브라우저에서 입력해주세요." },
      "participation:" + id, tx, live.tenantId);
      return { challengeId: id, client, requiresCode: true as const, expiresAt: expiresAt.toISOString() };
    }
    await tx.participationChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
    return { challengeId: id, client, requiresCode: false as const,
      ...await createSession(tx, live, id, input.email, currentPolicy, requestId) };
  }, { timeout: 15000 });
}

export async function verifyParticipationChallenge(token: string, challengeId: string,
  raw: z.infer<typeof participationChallengeVerifyInput>, requestId: string) {
  const input = participationChallengeVerifyInput.parse(raw), publicationId = await publicationIdForToken(token);
  const result = await db.$transaction(async tx => {
    const live = await lockPublicPublication(tx, publicationId, true) as ParticipationPublication;
    const policy = storedParticipationPolicy(live.formVersion);
    if (!policy.enabled || policy.method !== "EMAIL") return null;
    await tx.$queryRaw`SELECT id FROM "ParticipationChallenge" WHERE id=${challengeId} AND "publicationId"=${live.id} FOR UPDATE`;
    const challenge = await tx.participationChallenge.findFirst({ where: { id: challengeId, tenantId: live.tenantId, publicationId: live.id } });
    if (!challenge || challenge.clientHash !== tokenHash(input.client) || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5)
      return null;
    if (!challenge.codeHash || !input.code || !timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(tokenHash(challenge.id + ":" + input.code), "hex"))) {
      await tx.participationChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    const email = decrypt<string>(challenge.emailCipher);
    await assertTarget(tx, live, policy, email);
    await tx.participationChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    return createSession(tx, live, challenge.id, email, policy, requestId);
  }, { timeout: 15000 });
  if (!result) fail(422, "PARTICIPATION_CODE_INVALID", "인증번호가 올바르지 않거나 사용할 수 없습니다. 다시 인증을 요청해주세요.");
  return result;
}

export async function requireParticipationSession(tx: Transaction, publication: ParticipationPublication, proof: string | undefined,
  options: { write?: boolean; allowCompleted?: boolean } = {}) {
  const policy = storedParticipationPolicy(publication.formVersion);
  if (!policy.enabled) return null;
  if (!proof) fail(401, "PARTICIPATION_AUTH_REQUIRED", "참여 인증을 완료해주세요.");
  participationProofSchema.parse(proof);
  const initial = await tx.participationSession.findUnique({ where: { tokenHash: tokenHash(proof) } });
  if (!initial || initial.tenantId !== publication.tenantId || initial.publicationId !== publication.id)
    fail(401, "PARTICIPATION_SESSION_EXPIRED", "참여 인증이 만료되었습니다. 다시 인증해주세요.");
  if (options.write) await tx.$queryRaw`SELECT id FROM "ParticipationSession" WHERE id=${initial.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ParticipationSession" WHERE id=${initial.id} FOR SHARE`;
  if (options.write) await tx.$queryRaw`SELECT id FROM "PublicationParticipant" WHERE id=${initial.participantId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "PublicationParticipant" WHERE id=${initial.participantId} FOR SHARE`;
  const session = await tx.participationSession.findUniqueOrThrow({ where: { id: initial.id }, include: { participant: true } });
  if (session.revokedAt || session.expiresAt <= new Date()) fail(401, "PARTICIPATION_SESSION_EXPIRED", "참여 인증이 만료되었습니다. 다시 인증해주세요.");
  const email = decrypt<string>(session.participant.identityCipher);
  await assertTarget(tx, publication, policy, email);
  if (!options.allowCompleted && policy.limitDuplicate && session.participant.submissionCount > 0)
    fail(409, "PARTICIPATION_DUPLICATED", "이미 참여를 완료하셨습니다. 본 설문은 중복 참여가 제한됩니다.");
  return { policy, session, participant: session.participant };
}
