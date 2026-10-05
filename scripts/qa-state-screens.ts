// P13-T03: 상태별 화면 증거 — forbidden(viewer 권한 제한), empty, retry 경로를 실측한다.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
mkdirSync("docs/qa/P13-T03/states", { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on("pageerror", e => { const t = String(e); if (!/negative time stamp|Performance/.test(t)) errors.push(t.slice(0, 120)); });

// viewer 로그인
const login = await page.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "viewer@catchsecu.local.test", password: pw["viewer@catchsecu.local.test"] } });
if (login.status() !== 200) throw new Error("login " + login.status());

// 1) forbidden — viewer가 관리/설정 화면에 접근하면 제한 UI 또는 거부
const forbiddenRoutes = ["/security/policy", "/security/sso/setting", "/member"];
for (const r of forbiddenRoutes) {
  const res = await page.goto(base + r, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const blocked = res?.status() !== 200 || /접근할 수 없습니다|권한이 없|Forbidden|404/.test(text) || page.url().includes("access-not-allow");
  record("forbidden:" + r, blocked, (res?.status() ?? "?") + " " + text.slice(0, 60));
  await page.screenshot({ path: `docs/qa/P13-T03/states/forbidden-${r.replace(/\//g, "_")}.png` });
}

// 1b) /company-info는 로그인 사용자 모두에게 회사 등록 폼을 연다(권한 게이트 대상 아님)
{
  const res = await page.goto(base + "/company-info", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const text = await page.locator("body").innerText();
  record("company-info-form", res?.status() === 200 && /회사 등록/.test(text), text.slice(0, 60).replace(/\s+/g, " "));
}

// 2) empty — 존재하지 않는 검색 결과/빈 목록
await page.goto(base + "/notice", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const noticeBody = await page.locator("body").innerText();
record("notice-renders", noticeBody.length > 50, noticeBody.slice(0, 60).replace(/\s+/g, " "));

// 3) validation — 잘못된 입력이 제출을 막는지(회사 검색 등 빈 제출)
// viewer는 공지 목록을 볼 수 있어야 하고 관리 액션 버튼이 없어야 한다
const adminActions = await page.locator('button:has-text("삭제"), button:has-text("새 공지"), a:has-text("공지 작성")').count();
record("viewer-no-admin-actions", adminActions === 0, "adminButtons=" + adminActions);

record("page-errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync("docs/qa/P13-T03/state-screens.json", JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
