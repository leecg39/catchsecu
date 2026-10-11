// P13-T04 전 페이지 게이트: 181개 매니페스트 경로를 실제 브라우저(Playwright)로 직접URL→새로고침→뒤로가기 검증.
// 1440/768/390 뷰포트 수평 오버플로 측정, 스크린샷·콘솔 오류·최종 URL·HTTP 상태를 증거로 남긴다.
// 루트당 한 번 방문해 뷰포트를 리사이즈하며 측정하고, 결과를 루트 단위로 즉시 기록한다.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { db } from "../src/server/db";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";
import { summarizePageGate, resolvePageFixture, type PageGateResult } from "./lib/qa-page-gate";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
type MockFixtures = { storage: string; origin: string; database: string; email: string; password: string; companyId: string; serviceId: string; formId: string; routes: Record<string, string>;
  viewer?: { expiresAt: string; cookies: { name: string; value: string; path: string; httpOnly: boolean; sameSite: "Strict" }[] };
  subject: { expiresAt: string; cookies: { name: string; value: string; path: string; httpOnly: boolean; sameSite: "Strict" }[] } };
const mock: MockFixtures | null = process.env.QA_MOCK_FIXTURES === "1" ? JSON.parse(await readFile(".local/mock-page-fixtures.json", "utf8")) : null;
if (mock) {
  const database = new URL(env.DATABASE_URL);
  assert.equal(database.pathname, "/catchsecu_mock_admin");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(mock.storage, resolve(env.PRIVATE_STORAGE_DIR));
  assert.equal(mock.database, database.pathname); assert.equal(mock.origin, base);
  assert.ok(Date.parse(mock.subject.expiresAt) > Date.now(), "Regenerate expired Mock subject fixtures.");
  if (mock.viewer) assert.ok(Date.parse(mock.viewer.expiresAt) > Date.now(), "Regenerate expired Mock viewer fixtures.");
  for (const route of Object.values(mock.routes)) assert.equal(new URL(route, base).origin, base);
}
// Live local tokens and captured URLs must stay outside tracked evidence.
const outDir = process.env.QA_OUT ?? (mock ? ".local/mock-page-sweep" : "docs/qa/P13-T04");
await mkdir(`${outDir}/screens`, { recursive: true });
const allManifest = JSON.parse(await readFile("src/data/route-manifest.json", "utf8")) as { path: string; dynamic?: boolean; category?: string }[];
const routeFilter = process.env.QA_ROUTE_FILTER ? new RegExp(process.env.QA_ROUTE_FILTER) : null;
const manifest = routeFilter ? allManifest.filter(row => routeFilter.test(row.path)) : allManifest;
const pw = mock ? null : JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));

