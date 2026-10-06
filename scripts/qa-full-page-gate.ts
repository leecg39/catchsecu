// P13-T04 전 페이지 게이트: 181개 매니페스트 경로를 실제 브라우저(Playwright)로 직접URL→새로고침→뒤로가기 검증.
// 1440/768/390 뷰포트 수평 오버플로 측정, 스크린샷·콘솔 오류·최종 URL·HTTP 상태를 증거로 남긴다.
// 루트당 한 번 방문해 뷰포트를 리사이즈하며 측정하고, 결과를 루트 단위로 즉시 기록한다.
import { chromium, type BrowserContext, type Page } from "playwright";
import { db } from "../src/server/db";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";
import { summarizePageGate, resolvePageFixture, type PageGateResult } from "./lib/qa-page-gate";

const base = new URL(env.BETTER_AUTH_URL).origin;
const outDir = "docs/qa/P13-T04";
await mkdir(`${outDir}/screens`, { recursive: true });
const manifest = JSON.parse(await readFile("src/data/route-manifest.json", "utf8")) as { path: string; dynamic?: boolean; category?: string }[];
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));

// 동적 경로 → 실제 fixture
const svc = "20000000-0000-4000-8000-000000000001";
const tenant = "10000000-0000-4000-8000-000000000001";
const form = await db.form.findFirst({ where: { service: { tenantId: tenant } }, select: { id: true } });
const notice = await db.notice.findFirst({ select: { id: true } });
const alim = await db.kakaoTemplate.findFirst({ select: { id: true } }).catch(() => null);
const bill = await db.paymentOrder.findFirst({ where: { tenantId: tenant }, select: { id: true } }).catch(() => null);
const fixtures: Record<string, string | undefined> = {
  ":serviceId": svc, ":formId": form?.id,
  ":admNotiId": notice?.id ? String(notice.id) : undefined,
  ":templateId": alim?.id,
  ":id": bill?.id,
};
const skipDynamic = /:token|:code|pay|infoOwner|saeol|identification/;

const browser = await chromium.launch();
type Result = PageGateResult;
const results: Result[] = [];
const shotRoutes = new Set(["/dashboard", "/form/manage", "/notice", "/log/authority", "/sms/history", "/my-page", "/marketing", "/compliance", "/payment", "/set/user"]);
const widths: [number, number][] = [[1440, 900], [768, 1024], [390, 844]];
let currentResult: Result | null = null;
async function flush() { await writeFile(`${outDir}/full-sweep.json`, JSON.stringify(results, null, 1)); }
async function check(page: Page, route: string, manifestPath: string) {
  const r: Result = { manifestPath, route, consoleErrors: [], overflow: {} };
  currentResult = r;
  try {
    const res = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    r.status = res?.status();
    await page.waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, undefined, { timeout: 8000 });
    r.finalUrl = new URL(page.url()).pathname;
    for (const [w, h] of widths) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      r.overflow![w] = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (shotRoutes.has(manifestPath)) await page.screenshot({ path: `${outDir}/screens/${w}${route.replaceAll("/", "_")}.png`, fullPage: false });
    }
    const prev = r.finalUrl;
    const res2 = await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    r.status = r.status ?? res2?.status();
    r.refreshed = (res2?.status() ?? 0) === 200 && new URL(page.url()).pathname === prev;
    if (route !== "/dashboard") {
      await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      r.backOk = new URL(page.url()).pathname === "/dashboard";
    } else r.backOk = true;
  } catch (error) { r.error = String(error).slice(0, 160); }
  results.push(r);
  await flush();
}
async function login(ctx: BrowserContext) {
  const page = await ctx.newPage();
  const res = await page.request.post(base + "/api/v1/auth/sign-in/email", {
    headers: { origin: base, "content-type": "application/json" },
    data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
  if (res.status() !== 200) throw new Error("로그인 실패: " + res.status());
  await page.close();
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await login(ctx);
const page = await ctx.newPage();
page.on("console", m => { if (m.type() === "error" && currentResult && currentResult.consoleErrors.length < 5) currentResult.consoleErrors.push(m.text().slice(0, 120)); });
for (const row of manifest) {
  const fixture = resolvePageFixture(row.path, fixtures);
  if (fixture.missing.length || (row.dynamic && skipDynamic.test(row.path))) {
    results.push({ manifestPath: row.path, route: fixture.route, consoleErrors: [], skipped: fixture.missing.length ? `실제 fixture 없음: ${fixture.missing.join(", ")}` : "정상 동적 fixture 미준비" });
    await flush();
    continue;
  }
  await check(page, fixture.route, row.path);
}
await ctx.close();
const summary = summarizePageGate(manifest.map(row => row.path), results);
await writeFile(`${outDir}/full-sweep-summary.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...summary }, null, 2) + "\n");
console.log(JSON.stringify(summary));
process.exitCode = summary.result === "passed" ? 0 : 1;
await browser.close();
await db.$disconnect();
