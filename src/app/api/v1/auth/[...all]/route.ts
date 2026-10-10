import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { publishRouteTrace } from "@/server/route-trace";
export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
const traced = (handler: (request: Request) => Promise<Response>) => async (request: Request) => {
  try {
    const response = await handler(request);
    publishRouteTrace(request, response.status);
    return response;
  } catch (error) {
    publishRouteTrace(request, 500);
    throw error;
  }
};
export const GET = traced(handlers.GET);
export const POST = traced(handlers.POST);
