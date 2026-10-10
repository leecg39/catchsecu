// 가상 조직 인증(GPKI·새올·그룹웨어 mock) 어댑터 — 외부 기관 미연동 상태에서
// VirtualOrgMember 디렉터리로 login/verified/fail/email-register 경로를 실제 DB·
// 세션으로 검증한다. 인증 성공 후에는 completeSso의 실제 계정연결·JIT·세션·MFA
// 경로를 그대로 탄다. 디렉터리 행이 없으면 어떤 입력도 성공할 수 없다.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { VirtualOrgMember, SsoProvider, SsoState } from "@/generated/prisma/client";
import { orgEmailChallengeBody, orgEmailRegisterBody, type orgLoginBody, type orgMemberCreate, type orgMemberPatch } from "@/contracts/sso";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail, rateLimit } from "./http";
import { trustedClientIp } from "./client-ip";
import { audit } from "./audit";
import type { Context } from "./context";
import { assertSsoProviderPolicy } from "./sso-policy-enforcement";
import { assertFileDeadlines } from "./file-access";
import { assertSsoState, completeSso, isVirtualOrgProtocol, lockSsoActor, lockSsoCompany } from "./sso";
import { idempotent } from "./idempotency";
import { enqueueMail } from "./jobs";
import { assertSsoBrowser, ssoBrowserTransport, startSsoBrowser } from "./sso-browser";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const orgPinHash = (orgCode: string, employeeNo: string, pin: string) =>
  tokenHash(`orgpin:${orgCode}:${employeeNo}:${pin}`);

function memberDto(row: VirtualOrgMember) {
  return { id: row.id, orgCode: row.orgCode, employeeNo: row.employeeNo,
    name: decrypt<string>(row.nameCipher), email: row.emailCipher ? decrypt<string>(row.emailCipher) : null,
    version: row.version, createdAt: row.createdAt.toISOString() };
}
async function providerForUpdate(tx: Transaction, ctx: Pick<Context, "tenantId">, providerId: string) {
  await tx.$queryRawUnsafe('SELECT id FROM "SsoProvider" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE', providerId, ctx.tenantId);
  const row = await tx.ssoProvider.findFirst({ where: { id: providerId, tenantId: ctx.tenantId } });
  if (!row || !isVirtualOrgProtocol(row.protocol)) fail(404, "NOT_FOUND", "가상 조직 인증 설정을 찾을 수 없습니다.");
  return row;
}

