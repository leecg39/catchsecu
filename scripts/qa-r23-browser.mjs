/* global taskSpace */
const fs = await import("node:fs/promises");
const path = await import("node:path");

const root = "/Users/user01/Desktop/캐쳐시큐/catchsecu-clone";
const fixture = JSON.parse(await fs.readFile(path.join(root, ".local/qa-r23-ui.json"), "utf8"));
const exportTotal = fixture.exportTotal ?? 11;
const output = path.join(root, "docs/qa/R23-T04/current");
const origin = fixture.origin;
const restart = process.env.QA_R23_RESTART === "1" || await fs.access(path.join(root, ".local/qa-r23-restart"))
  .then(() => true).catch(() => false);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const period = `from=${fixture.month}-01&to=${today}`;
const task = await taskSpace(2);
if (task.ownership !== "agent") throw new Error("Ego TaskSpace 2 control is required");
const page = task.page("p5");
const report = {
  checkedAt: new Date().toISOString(), browser: "Ego Lite", spaceId: 2,
  restart, checks: [], widths: [], result: "running",
};
const instrument = await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
  window.__r23Errors=[]; window.__r23Requests=[];
  addEventListener('error',e=>window.__r23Errors.push(String(e.message)));
  addEventListener('unhandledrejection',e=>window.__r23Errors.push(String(e.reason)));
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    try { const value=typeof input==='string' ? input : input?.url; if (value) window.__r23Requests.push(value); } catch {}
    return originalFetch(input,init);
  };
})();` });

async function login() {
  await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', fixture.actors.owner.email);
  await page.fill('input[name="password"]', fixture.actors.owner.password);
  await page.evaluate(() => document.querySelector("form")?.requestSubmit());
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

async function waitText(value) {
  await page.waitForFunction(text => document.body.innerText.replace(/\s+/g, " ").includes(text), value, { timeout: 15000 });
}

async function check(pathname, expected, endpoint) {
  await page.goto(origin + pathname, { waitUntil: "domcontentloaded" });
  for (const value of expected) await waitText(value);
  if (endpoint) await page.waitForFunction(value => (window.__r23Requests ?? []).some(url => url.includes(value)), endpoint, { timeout: 15000 });
  const state = await page.evaluate(input => ({
    url: location.pathname + location.search,
    text: document.body.innerText,
    errors: window.__r23Errors ?? [],
    requests: (window.__r23Requests ?? []).filter(value => typeof value === "string" && value.includes("/api/v1/")),
    expected: input.expected.every(value => document.body.innerText.replace(/\s+/g, " ").includes(value)),
    endpoint: !input.endpoint || (window.__r23Requests ?? []).some(value => value.includes(input.endpoint)),
  }), { expected, endpoint });
  const passed = state.expected && state.endpoint && state.errors.length === 0;
  report.checks.push({ pathname, expected, endpoint: endpoint ?? null, passed, url: state.url,
    errors: state.errors, requests: state.requests });
  if (!passed) throw new Error(`R23 browser check failed: ${pathname}`);
  return state;
}

try {
  if (restart) {
    await check(`/log/month-monitoring?month=${fixture.month}&scope=${fixture.serviceAId}&exportPage=2&exportPageSize=10`,
      ["마감 데이터 조회", `${exportTotal}개 · 2페이지`], "/api/v1/analytics/exports?");
    report.checks.push({ pathname: "/log/month-monitoring", persistedSessionAfterRestart: true, passed: true });
    await page.evaluate(async () => {
      await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    });
    await login();
    report.checks.push({ pathname: "/login", freshReloginAfterRestart: true, passed: true });
  } else {
    await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    });
    await login();
  }

  await check(`/dashboard?${period}`, ["대시보드", "현재 보유", "3 건", "활성 서비스 2개"], "/api/v1/analytics/dashboard?");
  await check(`/dashboard/${fixture.serviceAId}?${period}`, ["서비스 대시보드", "현재 보유", "2 건"], "/api/v1/analytics/dashboard?");
  const privacyPath = `/privacy-detail/${fixture.serviceAId}?${period}&q=R23`;
  await check(privacyPath, ["개인정보 응답 보유 현황", "현재 보유 응답 2 건", "선택 기간 접수 3 건",
    "선택 기간 동의 철회 1 건", "선택 기간 파기 완료 1 건", "R23 서비스 A"], "/api/v1/analytics/privacy?");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText("현재 보유 응답 2 건");
  if (!(await page.url()).includes("q=R23")) throw new Error("privacy filter URL was not preserved after reload");
  report.checks.push({ pathname: privacyPath, reloadPreservedUrl: true, passed: true });

  const marketingPath = `/marketing-detail/${fixture.serviceAId}?${period}&q=R23`;
  await check(marketingPath, ["마케팅 동의 현황", "현재 동의 1", "현재 철회 1", "R23 서비스 A 1 1 1",
    "기간 내 동의 기록 1", "기간 내 철회 기록 1", "기간 내 삭제 기록 1"], "/api/v1/analytics/marketing?");
  await page.evaluate(() => history.back());
  await page.waitForURL("**/privacy-detail/**", { timeout: 15000 });
  await waitText("현재 보유 응답 2 건");
  if (!(await page.url()).includes("q=R23")) throw new Error("privacy URL was not restored by browser back");
  report.checks.push({ pathname: privacyPath, browserBackPreservedUrl: true, passed: true });

  const compliancePath = `/log/month-monitoring?month=${fixture.month}&scope=${fixture.serviceAId}&exportPage=2&exportPageSize=10`;
  await check(compliancePath, ["마감 데이터 조회", "법적 준수 여부는 미판정입니다.", "보유 응답 2건",
    "마감에 저장된 점검 근거", `${exportTotal}개 · 2페이지`], "/api/v1/analytics/exports?");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(`${exportTotal}개 · 2페이지`);
  const complianceUrl = await page.url();
  if (!complianceUrl.includes("exportPage=2") || !complianceUrl.includes("exportPageSize=10"))
    throw new Error("compliance export page URL was not preserved after reload");
  report.checks.push({ pathname: compliancePath, reloadPreservedUrl: true, passed: true });

  for (const width of [1440, 390]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false,
    });
    for (const pathname of [
      `/dashboard/${fixture.serviceAId}?${period}`,
      privacyPath,
      marketingPath,
      compliancePath,
    ]) {
      await page.goto(origin + pathname, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !document.body.innerText.includes("불러오는 중입니다") &&
        !document.body.innerText.includes("집계 중입니다"), undefined, { timeout: 15000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        errors: (window.__r23Errors ?? []).length,
      }));
      report.widths.push({ width, pathname, ...state });
      if (state.overflow || state.errors) throw new Error(`responsive failure: ${pathname} at ${width}`);
    }
    await page.screenshot({
      path: path.join(output, `browser-${restart ? "after" : "before"}-${width}.png`), fullPage: true,
    });
  }
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = String(error);
  throw error;
} finally {
  await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: instrument.identifier });
  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `browser-${restart ? "after" : "before"}-restart.json`),
    JSON.stringify(report, null, 2) + "\n");
}

console.log(JSON.stringify({ result: report.result, restart, checks: report.checks.length, widths: report.widths.length }));
