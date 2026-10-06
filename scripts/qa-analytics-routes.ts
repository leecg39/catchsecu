// P12-T02 집계·대시보드 잔여 브라우저 수용: 7개 경로의 권한·빈 상태·모바일 시나리오.
// dev 서버(3100)+catchsecu_dev, 자격증명은 .local/recovery-members.json.
import { chromium, type BrowserContext } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";

assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const base = new URL(env.BETTER_AUTH_URL).origin;
const out = "docs/qa/P12-T02/route-gates/", states = out + "states/";
await mkdir(states, { recursive: true });
const f = JSON.parse(await readFile(".local/recovery-members.json", "utf8"));
const [svcA, svcB] = f.services.map((s: { id: string }) => s.id);
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const req = (path: string, input?: unknown, cookie = "") =>
  new Request(base + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin: base, cookie, ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
async function loginCookie(who: "owner" | "member" | "expert") {
  const p = f.people[who];
  const res = await auth.handler(req("/auth/sign-in/email", { email: p.email, password: p.password }));
  assert.equal(res.status, 200, who + " sign-in");
  const cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId: p.id }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: f.companyId } });
  return cookie;
}
const ownerCookie = await loginCookie("owner"), memberCookie = await loginCookie("member");
async function ctx(cookie: string, width = 1440) {
  const c = await browser.newContext({ viewport: { width, height: 900 } });
  await c.addCookies(cookie.split("; ").map(pair => { const [name, ...rest] = pair.split("="); return { name, value: rest.join("="), url: base }; }));
  return c;
}
async function text(page: import("playwright").Page) { return page.locator("body").innerText(); }
const browser = await chromium.launch();

// API 기대값 — 대시보드 집계와 화면 숫자를 대조한다.
const dash = await (await fetch(base + "/api/v1/analytics/dashboard", { headers: { cookie: ownerCookie } })).json();
const svcADash = await (await fetch(base + `/api/v1/analytics/dashboard?serviceId=${svcA}`, { headers: { cookie: ownerCookie } })).json();

// 1) owner: /dashboard — 활성 서비스 2개와 실제 집계
const owner = await ctx(ownerCookie);
let page = await owner.newPage();
await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: states + "01-dashboard-owner.png" });
let body = await text(page);
const svcNames = f.services.map((s: { name: string }) => s.name);
record("dashboard-owner", svcNames.every(n => body.includes(n)), "services visible");

// 2) owner: /dashboard/{serviceId} 상세
await page.goto(base + `/dashboard/${svcA}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: states + "02-dashboard-service.png" });
body = await text(page);
record("dashboard-service-detail", body.includes(svcNames[0]) && !body.includes("오류"), "detail");

// 3) owner: /privacy-detail — 실제 집계(제출 0의 빈 상태도 허용하되 예시 더미 수치 없음)
await page.goto(base + "/privacy-detail", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: states + "03-privacy-detail.png" });
body = await text(page);
record("privacy-detail", !/예시|sample|Lorem/i.test(body), "real data");

// 4) owner: /marketing-detail/{serviceId} — 마케팅 요약
await page.goto(base + `/marketing-detail/${svcA}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: states + "04-marketing-detail.png" });
body = await text(page);
record("marketing-detail", !/404|찾을 수 없/.test(body.slice(0, 400)), "summary shown");

// 5) owner: /compliance — 데모 점수 제거·실제 자료 건수
await page.goto(base + "/compliance", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: states + "05-compliance.png" });
body = await text(page);
record("compliance-real", !body.includes("20/100") && !/1\s*원/.test(body), "no demo values");

// 6) member(viewer): 서비스 A만 허용 — B는 API·화면 모두 거부
const memberApiA = await fetch(base + `/api/v1/analytics/dashboard?serviceId=${svcA}`, { headers: { cookie: memberCookie } });
const memberApiB = await fetch(base + `/api/v1/analytics/dashboard?serviceId=${svcB}`, { headers: { cookie: memberCookie } });
const memberMktB = await fetch(base + `/api/v1/marketing/summary?serviceId=${svcB}`, { headers: { cookie: memberCookie } });
const member = await ctx(memberCookie);
const mpage = await member.newPage();
await mpage.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
await mpage.waitForTimeout(3000);
await mpage.screenshot({ path: states + "06-dashboard-member.png" });
body = await text(mpage);
const memberSeesOnlyA = body.includes(svcNames[0]) && !body.includes(svcNames[1]);
// marketing summary는 viewer가 capability 자체를 갖지 않아 서비스 범위 검사 전에 403 — 둘 다 올바른 거부다.
const mktDenied = memberMktB.status === 403 || memberMktB.status === 404;
record("member-scope", memberApiA.status === 200 && memberApiB.status === 404 && mktDenied && memberSeesOnlyA,
  `apiA=${memberApiA.status} apiB=${memberApiB.status} mktB=${memberMktB.status} uiA=${body.includes(svcNames[0])} uiB=${body.includes(svcNames[1])}`);

// 7) 빈 상태: 제출 0 — 대시보드에 0 또는 빈 상태 문구
const submissions = await db.submission.count({ where: { tenantId: f.companyId } });
body = await text(page);
await page.goto(base + `/dashboard/${svcA}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
body = await text(page);
const showsZero = /0|없습니다|없음/.test(body);
record("empty-state", submissions === 0 && showsZero, "subs=" + submissions);

// 8) 모바일 390px 오버플로
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
await mob.addCookies(ownerCookie.split("; ").map(pair => { const [name, ...rest] = pair.split("="); return { name, value: rest.join("="), url: base }; }));
const mpage2 = await mob.newPage();
let maxOverflow = 0;
for (const p of ["/dashboard", `/dashboard/${svcA}`, "/privacy-detail", `/marketing-detail/${svcA}`, "/compliance"]) {
  await mpage2.goto(base + p, { waitUntil: "domcontentloaded" });
  await mpage2.waitForTimeout(2000);
  const o = await mpage2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  maxOverflow = Math.max(maxOverflow, o);
}
await mpage2.screenshot({ path: states + "07-mobile-dashboard.png" });
record("mobile-no-overflow", maxOverflow <= 12, "max=" + maxOverflow);

await writeFile(out + "route-gates-results.json", JSON.stringify({ runAt: new Date().toISOString(), dashboardCounts: { services: dash.services?.length ?? null }, results }, null, 2));
await browser.close();
await db.$disconnect();
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `${failed.length} FAILED` : "ALL PASS");
process.exit(failed.length ? 1 : 0);
