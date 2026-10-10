import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const privateDirectory = ".local/rea-fullstack/question-images/legacy";
const output = "docs/qa/R08-T02/question-metadata/content-images/legacy-preservation.json";
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const fixtures = ["sso-journey", "sso-context", "sso-https", "sso-outbound", "sso-browser-binding", "sso-browser-fixture",
  "form-authority", "option-flow", "exact-flow", "text-flow", "special-flow", "address-flow", "drawing-flow",
  "international-flow", "explanation-flow", "materials-flow", "personal-information-flow", "custom-choice-flow", "author-assets-flow"];
const results = [];
for (const fixture of fixtures) {
  const result = spawnSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", `scripts/qa-rea-${fixture}.ts`, "verify"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...(fixture === "sso-https" ? {
      NODE_EXTRA_CA_CERTS: resolve(".local/rea-fullstack/sso/https/ca.pem"), BETTER_AUTH_URL: "https://localhost:3443",
    } : {}) },
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? "\n" + result.error.message : "");
  await writeFile(`${privateDirectory}/${fixture}.log`, log, { mode: 0o600 });
  results.push({ fixture, mode: "verify", exitCode: result.status, passed: result.status === 0,
    logSha256: createHash("sha256").update(log).digest("hex") });
}
const report = { checkedAt: new Date().toISOString(), status: results.every(r => r.passed) ? "passed" : "failed",
  total: results.length, passed: results.filter(r => r.passed).length, results,
  method: "Serial existing read-only verify modes. Frozen baselines unchanged; every post-baseline rich body/page/branch/reference/path/share field is asserted neutral before omission, together with the earlier questionImageKey and optionImageKey guards." };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, total: report.total, passed: report.passed, failed: results.filter(r => !r.passed).map(r => r.fixture) }));
if (report.status !== "passed") process.exitCode = 1;