// 동적 경로 → 실제 fixture
const svc = mock?.serviceId ?? "20000000-0000-4000-8000-000000000001";
const tenant = mock?.companyId ?? "10000000-0000-4000-8000-000000000001";
const form = await db.form.findFirst({ where: { service: { tenantId: tenant } }, select: { id: true } });
const notice = await db.notice.findFirst({ select: { id: true } });
const alim = await db.kakaoTemplate.findFirst({ where: { tenantId: tenant }, select: { id: true } }).catch(() => null);
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
// 와일드카드 경로는 404/보안 fallback 이 기대 응답 — R25-T01 수용조건.
const expectedNotFound = new Set(["/*", "/security/*"]);
// 경로별 정상 거동 — 실제 브라우저로 확인한 의도된 리다이렉트/인증 게이트 응답만 등록한다.
const expectations: Record<string, { redirects?: string[]; consoleStatuses?: number[] }> = {
  "/loading": { redirects: ["/dashboard"] },           // 로딩 완료 → 대시보드 이동
  "/pay/billing-policy": { redirects: ["/pay/license-service"] }, // 과금 개체 없음 → 라이선스 화면
  "/pay/method": { redirects: ["/pay/license-service"] },
  "/oauth2/signup": { consoleStatuses: [410] },        // 가입 인증 intent 만료 → 410 안내 화면
  "/oauth2/invite/signup": { consoleStatuses: [422] }, // 초대 토큰 부재 → 422 안내 화면
  "/shared-privacy/view": { consoleStatuses: [401] },  // 열람자 세션 부재 → 이메일 인증 게이트
};
const transientStatus = (s?: number) => s === 500 || s === 502 || s === 503 || s === 429;
async function check(page: Page, route: string, manifestPath: string) {
  const r: Result = { manifestPath, route, consoleErrors: [], overflow: {} };
  if (expectedNotFound.has(manifestPath)) r.expectedStatus = 404;
  const exp = expectations[manifestPath];
  if (exp?.redirects) r.allowedUrls = [route.split(/[?#]/, 1)[0], ...exp.redirects];
  if (exp?.consoleStatuses) r.expectedConsoleStatuses = exp.consoleStatuses;
  currentResult = r;
  try {
    let res = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    // 부하 스파이크로 인한 일시적 5xx/429 는 한 번 재시도해 실제 결함과 구분한다.
    if (transientStatus(res?.status())) {
      r.retried = true;
      await page.waitForTimeout(6000);
      res = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    r.status = res?.status();
    if (r.expectedStatus === 404) {
      r.finalUrl = new URL(page.url()).pathname;
      results.push(r);
      await flush();
      return;
    }
    await page.waitForFunction(() => document.body.children.length > 0 && document.body.innerText.trim().length > 0, undefined, { timeout: 8000 });
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
    r.refreshed = (res2?.status() ?? 0) === 200 && (r.allowedUrls ? r.allowedUrls.includes(new URL(page.url()).pathname) : new URL(page.url()).pathname === prev);
    if (route !== "/dashboard") {
      await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      if (new URL(page.url()).pathname !== "/dashboard") {
        // 뒤로가기 후 클라이언트 리다이렉트가 늦게 완료될 수 있어 짧게 추가 대기 후 확인한다.
        await page.waitForTimeout(1500);
      }
      r.backOk = new URL(page.url()).pathname === "/dashboard";
    } else r.backOk = true;
    // 인증 게이트 등 의도된 오류 응답은 콘솔 목록에서 제외해 실제 결함만 남긴다.
    if (r.expectedConsoleStatuses) r.consoleErrors = r.consoleErrors.filter(e => !r.expectedConsoleStatuses!.some(s => e.includes(`status of ${s}`) || e.includes(`(${s}`)));
  } catch (error) { r.error = String(error).slice(0, 160); }
  results.push(r);
  await flush();
}
async function login(ctx: BrowserContext) {
  const page = await ctx.newPage();
  const res = await page.request.post(base + "/api/v1/auth/sign-in/email", {
    headers: { origin: base, "content-type": "application/json" },
    data: { email: mock?.email ?? "owner@catchsecu.local.test", password: mock?.password ?? pw["owner@catchsecu.local.test"] } });
  if (res.status() !== 200) throw new Error("로그인 실패: " + res.status());
  await page.close();
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await login(ctx);
if (mock) await ctx.addCookies([...mock.subject.cookies, ...(mock.viewer?.cookies ?? [])].map(cookie => ({ ...cookie, domain: new URL(base).hostname })));
const page = await ctx.newPage();
page.on("console", m => { if (m.type() === "error" && currentResult && currentResult.consoleErrors.length < 5) currentResult.consoleErrors.push(m.text().slice(0, 120)); });
for (const row of manifest) {
  const explicit = mock?.routes[row.path];
  const fixture = explicit ? { route: explicit, missing: [] } : resolvePageFixture(row.path, fixtures);
  if (fixture.missing.length || (!explicit && row.dynamic && skipDynamic.test(row.path))) {
    results.push({ manifestPath: row.path, route: fixture.route, consoleErrors: [], skipped: fixture.missing.length ? `실제 fixture 없음: ${fixture.missing.join(", ")}` : "정상 동적 fixture 미준비" });
    await flush();
    continue;
  }
  await check(page, fixture.route, row.path);
  await page.waitForTimeout(150);
}
// 2차 패스: 레이트 리밋 창(60s)을 지나 재검사해 일시적 한계와 실제 결함을 구분한다.
const isFailed = (r: Result) => !r.skipped && (
  r.expectedStatus !== undefined && r.expectedStatus !== 200
    ? r.status !== r.expectedStatus || r.finalUrl !== r.route.split(/[?#]/, 1)[0]
    : !!r.error || r.status !== 200 || !r.finalUrl ||
      !(r.allowedUrls ? r.allowedUrls.includes(r.finalUrl) : r.finalUrl === r.route.split(/[?#]/, 1)[0]) ||
      r.refreshed !== true || r.backOk !== true || r.consoleErrors.length > 0 ||
      [1440, 768, 390].some(w => r.overflow?.[w] !== false));
const firstFailed = results.filter(isFailed);
if (firstFailed.length) {
  console.log(`pass-2: ${firstFailed.length} routes recheck after cooldown`);
  await page.waitForTimeout(65000);
  for (const prev of firstFailed) {
    const idx = results.indexOf(prev);
    const recheck: Result = { manifestPath: prev.manifestPath, route: prev.route, consoleErrors: [], overflow: {}, retried: true };
    if (prev.expectedStatus) recheck.expectedStatus = prev.expectedStatus;
    if (prev.allowedUrls) recheck.allowedUrls = prev.allowedUrls;
    if (prev.expectedConsoleStatuses) recheck.expectedConsoleStatuses = prev.expectedConsoleStatuses;
    currentResult = recheck;
    try {
      const res = await page.goto(base + prev.route, { waitUntil: "domcontentloaded", timeout: 20000 });
      recheck.status = res?.status();
      if (recheck.expectedStatus === 404) recheck.finalUrl = new URL(page.url()).pathname;
      else {
        await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 8000 });
        recheck.finalUrl = new URL(page.url()).pathname;
        for (const [w, h] of widths) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(200);
          recheck.overflow![w] = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        }
        const res2 = await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
        recheck.refreshed = (res2?.status() ?? 0) === 200 && (recheck.allowedUrls ? recheck.allowedUrls.includes(new URL(page.url()).pathname) : new URL(page.url()).pathname === recheck.finalUrl);
        if (prev.route !== "/dashboard") {
          await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
          await page.goto(base + prev.route, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
          if (new URL(page.url()).pathname !== "/dashboard") await page.waitForTimeout(1500);
          recheck.backOk = new URL(page.url()).pathname === "/dashboard";
        } else recheck.backOk = true;
        if (recheck.expectedConsoleStatuses) recheck.consoleErrors = recheck.consoleErrors.filter(e => !recheck.expectedConsoleStatuses!.some(s => e.includes(`status of ${s}`) || e.includes(`(${s}`)));
      }
    } catch (error) { recheck.error = String(error).slice(0, 160); }
    if (!isFailed(recheck)) results[idx] = recheck;
    else results[idx] = { ...recheck, attempts: 2 } as Result;
    await flush();
    await page.waitForTimeout(300);
  }
}
await ctx.close();
const summary = summarizePageGate(manifest.map(row => row.path), results);
await writeFile(`${outDir}/full-sweep-summary.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...summary }, null, 2) + "\n");
console.log(JSON.stringify(summary));
process.exitCode = summary.result === "failed" ? 1 : 0;
await browser.close();
await db.$disconnect();
