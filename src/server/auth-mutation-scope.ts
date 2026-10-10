import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@/generated/prisma/client";

export type AuthMutationScope = {
  client: Prisma.TransactionClient; requestId: string; path: string;
  actorId: string | null; tenantId: string | null; lockedUsers: Set<string>;
  changed: boolean; failed: boolean;
  proofDeadline: Date | null; createdResetProofs: Set<string>;
  ssoMfa?: import("./sso-mfa").SsoMfaAuthorization;
  rotatedSsoProof?: { source: import("./sso-session-proof").SsoProofSource; activeCompanyId: string | null };
};
export const authMutationScope = new AsyncLocalStorage<AuthMutationScope>();
