// P13-T03: conflict(409 VERSION_CONFLICT) 상태 화면 — 같은 프로필을 두 탭에서 편집해 뒤쪽 저장이 거부되는지 확인.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../src/server/env";
import { db } from "../src/server/db";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageA = await ctx.newPage();
const login = await pageA.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "admin@catchsecu.local.test", password: pw["admin@catchsecu.local.test"] } });
if (login.status() !== 200) throw new Error("login " + login.status());

// 탭 A와 탭 B가 같은 버전의 프로필 편집 화면을 연다
const open = async (page: import("playwright").Page) => {
  await page.goto(base + "/my-page/info/edit", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("form", { timeout: 15000 });
  await page.waitForTimeout(1200);
};
const pageB = await ctx.newPage();
await open(pageA); await open(pageB);

// 현재 이름 저장용 조회
const me = await (await pageA.request.get(base + "/api/v1/me")).json();
const originalName = me.name;

// 탭 A에서 이름 저장 → version 증가
const nameA = originalName + "-A" + Date.now().toString(36).slice(-3);
const nameInputA = pageA.locator('label:has-text("이름") input');
await nameInputA.fill("");
await nameInputA.fill(nameA);
await pageA.locator('button[type="submit"], button:has-text("저장")').first().click();
await pageA.waitForTimeout(2000);
const afterA = await pageA.locator("body").innerText();
const aOk = !/VERSION_CONFLICT|다른 곳에서/.test(afterA);
record("tabA-saves-first", aOk, "navigated=" + pageA.url());
const current = await db.user.findFirst({ where: { email: "admin@catchsecu.local.test" }, select: { name: true } });
record("db-has-new-name", current?.name === nameA, current?.name ?? "");

// 탭 B에서 같은(구) 버전으로 저장 시도 → 충돌 오류가 보여야 한다
const nameInputB = pageB.locator('label:has-text("이름") input');
await nameInputB.fill("");
await nameInputB.fill(originalName);
await pageB.locator('button[type="submit"], button:has-text("저장")').first().click();
await pageB.waitForTimeout(2000);
const afterB = await pageB.locator("body").innerText();
const conflicted = /다른 곳에서 (수정|변경)|최신 (내용|프로필) (을 )?다시 불러|VERSION_CONFLICT|충돌/.test(afterB);
record("tabB-shows-conflict", conflicted, afterB.slice(0, 120).replace(/\s+/g, " "));
await pageB.screenshot({ path: "docs/qa/P13-T03/states/conflict-profile.png" });

// 원상복구
await db.user.update({ where: { email: "admin@catchsecu.local.test" }, data: { name: originalName } });

writeFileSync("docs/qa/P13-T03/conflict-state.json", JSON.stringify(results, null, 1));
await browser.close(); await db.$disconnect();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
