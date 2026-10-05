// P08-T01: 발신 주소 관리 브라우저 실측 — 등록 모달→목록 반영→상세·권한 제어.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
mkdirSync("docs/qa/P08-T01/states", { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on("pageerror", e => { const t = String(e); if (!/negative time stamp|Performance/.test(t)) errors.push(t.slice(0, 120)); });

const login = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
if (login.status() !== 200) throw new Error("login " + login.status());

// 1) 발신 주소 목록 — 서비스 선택 필요 시 기본 서비스 선택
await page.goto(base + "/mail/number", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
let body = await page.locator("body").innerText();
if (/서비스를 선택해주세요/.test(body)) {
  // 서비스 선택 모달/버튼을 연다
  await page.locator(".shell-service").click().catch(() => {});
  await page.waitForTimeout(800);
  const svc = page.locator("text=기본 서비스").first();
  await svc.click().catch(() => {});
  await page.waitForTimeout(1200);
  body = await page.locator("body").innerText();
}
record("sender-list-render", /발신 주소 관리|발신번호 관리/.test(body), body.slice(0, 60).replace(/\s+/g, " "));
const canWrite = await page.locator('button:has-text("발신 주소 등록"), button:has-text("발신번호 등록")').count();
record("create-button", canWrite > 0, "buttons=" + canWrite);

// 2) 등록 모달 → 유효한 주소로 생성
if (canWrite > 0) {
  await page.locator('button:has-text("발신 주소 등록"), button:has-text("발신번호 등록")').first().click();
  await page.waitForSelector(".cs-modal", { timeout: 5000 }).catch(() => {});
  const modal = await page.locator(".cs-modal").count();
  record("create-modal", modal > 0, "modals=" + modal);
  if (modal) {
    const tag = Date.now().toString(36);
    await page.fill('.cs-modal input[name="label"]', "QA발신" + tag);
    await page.fill('.cs-modal input[name="address"]', "qa-" + tag + "@catchsecu.local.test");
    await page.locator('.cs-modal button[type="submit"], .cs-modal button:has-text("등록")').last().click();
    await page.waitForTimeout(2000);
    body = await page.locator("body").innerText();
    record("created-and-listed", body.includes("QA발신" + tag), "");
    await page.screenshot({ path: "docs/qa/P08-T01/states/sender-created.png" });
  }
}

// 3) viewer — 생성 버튼 미노출 또는 쓰기 거부
const res2 = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "viewer@catchsecu.local.test", password: pw["viewer@catchsecu.local.test"] } });
await page.goto(base + "/mail/number", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const vBody = await page.locator("body").innerText();
const vCreate = await page.locator('button:has-text("발신 주소 등록"), button:has-text("발신번호 등록")').count();
record("viewer-no-create", vCreate === 0 || /권한이 없|조회할 권한/.test(vBody), "buttons=" + vCreate);
await page.screenshot({ path: "docs/qa/P08-T01/states/sender-viewer.png" });

record("page-errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync("docs/qa/P08-T01/sender-browser.json", JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
