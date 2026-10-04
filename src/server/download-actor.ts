import type { Context, requireActor } from "./context";
import type { Transaction } from "./db";
import { lockAccountActor } from "./account-actor";
import { lockServiceActor } from "./service-actor";
import { fail } from "./http";

export type DownloadActor = Awaited<ReturnType<typeof requireActor>> & { context?: Context };

export async function lockDownloadActor(tx: Transaction, actor: DownloadActor, companyRequired = false) {
  // Company locks precede account/session locks, as in protected business APIs.
  const company = companyRequired && actor.context ? await lockServiceActor(tx, actor.context, "service.read") : null;
  const current = await lockAccountActor(tx, actor);
  if (companyRequired && !current.user.platformAdmin && !company)
    fail(403, "COMPANY_REQUIRED", "소속된 회사가 없습니다. 회사를 등록하거나 초대를 수락해주세요.");
  return { ...current, deadlines: company?.deadlines ?? current.deadlines };
}
