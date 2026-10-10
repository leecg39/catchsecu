import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink, chmod } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { env } from "./env";
import { MAX_ENCRYPTED_OBJECT_BYTES, MAX_PRIVATE_OBJECT_BYTES } from "@/contracts/storage-limits";

const magic = Buffer.from("CSF1");
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "hex");
const storageKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface PrivateFileStorage {
  write(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function storageObjectName(name: string) {
  if (name.includes("/") || name.includes("\\") || name.includes("..") || !storageKey.test(name)) throw new Error("Invalid storage key");
  return name + ".enc";
}
export function encryptStoredObject(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PRIVATE_OBJECT_BYTES) throw new Error("Invalid file size");
  storageObjectName(name);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptStoredObject(name: string, data: Buffer) {
  storageObjectName(name);
  if (data.length < 33 || data.length > MAX_ENCRYPTED_OBJECT_BYTES || !data.subarray(0, 4).equals(magic)) throw new Error("Invalid encrypted file");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
}
const root = () => resolve(env.PRIVATE_STORAGE_DIR, "objects");
async function directory() {
  const path = root();
  if (resolve(env.PRIVATE_STORAGE_DIR) === resolve("public") || resolve(env.PRIVATE_STORAGE_DIR).startsWith(resolve("public") + "/"))
    throw new Error("Private storage must be outside the public directory");
  // Refuse symlinks in every existing ancestor, including the configured root.
  let ancestor = path;
  while (true) {
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error("Storage symlink rejected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}
function objectPath(path: string, name: string) { return join(path, storageObjectName(name)); }
const localFiles: PrivateFileStorage = {
  async write(name, bytes) {
    const path = await directory(), target = objectPath(path, name), temp = objectPath(path, randomUUID()), encrypted = encryptStoredObject(name, bytes);
    const file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(encrypted); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temp, target); }
    catch (error) { await unlink(temp).catch(() => {}); throw error; }
  },
  async read(name) {
    const file = await open(objectPath(await directory(), name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("Invalid encrypted file");
      return decryptStoredObject(name, await file.readFile());
    } finally { await file.close(); }
  },
  async remove(name) {
    try { await unlink(objectPath(await directory(), name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  },
};
let selected: PrivateFileStorage | undefined;
async function storage() {
  if (selected) return selected;
  if (env.FILE_STORAGE === "local") return selected = localFiles;
  const { createS3FileStorage } = await import("./s3-storage");
  return selected = createS3FileStorage({
    endpoint: env.S3_ENDPOINT!, region: env.S3_REGION, bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  });
}
export const privateFiles: PrivateFileStorage = {
  async write(name, bytes) { return (await storage()).write(name, bytes); },
  async read(name) { return (await storage()).read(name); },
  async remove(name) { return (await storage()).remove(name); },
};
