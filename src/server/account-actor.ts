import type { requireActor } from "./context";
import type { Transaction } from "./db";
import { fail } from "./http";

// Company-independent actions (invitations and platform administration) still
// need the live account and session, not the request's authentication snapshot.
export async function lockAccountActor(tx: Transaction, actor: Awaited<ReturnType<typeof requireActor>>) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.user.id} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.user.id } });
  if (!user || user.status !== "active" || !user.emailVerified)
    fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${actor.session.id} AND "userId"=${actor.user.id} FOR SHARE`;
  const session = await tx.session.findFirst({ where: { id: actor.session.id, userId: user.id } });
  if (!session || session.expiresAt <= new Date())
    fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  return { user, session, deadlines: { session: session.expiresAt, expert: null, password: null } };
}
