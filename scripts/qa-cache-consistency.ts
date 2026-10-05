// P13-T03: 서버 캐시 무효화 일관성 — 서버 측 변경 후 새로고침/뒤로가기에서 stale 데이터가 보이지 않아야 한다.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../src/server/env";
import { db } from "../src/server/db";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// 로그인 → 회사 A 컨텍스트
const res = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
if (res.status() !== 200) throw new Error("login " + res.status());
await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// 1) 서버에서 서비스 외부명을 변경 → 브라우저를 새로고침하면 새 값이 보여야 한다
const service = await db.service.findFirstOrThrow({ where: { tenantId: "10000000-0000-4000-8000-000000000001", name: "기본 서비스" } });
const probe = "QA캐시" + Date.now().toString(36);
const before = service.externalName;
await db.service.update({ where: { id: service.id }, data: { externalName: probe } });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const body1 = await page.locator("body").innerText();
record("reload-shows-fresh-name", body1.includes(probe), probe);

// 2) 다른 화면으로 이동 → 브라우저 뒤로가기 → 여전히 최신값(bfcache·SPA 캐시 stale 여부)
await page.goto(base + "/my-page/profile", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.goBack();
await page.waitForTimeout(1200);
const body2 = await page.locator("body").innerText();
record("back-shows-fresh-name", body2.includes(probe), "after back");

// 3) 구값으로 되돌리고 새로고침 → 구값이 다시 보여야 한다(읽기 캐시가 없음을 재확인)
await db.service.update({ where: { id: service.id }, data: { externalName: before } });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const body3 = await page.locator("body").innerText();
record("reload-shows-restored-name", body3.includes(before) && !body3.includes(probe), before);

writeFileSync("docs/qa/P13-T03/cache-consistency.json", JSON.stringify(results, null, 1));
await browser.close(); await db.$disconnect();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
