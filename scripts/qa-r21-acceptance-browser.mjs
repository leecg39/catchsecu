/* global taskSpace */
const fs = await import("node:fs/promises");
const path = await import("node:path");
const root = "/Users/user01/Desktop/캐쳐시큐/catchsecu-clone";
const origin = "http://127.0.0.1:3198";
const fixture = JSON.parse(await fs.readFile(path.join(root, ".local/qa-r21-acceptance.json"), "utf8"));
const output = path.join(root, "docs/qa/R21-T04/current");
const restart = process.env.QA_R21_RESTART === "1";
const task = await taskSpace(2);
if (task.ownership !== "agent") throw new Error("Ego TaskSpace 2 control is required");
const page = task.page("p5");
const report = { checkedAt: new Date().toISOString(), browser: "Ego Lite", spaceId: 2, restart, checks: [], widths: [], result: "running" };
const instrument = await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
  window.__r21AcceptanceErrors=[];
  addEventListener('error',event=>window.__r21AcceptanceErrors.push(String(event.message)));
  addEventListener('unhandledrejection',event=>window.__r21AcceptanceErrors.push(String(event.reason)));
})();` });

async function login() {
  await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', fixture.actors.owner.email);
  await page.fill('input[name="password"]', fixture.actors.owner.password);
  await page.click('loc=role:button[name="로그인"]', { label: "R21 수용 계정 로그인" });
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}
async function waitText(text) {
  await page.waitForFunction(expected => document.body.innerText.includes(expected), text, { timeout: 15000 });
}
async function check(pathname, text, absent) {
  await page.goto(origin + pathname, { waitUntil: "domcontentloaded" });
  await waitText(text);
  const state = await page.evaluate(input => ({ url: location.pathname + location.search, text: document.body.innerText,
    errors: window.__r21AcceptanceErrors ?? [], absent: input.absent ? !document.body.innerText.includes(input.absent) : true }), { absent });
  const passed = state.text.includes(text) && state.absent && state.errors.length === 0;
  report.checks.push({ pathname, expected: text, absent: absent ?? null, passed, url: state.url, errors: state.errors.length });
  if (!passed) throw new Error(`Browser check failed: ${pathname}`);
}

try {
  if (restart) {
    await page.goto(origin + `/bill/${fixture.orderId}/refund`, { waitUntil: "domcontentloaded" });
    await waitText("환불 완료");
    report.checks.push({ pathname: new URL(await page.url()).pathname, persistedSessionAfterRestart: true, passed: true });
    await page.evaluate(async () => { await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
    await login();
    report.checks.push({ pathname: "/login", freshReloginAfterRestart: true, passed: true });
  } else {
    await page.goto(origin + "/pay/history", { waitUntil: "domcontentloaded" });
    if (new URL(await page.url()).pathname === "/login") await login();
  }

  await check(`/pay/result/success/${fixture.orderId}?result=forged`, "결제가 확인됐습니다");
  await check("/pay/history", "잔액 전액 환불");
  await check(`/bill/${fixture.orderId}/refund`, "환불 완료");
  await check("/pay/cancel", "현재 환불을 요청할 수 있는 결제 완료 주문이 없습니다", "환불 내역 확인 및 요청");
  for (const width of [1440, 390]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth,
      errors: (window.__r21AcceptanceErrors ?? []).length }));
    report.widths.push({ width, ...state });
    await page.screenshot({ path: path.join(output, `browser-${restart ? "after" : "before"}-${width}.png`), fullPage: true });
  }
  report.result = report.checks.every(item => item.passed) && report.widths.every(item => !item.overflow && item.errors === 0) ? "passed" : "failed";
} catch (error) {
  report.result = "failed"; report.error = String(error); throw error;
} finally {
  await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: instrument.identifier });
  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await fs.writeFile(path.join(output, `browser-${restart ? "after" : "before"}-restart.json`), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ result: report.result, restart, checks: report.checks.length, widths: report.widths }));
if (report.result !== "passed") throw new Error("R21 acceptance browser failed");
