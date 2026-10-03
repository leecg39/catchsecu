import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import type { AnalyticsDashboard } from "../src/contracts/analytics";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Analytics browser QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running analytics browser QA.");
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const email = "owner@catchsecu.local.test", serviceId = "20000000-0000-4000-8000-000000000001";
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ email, password: passwords[email] }) });
check(login.status === 200, "Browser QA login failed: " + login.status);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookie.split("; ").map(pair => {
    const index = pair.indexOf("="); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
  }));
  const response = await fetch(base + "/api/v1/analytics/dashboard?serviceId=" + serviceId, { headers: { cookie } });
  check(response.status === 200, "Browser QA API precondition failed");
  const analytics = await response.json() as AnalyticsDashboard;
  const page = await context.newPage();
  await page.goto(base + "/dashboard/" + serviceId);
  await page.locator(".dash-usage").waitFor();
  check((await page.locator(".dash-usage").innerText()).includes(String(analytics.totals.retainedSubmissions)),
    "Dashboard rendered count differs from its API");
  await page.goto(base + "/privacy-detail/" + serviceId);
  await page.getByRole("heading", { name: "개인정보 응답 보유 현황" }).waitFor();
  await page.locator(".public-stat-overview").waitFor();
  check((await page.locator(".public-stat-overview").innerText()).includes(String(analytics.totals.retainedSubmissions)),
    "Privacy detail rendered count differs from its API");
  const firstMarketing = page.waitForResponse(value => value.url().includes("/api/v1/marketing/summary?") && value.url().includes(serviceId));
  await page.goto(base + "/marketing-detail/" + serviceId);
  check((await firstMarketing).status() === 200, "Initial marketing summary failed in browser");
  await page.getByRole("heading", { name: "마케팅 동의 현황 (광고성 정보)" }).waitFor();
  await page.locator(".marketing-stats").waitFor();
  const today = new Date(), yesterday = new Date(today.getTime() - 86400000);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  await page.locator(".marketing-summary-filters input[type=date]").first().fill(localDate(yesterday));
  await page.locator(".marketing-summary-filters input[type=date]").last().fill(localDate(today));
  const filtered = page.waitForResponse(value => value.url().includes("/api/v1/marketing/summary?") && new URL(value.url()).searchParams.has("from"));
  await page.getByRole("button", { name: "기간 적용" }).click();
  check((await filtered).status() === 200, "Marketing date filter failed in browser");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMarketing = page.waitForResponse(value => value.url().includes("/api/v1/marketing/summary?") && value.url().includes(serviceId));
  await page.reload();
  check((await mobileMarketing).status() === 200, "Mobile marketing summary failed in browser");
  await page.locator(".marketing-stats").waitFor();
  check(!(await page.locator("body").innerText()).includes("집계 중입니다."), "Mobile screenshot was captured while loading");
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!mobileOverflow, "Marketing mobile page overflows the viewport");
  await page.screenshot({ path: "docs/qa/P12-T02/browser-marketing-mobile.png", fullPage: true });
  await page.goto(base + "/compliance");
  await page.getByText("검증된 준수 점검 결과가 아직 없습니다.").waitFor();
  check(!(await page.locator("body").innerText()).includes("20점"), "Compliance page still shows a demo score");
  console.log(JSON.stringify({ browser: "headless Chromium", dashboard: true, privacyDetail: true,
    marketingDateFilter: 200, mobileWidth: 390, mobileOverflow: false, complianceNoDemoScore: true }));
  await context.close();
} finally {
  await browser.close();
  await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
}
