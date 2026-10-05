// P06-T06 공개 폼 인증 UI 실측: challenge 렌더 → 이름/생년월일 입력 → 인증 → 제출 → 완료 화면
import { chromium } from "playwright";
const base = "http://localhost:3100";
const url = base + "/projects/YUgHbqxTfvt2o2gSkugVVJbLc8V9Zt24OkVhLrRs04w/form";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=본인인증", { timeout: 10000 });
console.log("1. 인증 섹션 렌더됨");
await page.waitForSelector('#verifyName', { timeout: 10000 });
console.log("2. challenge 완료, 입력 폼 표시");
const submitBtn = await page.locator('button:has-text("제출하기")');
console.log("3. 인증 전 제출 버튼 disabled:", await submitBtn.isDisabled());
await page.fill('#verifyName', "홍길동");
await page.fill('#verifyBirth', "1990-01-01");
await page.click('button:has-text("인증하기")');
await page.waitForSelector("text=본인인증을 완료했습니다", { timeout: 10000 });
console.log("4. 인증 완료 상태 표시됨");
console.log("5. 제출 버튼 disabled:", await submitBtn.isDisabled());
// 답변 입력 + 동의 체크 → 제출
await page.fill('textarea, input[type="text"]', "브라우저 실측 메모");
const consent = await page.locator('input[name="consent"]');
if (await consent.count()) await consent.check();
await submitBtn.click();
await page.waitForSelector("text=제출이 완료되었습니다", { timeout: 15000 });
const receipt = await page.locator("text=접수 번호").textContent();
console.log("6. 제출 완료:", receipt);
await browser.close();
console.log("BROWSER_FLOW_OK");
