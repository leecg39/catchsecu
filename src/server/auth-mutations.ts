import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import type { Session, User } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { authMutationScope, type AuthMutationScope } from "./auth-mutation-scope";
import { credentialScope } from "./credential-scope";
import { db, type Transaction } from "./db";
import { assertFileDeadlines } from "./file-access";
import { fail, route } from "./http";
import { enqueueMail } from "./jobs";

type SessionSnapshot = { session: Pick<Session, "id" | "userId" | "expiresAt" | "updatedAt" | "activeCompanyId">; user: Pick<User, "id"> };
type SessionLookup = (headers: Headers) => Promise<SessionSnapshot | null>;
class AuthRollback { constructor(public response: Response) {} }
const factorActions: Record<string, string> = {
  "enable": "auth.factor_setup", "disable": "auth.factor_disabled", "verify-totp": "auth.factor_verified",
  "verify-otp": "auth.factor_verified", "verify-backup-code": "auth.backup_code_verified",
  "send-otp": "auth.factor_code_requested", "generate-backup-codes": "auth.backup_codes_generated",
  "view-backup-codes": "auth.backup_codes_viewed", "get-totp-uri": "auth.factor_secret_viewed",
};
function factorOperation(path: string) { return path.startsWith("/api/v1/auth/two-factor/") ? path.split("/").at(-1)! : null; }
const publicPaths = ["/sign-in/email", "/sign-up/email", "/request-password-reset", "/send-verification-email", "/verify-email"].map(path => "/api/v1/auth" + path);

export async function lockAuthUser(tx: Transaction, userId: string, validate = false) {
  const scope = authMutationScope.getStore();
  if (!scope?.lockedUsers.has(userId)) {
    await tx.$queryRaw`SELECT c.id FROM "Company" c JOIN "Membership" m ON m."tenantId"=c.id
      WHERE m."userId"=${userId} AND m.status='active' AND c.status='active' ORDER BY c.id FOR SHARE OF c`;
    await tx.$queryRaw`SELECT p."tenantId" FROM "SecurityPolicy" p JOIN "Membership" m ON m."tenantId"=p."tenantId"
      WHERE m."userId"=${userId} AND m.status='active' ORDER BY p."tenantId" FOR SHARE OF p`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    scope?.lockedUsers.add(userId);
  }
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (validate && (!user || user.status !== "active" || !user.emailVerified))
    fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
  return user;
}
export async function withAuthTransaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
  const scope = authMutationScope.getStore(), credential = credentialScope.getStore();
  try {
    const client = scope?.client ?? credential?.client;
    return client ? await operation(client) : await db.$transaction(operation, { timeout: 15000 });
  } catch (error) {
    // Some maintained endpoints catch persistence errors and still return 200.
    // Preserve the fault across that catch so the outer request cannot commit.
    if (scope && !(error instanceof APIError)) scope.failed = true;
    throw error;
  }
}
export async function authAudit(tx: Transaction, userId: string, tenantId: string | null, action: string,
  resource: string, resourceId: string, changedFields: string[] = [], count?: number) {
  const scope = authMutationScope.getStore();
  if (scope) { scope.changed = true; scope.actorId ??= userId; scope.tenantId ??= tenantId; }
  try {
    await audit(tx, { tenantId, user: { id: userId } }, scope?.requestId ?? credentialScope.getStore()?.requestId ?? randomUUID(), action,
      resource, resourceId, changedFields, undefined, count === undefined ? undefined : { count });
  } catch (error) { if (scope) scope.failed = true; throw error; }
}

export async function authRequestAudit(tx: Transaction, action: string, resource = "authentication", resourceId?: string, actorId: string | null = null) {
  const scope = authMutationScope.getStore();
  // An anonymous request is not proof of the target account's identity.
  // Queueing verification on a rejected unverified login is intentional and
  // must not mark that response as a partially completed credential change.
  try { await audit(tx, { tenantId: null, user: { id: actorId } }, scope?.requestId ?? randomUUID(), action, resource, resourceId); }
  catch (error) { if (scope) scope.failed = true; throw error; }
}

export async function enqueueAuthMail(userId: string, mail: Parameters<typeof enqueueMail>[0], action: string) {
  return withAuthTransaction(async tx => {
    const scope = authMutationScope.getStore();
    if (!scope) throw new APIError("FORBIDDEN", { message: "인증 요청을 확인할 수 없습니다." });
    const user = await lockAuthUser(tx, userId);
    if (!user || user.status !== "active") {
      // Preserve the generic public reply while removing only proofs created
      // by this request, never an older proof belonging to another request.
      if (scope.createdResetProofs.size) await tx.verification.deleteMany({ where: { id: { in: [...scope.createdResetProofs] } } });
      return;
    }
    // This callback's recipient comes from the validated signed MFA challenge,
    // rather than an anonymous email field in a public recovery request.
    if (action === "auth.factor_code_queued") scope.actorId ??= userId;
    const job = await enqueueMail(mail, randomUUID(), tx);
    await authRequestAudit(tx, action, "job", job.id, scope.actorId);
  });
}

