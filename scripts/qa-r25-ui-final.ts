// R25-T05 UI·접근성·성능·원본 대조 마무리.
// A) 접근성: 대표 페이지에서 lang/main/h1/label/focus/오류알림/한글 줄바꿈/모바일 오버플로 측정.
// B) 성능: 실제 데이터량과 함께 목록 API·작업대기를 측정(임의 수치 대신 fixture 계약 기록).
// C) 원본 대조: docs/design-references 캡처와 현재 화면의 픽셀 차이 비율 목록. 100% 일치 주장 금지.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R25-T05");
await mkdir(`${outDir}/screens`, { recursive: true });
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));

// ---------- A) 접근성 ----------
const a11yPages = ["/dashboard", "/notice", "/form/manage", "/sms", "/security", "/my-page/info", "/log/authority", "/pay/history", "/help-center", "/jap_intro"];
type A11yRow = { page: string; lang?: string; hasH1orMain?: boolean; skipLink?: boolean; focusables?: number; labelsCoverage?: number; alertRegions?: number; tabMoves?: boolean; overflow390?: boolean; wordBreak?: string; errors: string[] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
{
  const res = await ctx.request.post(base + "/api/v1/auth/sign-in/email", { headers: { origin: base, "content-type": "application/json" },
    data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
  assert.equal(res.status(), 200, "login");
}
const page = await ctx.newPage();
const a11y: A11yRow[] = [];
for (const route of a11yPages) {
  const row: A11yRow = { page: route, errors: [] };
  try {
    await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 8000 }).catch(() => row.errors.push("empty-body"));
    row.lang = await page.evaluate(() => document.documentElement.lang || null) as string ?? undefined;
    const probe = await page.evaluate(() => {
      const h1 = !!document.querySelector("h1,h2,[role='heading']");
      const main = !!document.querySelector("main,[role='main'],#main");
      const skip = [...document.querySelectorAll("a")].some(a => (a.getAttribute("href") ?? "").startsWith("#") && /건너|skip|본문/.test(a.textContent ?? ""));
      const focusables = document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])").length;
      const inputs = [...document.querySelectorAll("input:not([type='hidden']),select,textarea")];
      const labeled = inputs.filter(el => el.id && document.querySelector(`label[for='${el.id}']`)
        || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")
        || el.closest("label") || el.getAttribute("placeholder"));
      const alerts = document.querySelectorAll("[role='alert'],[aria-live],[role='status']").length;
      const wb = getComputedStyle(document.body).wordBreak;
      return { h1, main, skip, focusables, labeled: inputs.length ? labeled.length / inputs.length : 1, alerts, wb };
    });
    row.hasH1orMain = probe.h1 || probe.main;
    row.skipLink = probe.skip;
    row.focusables = probe.focusables;
    row.labelsCoverage = Math.round(probe.labeled * 100) / 100;
    row.alertRegions = probe.alerts;
    row.wordBreak = probe.wb;
    // 키보드: Tab 순회가 실제로 focus를 이동하는가
    const before = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    const after = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.textContent ?? "").slice(0, 20));
    row.tabMoves = before !== after && after !== "BODY:";
    // 모바일 390 페이지 오버플로
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    row.overflow390 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (e) { row.errors.push(String(e).slice(0, 120)); }
  a11y.push(row);
  console.log("a11y", route, JSON.stringify({ ...row, errors: undefined }), row.errors.join(";"));
}
assert.ok(a11y.every(r => r.lang === "ko"), "all pages lang=ko");
assert.ok(a11y.every(r => r.hasH1orMain), "every page exposes heading/main landmark");
assert.ok(a11y.every(r => r.focusables && r.focusables > 0), "every page has focusable controls");
assert.ok(a11y.every(r => r.tabMoves), "Tab moves focus on every page");
assert.ok(a11y.every(r => r.overflow390 === false), "no 390px page overflow");

// ---------- B) 성능 (실제 데이터량 + 측정 환경을 계약으로 기록) ----------
const counts = {
  submissions: await db.submission.count(),
  auditEvents: await db.auditEvent.count(),
  forms: await db.form.count(),
  notices: await db.notice.count(),
  campaigns: await db.campaign.count(),
  jobsQueued: await db.job.count({ where: { status: { in: ["queued", "retry"] } } }),
  jobsLeased: await db.job.count({ where: { status: "leased" } }),
};
const sessionCookie = (await ctx.cookies(base)).map(c => `${c.name}=${c.value}`).join("; ");
async function timed(path: string, n = 5) {
  const times: number[] = [];
  let status = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fetch(base + "/api/v1" + path, { headers: { cookie: sessionCookie, origin: base } });
    status = r.status; await r.arrayBuffer();
    times.push(Math.round(performance.now() - t0));
  }
  times.sort((a, b) => a - b);
  return { path, status, medianMs: times[Math.floor(n / 2)], maxMs: times[n - 1] };
}
const perfTargets = ["/notices", "/audit-events?pageSize=50", "/forms?pageSize=50", `/campaigns?serviceId=20000000-0000-4000-8000-000000000001&channel=sms`, "/support-tickets"].map(p => timed(p));
const perf = [] as Awaited<ReturnType<typeof timed>>[];
for (const t of perfTargets) perf.push(await t);
for (const p of perf) console.log("perf", p.path, p.status, `${p.medianMs}ms median / ${p.maxMs}ms max`);
// 작업 대기 상태: 가장 오래된 queued 작업의 dueAt 경과
const oldest = await db.job.findFirst({ where: { status: { in: ["queued", "retry"] } }, orderBy: { dueAt: "asc" }, select: { dueAt: true, type: true } });
const perfContract = { environment: "local dev server 3121, production build, PostgreSQL localhost", measuredAt: new Date().toISOString(),
  dataset: counts, oldestQueuedJob: oldest ? { type: oldest.type, dueAt: oldest.dueAt } : null,
  targets: { listApiMedianMs: 3000, note: "측정 데이터량 기준 목록 API 중앙값 3초 이내 — 근거는 fixture 데이터량" },
  results: perf.map(p => ({ ...p, pass: p.status === 200 && p.medianMs <= 3000 })) };
