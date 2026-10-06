import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const providers = [
  { mode: "MAIL_TRANSPORT", remote: "smtp", flag: "ALLOW_LOCAL_MAIL" },
  { mode: "KAKAO_PROVIDER", remote: "unconfigured", flag: "ALLOW_LOCAL_KAKAO" },
  { mode: "PAYMENT_PROVIDER", remote: "webhook", flag: "ALLOW_LOCAL_PAYMENT" },
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/catchsecu_test");
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-secret-".repeat(3));
  vi.stubEnv("DATA_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("FILE_STORAGE", "local");
  for (const provider of providers) {
    vi.stubEnv(provider.mode, provider.remote);
    vi.stubEnv(provider.flag, undefined);
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe.each(providers)("$flag 운영 차단", ({ mode, flag }) => {
  test.each([undefined, "", "0", "false", "true", "yes", " 1", "1 "])(
    "명시적인 1 이외의 값(%s)은 로컬 공급자를 허용하지 않는다", async value => {
      vi.stubEnv(mode, "local");
      vi.stubEnv(flag, value);
      await expect(import("@/server/env")).rejects.toThrow(flag + "=1");
    },
  );
  test("명시적인 1은 로컬 미리보기를 허용한다", async () => {
    vi.stubEnv(mode, "local");
    vi.stubEnv(flag, "1");
    expect((await import("@/server/env")).env[mode]).toBe("local");
  });
  test("개발 환경에서는 허용 플래그 없이 로컬 공급자를 사용한다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(mode, "local");
    expect((await import("@/server/env")).env[mode]).toBe("local");
  });
});

test("서로 다른 공급자의 허용 플래그는 결제 차단을 해제하지 않는다", async () => {
  vi.stubEnv("PAYMENT_PROVIDER", "local");
  vi.stubEnv("ALLOW_LOCAL_MAIL", "1");
  vi.stubEnv("ALLOW_LOCAL_KAKAO", "1");
  await expect(import("@/server/env")).rejects.toThrow("ALLOW_LOCAL_PAYMENT=1");
});
