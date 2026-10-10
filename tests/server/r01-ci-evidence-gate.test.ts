import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const scannerSuites = [
  "tests/server/files.test.ts",
  "tests/server/notices.test.ts",
  "tests/server/guides.test.ts",
];

describe("R01-T05 자동 검증 계약", () => {
  test("필수 CI 단계는 실패를 무시하지 않는다", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).not.toContain("continue-on-error");
    for (const command of [
      "npm ci",
      "npm run db:generate",
      "migrate deploy",
      "npm run typecheck",
      "npm run lint",
      "name: database tests",
      "name: scanner suite",
    ]) {
      expect(workflow).toContain(command);
    }
  });

  test("검사기 의존 테스트는 일반 DB 시험에서 제외하고 blocked로만 보고한다", async () => {
    const [workflow, blockedScript] = await Promise.all([
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile("scripts/ci-scanner-blocked.ts", "utf8"),
    ]);

    for (const file of scannerSuites) {
      expect(workflow).toContain(`--exclude ${file}`);
      expect(blockedScript).toContain(`\"${file}\"`);
    }
    expect(blockedScript).toMatch(/scanner:\s*"blocked"/);
    expect(blockedScript).toMatch(/countsAsPass:\s*false/);
    expect(blockedScript).not.toMatch(/countsAsPass:\s*true/);
  });

  test("사전 점검은 로컬 전용 DB만 허용하고 준비 실패를 종료 코드로 전달한다", async () => {
    const preflight = await readFile("scripts/qa-preflight.ts", "utf8");

    expect(preflight).toContain('["localhost", "127.0.0.1"]');
    expect(preflight).toContain("catchsecu_(dev|test|shadow)");
    expect(preflight).toContain("if (!ready) process.exitCode=1");
    expect(preflight).toContain("externalAcceptance: false");
  });
});
