import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const inputFile = process.argv[2] ?? ".local/r00-t02-route-trace.jsonl";
const outputFile = process.argv[3] ?? "docs/qa/R00-T02/runtime-route-trace.json";
const raw = await readFile(inputFile, "utf8");
const events = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line) as { method: string; pathname: string; status: number }; }
  catch { throw new Error(`Invalid route trace JSON at line ${index + 1}`); }
});
const openApi = JSON.parse(await readFile("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const operations = Object.entries(openApi.paths).flatMap(([path, value]) =>
  Object.keys(value).map(method => method.toUpperCase()).filter(method => methods.has(method)).map(method => {
    let score = 0;
    const expression = path.split("/").filter(Boolean).map(segment => {
      if (/^\{[^}]+\}$/.test(segment)) { score += 1; return "/[^/]+"; }
      score += 10; return "/" + escape(segment);
    }).join("");
    return { method, path, score, regex: new RegExp("^" + expression + "/?$") };
  })).sort((a, b) => b.score - a.score);

type Runtime = { method: string; path: string; requests: number; successes: number; statuses: Record<string, number> };
const found = new Map<string, Runtime>();
let unmatchedRequests = 0;
for (const event of events) {
  const pathname = event.pathname.replace(/^\/api\/v1(?=\/|$)/, "") || "/";
  const operation = operations.find(item => item.method === event.method && item.regex.test(pathname));
  if (!operation) { unmatchedRequests += 1; continue; }
  const key = operation.method + " " + operation.path;
  const current = found.get(key) ?? { method: operation.method, path: operation.path, requests: 0, successes: 0, statuses: {} };
  current.requests += 1;
  if (event.status < 400) current.successes += 1;
  current.statuses[String(event.status)] = (current.statuses[String(event.status)] ?? 0) + 1;
  found.set(key, current);
}
const records = [...found.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const report = {
  checkedAt: new Date().toISOString(),
  scope: "실제 route wrapper 요청을 OpenAPI method+path로 정규화한 런타임 증거. 원시 동적 경로와 query는 저장하지 않음",
  sourceTraceSha256: createHash("sha256").update(raw).digest("hex"),
  requests: events.length,
  matchedRequests: events.length - unmatchedRequests,
  unmatchedRequests,
  operationsObserved: records.length,
  operationsSuccessful: records.filter(item => item.successes > 0).length,
  records,
};
await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ inputFile, outputFile, requests: report.requests, matchedRequests: report.matchedRequests,
  unmatchedRequests, operationsObserved: report.operationsObserved, operationsSuccessful: report.operationsSuccessful }));
