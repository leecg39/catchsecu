/* global taskSpace */
const fs = await import("node:fs/promises");
const path = await import("node:path");
const root = "/Users/user01/Desktop/캐쳐시큐/catchsecu-clone";
const origin = "http://127.0.0.1:3180";
const fixture = JSON.parse(await fs.readFile(path.join(root, ".local/qa-r21-ui.json"), "utf8"));
const output = path.join(root, "docs/qa/R21-T03/current");
const screenshots = path.join(output, "screens");
await fs.mkdir(screenshots, { recursive: true });

const task = await taskSpace(2);
if (task.ownership !== "agent") throw new Error("Ego TaskSpace 2 control is required");
const page = task.page("p5");
const report = { checkedAt: new Date().toISOString(), browser: "Ego Lite", spaceId: 2, routes: [], historyFlow: {}, result: "running" };
const instrument = await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
  window.__r21Errors=[];
  addEventListener('error',event=>window.__r21Errors.push(String(event.message)));
  addEventListener('unhandledrejection',event=>window.__r21Errors.push(String(event.reason)));
  const original=console.error;
  console.error=(...args)=>{window.__r21Errors.push(args.map(String).join(' '));original.apply(console,args);};
})();` });

const routeCases = [
  ["/pay/membership/detail", "/pay/membership/detail", "전체 상품 안내"],
  ["/pay/billing-policy", "/pay/license-service", "구독 및 결제수단 관리"],
  ["/pay/license-service", "/pay/license-service", "R21 QA 카드"],
  ["/pay/service-asset", "/pay/service-asset", "서비스 자산"],
  ["/pay/method", "/pay/license-service", "구독 및 결제수단 관리"],
  ["/pay/cancel", "/pay/cancel", "환불할 결제 선택"],
  ["/pay/history", "/pay/history", "무료 체험 시작"],
  ["/pay/usage/history", "/pay/usage/history", "본인인증·전자서명"],
  [`/pay/result/success/${fixture.orderId}`, `/pay/result/success/${fixture.orderId}`, "결제가 확인됐습니다"],
  [`/pay/credit/success/${fixture.orderId}`, `/pay/credit/success/${fixture.orderId}`, "결제가 확인됐습니다"],
  [`/pay/plus/success/${fixture.orderId}`, `/pay/plus/success/${fixture.orderId}`, "결제가 확인됐습니다"],
  [`/pay/plus/success/${fixture.orderId}/credit`, `/pay/plus/success/${fixture.orderId}/credit`, "결제가 확인됐습니다"],
  ["/pay/result/fail", "/pay/result/fail", "주문이 완료되지 않았습니다"],
  ["/pay/plus/fail/provider_error", "/pay/plus/fail/provider_error", "주문이 완료되지 않았습니다"],
  [`/creditBill/${fixture.orderId}`, `/creditBill/${fixture.orderId}`, "청구서 상세"],
  [`/bill/${fixture.orderId}`, `/bill/${fixture.orderId}`, "청구서 상세"],
  [`/bill/${fixture.orderId}/refund`, `/bill/${fixture.orderId}/refund`, "R21 화면 환불 대기"],
];

async function ensureLogin() {
  await page.goto(origin + "/pay/history", { waitUntil: "domcontentloaded" });
  if (new URL(await page.url()).pathname !== "/login") return;
  await page.fill('input[name="email"]', fixture.email);
  await page.fill('input[name="password"]', fixture.password);
  await page.click('loc=role:button[name="로그인"]', { label: "R21 QA 로그인" });
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

async function waitForText(text) {
  await page.waitForFunction(expected => document.body.innerText.includes(expected), text, { timeout: 15000 });
}

try {
  await ensureLogin();
  for (let index = 0; index < routeCases.length; index += 1) {
    const [requested, expectedPath, expectedText] = routeCases[index];
    const result = { requested, expectedPath, expectedText, widths: [] };
    report.routes.push(result);
    await page.goto(origin + requested, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(input => location.pathname === input.path && document.body.innerText.includes(input.text),
      { path: expectedPath, text: expectedText }, { timeout: 15000 });
    result.pathMatched = new URL(await page.url()).pathname === expectedPath;
    for (const width of [1440, 768, 390]) {
      await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        errorCount: (window.__r21Errors ?? []).length,
        errors: window.__r21Errors ?? [],
      }));
      result.widths.push({ width, overflow: state.overflow, errorCount: state.errorCount });
      if ([0, 2, 5, 6, 14, 16].includes(index) && width !== 768)
        await page.screenshot({ path: path.join(screenshots, `${String(index + 1).padStart(2, "0")}-${width}.png`), fullPage: true });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForText(expectedText);
    result.reloaded = new URL(await page.url()).pathname === expectedPath;
    result.result = result.pathMatched && result.reloaded && result.widths.every(item => !item.overflow && item.errorCount === 0) ? "passed" : "failed";
  }

  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(origin + "/pay/history?tab=message&pageSize=20", { waitUntil: "domcontentloaded" });
  await waitForText("사용 확정");
  const message = await page.evaluate(() => ({
    url: location.pathname + location.search,
    rows: document.querySelectorAll("table tbody tr").length,
    serviceShown: document.body.innerText.includes("R21 문자·인증 서비스"),
    pageSize: document.querySelector(".svc-history-pages select")?.value,
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForText("사용 확정");
  const reloadUrl = new URL(await page.url()).pathname + new URL(await page.url()).search;
  await page.click('loc=role:tab[name="본인인증 사용 내역"]', { label: "본인인증 탭 전환" });
  await page.waitForFunction(() => location.search.includes("tab=identity") && document.body.innerText.includes("사용 확정"), undefined, { timeout: 15000 });
  const identity = await page.evaluate(() => ({ url: location.pathname + location.search, rows: document.querySelectorAll("table tbody tr").length,
    serviceShown: document.body.innerText.includes("R21 문자·인증 서비스") }));
  await page.fill('input[name="from"]', "2026-10-11");
  await page.fill('input[name="to"]', "2026-10-01");
  await page.click('.svc-history-filter button[type="submit"]', { label: "잘못된 기간 검증" });
  await waitForText("조회 시작 일은 종료 일보다 늦을 수 없습니다");
  const invalidRangePreserved = !new URL(await page.url()).searchParams.has("from");
  await page.focus('.svc-history-filter button[type="submit"]');
  await page.press('.svc-history-filter button[type="submit"]', "Tab");
  const keyboardFocusMoved = await page.evaluate(() => document.activeElement?.textContent?.includes("검색 조건 초기화") === true);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.search.includes("tab=message") && document.body.innerText.includes("사용 확정"), undefined, { timeout: 15000 });
  const backRestored = new URL(await page.url()).searchParams.get("tab") === "message";
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => location.search.includes("tab=identity") && document.body.innerText.includes("사용 확정"), undefined, { timeout: 15000 });
  const forwardRestored = new URL(await page.url()).searchParams.get("tab") === "identity";
  report.historyFlow = { message, reloadUrl, reloadPreserved: reloadUrl === message.url, identity,
    invalidRangePreserved, keyboardFocusMoved, backRestored, forwardRestored };

  report.result = report.routes.every(item => item.result === "passed") && message.rows === 2 && message.serviceShown &&
    message.pageSize === "20" && report.historyFlow.reloadPreserved && identity.rows === 2 && identity.serviceShown &&
    invalidRangePreserved && keyboardFocusMoved && backRestored && forwardRestored ? "passed" : "failed";
} catch (error) {
  report.result = "failed";
  report.error = String(error);
  throw error;
} finally {
  await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: instrument.identifier });
  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await fs.writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2) + "\n");
}

console.log(JSON.stringify({ result: report.result, routes: report.routes.length, historyFlow: report.historyFlow }));
if (report.result !== "passed") throw new Error("R21 UI browser acceptance failed");
