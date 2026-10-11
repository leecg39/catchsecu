/* global taskSpace */
const fs = await import("node:fs/promises");
const path = await import("node:path");
const root = "/Users/user01/Desktop/캐쳐시큐/catchsecu-clone";
const fixture = JSON.parse(await fs.readFile(path.join(root, ".local/qa-r22-ui.json"), "utf8"));
const output = path.join(root, "docs/qa/R22-T04/current"), origin = fixture.origin;
const restart = process.env.QA_R22_RESTART === "1";
const task = await taskSpace(2);
if (task.ownership !== "agent") throw new Error("Ego TaskSpace 2 control is required");
const page = task.page("p5");
const report = { checkedAt: new Date().toISOString(), browser: "Ego Lite", spaceId: 2, restart, checks: [], widths: [], result: "running" };
const instrument = await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
  window.__r22Errors=[]; addEventListener('error',e=>window.__r22Errors.push(String(e.message)));
  addEventListener('unhandledrejection',e=>window.__r22Errors.push(String(e.reason)));
})();` });

async function login() {
  await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', fixture.actors.owner.email);
  await page.fill('input[name="password"]', fixture.actors.owner.password);
  await page.evaluate(() => document.querySelector("form")?.requestSubmit());
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}
async function waitText(value) { await page.waitForFunction(text => document.body.innerText.includes(text), value, { timeout: 15000 }); }
async function check(pathname, expected, absent) {
  await page.goto(origin + pathname, { waitUntil: "domcontentloaded" });
  await waitText(expected);
  const state = await page.evaluate(input => ({ url: location.pathname + location.search, text: document.body.innerText,
    errors: window.__r22Errors ?? [], absent: input.absent ? !document.body.innerText.includes(input.absent) : true }), { absent });
  const passed = state.text.includes(expected) && state.absent && state.errors.length === 0;
  report.checks.push({ pathname, expected, absent: absent ?? null, passed, url: state.url, errors: state.errors.length });
  if (!passed) throw new Error(`R22 browser check failed: ${pathname}`);
}

try {
  if (restart) {
    await page.goto(origin + `/log/info-monitoring?q=submission.r22_ui&searchField=action&serviceId=${fixture.serviceId}`, { waitUntil: "domcontentloaded" });
    await waitText("submission.r22_ui");
    report.checks.push({ pathname: "/log/info-monitoring", persistedSessionAfterRestart: true, passed: true });
    await page.evaluate(async () => { await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
    await login(); report.checks.push({ pathname: "/login", freshReloginAfterRestart: true, passed: true });
  } else {
    await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => { await fetch("/api/v1/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
    await login();
  }
  const routes = [
    ["/log/service", "service.r22_ui"], ["/log/info-monitoring", "submission.r22_ui"],
    ["/log/ad-monitoring", "marketing.r22_ui"], ["/log/customer", "subject.r22_ui"],
    ["/log/member", "invitation.r22_ui"], ["/log/authority", "policy.r22_ui"],
    ["/log/external-viewer", "share.r22_ui"], ["/log/access-history", "session.r22_ui"],
    ["/log/mail", "campaign.r22_ui"],
  ];
  for (const [pathname, action] of routes) {
    const query = `?q=${encodeURIComponent(action)}&searchField=action&serviceId=${fixture.serviceId}&pageSize=10`;
    await check(pathname + query, action);
  }
  const pageTwo = `/log/info-monitoring?q=submission.r22_same_time&searchField=action&serviceId=${fixture.serviceId}&page=2&pageSize=10`;
  await check(pageTwo, "2 / 3");
  await page.reload({ waitUntil: "domcontentloaded" }); await waitText("2 / 3");
  if (!(await page.url()).includes("page=2")) throw new Error("audit URL page state was not preserved");
  report.checks.push({ pathname: pageTwo, reloadPreservedUrl: true, passed: true });
  await check(`/log/info-monitoring?q=submission.r22_kst_boundary&searchField=action&serviceId=${fixture.serviceId}&from=2026-10-11&to=2026-10-11`,
    "submission.r22_kst_boundary_start", "submission.r22_kst_boundary_before");
  await check(`/my-page/activity-log?q=service.r22_ui&searchField=action&pageSize=10`, "service.r22_ui");
  await check(`/my-page/info-activity-log?scope=sent&reviewId=${fixture.reviewId}`, "R22 화면 검토 요청 원문");
  for (const width of [1440, 390]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
    for (const pathname of ["/log/info-monitoring?q=submission.r22_ui", "/log/authority?q=policy.r22_ui",
      `/my-page/info-activity-log?scope=sent&reviewId=${fixture.reviewId}`]) {
      await page.goto(origin + pathname, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth,
        errors: (window.__r22Errors ?? []).length }));
      report.widths.push({ width, pathname, ...state });
      if (state.overflow || state.errors) throw new Error(`responsive failure: ${pathname} at ${width}`);
    }
    await page.screenshot({ path: path.join(output, `browser-${restart ? "after" : "before"}-${width}.png`), fullPage: true });
  }
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error); throw error; }
finally {
  await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: instrument.identifier });
  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `browser-${restart ? "after" : "before"}-restart.json`), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ result: report.result, restart, checks: report.checks.length, widths: report.widths.length }));
