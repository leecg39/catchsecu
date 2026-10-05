// 스킵된 12개 동적 경로 보조 스윕 — 실제 fixture/플러시블 값으로 "우아한 렌더"를 확인한다.
import { chromium } from "playwright";
import { db } from "../src/server/db";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const outDir = "docs/qa/P13-T04";
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));

// 실제 fixture 조회
const order = await db.paymentOrder.findFirst({ select: { id: true } });
const purchaseId = order?.id ?? "00000000-0000-4000-8000-000000000000";
const formToken = "YUgHbqxTfvt2o2gSkugVVJbLc8V9Zt24OkVhLrRs04w"; // 방금 게시한 검증 폼
const infoOwner = "A".repeat(43);
const routes: [string, string][] = [
  ["/identification/success", "인증 콜백 성공"],
  ["/saeol/fail/testorg", "새올 연동 실패"],
  ["/document/P/" + "A".repeat(43), "문서 P 토큰"],
  ["/document/C/" + "A".repeat(43), "문서 C 토큰"],
  ["/document/OC/" + "A".repeat(43), "문서 OC 토큰"],
  ["/infoOwner/agree-history/" + infoOwner, "정보주체 동의 이력"],
  ["/infoOwner/action-history/" + infoOwner, "정보주체 조치 이력"],
  ["/pay/result/success/" + purchaseId, "결제 성공"],
  ["/pay/credit/success/" + purchaseId, "크레딧 성공"],
  ["/pay/plus/success/" + purchaseId, "플러스 성공"],
  ["/pay/plus/success/" + purchaseId + "/basic", "플러스 성공+타입"],
  ["/pay/plus/fail/USER_CANCEL", "플러스 실패"],
  ["/projects/" + formToken + "/form", "공개 폼(검증)"],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const res0 = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
if (res0.status() !== 200) throw new Error("login " + res0.status());
const results: { route: string; note: string; status?: number; title?: string; overflow?: boolean; error?: string }[] = [];
for (const [route, note] of routes) {
  const r: (typeof results)[number] = { route, note };
  try {
    const res = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 15000 });
    r.status = res?.status();
    await page.waitForTimeout(800);
    r.title = await page.title();
    r.overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 100);
    (r as Record<string, unknown>).bodyPreview = bodyText;
  } catch (e) { r.error = String(e).slice(0, 120); }
  results.push(r);
}
await writeFile(`${outDir}/dynamic-skipped-sweep.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.map(r => ({ route: r.route, status: r.status, overflow: r.overflow, err: r.error })), null, 1));
await browser.close();
await db.$disconnect();