export async function listOrgMembers(ctx: Context, providerId: string) {
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx);
    const provider = await tx.ssoProvider.findFirst({ where: { id: providerId, tenantId: ctx.tenantId } });
    if (!provider || !isVirtualOrgProtocol(provider.protocol)) fail(404, "NOT_FOUND", "가상 조직 인증 설정을 찾을 수 없습니다.");
    const rows = await tx.virtualOrgMember.findMany({ where: { providerId },
      orderBy: [{ orgCode: "asc" }, { employeeNo: "asc" }] });
    assertFileDeadlines(actor.deadlines);
    return { items: rows.map(memberDto), canManage: actor.member.role === "owner" };
  });
}
export async function addOrgMember(ctx: Context, providerId: string, input: z.infer<typeof orgMemberCreate>, requestId: string, key: string | null = null) {
  if (key !== null && !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) fail(400, "IDEMPOTENCY_REQUIRED", "유효한 Idempotency-Key가 필요합니다.");
  let deadlines: Parameters<typeof assertFileDeadlines>[0];
  const create = async (tx: Transaction) => {
    const actor = await lockSsoActor(tx, ctx, true);
    deadlines = actor.deadlines;
    await providerForUpdate(tx, ctx, providerId);
    const row = await tx.virtualOrgMember.create({ data: { tenantId: ctx.tenantId, providerId,
      orgCode: input.orgCode, employeeNo: input.employeeNo,
      nameCipher: encrypt(input.name), emailCipher: input.email ? encrypt(input.email.toLowerCase()) : null,
      pinHash: orgPinHash(input.orgCode, input.employeeNo, input.pin) } });
    await audit(tx, ctx, requestId, "org_auth.member_added", "virtualOrgMember", row.id, ["orgCode", "employeeNo"]);
    assertFileDeadlines(actor.deadlines);
    return { status: 201, body: memberDto(row),
      resource: { tenantId: ctx.tenantId, resourceType: "org-member" as const, resourceId: row.id } };
  };
  if (key === null) return db.$transaction(async tx => (await create(tx)).body);
  // Expired replay markers must not bypass the current owner check.
  await db.$transaction(async tx => assertFileDeadlines((await lockSsoActor(tx, ctx, true)).deadlines));
  const result = await idempotent(`org-member:create:${ctx.tenantId}:${providerId}:${ctx.user.id}`, key, input, create,
    async tx => {
      deadlines = (await lockSsoActor(tx, ctx, true)).deadlines;
      await providerForUpdate(tx, ctx, providerId);
    }, async (tx, cached) => {
      const current = await tx.virtualOrgMember.findFirst({ where: { id: cached.id, providerId, tenantId: ctx.tenantId } });
      if (!current) fail(410, "IDEMPOTENCY_EXPIRED", "이미 삭제된 디렉터리 구성원 요청입니다.");
      return memberDto(current);
    }, async () => assertFileDeadlines(deadlines));
  return result.body;
}
export async function updateOrgMember(ctx: Context, providerId: string, memberId: string, input: z.infer<typeof orgMemberPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    await providerForUpdate(tx, ctx, providerId);
    await tx.$queryRaw`SELECT id FROM "VirtualOrgMember" WHERE id=${memberId} AND "providerId"=${providerId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const row = await tx.virtualOrgMember.findFirst({ where: { id: memberId, providerId, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "디렉터리 구성원을 찾을 수 없습니다.");
    if (row.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const saved = await tx.virtualOrgMember.update({ where: { id: row.id }, data: {
      ...(input.name !== undefined ? { nameCipher: encrypt(input.name) } : {}),
      ...(input.email !== undefined ? { emailCipher: input.email === null ? null : encrypt(input.email.toLowerCase()) } : {}),
      ...(input.pin !== undefined ? { pinHash: orgPinHash(row.orgCode, row.employeeNo, input.pin) } : {}),
      version: { increment: 1 },
    } });
    // Pending email claims are bound to the directory version. Erase their secrets
    // when an administrator edits the identity; already issued sessions are unchanged.
    await tx.ssoState.deleteMany({ where: { tenantId: ctx.tenantId, providerId, orgMemberId: row.id } });
    await audit(tx, ctx, requestId, "org_auth.member_updated", "virtualOrgMember", row.id,
      ["name", "email", "pin"].filter(field => input[field as "name" | "email" | "pin"] !== undefined));
    assertFileDeadlines(actor.deadlines);
    return memberDto(saved);
  });
}
export async function removeOrgMember(ctx: Context, providerId: string, memberId: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const actor = await lockSsoActor(tx, ctx, true);
    await providerForUpdate(tx, ctx, providerId);
    const row = await tx.virtualOrgMember.findFirst({ where: { id: memberId, providerId } });
    if (!row) fail(404, "NOT_FOUND", "디렉터리 구성원을 찾을 수 없습니다.");
    if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
    await tx.ssoState.deleteMany({ where: { tenantId: ctx.tenantId, providerId, orgMemberId: row.id } });
    await tx.idempotencyRecord.updateMany({ where: { tenantId: ctx.tenantId, resourceType: "org-member", resourceId: row.id },
      data: { responseCipher: null, requestHash: null, invalidatedAt: new Date() } });
    await tx.virtualOrgMember.delete({ where: { id: row.id } });
    await audit(tx, ctx, requestId, "org_auth.member_removed", "virtualOrgMember", row.id, ["orgCode", "employeeNo"]);
    assertFileDeadlines(actor.deadlines);
    return { deleted: true };
  });
}

// 인증 성공 시 completeSso의 실제 계정 연결·JIT·세션·MFA 경로로 넘긴다.
// state는 이미 소비(deleteMany)된 행이어야 한다.
async function finishOrgLogin(provider: SsoProvider, state: SsoState, member: VirtualOrgMember, headers: Headers) {
  const email = member.emailCipher ? decrypt<string>(member.emailCipher) : undefined;
  const result = await completeSso(provider, state, {
    sub: `${member.orgCode}:${member.employeeNo}`, iss: provider.issuer,
    email, name: decrypt<string>(member.nameCipher), emailVerified: !!email }, headers, async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM "VirtualOrgMember" WHERE id=$1 AND "providerId"=$2 FOR UPDATE', member.id, provider.id);
    const current = await tx.virtualOrgMember.findUnique({ where: { id: member.id } });
    if (!current || current.providerId !== provider.id)
      fail(401, "ORG_AUTH_FAILED", "조직 인증 계정이 해제되었습니다. 다시 로그인해주세요.");
    if (memberSnapshot(current) !== memberSnapshot(member) || current.pinHash !== member.pinHash
      || current.emailCipher !== member.emailCipher || current.nameCipher !== member.nameCipher)
      fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
  });
  return { status: "verified" as const, ...result };
}

function newOrgState(provider: SsoProvider, member: VirtualOrgMember, mode: string, token: string) {
  return { tenantId: provider.tenantId, providerId: provider.id, providerVersion: provider.version,
    stateHash: sha256(token), nonceHash: memberSnapshot(member), verifierCipher: encrypt(token),
    mode, orgMemberId: member.id, expiresAt: new Date(Date.now() + 10 * 60000) };
}
// 티켓 발행 시점의 디렉터리 버전 — 등록 시점에 관리자 수정·삭제가 있으면 거부한다.
export const memberSnapshot = (member: VirtualOrgMember) => sha256(`orgmember:${member.id}:${member.version}`);

export async function orgLogin(input: z.infer<typeof orgLoginBody>, headers: Headers) {
  ssoBrowserTransport(input.protocol);
  await rateLimit("org-login:" + trustedClientIp(headers), 20);
  const member = await db.virtualOrgMember.findUnique({
    where: { orgCode_employeeNo: { orgCode: input.orgCode, employeeNo: input.employeeNo } },
    include: { provider: true } });
  const pin = orgPinHash(input.orgCode, input.employeeNo, input.pin);
  const pinOk = !!member && member.pinHash.length === pin.length &&
    timingSafeEqual(Buffer.from(member.pinHash), Buffer.from(pin));
  if (!member || !pinOk) {
    if (member) await audit(db, { tenantId: member.tenantId, user: { id: null } }, "org-login",
      "org_auth.failed", "virtualOrgMember", member.id, ["reason"]);
    fail(401, "ORG_AUTH_FAILED", "조직 인증에 실패했습니다. 조직 식별자·사번·인증번호를 확인해주세요.");
  }
  const provider = member.provider;
  if (provider.protocol !== input.protocol || !provider.enabled || !provider.preflightOk)
    fail(404, "NOT_FOUND", "사용할 수 있는 조직 인증 설정이 없습니다.");
  await assertSsoProviderPolicy(db, provider);

  let startedState: SsoState | null = null;
  if (input.state) {
    // SSO 시작(state) 흐름 — link/invite/login 모드를 completeSso가 그대로 처리한다.
    const state = await db.ssoState.findUnique({ where: { stateHash: sha256(input.state) } });
    if (!state || state.providerId !== provider.id || state.expiresAt <= new Date())
      fail(401, "STATE_INVALID", "로그인 요청이 만료되었거나 존재하지 않습니다.");
    assertSsoState(provider, state);
    assertSsoBrowser(state, headers, provider.protocol);
    // Linking already has an authenticated local user. Login and invitation
    // identities without an email must first prove ownership of their new address.
    if (!member.emailCipher && state.mode !== "link") startedState = state;
    else {
    const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
    if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
    return finishOrgLogin(provider, state, member, headers);
    }
  }

  // 직접 로그인: 디렉터리에 이메일이 없으면 email-register 단계로 보낸다.
  if (!member.emailCipher) {
    const browser = startSsoBrowser(headers, provider.protocol);
    const ticket = randomBytes(32).toString("base64url");
    return db.$transaction(async tx => {
      // Issue under the same company -> provider -> member locks as editing and
      // deletion, so an old credential snapshot cannot recreate a revoked ticket.
      await lockSsoCompany(tx, member.tenantId, headers);
      const currentProvider = await providerForUpdate(tx, { tenantId: member.tenantId }, provider.id);
      if (!currentProvider.enabled || !currentProvider.preflightOk || currentProvider.version !== provider.version)
        fail(409, "SSO_CONFIGURATION_CHANGED", "SSO 설정이 변경되었습니다. 로그인을 다시 시작해주세요.");
      await assertSsoProviderPolicy(tx, currentProvider);
      await tx.$queryRaw`SELECT id FROM "VirtualOrgMember" WHERE id=${member.id} AND "providerId"=${provider.id} AND "tenantId"=${member.tenantId} FOR UPDATE`;
      const current = await tx.virtualOrgMember.findFirst({ where: { id: member.id, providerId: provider.id, tenantId: member.tenantId } });
      if (!current) fail(401, "ORG_AUTH_FAILED", "조직 인증 계정이 해제되었습니다. 다시 로그인해주세요.");
      if (current.version !== member.version || current.pinHash !== member.pinHash || current.emailCipher !== member.emailCipher || current.nameCipher !== member.nameCipher)
        fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
      let issued: SsoState;
      const data = { ...newOrgState(currentProvider, current, startedState?.mode ?? "login", ticket),
        browserHash: startedState?.browserHash ?? browser.browserHash };
      if (startedState) {
        // Retain invitation identity and the original deadline, and atomically
        // replace the public redirect state with a PIN-authenticated email ticket.
        const changed = await tx.ssoState.updateMany({ where: { id: startedState.id, stateHash: startedState.stateHash,
          expiresAt: { gt: new Date() }, orgMemberId: null }, data: { ...data, expiresAt: startedState.expiresAt } });
        if (!changed.count) fail(401, "STATE_REPLAYED", "로그인 요청이 이미 사용되었습니다. 다시 시작해주세요.");
        issued = await tx.ssoState.findUniqueOrThrow({ where: { id: startedState.id } });
      } else issued = await tx.ssoState.create({ data });
      await audit(tx, { tenantId: currentProvider.tenantId, user: { id: null } }, "org-login",
        "org_auth.email_register_required", "virtualOrgMember", current.id, []);
      assertSsoState(currentProvider, issued);
      if (startedState) assertSsoBrowser(issued, headers, currentProvider.protocol);
      return { status: "email-register" as const, ticket, expiresAt: issued.expiresAt.toISOString(), protocol: currentProvider.protocol, browserCookie: browser.browserCookie };
    });
  }

  // 실제 콜백과 같은 검증 경로를 타도록 state를 만들고 바로 소비한다.
  const token = randomBytes(24).toString("base64url");
  const state = await db.ssoState.create({ data: newOrgState(provider, member, "login", token) });
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
  return finishOrgLogin(provider, state, member, headers);
}

// All consumers serialize with provider/directory administration. A ticket is a
// bearer credential, so errors and mail never disclose its plaintext value.
async function lockEmailTicket(tx: Transaction, ticket: string, headers: Headers) {
  const initial = await tx.ssoState.findUnique({ where: { stateHash: sha256(ticket) } });
  if (!initial?.orgMemberId || !["login", "invite"].includes(initial.mode))
    fail(401, "STATE_INVALID", "이메일 등록 요청이 만료되었거나 존재하지 않습니다. 조직 인증을 다시 시작해주세요.");
  assertSsoBrowser(initial, headers);
  await lockSsoCompany(tx, initial.tenantId, headers);
  const provider = await providerForUpdate(tx, { tenantId: initial.tenantId }, initial.providerId);
  assertSsoState(provider, initial);
  await assertSsoProviderPolicy(tx, provider);
  await tx.$queryRaw`SELECT id FROM "VirtualOrgMember" WHERE id=${initial.orgMemberId} AND "providerId"=${provider.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SsoState" WHERE id=${initial.id} FOR UPDATE`;
  const state = await tx.ssoState.findUnique({ where: { stateHash: sha256(ticket) } });
  const member = await tx.virtualOrgMember.findUnique({ where: { id: initial.orgMemberId } });
  if (!state || state.id !== initial.id || !member || member.providerId !== provider.id)
    fail(401, "STATE_INVALID", "이메일 등록 요청이 만료되었거나 존재하지 않습니다. 조직 인증을 다시 시작해주세요.");
  assertSsoState(provider, state);
  assertSsoBrowser(state, headers, provider.protocol);
  if (member.emailCipher) fail(409, "EMAIL_REGISTERED", "이미 이메일이 등록된 계정입니다. 다시 로그인해주세요.");
  if (state.nonceHash !== memberSnapshot(member))
    fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
  return { state, member, provider };
}
const mailKey = (id: string) => "mail:org-email:" + id;
async function cancelEmailJobs(tx: Transaction, tenantId: string, ids: string[]) {
  await tx.job.updateMany({ where: { tenantId, dedupeKey: { in: ids.map(mailKey) }, status: { in: ["queued", "retry"] } },
    data: { status: "cancelled", completedAt: new Date() } });
}

export async function requestOrgEmailChallenge(raw: z.infer<typeof orgEmailChallengeBody>, headers: Headers) {
  const input = orgEmailChallengeBody.parse(raw), email = input.email.toLowerCase();
  await rateLimit("org-email-challenge:" + trustedClientIp(headers), 20);
  return db.$transaction(async tx => {
    const { state, member, provider } = await lockEmailTicket(tx, input.ticket, headers);
    const now = new Date();
    const latest = await tx.orgEmailChallenge.findFirst({ where: { stateId: state.id }, orderBy: { createdAt: "desc" } });
    if (latest && latest.createdAt.getTime() + 60000 > now.getTime())
      fail(429, "ORG_EMAIL_CHALLENGE_RATE_LIMITED", "인증번호는 1분 뒤 다시 요청할 수 있습니다.");
    // Span new PIN tickets, but invalid/expired tickets and cooldown retries
    // cannot exhaust the real member's mail allowance.
    await rateLimit("org-email-member:" + member.id, 10, 3600);
    const older = await tx.orgEmailChallenge.findMany({ where: { stateId: state.id, revokedAt: null }, select: { id: true } });
    await tx.orgEmailChallenge.updateMany({ where: { stateId: state.id, revokedAt: null }, data: { revokedAt: now } });
    await cancelEmailJobs(tx, state.tenantId, older.map(row => row.id));
    const id = randomUUID(), code = randomInt(0, 1000000).toString().padStart(6, "0");
    const expiresAt = new Date(Math.min(now.getTime() + 5 * 60000, state.expiresAt.getTime()));
    await tx.orgEmailChallenge.create({ data: { id, tenantId: state.tenantId, stateId: state.id,
      emailCipher: encrypt(email), emailHash: tokenHash(email), codeHash: tokenHash(id + ":" + code), expiresAt, createdAt: now } });
    await enqueueMail({ to: email, subject: "캐치시큐 조직 로그인 이메일 인증번호",
      text: `조직 로그인에 사용할 이메일을 확인합니다.\n인증번호: ${code}\n5분 이내에 요청한 화면에서 입력해주세요. 요청하지 않았다면 사용하지 마세요.` }, "org-email:" + id, tx, state.tenantId);
    await audit(tx, { tenantId: state.tenantId, user: { id: null } }, "org-email-challenge",
      "org_auth.email_challenge_requested", "virtualOrgMember", member.id, []);
    assertSsoState(provider, state);
    if (expiresAt <= new Date()) fail(422, "ORG_EMAIL_CHALLENGE_INVALID", "인증번호가 만료되었습니다. 다시 요청해주세요.");
    return { challengeId: id, expiresAt: expiresAt.toISOString(), retryAt: new Date(now.getTime() + 60000).toISOString() };
  });
}

async function checkedEmailChallenge(tx: Transaction, state: SsoState, input: z.infer<typeof orgEmailRegisterBody>) {
  await tx.$queryRaw`SELECT id FROM "OrgEmailChallenge" WHERE id=${input.challengeId} AND "stateId"=${state.id} FOR UPDATE`;
  const challenge = await tx.orgEmailChallenge.findFirst({ where: { id: input.challengeId, stateId: state.id, tenantId: state.tenantId } });
  if (!challenge || challenge.emailHash !== tokenHash(input.email.toLowerCase()))
    fail(404, "ORG_EMAIL_CHALLENGE_NOT_FOUND", "이 이메일과 등록 요청에 해당하는 인증번호가 없습니다. 다시 요청해주세요.");
  if (challenge.revokedAt || challenge.expiresAt <= new Date())
    fail(422, "ORG_EMAIL_CHALLENGE_INVALID", "인증번호가 만료되었거나 새 번호가 발급되었습니다. 다시 요청해주세요.");
  if (challenge.attempts >= 5)
    fail(422, "ORG_EMAIL_ATTEMPTS_EXCEEDED", "인증번호를 5회 잘못 입력했습니다. 새 인증번호를 요청해주세요.");
  const correct = timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(tokenHash(challenge.id + ":" + input.code), "hex"));
  return { challenge, correct };
}

