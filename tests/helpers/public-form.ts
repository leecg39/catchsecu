import { publicForm } from "@/server/submissions";
import { resolveFixedUrl } from "@/server/fixed-urls";

export async function activePublicForm(token: string) {
  const result = await publicForm(token);
  if (result.closed) throw new Error("Expected an active public form fixture");
  return result;
}

export async function activeFixedUrl(slug: string) {
  const result = await resolveFixedUrl(slug);
  if (result.closed) throw new Error("Expected an active fixed URL fixture");
  return result;
}
