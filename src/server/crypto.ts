import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

// 키 분리: tokenHash 등 조회용 HMAC은 DATA_LOOKUP_KEY(미지정 시 암호화 키와 동일)로 고정해
// 저장된 해시·조인이 암호화 키 회전과 무관하게 유지된다. 암호문은 현재 키로만 생성하고,
// 복호는 현재 키 → DATA_ENCRYPTION_KEY_PREVIOUS 순으로 시도한다. 재암호화 배치 후 PREVIOUS 제거로 회전 완료.
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "hex");
const previous = env.DATA_ENCRYPTION_KEY_PREVIOUS ? Buffer.from(env.DATA_ENCRYPTION_KEY_PREVIOUS, "hex") : null;
if (previous && previous.equals(key)) throw new Error("이전 암호화 키가 현재 키와 같습니다. 회전하려면 다른 키를 사용하세요.");
const lookupKey = Buffer.from(env.DATA_LOOKUP_KEY ?? env.DATA_ENCRYPTION_KEY, "hex");

export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), content.toString("base64url")].join(".");
}
export function decrypt<T>(value: string): T {
  const [version, iv, tag, content] = value.split(".");
  if (version !== "v1" || !iv || !tag || !content) throw new Error("암호화 데이터 형식 오류");
  const attempt = (k: Buffer) => {
    const cipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(content, "base64url")), cipher.final()]).toString("utf8")) as T;
  };
  try { return attempt(key); }
  catch (error) {
    if (!previous) throw error;
    return attempt(previous);
  }
}
// 구키로 암호화된 값을 현재 키로 재암호화한다. 형식 오류·복호 실패는 그대로 예외.
export function reencrypt(value: string): string { return encrypt(decrypt(value)); }
export function tokenHash(value: string) {
  return createHmac("sha256", lookupKey).update(value).digest("hex");
}
export function opaqueToken() { return randomBytes(32).toString("base64url"); }
