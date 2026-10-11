import { z } from "zod";
import { nlpFeedbackInput } from "@/contracts/question-nlp";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { recordPersonalInformationFeedback } from "@/server/question-nlp";

function serviceId(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/")[4]); }
export const POST = route(async (request, requestId) => {
  const id = serviceId(request);
  const ctx = await requireContext(request.headers, "form.write");
  return json(await recordPersonalInformationFeedback(ctx, id, await body(request, nlpFeedbackInput), requestId));
});
