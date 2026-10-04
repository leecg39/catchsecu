import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { legacyImportInput } from "@/contracts/migration";
import { migrateLegacy } from "@/server/legacy-migration";
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers);
  const input = await body(request, legacyImportInput);
  return json(await migrateLegacy(ctx, input, requestId));
});
