import { spawn } from "node:child_process";

const target = process.argv[2];
const source = new URL(process.env.DATABASE_URL ?? "");
if (!target || !["localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/catchsecu_dev")
  throw new Error("shadow 실행은 로컬 catchsecu_dev 설정에서만 할 수 있습니다.");
source.pathname = "/catchsecu_shadow";
const child = spawn(process.execPath, ["--import", "tsx", target], { env: { ...process.env, DATABASE_URL: source.href }, stdio: "inherit" });
child.on("close", code => process.exit(code ?? 1));
