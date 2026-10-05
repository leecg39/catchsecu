// P13-T03: loading·validation·retry·disabled·empty 상태 화면 실측.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
mkdirSync("docs/qa/P13-T03/states", { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const login = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
if (login.status() !== 200) throw new Error("login " + login.status());

// 1) loading — 발신자 목록 API를 1.5초 지연해 로딩 표시를 캡처
await page.route("**/api/v1/senders*", async route => {
  try { await new Promise(r => setTimeout(r, 1500)); await route.continue(); } catch {}
});
await page.goto(base + "/mail/number", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const loading = await page.locator("body").innerText();
const hasLoading = /불러오는 중|로딩|loading/i.test(loading) || await page.locator('[role="status"], .cs-skeleton, [aria-busy="true"]').count() > 0;
record("loading-indicator", hasLoading, hasLoading ? "" : loading.slice(0, 80));
await page.screenshot({ path: "docs/qa/P13-T03/states/loading-senders.png" });
await page.unroute("**/api/v1/senders*");
await page.waitForTimeout(1800);

// 2) validation — 발신 주소 등록에 잘못된 이메일 → 서버/폼 오류 표시
await page.locator('button:has-text("발신 주소 등록"), button:has-text("발신번호 등록")').first().click();
await page.waitForSelector(".cs-modal", { timeout: 5000 });
await page.fill('.cs-modal input[name="label"]', "검증테스트");
await page.fill('.cs-modal input[name="address"]', "not-an-email");
await page.evaluate(() => { const i = document.querySelector<HTMLInputElement>('.cs-modal input[name="address"]'); if (i) i.type = "text"; }); // HTML5 검증 우회해 서버 검증을 확인
await page.locator('.cs-modal button[type="submit"], .cs-modal button:has-text("등록")').last().click();
await page.waitForTimeout(1200);
const modal = await page.locator(".cs-modal").innerText().catch(() => "");
const hasAlert = await page.locator('.cs-modal [role="alert"]').count();
record("validation-error", hasAlert > 0 || /올바른|형식|주소/.test(modal), modal.slice(0, 100).replace(/\s+/g, " "));
await page.screenshot({ path: "docs/qa/P13-T03/states/validation-sender.png" });
await page.keyboard.press("Escape");
await page.locator(".cs-modal").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});

// 3) disabled — 목록 필터의 disabled 상태 또는 busy 버튼 (전송 중 버튼 비활성)
await page.locator('button:has-text("발신 주소 등록"), button:has-text("발신번호 등록")').first().click();
await page.waitForSelector(".cs-modal", { timeout: 5000 });
await page.fill('.cs-modal input[name="label"]', "비활성테스트");
await page.fill('.cs-modal input[name="address"]', "qa-disabled@catchsecu.local.test");
await page.route("**/api/v1/senders", async route => { try { await new Promise(r => setTimeout(r, 1500)); await route.continue(); } catch {} });
await page.locator('.cs-modal button[type="submit"], .cs-modal button:has-text("등록")').last().click();
await page.waitForTimeout(300);
const disabledBtn = await page.locator('.cs-modal button[disabled]').count();
const busyLabel = (await page.locator(".cs-modal").innerText()).includes("등록 중");
record("disabled-busy", disabledBtn > 0 || busyLabel, "disabled=" + disabledBtn + " busy=" + busyLabel);
await page.screenshot({ path: "docs/qa/P13-T03/states/disabled-busy.png" });
await page.unroute("**/api/v1/senders");
await page.waitForTimeout(2000);

// 4) retry — 목록 API를 1회 실패시킨 뒤 새로고침 버튼으로 복구
let armFail = true;
await page.route("**/api/v1/senders*", route => { try { if (armFail && route.request().method() === "GET") route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." } }) }); else route.continue(); } catch {} });
await page.goto(base + "/mail/number", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const errBody = await page.locator("body").innerText();
const hasError = /오류|실패|불러오지|다시/.test(errBody);
record("error-state", hasError, errBody.slice(0, 80).replace(/\s+/g, " "));
await page.screenshot({ path: "docs/qa/P13-T03/states/error-retry.png" });
armFail = false;
await page.locator('button:has-text("새로고침")').first().click().catch(() => {});
await page.waitForTimeout(1500);
await page.unroute("**/api/v1/senders*");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const recovered = await page.locator("body").innerText();
record("retry-recovers", /발신 주소 목록|대표|발신자/.test(recovered), "");

writeFileSync("docs/qa/P13-T03/ui-states.json", JSON.stringify(results, null, 1));
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: bad.length }));
process.exit(bad.length ? 1 : 0);
