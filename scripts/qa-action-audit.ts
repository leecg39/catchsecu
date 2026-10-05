// P13-T03 전수 action 감사: 매니페스트의 인증 경로를 실제 브라우저로 방문해 보이는 버튼·링크가
// 실제 효과(API 요청·페이지 이동·대화상자/상태 변화)를 내는지 검증한다.
// 파괴적·외부발송 키워드 버튼은 클릭하지 않고 skipped로 기록한다(클릭 자체가 실제 부작용).
// 링크는 실제 GET으로 상태를 확인하고, 버튼은 클릭 후 네트워크/URL/DOM 변화를 감지한다.
import { chromium, type Page } from "playwright";
import { db } from "../src/server/db";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const outDir = "docs/qa/P13-T03";
const manifest = JSON.parse(await readFile("src/data/route-manifest.json", "utf8")) as { path: string; dynamic?: boolean }[];
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));

const svc = "20000000-0000-4000-8000-000000000001";
const tenant = "10000000-0000-4000-8000-000000000001";
const form = await db.form.findFirst({ where: { service: { tenantId: tenant } }, select: { id: true } });
const notice = await db.notice.findFirst({ select: { id: true } });
const alim = await db.kakaoTemplate.findFirst({ select: { id: true } }).catch(() => null);
const bill = await db.paymentOrder.findFirst({ select: { id: true } }).catch(() => null);
const fixtures: Record<string, string> = {
  ":serviceId": svc, ":formId": form?.id ?? "00000000-0000-4000-8000-000000000000",
  ":noticeId": notice?.id ? String(notice.id) : "0", ":id": svc,
  ":templateId": alim?.id ?? "00000000-0000-4000-8000-000000000000",
  ":billId": bill?.id ?? "00000000-0000-4000-8000-000000000000",
  ":token": "qa-gate-invalid-token",
};
const resolvePath = (path: string) => path.split("/").map(seg => seg.startsWith(":") ? (fixtures[seg] ?? fixtures[":token"]) : seg).join("/");
const skipDynamic = /:token|:code|pay|infoOwner|saeol|identification/;
// 클릭하면 실제 데이터를 파괴하거나 외부 발송·결제를 일으키는 컨트롤 — 효과 유무만이 아니라 부작용이 문제이므로 건너뛴다
const dangerous = /삭제|파기|탈퇴|해지|환불|로그아웃|발송|전송|결제|철회|차단|정지|승인|반려|제출|폐기|회수|만료|제거|초기화|종료/;

type ButtonResult = { text: string; effect: string };
type RouteResult = { route: string; status?: number; buttons: number; checked: number; skipped: number;
  dead: ButtonResult[]; effects: Record<string, number>; badLinks: string[]; error?: string };
const results: RouteResult[] = [];
const timedOut = new Set<string>();
// 부분 실행(--routes 필터)일 때는 기존 결과를 불러와 갱신 대상만 교체한다
const prior: RouteResult[] = await readFile(`${outDir}/action-audit.json`, "utf8").then(s => JSON.parse(s)).catch(() => []);
async function flush() {
  const merged = [...prior.filter(p => !results.some(r => r.route === p.route)), ...results];
  await writeFile(`${outDir}/action-audit.json`, JSON.stringify(merged, null, 1));
}

