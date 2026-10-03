import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import type { LedgerOverview } from "../src/contracts/ledger";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Ledger QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before ledger QA.");
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const email = "owner@catchsecu.local.test";
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
  headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: passwords[email] }) });
check(login.status === 200, "Ledger QA login failed: " + login.status);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const browser = await chromium.launch({ headless: true });
try {
  const contextResponse = await fetch(base + "/api/v1/context", { headers: { cookie } });
  check(contextResponse.status === 200, "Context request failed");
  const sessionContext = await contextResponse.json() as { company: { id: string } | null };
  const tenantId = sessionContext.company?.id;
  check(tenantId, "Owner company is unavailable");
  const response = await fetch(base + "/api/v1/ledger", { headers: { cookie } });
  check(response.status === 200, "Ledger request failed: " + response.status);
  const result = await response.json() as LedgerOverview;
  const account = await db.creditAccount.findUnique({ where: { tenantId_currency: { tenantId, currency: "KRW" } } });
  const count = await db.ledgerTransaction.count({ where: { tenantId, currency: "KRW" } });
  check(result.available === (account?.available ?? BigInt(0)).toString() &&
    result.held === (account?.held ?? BigInt(0)).toString() && result.total === count,
    "Ledger API differs from independent DB balance/count");
  const foreign = await db.service.findFirst({ where: { tenantId: { not: tenantId } }, select: { id: true } });
  if (foreign) {
    const denied = await fetch(base + "/api/v1/ledger?serviceId=" + foreign.id, { headers: { cookie } });
    check(denied.status === 404, "Foreign service was not rejected");
  }
  check((await fetch(base + "/api/v1/ledger?pageSize=101", { headers: { cookie } })).status === 422, "Large page was accepted");
  check((await fetch(base + "/api/v1/ledger", { method: "POST", headers: { origin: base, cookie } })).status === 405,
    "Public ledger write was accepted");

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(cookie.split("; ").map(pair => {
    const index = pair.indexOf("="); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
  }));
  const page = await context.newPage();
  const ledgerLoad = page.waitForResponse(value => value.url().includes("/api/v1/ledger"));
  const html = await page.goto(base + "/pay/license-service");
  check(html?.status() === 200, "License page HTML failed");
  check((await ledgerLoad).status() === 200, "License page ledger request failed");
  const panel = page.getByRole("heading", { name: "크레딧", exact: true }).locator("..");
  await panel.getByText("사용 가능").waitFor();
  check((await panel.innerText()).includes("예약 중"), "Credit balance panel did not render");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, "Mobile license page overflows");
  await page.screenshot({ path: "docs/qa/P10-T03/credit-balance-mobile.png", fullPage: true });
  console.log(JSON.stringify({ dbBalanceMatches: true, ledgerCountMatches: true, foreignServiceDenied: !!foreign,
    invalidPageDenied: true, publicWriteDenied: true, browserBalance: true, mobileWidth: 390, mobileOverflow: false }));
  await context.close();
} finally {
  await browser.close();
  await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
  await db.$disconnect();
}