export async function removeAuthSessions(tx: Transaction, where: Prisma.SessionWhereInput) {
  const initial = await tx.session.findMany({ where, select: { userId: true }, distinct: ["userId"] });
  for (const id of initial.map(row => row.userId).sort()) await lockAuthUser(tx, id);
  const rows = await tx.session.findMany({ where, select: { id: true, userId: true, activeCompanyId: true }, orderBy: { id: "asc" } });
  for (const row of rows) await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${row.id} FOR UPDATE`;
  if (!rows.length) return 0;
  const deleted = await tx.session.deleteMany({ where: { AND: [where, { id: { in: rows.map(row => row.id) } }] } });
  if (deleted.count !== rows.length) throw new Error("Session deletion changed concurrently");
  for (const row of rows) await authAudit(tx, row.userId, row.activeCompanyId, "session.ended", "session", row.id);
  return deleted.count;
}

export async function expireAuthSession(id: string, minutes: number) {
  return withAuthTransaction(async tx => {
    const initial = await tx.session.findUnique({ where: { id } });
    if (!initial) return true;
    await lockAuthUser(tx, initial.userId);
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${id} FOR UPDATE`;
    const current = await tx.session.findUnique({ where: { id } });
    if (!current) return true;
    if (current.expiresAt.getTime() > Date.now() && Date.now() - current.updatedAt.getTime() <= minutes * 60000) return false;
    await removeAuthSessions(tx, { id });
    return true;
  });
}

export function guardAuthMutations(handler: (request: Request) => Promise<Response>, lookup: SessionLookup) {
  const guarded = route(async (request, requestId) => {
    const path = new URL(request.url).pathname, operation = factorOperation(path), logout = path.endsWith("/sign-out");
    let initial: SessionSnapshot | null = null;
    if (!publicPaths.includes(path)) {
      try { initial = await lookup(request.headers); }
      catch (error) { if (!(error instanceof APIError) || error.statusCode !== 401) throw error; }
    }
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$queryRaw`SELECT set_config('app.auth_request_id', ${requestId}, true)`;
        const state: AuthMutationScope = { client: tx, requestId, path, actorId: initial?.user.id ?? null,
          tenantId: initial?.session.activeCompanyId ?? null, lockedUsers: new Set(), changed: false, failed: false,
          proofDeadline: null, createdResetProofs: new Set() };
        return authMutationScope.run(state, async () => {
          let deadline: Date | null = null;
          if (initial) {
            await lockAuthUser(tx, initial.user.id, !logout);
            await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${initial.session.id} AND "userId"=${initial.user.id} FOR UPDATE`;
            const current = await tx.session.findFirst({ where: { id: initial.session.id, userId: initial.user.id } });
            if (!current && !logout) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
            if (current && !logout) {
              const policy = current.activeCompanyId && await tx.securityPolicy.findUnique({ where: { tenantId: current.activeCompanyId } });
              deadline = new Date(Math.min(current.expiresAt.getTime(), policy ? current.updatedAt.getTime() + policy.sessionMinutes * 60000 : Infinity));
              assertFileDeadlines({ session: deadline, expert: null, password: null });
            }
          }
          const response = await handler(request);
          if (state.failed) fail(500, "AUTH_PERSISTENCE_FAILED", "인증 변경을 저장하지 못했습니다. 다시 시도해주세요.");
          const location = response.headers.get("location");
          const confirmedRedirect = path.endsWith("/verify-email") && [302, 303].includes(response.status) && location
            && !new URL(location, request.url).searchParams.has("error");
          const succeeded = response.ok || !!confirmedRedirect;
          // Incorrect factor codes must retain the library's attempt counters.
          // A failed response after a successful business write must roll back.
          if (response.status >= 500 || !succeeded && state.changed) {
            const headers = new Headers(response.headers); headers.delete("set-cookie");
            throw new AuthRollback(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
          }
          if (operation && factorActions[operation] && state.actorId) {
            await authAudit(tx, state.actorId, state.tenantId,
              succeeded ? factorActions[operation] : "auth.factor_rejected", "user", state.actorId);
          }
          if (path.endsWith("/sign-in/email")) {
            if (succeeded && state.actorId && (await response.clone().json()).twoFactorRedirect === true)
              await authAudit(tx, state.actorId, state.tenantId, "auth.factor_challenged", "user", state.actorId);
            if ([401, 403].includes(response.status)) await authRequestAudit(tx, "auth.login_rejected");
          }
          const publicAction = path.endsWith("/sign-up/email") ? "registration" : path.endsWith("/request-password-reset") ? "password_reset"
            : path.endsWith("/send-verification-email") ? "verification" : path.endsWith("/verify-email") ? "email_verification" : null;
          if (publicAction && (succeeded || path.endsWith("/verify-email")))
            await authRequestAudit(tx, "auth." + publicAction + (succeeded ? "_requested" : "_rejected"), "authentication", undefined, succeeded ? state.actorId : null);
          if (succeeded && state.proofDeadline && state.proofDeadline.getTime() <= Date.now())
            fail(401, "AUTH_PROOF_EXPIRED", "인증 링크나 코드가 만료되었습니다. 다시 요청해주세요.");
          if (deadline) assertFileDeadlines({ session: deadline, expert: null, password: null });
          return response;
        });
      }, { timeout: 30000, maxWait: 5000 });
    } catch (error) { if (error instanceof AuthRollback) return error.response; throw error; }
  });
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    const supported = publicPaths.includes(path) || ["/sign-out", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions"].some(p => path === "/api/v1/auth" + p)
      || !!factorActions[factorOperation(path) ?? ""];
    return request.method === "POST" && supported || request.method === "GET" && path === "/api/v1/auth/verify-email" ? guarded(request) : handler(request);
  };
}