async function auditRoute(page: Page, route: string, manifestPath: string) {
  const r: RouteResult = { route: manifestPath, buttons: 0, checked: 0, skipped: 0, dead: [], effects: {}, badLinks: [] };
  try {
    const res = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    r.status = res?.status();
    await page.waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, undefined, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (r.status !== 200) { results.push(r); await flush(); return; }
    // 링크: 보이는 앵커의 href를 실제 요청으로 검증
    const hrefs = await page.$$eval("a[href]", els => [...new Set(els.map(e => (e as HTMLAnchorElement).href))].filter(h => h.startsWith(location.origin)).slice(0, 25));
    for (const href of hrefs) {
      const status = (await page.request.get(href, { timeout: 5000 }).catch(() => null))?.status() ?? 0;
      if (status >= 400 && status !== 401 && status !== 403) r.badLinks.push(new URL(href).pathname + ":" + status);
    }
    if (timedOut.has(manifestPath)) return; // 워치독이 이미 결과를 기록한 경로는 중복 기록하지 않는다
    // 버튼: 텍스트+중복 순번으로 클릭 대상을 다시 집는다 (메뉴 열림 등 DOM 변화에 대한 인덱스 시프트 방지)
    const labels = await page.$$eval("button:visible, [role='button']:visible", els => els
      .map(e => ({ text: ((e as HTMLElement).innerText || (e as HTMLElement).getAttribute("aria-label") || "").trim().slice(0, 40), disabled: (e as HTMLButtonElement).disabled }))
      .filter(b => b.text && !b.disabled).map(b => b.text).slice(0, 25));
    r.buttons = labels.length;
    const tested = new Set<string>(), occurrences = new Map<string, number>();
    for (const label of labels) {
      if (tested.has(label)) continue; // 같은 라벨은 경로당 한 번만 검증한다
      tested.add(label);
      if (dangerous.test(label)) { r.skipped++; continue; }
      const ordinal = occurrences.get(label) ?? 0;
      let fired: string[] = [];
      const onReq = (req: { url: () => string }) => { if (req.url().includes("/api/")) fired.push(req.url()); };
      page.on("request", onReq);
      const beforeUrl = page.url();
      const overlaySel = "[role='dialog'], [aria-modal='true'], [role='listbox'], [role='menu'], [role='tooltip']";
      const beforeDialogs = await page.locator(overlaySel).count();
      const beforeText = await page.evaluate(() => document.body.innerText);
      const btn = page.locator(`button:visible, [role='button']:visible`).filter({ hasText: label.slice(0, 20) }).nth(ordinal).first();
      if ((await btn.count()) === 0) { r.skipped++; page.off("request", onReq); continue; }
      const meta = await btn.evaluate(e => ({ expanded: e.getAttribute("aria-expanded"), pressed: e.getAttribute("aria-pressed"), selected: e.getAttribute("aria-selected"),
        submitBlocked: (e as HTMLButtonElement).type === "submit" && e.closest("form") ? !e.closest("form")!.checkValidity() : false }), undefined, { timeout: 1200 }).catch(() => null);
      const clicked = await btn.click({ timeout: 1500 }).then(() => true).catch(() => false);
      await page.waitForTimeout(450);
      page.off("request", onReq);
      if (!clicked) { r.skipped++; continue; }
      const afterDialogs = await page.locator(overlaySel).count();
      const afterText = await page.evaluate(() => document.body.innerText);
      const ariaAfter = await btn.evaluate(e => ({ expanded: e.getAttribute("aria-expanded"), pressed: e.getAttribute("aria-pressed"), selected: e.getAttribute("aria-selected") }), undefined, { timeout: 1200 }).catch(() => null);
      const ariaChanged = !!meta && !!ariaAfter && JSON.stringify({ expanded: meta.expanded, pressed: meta.pressed, selected: meta.selected }) !== JSON.stringify(ariaAfter);
      let effect = "";
      if (fired.length > 0) effect = "api";
      else if (page.url() !== beforeUrl) effect = "navigation";
      else if (afterDialogs !== beforeDialogs) effect = "dialog";
      else if (ariaChanged) effect = "aria";
      else if (meta?.submitBlocked) effect = "form-validation"; // 필수 입력이 비어 브라우저가 제출을 차단 — 배선 자체는 정상
      else if (afterText !== beforeText) effect = "dom";
      if (effect) r.effects[effect] = (r.effects[effect] ?? 0) + 1;
      else r.dead.push({ text: label, effect: "none" });
      r.checked++;
      // 상태 복원: 대화상자는 닫고 이동했으면 돌아온다
      if (afterDialogs > beforeDialogs) await page.keyboard.press("Escape").catch(() => {});
      if (new URL(page.url()).pathname !== new URL(beforeUrl).pathname)
        await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 15000 }).then(() => page.waitForTimeout(300)).catch(() => {});
      fired = [];
    }
  } catch (error) { r.error = String(error).slice(0, 160); }
  if (!timedOut.has(manifestPath)) { results.push(r); await flush(); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lp = await ctx.newPage();
const login = await lp.request.post(base + "/api/v1/auth/sign-in/email", {
  headers: { origin: base, "content-type": "application/json" },
  data: { email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] } });
if (login.status() !== 200) throw new Error("로그인 실패: " + login.status());
await lp.close();
let page = await ctx.newPage();
const only = process.argv.slice(2).filter(a => !a.startsWith("--")).length ? new Set(process.argv.slice(2)) : null;
const extraRoutes = (process.env.QA_EXTRA_ROUTES ?? "").split(",").filter(Boolean);
const queue = [...manifest.map(row => row.path), ...extraRoutes];
for (const manifestPath of queue) {
  const row = { path: manifestPath, dynamic: manifestPath.includes(":") };
  if (only && !only.has(row.path)) continue;
  if (row.dynamic && skipDynamic.test(row.path)) continue;
  // 경로당 150초 워치독 — 지연 경로는 기록하고 새 페이지로 계속한다
  const route = resolvePath(row.path);
  const timed = await Promise.race([
    auditRoute(page, route, row.path).then(() => false),
    new Promise<true>(res => setTimeout(() => res(true), 300000)),
  ]);
  if (timed) {
    timedOut.add(row.path);
    results.push({ route: row.path, buttons: 0, checked: 0, skipped: 0, dead: [], effects: {}, badLinks: [], error: "ROUTE_TIMEOUT" });
    await flush();
    await page.close().catch(() => {});
    page = await ctx.newPage();
  }
}
await ctx.close();
const deadRoutes = results.filter(r => r.dead.length > 0 || r.badLinks.length > 0 || r.error);
console.log(JSON.stringify({ routes: results.length, buttons: results.reduce((a, r) => a + r.buttons, 0),
  checked: results.reduce((a, r) => a + r.checked, 0), skipped: results.reduce((a, r) => a + r.skipped, 0),
  deadTotal: results.reduce((a, r) => a + r.dead.length, 0), anomalies: deadRoutes.length,
  sample: deadRoutes.slice(0, 10).map(r => ({ route: r.route, dead: r.dead.map(d => d.text), badLinks: r.badLinks, error: r.error })) }));
await browser.close();
await db.$disconnect();
