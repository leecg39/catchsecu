import { z } from "zod";
import { fail, json, route } from "@/server/http";
import { confirmUnsubscribe, limitedEmailBody, readUnsubscribe } from "@/server/email-feedback";
import { unsubscribeJobId, unsubscribeUrl } from "@/server/email-policy";
const token = (request: Request) => new URL(request.url).pathname.split("/").at(-1)!;
export const GET = route(async request => {
  const value = await readUnsubscribe(token(request));
  if (new URL(request.url).searchParams.get("confirmPage") === "1") return new Response(null, { status: 302, headers: { Location: unsubscribeUrl(unsubscribeJobId(token(request))) } });
  return json(value);
}, "unsubscribe-token");
export const POST = route(async (request, requestId) => {
  const type = request.headers.get("content-type")?.split(";")[0].trim(), raw = await limitedEmailBody(request, 4096);
  if (type === "application/x-www-form-urlencoded") {
    const values = new URLSearchParams(raw.toString("utf8"));
    if ([...values].length !== 1 || values.get("List-Unsubscribe") !== "One-Click") fail(422, "UNSUBSCRIBE_CONFIRM_REQUIRED", "수신거부를 확인해주세요.");
  } else if (type === "multipart/form-data") {
    let form: FormData; try { form = await new Response(raw, { headers: { "content-type": request.headers.get("content-type")! } }).formData(); } catch { fail(400, "INVALID_FORM", "양식을 확인해주세요."); }
    if ([...form].length !== 1 || form.get("List-Unsubscribe") !== "One-Click") fail(422, "UNSUBSCRIBE_CONFIRM_REQUIRED", "수신거부를 확인해주세요.");
  } else if (type === "application/json") {
    let data: unknown; try { data = JSON.parse(raw.toString("utf8")); } catch { fail(400, "INVALID_JSON", "JSON 형식을 확인해주세요."); }
    z.object({ confirm: z.literal(true) }).strict().parse(data);
  } else fail(415, "CONTENT_TYPE", "수신거부 확인 양식이 필요합니다.");
  return json(await confirmUnsubscribe(token(request), requestId));
}, "unsubscribe-token");
