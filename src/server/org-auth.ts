// 가상 조직 인증(GPKI·새올·그룹웨어 mock) 어댑터 — 외부 기관 미연동 상태에서
// VirtualOrgMember 디렉터리로 login/verified/fail/email-register 경로를 실제 DB·
// 세션으로 검증한다. 인증 성공 후에는 completeSso의 실제 계정연결·JIT·세션·MFA
// 경로를 그대로 탄다. 디렉터리 행이 없으면 어떤 입력도 성공할 수 없다.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { VirtualOrgMember, SsoProvider, SsoState } from "@/generated/prisma/client";
import type { orgLoginBody, orgMemberCreate } from "@/contracts/sso";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail, rateLimit } from "./http";
import { trustedClientIp } from "./client-ip";
import { audit } from "./audit";
import type { Context } from "./context";
import { assertFileDeadlines } from "./file-access";
import { lockServiceActor } from "./service-actor";
import { completeSso, isVirtualOrgProtocol } from "./sso";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const orgPinHash = (orgCode: string, employeeNo: string, pin: string) =>
  tokenHash(`orgpin:${orgCode}:${employeeNo}:${pin}`);

function memberDto(row: VirtualOrgMember) {
  return { id: row.id, orgCode: row.orgCode, employeeNo: row.employeeNo,
    name: decrypt<string>(row.nameCipher), email: row.emailCipher ? decrypt<string>(row.emailCipher) : null,
    version: row.version, createdAt: row.createdAt.toISOString() };
}
async function providerForUpdate(tx: Transaction, ctx: Context, providerId: string) {
  await tx.$queryRawUnsafe('SELECT id FROM "SsoProvider" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE', providerId, ctx.tenantId);
  const row = await tx.ssoProvider.findFirst({ where: { id: providerId, tenantId: ctx.tenantId } });
  if (!row || !isVirtualOrgProtocol(row.protocol)) fail(404, "NOT_FOUND", "가상 조직 인증 설정을 찾을 수 없습니다.");
  return row;
}

export async function listOrgMembers(ctx: Context, providerId: string) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "security.read");
    const provider = await tx.ssoProvider.findFirst({ where: { id: providerId, tenantId: ctx.tenantId } });
    if (!provider || !isVirtualOrgProtocol(provider.protocol)) fail(404, "NOT_FOUND", "가상 조직 인증 설정을 찾을 수 없습니다.");
    const rows = await tx.virtualOrgMember.findMany({ where: { providerId },
      orderBy: [{ orgCode: "asc" }, { employeeNo: "asc" }] });
    assertFileDeadlines(actor.deadlines);
    return { items: rows.map(memberDto) };
  });
}
export async function addOrgMember(ctx: Context, providerId: string, input: z.infer<typeof orgMemberCreate>, requestId: string) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "security.write");
    await providerForUpdate(tx, ctx, providerId);
    const row = await tx.virtualOrgMember.create({ data: { tenantId: ctx.tenantId, providerId,
      orgCode: input.orgCode, employeeNo: input.employeeNo,
      nameCipher: encrypt(input.name), emailCipher: input.email ? encrypt(input.email.toLowerCase()) : null,
      pinHash: orgPinHash(input.orgCode, input.employeeNo, input.pin) } });
    await audit(tx, ctx, requestId, "org_auth.member_added", "virtualOrgMember", row.id, ["orgCode", "employeeNo"]);
    assertFileDeadlines(actor.deadlines);
    return memberDto(row);
  });
}
export async function removeOrgMember(ctx: Context, providerId: string, memberId: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "security.write");
    await providerForUpdate(tx, ctx, providerId);
    const row = await tx.virtualOrgMember.findFirst({ where: { id: memberId, providerId } });
    if (!row) fail(404, "NOT_FOUND", "디렉터리 구성원을 찾을 수 없습니다.");
    if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다.");
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
    email, name: decrypt<string>(member.nameCipher), emailVerified: !!email }, headers);
  return { status: "verified" as const, ...result };
}

function newOrgState(provider: SsoProvider, member: VirtualOrgMember, mode: string, token: string) {
  return { tenantId: provider.tenantId, providerId: provider.id, providerVersion: provider.version,
    stateHash: sha256(token), nonceHash: memberSnapshot(member), verifierCipher: encrypt(token),
    mode, orgMemberId: member.id, expiresAt: new Date(Date.now() + 10 * 60000) };
}
// 티켓 발행 시점의 디렉터리 버전 — 등록 시점에 관리자 수정·삭제가 있으면 거부한다.
const memberSnapshot = (member: VirtualOrgMember) => sha256(`orgmember:${member.id}:${member.version}`);

