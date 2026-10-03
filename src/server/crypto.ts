import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "hex");
export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), content.toString("base64url")].join(".");
}
export function decrypt<T>(value: string): T {
  const [version, iv, tag, content] = value.split(".");
  if (version !== "v1" || !iv || !tag || !content) throw new Error("암호화 데이터 형식 오류");
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(content, "base64url")), cipher.final()]).toString("utf8")) as T;
}
export function tokenHash(value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}
export function opaqueToken() { return randomBytes(32).toString("base64url"); }
