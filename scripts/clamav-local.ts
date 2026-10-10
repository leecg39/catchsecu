import { mkdir, chmod, writeFile, access } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const taskRoot = process.cwd(), id = createHash("sha256").update(taskRoot).digest("hex").slice(0, 8);
const socketDir = join(homedir(), ".cache", "catchsecu-clamav", id), socket = join(socketDir, "clamd.sock");
const state = resolve(".local/clamav"), database = join(state, "database"), temp = join(state, "tmp");
const binaryRoot = resolve(process.env.CLAMAV_LOCAL_ROOT || ".local/tools/clamav");
async function configure() {
  for (const dir of [state, database, temp, socketDir]) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700); }
  const common = ["DatabaseDirectory " + database, "CVDCertsDirectory " + join(binaryRoot, "etc/certs")];
  const fresh = [...common, "DatabaseMirror database.clamav.net", "DatabaseOwner " + userInfo().username,
    "Foreground yes", "ConnectTimeout 15", "ReceiveTimeout 60", "MaxAttempts 2", "Checks 12", "LogTime yes"];
  const clamd = [...common, "LocalSocket " + socket, "LocalSocketMode 600", "FixStaleSocket yes", "Foreground yes",
    "TemporaryDirectory " + temp, "LogTime yes", "OfficialDatabaseOnly yes", "MaxThreads 4", "MaxQueue 20",
    "StreamMaxLength 15M", "MaxFileSize 15M", "MaxScanSize 32M", "AlertExceedsMax yes", "AlertEncrypted yes",
    "SelfCheck 60", "ExitOnOOM yes"];
  await writeFile(join(state, "freshclam.conf"), fresh.join("\n") + "\n", { mode: 0o600 });
  await writeFile(join(state, "clamd.conf"), clamd.join("\n") + "\n", { mode: 0o600 });
}
async function main() {
  await configure();
  const mode = process.argv[2] || "configure";
  if (mode === "configure") { console.log("CLAMAV_SOCKET=" + socket); return; }
  if (!["update", "updater", "serve"].includes(mode)) throw new Error("사용법: configure | update | updater | serve");
  const binary = join(binaryRoot, mode === "serve" ? "sbin/clamd" : "bin/freshclam");
  await access(binary);
  const args = ["--config-file=" + join(state, mode === "serve" ? "clamd.conf" : "freshclam.conf")];
  if (mode === "updater") args.push("--daemon", "--foreground");
  const child = spawn(binary, args, { stdio: "inherit", env: { ...process.env, TZ: "UTC", CVD_CERTS_DIR: join(binaryRoot, "etc/certs") } });
  process.on("SIGINT", () => child.kill("SIGINT")); process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject); child.on("exit", code => resolve(code ?? 1));
  });
}
main().catch(() => { console.error("ClamAV 실행에 실패했습니다. 로컬 실행 파일과 설정 경로를 확인하세요."); process.exitCode = 1; });