export async function orgLogin(input: z.infer<typeof orgLoginBody>, headers: Headers) {
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

  if (input.state) {
    // SSO 시작(state) 흐름 — link/invite/login 모드를 completeSso가 그대로 처리한다.
    const state = await db.ssoState.findUnique({ where: { stateHash: sha256(input.state) } });
    if (!state || state.providerId !== provider.id || state.expiresAt <= new Date())
      fail(401, "STATE_INVALID", "로그인 요청이 만료되었거나 존재하지 않습니다.");
    const consumed = await db.ssoState.deleteMany({ where: { id: state.id, expiresAt: { gt: new Date() } } });
    if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
    return finishOrgLogin(provider, state, member, headers);
  }

  // 직접 로그인: 디렉터리에 이메일이 없으면 email-register 단계로 보낸다.
  if (!member.emailCipher) {
    const ticket = randomBytes(32).toString("base64url");
    await db.ssoState.create({ data: newOrgState(provider, member, "login", ticket) });
    await audit(db, { tenantId: provider.tenantId, user: { id: null } }, "org-login",
      "org_auth.email_register_required", "virtualOrgMember", member.id, []);
    return { status: "email-register" as const, ticket };
  }

  // 실제 콜백과 같은 검증 경로를 타도록 state를 만들고 바로 소비한다.
  const token = randomBytes(24).toString("base64url");
  const state = await db.ssoState.create({ data: newOrgState(provider, member, "login", token) });
  const consumed = await db.ssoState.deleteMany({ where: { id: state.id } });
  if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
  return finishOrgLogin(provider, state, member, headers);
}

export async function registerOrgEmail(input: { ticket: string; email: string }, headers: Headers) {
  await rateLimit("org-email-register:" + trustedClientIp(headers), 20);
  const state = await db.ssoState.findUnique({ where: { stateHash: sha256(input.ticket) } });
  if (!state || !state.orgMemberId || state.mode !== "login" || state.expiresAt <= new Date())
    fail(401, "STATE_INVALID", "이메일 등록 요청이 만료되었거나 존재하지 않습니다.");
  const member = await db.virtualOrgMember.findUnique({ where: { id: state.orgMemberId }, include: { provider: true } });
  if (!member || member.providerId !== state.providerId)
    fail(401, "STATE_INVALID", "이메일 등록 요청이 만료되었거나 존재하지 않습니다.");
  if (member.emailCipher)
    fail(409, "EMAIL_REGISTERED", "이미 이메일이 등록된 계정입니다. 다시 로그인해주세요.");
  if (state.nonceHash !== memberSnapshot(member))
    fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
  const email = input.email.toLowerCase();
  const result = await completeSso(member.provider, state, {
    sub: `${member.orgCode}:${member.employeeNo}`, iss: member.provider.issuer,
    email, name: decrypt<string>(member.nameCipher), emailVerified: true,
  }, headers, async tx => {
    // Company -> provider -> directory, matching administrative removal order.
    await tx.$queryRawUnsafe('SELECT id FROM "VirtualOrgMember" WHERE id=$1 AND "providerId"=$2 FOR UPDATE', member.id, state.providerId);
    const current = await tx.virtualOrgMember.findUnique({ where: { id: member.id } });
    if (!current || current.providerId !== state.providerId)
      fail(401, "STATE_INVALID", "이메일 등록 요청이 만료되었거나 존재하지 않습니다.");
    if (current.emailCipher)
      fail(409, "EMAIL_REGISTERED", "이미 이메일이 등록된 계정입니다. 다시 로그인해주세요.");
    if (state.nonceHash !== memberSnapshot(current))
      fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
    const consumed = await tx.ssoState.deleteMany({ where: { id: state.id,
      stateHash: sha256(input.ticket), orgMemberId: current.id, expiresAt: { gt: new Date() } } });
    if (!consumed.count) fail(401, "STATE_REPLAYED", "state가 이미 사용되었습니다.");
    const claimed = await tx.virtualOrgMember.updateMany({ where: { id: current.id,
      version: current.version, emailCipher: null }, data: { emailCipher: encrypt(email), version: { increment: 1 } } });
    if (!claimed.count) fail(409, "DIRECTORY_CHANGED", "디렉터리 정보가 변경되었습니다. 다시 로그인해주세요.");
    await audit(tx, { tenantId: current.tenantId, user: { id: null } }, "org-email-register",
      "org_auth.email_registered", "virtualOrgMember", current.id, ["emailCipher"]);
  });
  return { status: "verified" as const, ...result };
}
