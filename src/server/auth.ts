import { trustedClientIp } from "./client-ip";
import { assertCompanyIp } from "./ip-enforcement";
import { HttpError } from "./http";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { verifyJWT } from "better-auth/crypto";
import { db } from "./db";
import { env } from "./env";
import { enqueueMail } from "./jobs";
import { credentialOperation, guardCredentialRequests } from "./credential-lock";
import { assertNextPassword } from "./password-policy";
import { isSafeAuthCallback } from "@/lib/return-to";

const authInstance = betterAuth({
  appName: "캐치시큐",
  basePath: "/api/v1/auth",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  logger: { disabled: true },
  trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
  database: prismaAdapter(db, { provider: "postgresql" }),
  // Better Auth skips Origin checks by default in NODE_ENV=test. Keep the
  // production protections active in the integration suite as well.
  advanced: { database: { generateId: "uuid" }, disableOriginCheck: false, disableCSRFCheck: false },
  emailAndPassword: {
    enabled: true, requireEmailVerification: true, minPasswordLength: 12, maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      if ((await db.user.findUnique({ where: { id: user.id }, select: { status: true } }))?.status !== "active") return;
      await enqueueMail({ to: user.email, subject: "비밀번호 재설정", text: "아래 링크에서 비밀번호를 재설정하세요.\n" + url });
    },
  },
  emailVerification: {
    sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      if ((await db.user.findUnique({ where: { id: user.id }, select: { status: true } }))?.status !== "active") return;
      await enqueueMail({ to: user.email, subject: "이메일 인증", text: "아래 링크에서 이메일을 인증하세요.\n" + url });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, updateAge: 60, disableSessionRefresh: true, cookieCache: { enabled: false },
    additionalFields: {
      activeCompanyId: { type: "string", required: false, input: false },
      activeServiceId: { type: "string", required: false, input: false },
    },
  },
  user: {
    additionalFields: {
      status: { type: "string", defaultValue: "active", input: false },
      platformAdmin: { type: "boolean", defaultValue: false, input: false },
    },
  },
  account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
  verification: { storeIdentifier: "hashed" },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  plugins: [twoFactor({
    issuer: "캐치시큐",
    otpOptions: { storeOTP: "hashed", sendOTP: async ({ user, otp }) => {
      await enqueueMail({ to: user.email, subject: "로그인 인증코드", text: "인증코드: " + otp + "\n다른 사람에게 알려주지 마세요." });
    } },
  })],
  hooks: { before: createAuthMiddleware(async ctx => {
    if (ctx.path === "/verify-email" && typeof ctx.query?.token === "string") {
      const token = await verifyJWT<{ email?: string }>(ctx.query.token, ctx.context.secret);
      if (token?.email && (await db.user.findUnique({ where: { email: token.email }, select: { status: true } }))?.status !== "active")
        throw new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "링크가 만료되었거나 사용할 수 없습니다." });
    }
    for (const callback of [ctx.body?.callbackURL, ctx.body?.redirectTo, ctx.query?.callbackURL]) {
      if (callback !== undefined && !isSafeAuthCallback(callback, env.BETTER_AUTH_URL))
        throw new APIError("BAD_REQUEST", { code: "INVALID_CALLBACK_URL", message: "인증 후 이동할 주소가 올바르지 않습니다." });
    }
    if (["/change-password", "/reset-password"].includes(ctx.path)) {
      const operation = credentialOperation();
      if (!operation) throw new APIError("FORBIDDEN", { code: "PASSWORD_GUARD_REQUIRED", message: "비밀번호 변경 화면을 사용해주세요." });
      if (ctx.path === "/change-password") {
        const current = await getSessionFromCtx(ctx, { disableRefresh: true });
        if (!current || current.user.id !== operation.userId) throw new APIError("UNAUTHORIZED", { message: "다시 로그인해주세요." });
        const account = await db.account.findFirst({ where: { userId: operation.userId, providerId: "credential" }, select: { password: true } });
        if (!account?.password || !await ctx.context.password.verify({ hash: account.password, password: ctx.body.currentPassword }))
          throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "현재 비밀번호를 확인해주세요." });
      }
      await assertNextPassword(operation.userId, ctx.body.newPassword, ctx.context.password.verify);
    }
    // Check inactivity before any auth endpoint can rotate or mutate an existing session.
    // Login/recovery endpoints must remain available when the browser sends an expired cookie.
    const publicAuth = ["/sign-in/email", "/sign-up/email", "/sign-out", "/request-password-reset", "/reset-password", "/verify-email", "/send-verification-email"];
    if (!publicAuth.includes(ctx.path) && !ctx.path.startsWith("/reset-password/")) {
      const current = await getSessionFromCtx(ctx, { disableRefresh: true, disableCookieCache: true });
      if (current) {
        const session = await db.session.findUnique({ where: { id: current.session.id } });
        const member = session && await db.membership.findFirst({ where: { userId: session.userId, status: "active",
          ...(session.activeCompanyId ? { tenantId: session.activeCompanyId } : {}), tenant: { status: "active" } },
          include: { tenant: { include: { policy: true } } }, orderBy: { createdAt: "asc" } });
        const minutes = member?.tenant.policy?.sessionMinutes;
        if (!session || (minutes && Date.now() - session.updatedAt.getTime() > minutes * 60000)) {
          if (session) await db.session.deleteMany({ where: { id: session.id } });
          throw new APIError("UNAUTHORIZED", { code: "SESSION_EXPIRED", message: "세션이 만료되었습니다. 다시 로그인해주세요." });
        }
      }
    }
    if (ctx.path === "/update-user") throw new APIError("FORBIDDEN", { message: "프로필 수정 화면을 사용해주세요." });
    if (ctx.path === "/two-factor/disable") {
      const session = await getSessionFromCtx(ctx);
      if (session) {
        const required = await db.membership.count({ where: { userId: session.user.id, status: "active", tenant: { status: "active", policy: { requireMfa: true } } } });
        if (required) throw new APIError("FORBIDDEN", { message: "회사 보안 정책에 따라 2단계 인증을 해제할 수 없습니다." });
      }
    }
  }) },
  databaseHooks: {
    account: {
      create: { before: async (data, ctx) => {
        if (data.providerId === "credential" && data.password && ctx?.path !== "/sign-up/email" && !credentialOperation())
          throw new APIError("FORBIDDEN", { message: "비밀번호 재설정 화면을 사용해주세요." });
        return { data };
      } },
      update: { before: async data => {
        if (data.password && !credentialOperation()) throw new APIError("FORBIDDEN", { message: "비밀번호 변경 화면을 사용해주세요." });
        return { data };
      } },
    },
    user: {
      update: {
        before: async (data, ctx) => {
          if (!("twoFactorEnabled" in data) || !ctx) return { data };
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError("UNAUTHORIZED", { message: "다시 로그인해주세요." });
          // The maintained plugin rotates the current session after verifying the factor.
          // Revoke other sessions so a password-only session cannot bypass the new factor.
          const revoked = await db.session.deleteMany({ where: { userId: session.user.id, id: { not: session.session.id } } });
          await db.auditEvent.create({ data: { actorId: session.user.id, action: "auth.sessions_revoked_for_mfa",
            resource: "user", resourceId: session.user.id, requestId: crypto.randomUUID(), detail: { count: revoked.count } } });
          return { data };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { status: true } });
          if (!user || user.status !== "active") throw new APIError("FORBIDDEN", { message: "사용할 수 없는 계정입니다." });
          const members = await db.membership.findMany({
            where: { userId: session.userId, status: "active", tenant: { status: "active" }, OR: [{ accessKind: "direct" }, { accessKind: "expert", expertAssignment: { is: { expertUserId: session.userId, status: "active", expiresAt: { gt: new Date() } } } }] },
            orderBy: { createdAt: "asc" },
          });
          let companyId: string | null = null;
          for (const member of members) {
            try { await assertCompanyIp(member.tenantId, trustedClientIp(context?.headers ?? new Headers())); companyId = member.tenantId; break; }
            catch (error) { if (!(error instanceof HttpError) || !["IP_NOT_ALLOWED", "IP_ADDRESS_UNAVAILABLE"].includes(error.code)) throw error; }
          }
          if (members.length && !companyId) throw new APIError("FORBIDDEN", { code: "IP_NOT_ALLOWED", message: "회사에서 허용한 IP에서 로그인해주세요." });
          return { data: { ...session, activeCompanyId: companyId } };
        },
        after: async session => {
          await db.auditEvent.create({ data: { tenantId: typeof session.activeCompanyId === "string" ? session.activeCompanyId : null,
            actorId: session.userId, action: "session.created",
            resource: "session", resourceId: session.id, requestId: crypto.randomUUID(), detail: {} } });
        },
      },
    },
  },
});

export const auth = { ...authInstance, handler: guardCredentialRequests(authInstance.handler,
  async headers => (await authInstance.api.getSession({ headers, query: { disableRefresh: true } }))?.user.id ?? null,
  async token => {
    const context = await authInstance.$context;
    const verification = await context.internalAdapter.findVerificationValue("reset-password:" + token);
    return verification && verification.expiresAt > new Date() ? verification.value : null;
  }) };
