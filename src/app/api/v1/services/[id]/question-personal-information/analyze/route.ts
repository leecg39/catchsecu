import { z } from "zod";
import { nlpAnalyzeInput } from "@/contracts/question-nlp";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { analyzePersonalInformation } from "@/server/question-nlp";

function serviceId(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/")[4]); }
export const POST = route(async request => {
  const id = serviceId(request);
  const ctx = await requireContext(request.headers, "form.write");
  return json(await analyzePersonalInformation(ctx, id, await body(request, nlpAnalyzeInput)));
});
