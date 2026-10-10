import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const scripts = [
  "scripts/qa-rea-management.ts",
  "scripts/qa-rea-access-requests.ts",
] as const;

test("R03-T04 재시작 수용 스크립트는 로컬 로그인 버킷만 명시적으로 초기화한다", async () => {
  for (const path of scripts) {
    const source = await readFile(path, "utf8");
    expect(source, path).toContain('process.argv.includes("--reset-auth-rate-limit")');
    expect(source, path).toContain(
      'deleteMany({ where: { key: "127.0.0.1|/sign-in/email" } })',
    );
    expect(source, path).not.toMatch(/rateLimit\.deleteMany\(\s*\)/);
  }
});

