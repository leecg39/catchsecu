// P06-T06: 공개 폼 전자서명(signature kind) 브라우저 실측.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const token = "YUgHbqxTfvt2o2gSkugVVJbLc8V9Zt24OkVhLrRs04w";
mkdirSync("docs/qa/P06-T06/states", { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(base + "/projects/" + token + "/form", { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2500);
let body = await page.locator("body").innerText();

// 경로가 /f/ 가 아닐 수 있으니 실제 공개 경로를 확인한다
if (!/본인인증|전자서명/.test(body)) {
  for (const p of ["/project/" + token + "/form", "/url/" + token, "/test-projects/" + token + "/form"]) {
    await page.goto(base + p, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2000);
    body = await page.locator("body").innerText();
    if (/본인인증|전자서명/.test(body)) break;
  }
}
record("form-rendered", /본인인증|전자서명/.test(body), body.slice(0, 60).replace(/\s+/g, " "));

// 검증 방법 선택 버튼(두 kind 모두 설정)
const sigBtn = page.locator('button:has-text("전자서명")');
const hasSelector = await sigBtn.count();
record("kind-selector", hasSelector > 0, "buttons=" + hasSelector);
if (hasSelector) {
  await sigBtn.first().click();
  await page.waitForTimeout(1500);
  body = await page.locator("body").innerText();
  record("signature-step", /서명하기|서명자/.test(body), body.match(/서명[^.]*\./)?.[0]?.slice(0, 60) ?? "");
  await page.screenshot({ path: "docs/qa/P06-T06/states/signature-step.png" });
  // 이름·생년월일 입력 후 서명
  await page.fill("#verifyName", "서명자홍");
  await page.fill("#verifyBirth", "1985-05-05");
  await page.locator('button:has-text("서명하기")').click();
  await page.waitForTimeout(2500);
  body = await page.locator("body").innerText();
  record("signature-done", /전자서명을 완료/.test(body), "");
  await page.screenshot({ path: "docs/qa/P06-T06/states/signature-done.png" });
  // 제출 → 접수 번호
  const answer = page.locator('input[name], textarea[name]').first();
  await answer.fill("서명 플로우 실측");
  await page.locator('input[name="consent"]').check().catch(() => {});
  await page.locator('button:has-text("제출하기")').click();
  await page.waitForTimeout(3000);
  body = await page.locator("body").innerText();
  record("submitted", /접수 번호|제출이 완료/.test(body), body.match(/접수 번호[^\n]*/)?.[0] ?? "");
  await page.screenshot({ path: "docs/qa/P06-T06/states/signature-submitted.png" });
}
writeFileSync("docs/qa/P06-T06/signature-browser.json", JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
