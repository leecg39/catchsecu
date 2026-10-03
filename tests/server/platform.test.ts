import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import { GET as ready } from "@/app/api/v1/ready/route";
import { route } from "@/server/http";

describe("platform gate", () => {
  test("readiness follows applied migrations and error logs omit messages", async () => {
    const response = await ready(new Request("http://localhost/api/v1/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => { lines.push(String(line)); };
    try {
      const failed = await route(async () => { throw new Error("person@example.com token-secret"); })(new Request("http://localhost/api/v1/health"));
      expect(failed.status).toBe(500);
      expect(failed.headers.get("x-request-id")).toBeTruthy();
      const log = lines.join("\n");
      expect(log).not.toContain("person@example.com");
      expect(log).not.toContain("token-secret");
      expect(log).toContain("INTERNAL_ERROR");
    } finally { console.error = original; }
  });

  test("missing required environment names the field and not a planted secret", async () => {
    const canary = "canary-secret-value-should-not-appear";
    const result = await new Promise<{ code: number; output: string }>(resolve => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/load-env.ts"], {
        env: { PATH: process.env.PATH ?? "", CANARY: canary, NODE_ENV: "test" } as NodeJS.ProcessEnv,
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.on("close", code => resolve({ code: code ?? 1, output }));
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("DATABASE_URL");
    expect(result.output).not.toContain(canary);
  });
});
