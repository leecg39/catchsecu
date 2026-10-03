import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import type { BillingHistoryList } from "../src/contracts/billing-history";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Billing history QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running billing history QA.");
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const email = "owner@catchsecu.local.test";
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
  headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: passwords[email] }) });
check(login.status === 200, "Billing history QA login failed: " + login.status);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const browser = await chromium.launch({ headless: true });
try {
  const response = await fetch(base + "/api/v1/billing-history", { headers: { cookie } });
  check(response.status === 200, "Billing history API failed: " + response.status);
  const result = await response.json() as BillingHistoryList;
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
  const tenantId = user.memberships.find(item => item.role === "owner")?.tenantId;
  check(tenantId, "Seed owner has no company");
  const total = await db.billingSubscription.count({ where: { tenantId, planId: "trial", status: { in: ["trialing", "expired"] } } });
  check(result.total === total && result.items.every(item => item.kind === "trial_started" && item.amountKrw === 0),
    "API history differs from independent subscription query");

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookie.split("; ").map(pair => {
    const index = pair.indexOf("="); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
  }));
  const page = await context.newPage();
  const initial = page.waitForResponse(value => value.url().includes("/api/v1/billing-history?"));
  const documentResponse = await page.goto(base + "/pay/history");
  check(documentResponse?.status() === 200, "Billing history HTML failed");
  check((await initial).status() === 200, "Billing history browser API failed");
  await page.getByText(`총 ${total}건`).waitFor();
  check((await page.locator(".cs-table tbody").innerText()).includes("무료 체험 시작"), "Trial row did not render");

  const next = new Date(Date.now() + 9 * 3600000); next.setUTCMonth(next.getUTCMonth() + 1);
  const futureMonth = next.toISOString().slice(0, 7);
  await page.getByLabel("조회 시작 월").fill(futureMonth);
  const filtered = page.waitForResponse(value => value.url().includes("/api/v1/billing-history?") && value.url().includes("fromMonth=" + futureMonth));
  await page.getByRole("button", { name: "검색", exact: true }).click();
  check((await filtered).status() === 200, "Future-month filter failed");
  await page.getByText("조회 조건에 맞는 이력이 없습니다.").waitFor();
  const reset = page.waitForResponse(value => value.url().includes("/api/v1/billing-history?") && !value.url().includes("fromMonth="));
  await page.getByRole("button", { name: "검색 조건 초기화" }).click();
  check((await reset).status() === 200, "History reset failed");
  await page.getByText(`총 ${total}건`).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "Mobile document overflows");
  await page.screenshot({ path: "docs/qa/P10-T05/billing-history-mobile.png", fullPage: true });
  console.log(JSON.stringify({ totalMatchesDatabase: true, renderedTrial: true, futureMonthEmpty: true,
    reset: true, mobileWidth: 390, mobileOverflow: false }));
  await context.close();
} finally {
  await browser.close();
  await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
  await db.$disconnect();
}
