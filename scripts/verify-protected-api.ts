import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { safeReturnTo } from "../src/lib/return-to";

const database = new URL(process.env.DATABASE_URL ?? "");
if (database.pathname !== "/catchsecu_test") throw new Error("보호 API 검증은 catchsecu_test에서만 실행합니다.");
const id = "00000000-0000-4000-8000-000000000099";
const publicPrefix = ["/api/v1/health", "/api/v1/ready", "/api/v1/auth", "/api/v1/public", "/api/v1/email-unsubscribe"];
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith("route.ts") ? [path] : [];
  }));
  return found.flat();
}
function urlsFor(file: string) {
  const suffix = relative("src/app", file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
  const withId = suffix.replace(/\[\[\.\.\.[^\]]+\]\]/g, id).replace(/\[\.\.\.[^\]]+\]/g, id).replace(/\[[^\]]+\]/g, id);
  return ["/" + withId];
}
const failures: string[] = [];
const rows: { url: string; method: string; status: number }[] = [];
for (const file of await files("src/app/api/v1")) {
  const loaded = await import(pathToFileURL(join(process.cwd(), file)).href) as Record<string, (request: Request) => Promise<Response>>;
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const handler = loaded[method];
    if (typeof handler !== "function") continue;
    for (const url of urlsFor(file)) {
      const response = await handler(new Request("http://localhost:3101" + url, { method, headers: method === "GET" ? {} : { origin: "http://localhost:3101", "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" }));
      rows.push({ url, method, status: response.status });
      const open = response.status < 400 && !publicPrefix.some(prefix => url === prefix || url.startsWith(prefix + "/"));
      if (open) failures.push(method + " " + url + " -> " + response.status);
    }
  }
}
const redirects = ["/dashboard", "https://evil.example", "//evil.example", "/\\evil", "/%2f%2fevil.example", "/login?returnTo=https://evil.example"];
const safe = redirects.map(value => [value, safeReturnTo(value)]);
if (safeReturnTo("/dashboard") !== "/dashboard" || safeReturnTo("https://evil.example") !== "/dashboard" || safeReturnTo("//evil.example") !== "/dashboard" || safeReturnTo("/\\evil") !== "/dashboard")
  failures.push("returnTo가 외부 주소를 허용합니다.");
const report = { checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed", calls: rows.length, blocked: rows.filter(row => row.status >= 400).length, failures, safe };
const { mkdir, writeFile } = await import("node:fs/promises");
await mkdir("docs/qa/P02-T05", { recursive: true });
await writeFile("docs/qa/P02-T05/unauthenticated.json", JSON.stringify(report, null, 2) + "\n");
if (failures.length) throw new Error(failures.slice(0, 20).join("\n"));
console.log(JSON.stringify({ result: report.result, calls: report.calls, blocked: report.blocked }));
