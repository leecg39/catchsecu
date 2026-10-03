import { requireActor } from "@/server/context";
import { accountClosureStatus, closeAccount } from "@/server/account-closure";
import { accountClosureInput } from "@/contracts/account-closure";
import { body, json, rateLimit, route } from "@/server/http";
export const GET = route(async request => json(await accountClosureStatus(await requireActor(request.headers))));
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  await rateLimit("account-closure:" + actor.user.id, 5);
  return json(await closeAccount(actor, await body(request, accountClosureInput), requestId));
});
