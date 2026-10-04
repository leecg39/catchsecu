import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { env } from "./env";
import { db } from "./db";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new HttpError(status, code, message); }
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail(415, "CONTENT_TYPE", "JSON 형식으로 요청해주세요.");
  if (Number(request.headers.get("content-length") || 0) > 1000000) fail(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_JSON", "입력 내용이 없습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 1000000) { await reader.cancel(); fail(413, "BODY_TOO_LARGE", "요청이 너무 큽니다."); }
    chunks.push(chunk.value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "INVALID_JSON", "JSON 형식을 확인해주세요."); }
  return schema.parse(value);
}
export function requireVersion(input: { version: number }, current: { version: number }) {
  if (input.version !== current.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
}
export async function rateLimit(key: string, limit = 60, seconds = 60) {
  const result = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "ApiRateLimit" (key, count, "resetAt")
    VALUES (${key}, 1, now() + ${seconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "ApiRateLimit"."resetAt" < now() THEN 1 ELSE "ApiRateLimit".count + 1 END,
      "resetAt" = CASE WHEN "ApiRateLimit"."resetAt" < now() THEN now() + ${seconds} * interval '1 second' ELSE "ApiRateLimit"."resetAt" END
    RETURNING count`;
  if (result[0].count > limit) fail(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
}
type Handler = (request: Request, requestId: string) => Promise<Response>;
/** Only cookie-independent endpoints that verify their own cryptographic credential may bypass Origin. */
export function route(handler: Handler, externalAuthentication?: "signed-webhook" | "unsubscribe-token" | "saml-assertion") {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (!externalAuthentication && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        if (request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) fail(403, "ORIGIN_REJECTED", "요청 출처를 확인할 수 없습니다.");
      }
      const response = await handler(request, requestId);
      response.headers.set("X-Request-Id", requestId);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      let status = 500, code = "INTERNAL_ERROR", message = "요청을 처리하지 못했습니다.", fieldErrors;
      if (error instanceof HttpError) ({ status, code, message } = error);
      else if (error instanceof z.ZodError) {
        status = 422; code = "VALIDATION_ERROR"; message = "입력 내용을 확인해주세요.";
        fieldErrors = error.flatten().fieldErrors;
      } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") { status = 409; code = "ALREADY_EXISTS"; message = "이미 등록된 값입니다."; }
        if (["P2003", "P2014"].includes(error.code)) { status = 409; code = "RESOURCE_IN_USE"; message = "연결된 데이터가 있어 처리할 수 없습니다."; }
        if (error.code === "P2025") { status = 404; code = "NOT_FOUND"; message = "항목을 찾을 수 없습니다."; }
        if (error.code === "P2034") { status = 409; code = "CONCURRENT_CHANGE"; message = "동시 변경이 발생했습니다. 다시 시도해주세요."; }
      }
      if (status === 500) console.error(JSON.stringify({ requestId, code, kind: error instanceof Error ? error.name : "UnknownError" }));
      return Response.json({ error: { code, message, fieldErrors, requestId } }, {
        status, headers: { "X-Request-Id": requestId, "Cache-Control": "private, no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    }
  };
}
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).default(""),
  sort: z.enum(["createdAt", "name"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
