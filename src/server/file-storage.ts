import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink, chmod } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { env } from "./env";
import { MAX_FILE_BYTES } from "@/contracts/files";

const magic = Buffer.from("CSF1");
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "hex");
export interface PrivateFileStorage {
  write(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
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
function objectPath(path: string, name: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name)) throw new Error("Invalid storage key");
  return join(path, name + ".enc");
}
export const privateFiles: PrivateFileStorage = {
  async write(name, bytes) {
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("Invalid file size");
    const path = await directory(), target = objectPath(path, name), temp = objectPath(path, randomUUID());
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(name));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted])); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temp, target); }
    catch (error) { await unlink(temp).catch(() => {}); throw error; }
  },
  async read(name) {
    const file = await open(objectPath(await directory(), name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 33 || stat.size > MAX_FILE_BYTES + 32) throw new Error("Invalid encrypted file");
      const data = await file.readFile();
      if (!data.subarray(0, 4).equals(magic)) throw new Error("Invalid encrypted file");
      const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
      decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(data.subarray(16, 32));
      return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
    } finally { await file.close(); }
  },
  async remove(name) {
    try { await unlink(objectPath(await directory(), name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  },
};
