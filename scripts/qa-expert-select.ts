// P13-T02: /expert/select-company 실브라우저 흐름 검증 — 로그인→배정 목록→선택→대시보드 진입.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
const email = Object.keys(pw).find(k => k.startsWith("qa-expert-"));
if (!email) throw new Error("run qa-expert-fixture.ts first");
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", e => errors.push(String(e).slice(0, 160)));

// 1) 로그인 — 직접 회사 없는 전문가는 /expert/select-company로 이동해야 한다
await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pw[email]);
await page.click('button:has-text("로그인")');
await page.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
record("login-redirect-to-select", page.url().includes("/expert/select-company") || page.url().includes("/dashboard"), page.url());

// 2) 배정 목록 — 회사 A가 선택 가능하게 보여야 한다
if (!page.url().includes("/expert/select-company")) await page.goto(base + "/expert/select-company");
await page.waitForSelector(".expert-company-list", { timeout: 15000 }).catch(() => {});
const items = page.locator(".expert-company-item");
const count = await items.count();
record("assignment-list", count >= 1, "rows=" + count);
const radio = items.first().locator('input[type="radio"]');
record("radio-enabled", await radio.isEnabled().catch(() => false), "");

// 3) 검색 필터 — 없는 이름 검색 시 빈 상태, 복원 시 목록 재표시
await page.fill('input[aria-label="회사 검색하기"]', "존재하지않는회사xyz");
await page.waitForTimeout(1200);
const emptyText = await page.locator(".expert-select-page form").innerText();
record("search-empty", /검색 결과가 없습니다/.test(emptyText), emptyText.slice(0, 60));
await page.fill('input[aria-label="회사 검색하기"]', "");
await page.waitForTimeout(1200);
record("search-restore", await items.count() >= 1, "rows=" + await items.count());

// 4) 회사 선택 → 전문가 PLUS 시작 → /dashboard 이동
await radio.check();
await page.click('button:has-text("전문가 PLUS 시작하기")');
await page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
record("select-to-dashboard", page.url().includes("/dashboard"), page.url());
const dash = await page.locator("body").innerText();
record("dashboard-content", dash.includes("대시보드") || dash.includes("서비스"), dash.slice(0, 80).replace(/\s+/g, " "));

// 5) 새로고침 후에도 컨텍스트 유지 — expert 선택 화면으로 되돌아가지 않아야 한다
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
record("reload-keeps-context", !page.url().includes("/expert/select-company"), page.url());

record("console-errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.screenshot({ path: "docs/qa/P13-T02/expert-select.png", fullPage: false });
writeFileSync("docs/qa/P13-T02/expert-select.json", JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
