import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authMutationScope } from "./auth-mutation-scope";
import { authAudit, lockAuthUser, removeAuthSessions, withAuthTransaction } from "./auth-mutations";
import { db, outsideAuthTransaction } from "./db";

export function auditedAuthAdapter(options: BetterAuthOptions) {
  const adapter = prismaAdapter(db, { provider: "postgresql" })(options);
  // CAS operations can open their own transaction. Leave both request scopes
  // around the entire rate-limit operation, including that transaction.
  const base = new Proxy(adapter, { get(target, property) {
    const method = Reflect.get(target, property);
    if (typeof method !== "function") return method;
    return (...args: unknown[]) => (args[0] as { model?: string } | undefined)?.model === "rateLimit"
      ? outsideAuthTransaction(() => method.apply(target, args)) : method.apply(target, args);
  } });
  const factorWrite = (fields: object) => ["secret", "backupCodes", "verified"].some(field => field in fields);
  function requestScope() {
    const current = authMutationScope.getStore();
    if (!current) throw new APIError("FORBIDDEN", { message: "인증 요청을 확인할 수 없습니다." });
    return current;
  }
  function proofDeadline(found: unknown, consumed = false) {
    const scope = authMutationScope.getStore();
    if (!scope || !found || typeof found !== "object" || !("expiresAt" in found)) return;
    const date = new Date(found.expiresAt as string | Date);
    if (!(scope.path === "/api/v1/auth/sign-in/email" || scope.path === "/api/v1/auth/two-factor/send-otp" || scope.path.startsWith("/api/v1/auth/two-factor/verify-"))) return;
    if (Number.isFinite(date.getTime()) && (consumed || date.getTime() > Date.now()) && (!scope.proofDeadline || date < scope.proofDeadline)) scope.proofDeadline = date;
  }
  const findOne: typeof base.findOne = async <T>(input: Parameters<typeof base.findOne>[0]): Promise<T | null> => {
    let found = await base.findOne<T>(input);
    const scope = authMutationScope.getStore();
    if (scope && input.model === "verification") proofDeadline(found);
    if (scope && input.model === "twoFactor" && found) {
      const userId = (found as { userId?: unknown }).userId;
      if (typeof userId === "string") {
        // Pending MFA login has no session yet. Take the account lock before
        // factor CAS/counters so disabling MFA cannot deadlock with login.
        await lockAuthUser(scope.client, userId, true);
        scope.actorId ??= userId;
        found = await base.findOne<T>(input);
      }
    }
    return found;
  };
  const create: typeof base.create = async <T extends Record<string, unknown>, R = T>(input: {
    model: string; data: Omit<T, "id">; select?: string[]; forceAllowId?: boolean;
  }): Promise<R> => {
    if (input.model === "user" || input.model === "verification") {
      const scope = requestScope();
      if (input.model === "user" && scope.path !== "/api/v1/auth/sign-up/email")
        throw new APIError("FORBIDDEN", { message: "회원가입 화면을 사용해주세요." });
      const created = await base.create<T, R & { id: string }>({ ...input,
        ...(input.select ? { select: [...new Set([...input.select, "id"])] } : {}) });
      if (input.model === "user") await authAudit(scope.client, created.id, null, "auth.account_registered", "user", created.id, ["name", "email"]);
      if (input.model === "verification" && scope.path === "/api/v1/auth/request-password-reset") {
        scope.createdResetProofs.add(created.id); scope.changed = true;
      }
      if (input.select && !input.select.includes("id")) { const selected = { ...created }; delete (selected as { id?: string }).id; return selected as R; }
      return created;
    }
    if (input.model === "twoFactor") {
      const scope = requestScope(); scope.changed = true;
      return base.create<T, R>(input);
    }
    if (input.model !== "session") return base.create<T, R>(input);
    return withAuthTransaction(async tx => {
      const userId = input.data.userId;
      if (typeof userId !== "string") throw new Error("Session user is required");
      await lockAuthUser(tx, userId);
      if (!await tx.user.findFirst({ where: { id: userId, status: "active", emailVerified: true } }))
        throw new APIError("FORBIDDEN", { message: "사용할 수 없는 계정입니다." });
      // Better Auth's after hooks can run after a transaction commits. Put the
      // session and its event inside the adapter's actual database operation.
      const created = await prismaAdapter(tx, { provider: "postgresql" })(options).create<T, R & { id: string }>({ ...input,
        ...(input.select ? { select: [...new Set([...input.select, "id"])] } : {}) });
      const id = (created as { id?: unknown }).id;
      if (typeof id !== "string") throw new Error("Created session ID is required");
      const session = await tx.session.findUniqueOrThrow({ where: { id } });
      await authAudit(tx, session.userId, session.activeCompanyId, "session.created", "session", session.id);
      if (input.select && !input.select.includes("id")) {
        const selected = { ...created }; delete (selected as { id?: string }).id;
        return selected as R;
      }
      return created;
    });
  };
  const update: typeof base.update = async <T>(input: Parameters<typeof base.update>[0]): Promise<T | null> => {
    if (input.model === "user" && "emailVerified" in input.update) {
      const scope = requestScope();
      if (scope.path !== "/api/v1/auth/verify-email" || input.update.emailVerified !== true)
        throw new APIError("FORBIDDEN", { message: "이메일 인증 링크를 사용해주세요." });
      return withAuthTransaction(async tx => {
        const adapter = prismaAdapter(tx, { provider: "postgresql" })(options);
        const prior = await adapter.findOne<{ id: string; emailVerified: boolean }>({ model: "user", where: input.where });
        if (!prior) return null;
        const current = await lockAuthUser(tx, prior.id);
        if (!current || current.status !== "active") throw new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "링크가 만료되었거나 사용할 수 없습니다." });
        const result = await adapter.update<T>(input);
        if (result && current.emailVerified !== true) await authAudit(tx, prior.id, null, "auth.email_verified", "user", prior.id, ["emailVerified"]);
        return result;
      });
    }
    if (input.model === "user" && "twoFactorEnabled" in input.update) {
      requestScope();
      return withAuthTransaction(async tx => {
        const adapter = prismaAdapter(tx, { provider: "postgresql" })(options);
        const prior = await adapter.findOne<{ id: string; twoFactorEnabled: boolean }>({ model: input.model, where: input.where });
        const result = await adapter.update<T>(input);
        if (prior && result && prior.twoFactorEnabled !== input.update.twoFactorEnabled)
          await authAudit(tx, prior.id, authMutationScope.getStore()?.tenantId ?? null,
            input.update.twoFactorEnabled ? "auth.mfa_enabled" : "auth.mfa_disabled", "user", prior.id, ["twoFactorEnabled"]);
        return result;
      });
    }
    const scope = input.model === "twoFactor" && factorWrite(input.update) ? requestScope() : null;
    const result = await base.update<T>(input);
    if (result && scope) scope.changed = true;
    return result;
  };
  const incrementOne: typeof base.incrementOne = async <T>(input: Parameters<typeof base.incrementOne>[0]): Promise<T | null> => {
    const scope = input.model === "twoFactor" && factorWrite(input.set ?? {}) ? requestScope() : null;
    const result = await base.incrementOne<T>(input);
    if (result && scope) scope.changed = true;
    return result;
  };
  const consumeOne: typeof base.consumeOne = async <T>(input: Parameters<typeof base.consumeOne>[0]): Promise<T | null> => {
    const result = await base.consumeOne<T>(input);
    if (input.model === "verification") proofDeadline(result, true);
    return result;
  };
  async function deleteSessions(input: Parameters<typeof base.deleteMany>[0]) {
    return withAuthTransaction(async tx => {
      const adapter = prismaAdapter(tx, { provider: "postgresql" })(options);
      // The adapter defaults can cap findMany. Explicit paging accounts for all
      // sessions in a bulk revocation rather than just the first page.
      async function matchingSessions() {
        const rows: { id: string; userId: string }[] = [];
        for (let offset = 0; ; offset += 1000) {
          const page = await adapter.findMany<{ id: string; userId: string }>({ ...input, select: ["id", "userId"], limit: 1000, offset, sortBy: { field: "id", direction: "asc" } });
          rows.push(...page); if (page.length < 1000) break;
        }
        return rows;
      }
      const prior = await matchingSessions();
      const userIds = new Set(prior.map(row => row.userId));
      for (const where of input.where ?? []) if (where.field === "userId" && (!where.operator || where.operator === "eq") && typeof where.value === "string") userIds.add(where.value);
      for (const userId of [...userIds].sort()) await lockAuthUser(tx, userId);
      // A login may finish while revocation waits for its account lock. Refresh
      // after the lock so that newly committed session is also revoked.
      const rows = await matchingSessions();
      return removeAuthSessions(tx, { id: { in: rows.map(row => row.id) } });
    });
  }
  const deleteOne: typeof base.delete = async input => {
    if (input.model === "session") { await deleteSessions(input); return; }
    if (input.model === "twoFactor") requestScope().changed = true;
    return base.delete(input);
  };
  const deleteMany: typeof base.deleteMany = async input => input.model === "session" ? deleteSessions(input) : base.deleteMany(input);
  const audited: typeof base = { ...base, findOne, create, update, incrementOne, consumeOne, delete: deleteOne, deleteMany,
    // Better Auth's as-is transaction otherwise substitutes the original
    // adapter and silently bypasses our create/update/consume overrides.
    transaction: callback => base.transaction(() => callback(audited)) };
  return audited;
}
