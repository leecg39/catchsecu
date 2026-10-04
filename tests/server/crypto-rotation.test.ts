import { describe, expect, it, vi } from "vitest";

const KEY_A = "a".repeat(64), KEY_B = "b".repeat(64), LOOKUP = "c".repeat(64);
const snapshot = { ...process.env };
async function cryptoWith(extra: Record<string, string | undefined>) {
  Object.assign(process.env, snapshot, extra);
  for (const key of ["DATA_ENCRYPTION_KEY", "DATA_ENCRYPTION_KEY_PREVIOUS", "DATA_LOOKUP_KEY"])
    if (extra[key] === undefined && !(key in snapshot)) delete process.env[key];
  vi.resetModules();
  return await import("@/server/crypto");
}

describe("데이터 키 회전", () => {
  it("이전 키로 만든 암호문을 현재 키+이전 키 조합으로 복호한다", async () => {
    const oldCrypto = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A, DATA_ENCRYPTION_KEY_PREVIOUS: undefined, DATA_LOOKUP_KEY: undefined });
    const sealed = oldCrypto.encrypt({ secret: "이전 키 데이터" });
    const rotated = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_B, DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A });
    expect(rotated.decrypt(sealed)).toEqual({ secret: "이전 키 데이터" });
    // 재암호화 결과는 현재 키만으로 열린다.
    const fresh = rotated.reencrypt(sealed);
    expect(fresh).not.toBe(sealed);
    const onlyNew = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_B, DATA_ENCRYPTION_KEY_PREVIOUS: undefined });
    expect(onlyNew.decrypt(fresh)).toEqual({ secret: "이전 키 데이터" });
  });
  it("이전 키 없이는 구 암호문 복호가 실패하고, 변조는 어느 키로도 거부된다", async () => {
    const oldCrypto = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A });
    const sealed = oldCrypto.encrypt({ v: 1 });
    const rotated = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_B, DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A });
    const tampered = sealed.slice(0, -4) + "AAAA";
    await expect(async () => rotated.decrypt(tampered)).rejects.toThrow();
    const onlyNew = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_B });
    await expect(async () => onlyNew.decrypt(sealed)).rejects.toThrow();
    await expect(async () => rotated.decrypt("v2.xx.yy.zz")).rejects.toThrow("형식");
  });
  it("조회 해시는 DATA_LOOKUP_KEY 고정으로 암호화 키 회전과 무관하게 유지된다", async () => {
    const before = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A, DATA_LOOKUP_KEY: LOOKUP });
    const digest = before.tokenHash("subject:email:viewer@example.test");
    const after = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_B, DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A, DATA_LOOKUP_KEY: LOOKUP });
    expect(after.tokenHash("subject:email:viewer@example.test")).toBe(digest);
    // DATA_LOOKUP_KEY 미지정 시 암호화 키를 그대로 사용해 기존 데이터와 호환된다.
    const legacy = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A, DATA_LOOKUP_KEY: undefined });
    const pinned = await cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A, DATA_LOOKUP_KEY: KEY_A });
    expect(legacy.tokenHash("subject:email:viewer@example.test")).toBe(pinned.tokenHash("subject:email:viewer@example.test"));
  });
  it("이전 키가 현재 키와 같으면 부팅을 거부한다", async () => {
    await expect(cryptoWith({ DATA_ENCRYPTION_KEY: KEY_A, DATA_ENCRYPTION_KEY_PREVIOUS: KEY_A })).rejects.toThrow();
  });
});