export async function registerOrgEmail(raw: z.infer<typeof orgEmailRegisterBody>, headers: Headers) {
  const input = orgEmailRegisterBody.parse(raw), email = input.email.toLowerCase();
  await rateLimit("org-email-register:" + trustedClientIp(headers), 20);
  // Failed attempts must commit, while a correct challenge must be consumed in
  // the same transaction as directory/JIT/session/audit writes below.
  const checked = await db.$transaction(async tx => {
    const ticket = await lockEmailTicket(tx, input.ticket, headers);
    const { challenge, correct } = await checkedEmailChallenge(tx, ticket.state, input);
    if (correct) return { ...ticket, challenge, failed: 0 };
    await tx.orgEmailChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    if (challenge.attempts === 4) await cancelEmailJobs(tx, ticket.state.tenantId, [challenge.id]);
    await audit(tx, { tenantId: ticket.state.tenantId, user: { id: null } }, "org-email-register",
      "org_auth.email_challenge_rejected", "virtualOrgMember", ticket.member.id, ["attempts"]);
    return { ...ticket, challenge, failed: challenge.attempts + 1 };
  });
  if (checked.failed) fail(422, checked.failed >= 5 ? "ORG_EMAIL_ATTEMPTS_EXCEEDED" : "ORG_EMAIL_CODE_INVALID",
    checked.failed >= 5 ? "인증번호를 5회 잘못 입력했습니다. 새 인증번호를 요청해주세요." : "인증번호가 올바르지 않습니다. 5회 실패하면 다시 요청해야 합니다.");
  const { member, provider, state, challenge } = checked;
  // completeSso checks this deadline again immediately before commit.
  const boundedState = { ...state, expiresAt: new Date(Math.min(state.expiresAt.getTime(), challenge.expiresAt.getTime())) };
  const result = await completeSso(provider, boundedState, {
    sub: `${member.orgCode}:${member.employeeNo}`, iss: provider.issuer,
    email, name: decrypt<string>(member.nameCipher), emailVerified: true,
  }, headers, async tx => {
    const current = await lockEmailTicket(tx, input.ticket, headers);
    const verified = await checkedEmailChallenge(tx, current.state, input);
    if (!verified.correct) fail(422, "ORG_EMAIL_CODE_INVALID", "인증번호가 올바르지 않습니다.");
    const pending = await tx.orgEmailChallenge.findMany({ where: { stateId: state.id }, select: { id: true } });
    await cancelEmailJobs(tx, state.tenantId, pending.map(row => row.id));
    const consumed = await tx.ssoState.deleteMany({ where: { id: state.id, stateHash: sha256(input.ticket), expiresAt: { gt: new Date() } } });
    if (!consumed.count) fail(401, "STATE_REPLAYED", "등록 요청이 이미 사용되었습니다.");
    await tx.virtualOrgMember.update({ where: { id: member.id }, data: { emailCipher: encrypt(email), version: { increment: 1 } } });
    await audit(tx, { tenantId: state.tenantId, user: { id: null } }, "org-email-register",
      "org_auth.email_registered", "virtualOrgMember", member.id, ["emailCipher"]);
  });
  return { status: "verified" as const, ...result };
}