assert.ok(perfContract.results.every(r => r.pass), JSON.stringify(perfContract.results.filter(r => !r.pass)));

// ---------- C) 원본 대조 ----------
// 파일명 → 경로 후보: `--`/`__`→/ 우선, 미등록이면 `_`→/ 와 첫 `-`→/ 도 시도. 등록 경로만 비교.
const refRoot = "docs/design-references";
const manifestPaths = new Set((JSON.parse(await readFile("src/data/route-manifest.json", "utf8")) as { path: string }[]).map(r => r.path));
const isKnown = (route: string) => manifestPaths.has(route) || ["/kakao-playground", "/integration/message"].some(p => route === p);
type RefMap = { file: string; route: string; width: number };
const refMaps: RefMap[] = [];
const unmapped: string[] = [];
for (const dir of ["app.catchsecu.com", "forms", "management", "public", "services"]) {
  for (const file of await readdir(`${refRoot}/${dir}`).catch(() => [] as string[])) {
    if (!file.endsWith(".png")) continue;
    if (/-detail|-modal|-hover|-tab-|second-tab|no-mail|policy-tab|final-dashboard/.test(file)) continue;
    const m = file.match(/^(.*?)-?(1440|768|390)?\.png$/);
    if (!m) continue;
    const stem = m[1].replace(/^_+|_+$/g, "");
    const width = m[2] ? Number(m[2]) : 1440;
    const candidates = [
      "/" + stem.replace(/__|--/g, "/"),
      "/" + stem.replace(/__/g, "/").replace(/--/g, "/").replace(/_/g, "/"),
      "/" + stem.replace(/_/g, "/"),
      "/" + stem.replace(/-/, "/"),
    ];
    const route = candidates.find(c => isKnown(c));
    if (route) refMaps.push({ file: `${dir}/${file}`, route, width });
    else unmapped.push(`${dir}/${file}`);
  }
}
async function diffPct(refPath: string, curPath: string, width: number) {
  const ref = await sharp(refPath).resize({ width, withoutEnlargement: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cur = await sharp(curPath).resize({ width, withoutEnlargement: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const h = Math.max(1, Math.floor(Math.min(ref.info.height, cur.info.height)));
  const len = Math.min(ref.data.length, cur.data.length, width * h * 4);
  let diff = 0;
  for (let i = 0; i < len; i += 4) {
    const d = Math.abs(ref.data[i] - cur.data[i]) + Math.abs(ref.data[i + 1] - cur.data[i + 1]) + Math.abs(ref.data[i + 2] - cur.data[i + 2]);
    if (d > 48) diff++;
  }
  return Math.round((diff / (len / 4)) * 10000) / 100;
}
const diffs: { file: string; route: string; width: number; status?: number; diffPct?: number; verdict: string }[] = [];
for (const ref of refMaps) {
  const shot = `${outDir}/screens/${ref.width}${ref.route.replaceAll("/", "_")}.png`;
  const entry: (typeof diffs)[number] = { ...ref, verdict: "unreached" };
  try {
    const res = await page.setViewportSize({ width: ref.width, height: 900 }).then(() => page.goto(base + ref.route, { waitUntil: "domcontentloaded", timeout: 15000 }));
    entry.status = res?.status();
    if (res?.status() === 200) {
      await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 6000 }).catch(() => null);
      await page.waitForTimeout(400);
      await page.screenshot({ path: shot });
      entry.diffPct = await diffPct(`${refRoot}/${ref.file}`, shot, ref.width);
      entry.verdict = entry.diffPct <= 2 ? "close" : entry.diffPct <= 15 ? "similar" : "diverged";
    } else entry.verdict = `http-${entry.status}`;
  } catch (e) { entry.verdict = "error: " + String(e).slice(0, 80); }
  diffs.push(entry);
}
await page.setViewportSize({ width: 1440, height: 900 });
const byVerdict = diffs.reduce<Record<string, number>>((acc, d) => { acc[d.verdict] = (acc[d.verdict] ?? 0) + 1; return acc; }, {});
console.log("원본대조:", JSON.stringify(byVerdict));

await browser.close();
await writeFile(resolve(outDir, "ui-final.json"), JSON.stringify({ checkedAt: new Date().toISOString(),
  a11y, perfContract, sourceDiff: { references: diffs.length, unmapped, byVerdict, rows: diffs } }, null, 2) + "\n");
console.log(`R25-T05: a11y ${a11y.length}p, perf ${perf.length} api, 원본대조 ${diffs.length} refs`);
await db.$disconnect();
