import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const mode = process.argv.includes("--providers") ? "providers" : "full";
const out = resolve(process.env.MOCK_VERIFICATION_EVIDENCE_DIR ?? resolve("docs/qa/mock-completion", mode));
if (!out.startsWith(resolve("docs/qa/mock-completion") + "/"))
  throw new Error("Mock evidence must stay inside docs/qa/mock-completion.");
const envFile = resolve(process.env.MOCK_VERIFICATION_ENV_FILE ?? ".env.test.local");
if (envFile !== resolve(".env.test.local") && !envFile.startsWith(resolve(".local") + "/"))
  throw new Error("Alternative Mock settings must stay inside the private .local folder.");
const config = parseEnv(await readFile(envFile, "utf8"));
const database = new URL(config.DATABASE_URL), app = new URL(config.BETTER_AUTH_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname) || !["localhost", "127.0.0.1"].includes(app.hostname))
  throw new Error("Mock verification requires loopback catchsecu_test and application URLs.");
const major = Number(process.versions.node.split(".")[0]);
if (![22, 24].includes(major)) throw new Error("Use project-supported Node 22 or 24.");
await mkdir(out, { recursive: true });
await mkdir(".local", { recursive: true });
const groups = [
  { id: "catalog-and-retention", tasks: ["P10-T01", "P07-T03"], kind: "synthetic catalog/retention + live authority/atomicity", files: ["admin-plans.test.ts", "retention-rules.test.ts"] },
  { id: "idp", tasks: ["P11-T03", "P11-T05"], kind: "local OIDC RSA HTTP + signed SAML", files: ["sso.test.ts", "sso-saml.test.ts", "sso-recovery.test.ts", "security-gate.test.ts"] },
  { id: "organization", tasks: ["P11-T04"], kind: "virtual GPKI/Saeol/groupware directory", files: ["org-auth.test.ts"] },
  { id: "payment", tasks: ["P10-T02", "P10-T04", "P10-T05"], kind: "virtual PG + signed webhook + real PostgreSQL ledger", files: ["billing-virtual.test.ts", "payment-orders.test.ts", "payment-concurrency.test.ts", "billing-refunds.test.ts", "billing-settlement.test.ts"] },
  { id: "mail", tasks: ["P09-T01", "P09-T02", "P09-T06"], kind: "local mail artifact + job/feedback state", files: ["mail-job-audit.test.ts", "message-content.test.ts", "campaigns.test.ts"] },
  { id: "sms", tasks: ["P08-T03", "P09-T06"], kind: "mock HTTP/HMAC provider + signed receipt", files: ["sms-adapter.test.ts"] },
  { id: "kakao", tasks: ["P09-T03", "P09-T04", "P09-T06"], kind: "local channel/template review and delivery", files: ["kakao-templates.test.ts"] },
  { id: "notifications", tasks: ["P09-T05"], kind: "local receipt + SSRF/failure contract", files: ["notifications.test.ts"] },
  { id: "identity-signature", tasks: ["P06-T06"], kind: "local signed identity/signature callbacks", files: ["verification-flow.test.ts", "verification-configuration.test.ts"] },
  { id: "recovery", tasks: ["P07-T04", "P14-T01", "P14-T04"], kind: "synthetic legacy data/key rotation/destruction in PostgreSQL; not infrastructure restore", files: ["legacy-migration.test.ts", "crypto-rotation.test.ts", "destruction.test.ts"] },
];
const providerFiles = [...new Set(groups.flatMap(g => g.files))].map(f => "tests/server/" + f);
const childEnv = { ...process.env, ...config, NODE_ENV: "test", MAIL_TRANSPORT: "local", SMS_TRANSPORT: "unconfigured", KAKAO_PROVIDER: "local", PAYMENT_PROVIDER: "local", NOTIFICATION_TRANSPORT: "local", FILE_STORAGE: "local", ALLOW_LOCAL_MAIL: "1", ALLOW_LOCAL_KAKAO: "1", ALLOW_LOCAL_PAYMENT: "1", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_USER: "", SMTP_PASSWORD: "", SOLAPI_API_KEY: "", SOLAPI_API_SECRET: "", SOLAPI_TENANT_ID: "", S3_ENDPOINT: "", S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "", S3_BUCKET: "" };
// Optional schema values must be absent, rather than empty strings. Prevent .env.local
// fallback during Next builds by supplying valid synthetic values instead.
Object.assign(childEnv, { SOLAPI_API_KEY: "mock-key", SOLAPI_API_SECRET: "mock-secret-0123456789", SOLAPI_TENANT_ID: "00000000-0000-4000-8000-000000000000", S3_ENDPOINT: "http://127.0.0.1:1", S3_ACCESS_KEY_ID: "mock-access-key-0000", S3_SECRET_ACCESS_KEY: "mock-secret-key-0000", S3_BUCKET: "mock-bucket" });
// The SMS suite explicitly tests missing credentials. Test processes do not load
// .env.local, so remove these there; the build gets the synthetic placeholders.
const testEnv = { ...childEnv, KAKAO_PROVIDER: "unconfigured" };
for (const key of ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_TENANT_ID"]) delete testEnv[key];
async function sourceSnapshot() {
  const paths = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src", "scripts", "tests", "prisma", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "vitest.config.ts"], { encoding: "utf8" }).trim().split("\n").filter(Boolean))].sort();
  const hashes = {};
  for (const path of paths) hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
  return hashes;
}
const startHashes = await sourceSnapshot();
const report = { checkedAt: new Date().toISOString(), mode, evidenceLevel: "mock", realExternalAcceptance: false, node: process.version, gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), result: "running", steps: [], providers: [], limits: ["Mock evidence replaces external proof for this requested run only.", "No real provider delivery, original-screen fidelity, staging or WAL/PITR certification.", "Uses real isolated PostgreSQL; does not replace DB with memory mocks."] };
async function save() { await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
await save();
async function run(id, command, args, env = testEnv) {
  console.log("START " + id);
  const started = Date.now();
  const log = createWriteStream(resolve(out, id + ".log"));
  const result = await new Promise(resolveRun => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => log.write(chunk));
    child.stderr.on("data", chunk => log.write(chunk));
    child.on("error", e => resolveRun({ code: -1, error: e.code || "SPAWN_FAILED" }));
    child.on("close", (code, signal) => resolveRun({ code, signal }));
  });
  log.end();
  await finished(log);
  report.steps.push({ id, status: result.code === 0 ? "passed" : "failed", ...result, durationMs: Date.now() - started, log: id + ".log" });
  await save();
  console.log((result.code === 0 ? "PASS " : "FAIL ") + id);
}
await run("scanner", process.execPath, ["--import", "tsx", "scripts/check-mock-scanner.ts"]);
if (report.steps.at(-1).status !== "passed") {
  report.result = "failed"; report.finishedAt = new Date().toISOString(); await save(); process.exit(1);
}
await run("migrations", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
if (report.steps.at(-1).status !== "passed") {
  report.result = "failed"; await save(); process.exit(1);
}
const jsonPath = resolve(out, "tests.json");
// Clear previous test output so a failed invocation cannot reuse stale evidence.
await writeFile(jsonPath, "null\n");
await run("tests", process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...(mode === "providers" ? providerFiles : []), "--reporter=json", "--outputFile=" + jsonPath]);
const tests = JSON.parse(await readFile(jsonPath, "utf8"));
report.tests = tests ? { passed: tests.numPassedTests, failed: tests.numFailedTests, pending: tests.numPendingTests, todo: tests.numTodoTests, files: tests.testResults.length } : null;
for (const group of groups) {
  const files = group.files.map(f => tests?.testResults.find(r => r.name.endsWith("/tests/server/" + f)));
  const assertions = files.flatMap(f => f?.assertionResults || []);
  report.providers.push({ ...group, status: files.every(Boolean) && assertions.length > 0 && assertions.every(a => a.status === "passed") ? "mock-verified" : "failed-or-incomplete", tests: assertions.length });
}
await save();
await run("s3", process.execPath, ["--import", "tsx", "scripts/verify-s3-storage.ts"]);
const s3 = JSON.parse(await readFile("docs/qa/P01-T03/s3-roundtrip.json", "utf8"));
report.providers.push({ id: "s3", tasks: ["P01-T03", "P06-T03", "P14-T03"], kind: "loopback SigV4 + encrypted bytes", status: report.steps.at(-1).status === "passed" && s3.result === "passed" ? "mock-verified" : "failed-or-incomplete", requests: s3.requests });
await writeFile(resolve(out, "s3.json"), JSON.stringify(s3, null, 2) + "\n");
await run("contracts", "python3", ["scripts/verify-contracts.py"]);
await run("plan", "python3", ["scripts/verify-plan.py"]);
if (mode === "full") {
  await run("typecheck", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  await run("lint", process.execPath, ["node_modules/eslint/bin/eslint.js", "."]);
  await writeFile(".local/mock-acceptance-tsconfig.json", JSON.stringify({ extends: "../tsconfig.json", include: ["../next-env.d.ts", "../src/**/*.ts", "../src/**/*.tsx", "../scripts/**/*.ts", "../tests/**/*.ts", "./mock-acceptance-build/types/**/*.ts"], exclude: ["../node_modules"] }, null, 2));
  await run("build", process.execPath, ["node_modules/next/dist/bin/next", "build"], { ...childEnv, NODE_ENV: "production", CATCHSECU_BUILD_DIR: ".local/mock-acceptance-build", CATCHSECU_TSCONFIG: ".local/mock-acceptance-tsconfig.json" });
}
const taskRows = JSON.parse(await readFile("docs/planning/tasks.json", "utf8"));
report.tasks = taskRows.map(task => ({ id: task.id, status: task.status, mockProviders: report.providers.filter(p => p.tasks.includes(task.id)).map(p => p.id), evidence: task.evidence, acceptance: task.acceptance }));
report.result = report.steps.every(s => s.status === "passed") && report.providers.every(p => p.status === "mock-verified") && report.tests && report.tests.failed === 0 && report.tests.pending === 0 && report.tests.todo === 0 ? "passed" : "failed";
report.finishedAt = new Date().toISOString();
report.sourceHashes = await sourceSnapshot();
report.sourceChangedDuringRun = [...new Set([...Object.keys(startHashes), ...Object.keys(report.sourceHashes)])].filter(path => startHashes[path] !== report.sourceHashes[path]);
if (report.sourceChangedDuringRun.length) report.result = "failed";
await save();
console.log(JSON.stringify({ result: report.result, evidenceLevel: "mock", tests: report.tests, report: relative(root, resolve(out, "report.json")) }));
process.exitCode = report.result === "passed" ? 0 : 1;
