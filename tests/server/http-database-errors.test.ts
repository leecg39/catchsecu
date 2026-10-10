import { afterAll, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { route } from "@/server/http";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
afterAll(() => db.$disconnect());

test.each([
  ["23514", "DATA_CONFLICT"],
  ["0A000", "TRANSACTION_UNSUPPORTED"],
  ["40001", "CONCURRENT_CHANGE"],
  ["40P01", "CONCURRENT_CHANGE"],
  ["55P03", "CONCURRENT_CHANGE"],
])("actual PostgreSQL %s becomes a safe 409 at the HTTP boundary", async (state, expectedCode) => {
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const handler = route(async () => {
      await db.$executeRawUnsafe(`DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '${state}', MESSAGE = 'private constraint detail'; END $$`);
      return Response.json({ impossible: true });
    });
    const response = await handler(new Request(env.BETTER_AUTH_URL + "/test-database-error"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(expectedCode);
    expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
    expect(JSON.stringify(body)).not.toContain("private constraint detail");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(logging).not.toHaveBeenCalled();
  } finally { logging.mockRestore(); }
});

test("unknown SQL error remains a redacted server failure", async () => {
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const handler = route(async () => {
      await db.$executeRawUnsafe("DO $$ BEGIN RAISE EXCEPTION 'private unrecognized failure'; END $$");
      return Response.json({ impossible: true });
    });
    const response = await handler(new Request(env.BETTER_AUTH_URL + "/test-database-error"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("private unrecognized failure");
    expect(logging).toHaveBeenCalledOnce();
  } finally { logging.mockRestore(); }
});
