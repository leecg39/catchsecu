import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { cleanupExpiredExports, runOneExport } from "../src/server/exports";

const workerId = randomUUID(); let stopped = false;
process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
async function main() {
  console.info("CSV 내보내기 전용 처리기 시작", { workerId });
  let cleanedAt = 0;
  while (!stopped) {
    if (Date.now() - cleanedAt >= 60000) { await cleanupExpiredExports(); cleanedAt = Date.now(); }
    const worked = await runOneExport(workerId);
    if (process.argv.includes("--once") || (!worked && process.argv.includes("--drain"))) break;
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
main().catch(() => { console.error("CSV 처리기가 중단되었습니다. DB 연결과 설정을 확인해주세요."); process.exitCode = 1; }).finally(() => db.$disconnect());
