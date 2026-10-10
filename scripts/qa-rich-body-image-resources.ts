import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile), started = Date.now();
const result = await execute(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/server/author-asset-validation.test.ts"], {
  env: process.env, timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
});
assert.match(result.stdout, /Tests\s+64 passed/);
const report = {
  checkedAt: new Date().toISOString(), result: "passed", watchdogMs: 30_000, elapsedMs: Date.now() - started,
  bodyImage: { pixels: 24 * 1024 * 1024, dimension: 16_384, frames: 1 },
  legacyImage: { pixels: 8 * 1024 * 1024, dimension: 8192, frames: 1 },
  concurrentDecodes: 2, tests: 64,
};
await mkdir("docs/qa/R08-T02/body-images/resources", { recursive: true });
await writeFile("docs/qa/R08-T02/body-images/resources/watchdog-final.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
