import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
import { env } from "./env";
import { fail } from "./http";
import { MAX_FILE_BYTES } from "@/contracts/files";
import { MAX_PRIVATE_OBJECT_BYTES } from "@/contracts/storage-limits";

function unavailable(): never { fail(503, "FILE_SCANNER_UNAVAILABLE", "파일 검사 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요."); }
async function command(bytes: Buffer, timeout = 20000) {
  const path = env.CLAMAV_SOCKET;
  if (!path || !isAbsolute(path) || Buffer.byteLength(path) > 103) unavailable();
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ path }), chunks: Buffer[] = []; let size = 0, settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return; settled = true; socket.destroy();
      if (error) reject(error); else resolve(value!);
    };
    socket.setTimeout(timeout, () => finish(new Error("Scanner timeout")));
    socket.on("error", () => finish(new Error("Scanner connection failed")));
    socket.on("close", () => { if (!settled) finish(new Error("Scanner closed without a response")); });
    socket.on("connect", () => socket.write(bytes));
    socket.on("data", chunk => {
      size += chunk.length; if (size > 4096) { finish(new Error("Scanner response too large")); return; }
      chunks.push(chunk); const response = Buffer.concat(chunks), end = response.indexOf(0);
      if (end !== -1) finish(undefined, response.subarray(0, end).toString("utf8"));
    });
  });
}
export async function requireFileScanner() {
  let version: string;
  try { version = await command(Buffer.from("zVERSION\0"), 2500); } catch { unavailable(); }
  const match = /^ClamAV ([^/\r\n]+)\/(\d+)\/(.+)$/.exec(version!);
  if (!match) unavailable();
  // The supplied daemon launcher uses TZ=UTC; clamd's VERSION date has no timezone.
  const updatedAt = Date.parse(match[3] + " UTC"), age = Date.now() - updatedAt;
  if (!Number.isFinite(updatedAt) || age < -3600000 || age > env.CLAMAV_MAX_SIGNATURE_AGE_HOURS * 3600000)
    fail(503, "FILE_SCANNER_OUTDATED", "파일 검사 데이터가 최신 상태가 아닙니다. 관리자에게 문의해주세요.");
  return { engine: version!.slice(0, 200), signatureUpdatedAt: new Date(updatedAt) };
}
export async function scanFile(bytes: Buffer, maxBytes = MAX_FILE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRIVATE_OBJECT_BYTES) throw new Error("Invalid trusted scan byte limit");
  if (!bytes.length || bytes.length > maxBytes) fail(413, "FILE_TOO_LARGE", "파일 크기 제한을 초과했습니다.");
  const scanner = await requireFileScanner(), length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  let reply: string;
  try { reply = await command(Buffer.concat([Buffer.from("zINSTREAM\0"), length, bytes, Buffer.alloc(4)])); } catch { unavailable(); }
  if (reply! === "stream: OK") return { clean: true, ...scanner };
  if (/^stream: .+ FOUND$/.test(reply!)) return { clean: false, ...scanner };
  unavailable();
}
