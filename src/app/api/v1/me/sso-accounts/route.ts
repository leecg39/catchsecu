import { requireSsoRecoveryContext } from "@/server/context";
import { json, route } from "@/server/http";
import { listOwnSsoAccounts } from "@/server/sso-accounts";
export const GET = route(async request => json(await listOwnSsoAccounts(await requireSsoRecoveryContext(request.headers))));
