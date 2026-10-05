// Frozen Metric (Level 1.5) — Inner Loop는 이 파일과 test-routes.json을 수정하지 않는다.
// 실행: node --env-file=.env.local --import tsx autoresearch/eval/ux-eval.ts <label>
// 점수 = error·dom·form(상호작용 프로브)·visual 4축 가중합. 가중치는 outer/metric_weights.json에서 읽는다.
import { randomInt, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, type APIRequestContext, type Page } from "playwright";

type Steps = Record<string, boolean>;
type Spec = {
  base: string; account: string; viewports: { name: string; width: number; height: number }[];
  routes: { path: string; name: string }[];
  probes: {
    palette: { route: string; query: string; expectPath: string };
    shortcuts: { route: string; heading: string };
    modalFocus: { route: string; opener: string; tabs: number };
    confirmDialog: { route: string; cidrPrefix: string };
    unsavedGuard: { route: string; field: string; leaveTo: string };
    toast: { route: string; button: string; text: string };
    copy: { route: string };
    qr: { route: string; minSize: number };
    sort: { route: string; panel: string; textColumn: string; numberColumn: string };
    breadcrumb: { pages: { route: string; group: string; current: string }[] };
    skipLink: { route: string; text: string };
  };
  global: { focusVisible: { route: string; tabs: number; minContrast: number }; reducedMotion: { route: string; selector: string; maxSeconds: number } };
};

const spec: Spec = JSON.parse(await readFile("autoresearch/eval/test-routes.json", "utf8"));
const weights: Record<"error" | "dom" | "form" | "visual", number> = JSON.parse(await readFile("autoresearch/outer/metric_weights.json", "utf8"));
const accounts: Record<string, string> = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const base = spec.base, label = process.argv[2] ?? "run";
const errors: string[] = [], nativeDialogs: string[] = [];
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const ratio = (steps: Steps) => mean(Object.values(steps).map(Number));
const pathOf = (page: Page) => { try { return new URL(page.url()).pathname; } catch { return ""; } };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript({ content: "window.__name = (fn) => fn;" });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const request: APIRequestContext = context.request;
let loginStatus = 0, loginBody = "";
for (let attempt = 0; attempt < 4 && loginStatus !== 200; attempt++) {
  if (attempt) await new Promise(resolve => setTimeout(resolve, 3000));
  const login = await request.post(base + "/api/v1/auth/sign-in/email", {
    headers: { origin: base, "content-type": "application/json" }, data: { email: spec.account, password: accounts[spec.account] } });
  loginStatus = login.status(); loginBody = (await login.text()).slice(0, 300);
}
if (loginStatus !== 200) throw new Error("로그인 실패: " + loginStatus + " " + loginBody);
const page = await context.newPage();
page.on("console", message => { if (message.type() === "error") errors.push(pathOf(page) + " :: " + message.text().slice(0, 220)); });
page.on("pageerror", error => errors.push(pathOf(page) + " :: pageerror " + String(error.message).slice(0, 220)));
page.on("dialog", dialog => {
  if (dialog.type() === "beforeunload") { void dialog.accept().catch(() => {}); return; }
  nativeDialogs.push(dialog.type() + ":" + dialog.message().slice(0, 80)); void dialog.dismiss().catch(() => {});
});

async function go(path: string) {
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function resetFocus() {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); document.body.setAttribute("tabindex", "-1"); document.body.focus(); document.body.removeAttribute("tabindex"); });
}
const visible = (selector: string, timeout = 2500) => page.locator(selector).last().waitFor({ state: "visible", timeout }).then(() => true, () => false);
async function poll(check: () => Promise<boolean>, timeout: number) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check().catch(() => false)) return true; await page.waitForTimeout(150); }
  return false;
}

// DOM·접근성 구조 검사(경로별)
async function domChecks() {
  return page.evaluate(() => {
    const shown = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const nameOf = (el: Element) => (el.getAttribute("aria-label") || el.getAttribute("title")
      || (el.getAttribute("aria-labelledby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ")
      || (el as HTMLElement).innerText || "").trim();
    const share = (hit: number, all: number) => all ? hit / all : 1;
    const buttons = [...document.querySelectorAll("button, [role=button]")].filter(shown);
    const named = buttons.filter(b => nameOf(b) || b.querySelector("img[alt]:not([alt='']), svg[aria-label]"));
    const controls = [...document.querySelectorAll("input, select, textarea")].filter(el => !["hidden", "submit", "button", "reset", "image"].includes((el as HTMLInputElement).type)).filter(shown);
    const labeled = controls.filter(el => (el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title"));
    const images = [...document.querySelectorAll("img")];
    return {
      buttonsNamed: share(named.length, buttons.length), controlsLabeled: share(labeled.length, controls.length),
      imagesAlt: share(images.filter(img => img.hasAttribute("alt")).length, images.length),
      main: document.querySelector("main") ? 1 : 0,
      liveRegion: document.querySelector("[aria-live='polite'], [aria-live='assertive']") ? 1 : 0,
      unnamed: buttons.filter(b => !named.includes(b)).slice(0, 3).map(b => b.outerHTML.slice(0, 140)),
      unlabeled: controls.filter(c => !labeled.includes(c)).slice(0, 3).map(c => c.outerHTML.slice(0, 140)),
    };
  });
}
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function focusVisible() {
  const { route, tabs, minContrast } = spec.global.focusVisible;
  await go(route);
  await page.locator("main h1").first().click({ timeout: 10000 }).catch(() => {});
  let pass = 0, total = 0; const misses: string[] = [];
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(min => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el), tag = el.tagName + "." + String(el.className).split(" ")[0];
      const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const contrast = (color: string) => {
        const m = color.match(/rgba?\(([^)]+)\)/); if (!m) return 0;
        const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        if (a < 0.5) return 0;
        const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        return 1.05 / (lum + 0.05);
      };
      if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
        if (style.outlineStyle === "auto") return { pass: true, tag };
        return { pass: contrast(style.outlineColor) >= min, tag };
      }
      const shadow = style.boxShadow && style.boxShadow !== "none" ? style.boxShadow.match(/rgba?\([^)]+\)/)?.[0] : undefined;
      return { pass: !!shadow && contrast(shadow) >= min, tag };
    }, minContrast);
    if (!result) continue;
    total++; if (result.pass) pass++; else misses.push(result.tag);
  }
  return { score: total ? pass / total : 0, misses: [...new Set(misses)].slice(0, 6) };
}
async function reducedMotion() {
  const { route, selector, maxSeconds } = spec.global.reducedMotion;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await go(route);
  const durations = await page.$$eval(selector, els => els.slice(0, 12).map(el => getComputedStyle(el).transitionDuration));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const max = Math.max(0, ...durations.flatMap(d => d.split(",").map(part => part.trim().endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part))));
  return { score: durations.length && max <= maxSeconds ? 1 : 0, max };
}

// 상호작용 프로브(form 축)
async function palette(): Promise<Steps> {
  const p = spec.probes.palette, steps: Steps = { open: false, focus: false, results: false, navigate: false };
  await go(p.route); await resetFocus();
  await page.keyboard.press("Control+k");
  const dialog = page.locator("[role='dialog']").filter({ has: page.locator("input") }).last();
  steps.open = await dialog.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
  if (!steps.open) return steps;
  steps.focus = await page.evaluate(() => { const a = document.activeElement; return !!a && a.tagName === "INPUT" && !!a.closest("[role='dialog']"); });
  await page.keyboard.type(p.query, { delay: 40 });
  steps.results = await page.locator("[role='option']").filter({ hasText: p.query }).first().waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
  const before = pathOf(page);
  await page.keyboard.press("Enter");
  await page.waitForURL(url => new URL(url).pathname !== before, { timeout: 20000 }).catch(() => {});
  steps.navigate = pathOf(page).includes(p.expectPath);
  return steps;
}
async function shortcuts(): Promise<Steps> {
  const p = spec.probes.shortcuts, steps: Steps = { open: false, close: false };
  await go(p.route); await resetFocus();
  await page.keyboard.press("?");
  const dialog = page.locator("[role='dialog']").filter({ hasText: p.heading }).last();
  steps.open = await dialog.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
  if (steps.open) { await page.keyboard.press("Escape"); steps.close = await dialog.waitFor({ state: "hidden", timeout: 2500 }).then(() => true, () => false); }
  return steps;
}
async function modalFocus(): Promise<Steps> {
  const p = spec.probes.modalFocus, steps: Steps = { focusIn: false, trapped: false, scrollLock: false, restore: false };
  await go(p.route);
  await page.locator(p.opener).first().click({ timeout: 10000 });
  const dialog = page.locator("[role='dialog']").last();
  if (!await dialog.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) return steps;
  await page.waitForTimeout(200);
  const inside = () => page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"));
  steps.focusIn = await inside();
  let trapped = true;
  for (let i = 0; i < p.tabs; i++) { await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab"); trapped = trapped && await inside(); }
  steps.trapped = trapped;
  steps.scrollLock = await page.evaluate(() => getComputedStyle(document.body).overflow === "hidden" || getComputedStyle(document.documentElement).overflow === "hidden");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  steps.restore = await page.evaluate(selector => document.activeElement === document.querySelector(selector), p.opener);
  return steps;
}
async function confirmDialog(): Promise<Steps> {
  const p = spec.probes.confirmDialog, steps: Steps = { alertdialog: false, noNative: false, cancelKeeps: false, confirmDeletes: false };
  const listing = await request.get(base + "/api/v1/security/ip-rules?page=1", { headers: { origin: base } });
  const tenantId = (await listing.json()).policy?.tenantId as string | undefined;
  if (!tenantId) return steps;
  const cidr = p.cidrPrefix + randomInt(2, 250) + "/32";
  const created = await request.post(base + "/api/v1/security/ip-rules", { headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
    data: { tenantId, cidr, description: "UX RSI 평가용 임시 규칙", enabled: false } });
  if (!created.ok()) return steps;
  const rule = await created.json() as { id: string };
  const exists = async () => (await request.get(base + "/api/v1/security/ip-rules/" + rule.id, { headers: { origin: base } })).status() === 200;
  try {
    await go(p.route);
    await page.getByPlaceholder("IP 또는 설명").fill(cidr.split("/")[0]).catch(() => {});
    const row = page.locator("tr", { hasText: cidr }).first();
    await row.waitFor({ state: "visible", timeout: 10000 });
    const before = nativeDialogs.length;
    await row.getByRole("button", { name: "삭제" }).click();
    const alert = page.locator("[role='alertdialog']").last();
    steps.alertdialog = await alert.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
    steps.noNative = nativeDialogs.length === before;
    if (!steps.alertdialog) return steps;
    await page.keyboard.press("Escape");
    await alert.waitFor({ state: "hidden", timeout: 2500 }).catch(() => {});
    steps.cancelKeeps = !await alert.isVisible() && await exists();
    await row.getByRole("button", { name: "삭제" }).click();
    await alert.waitFor({ state: "visible", timeout: 2500 });
    await alert.getByRole("button", { name: /삭제/ }).click();
    steps.confirmDeletes = await poll(async () => !await exists(), 8000);
    return steps;
  } finally {
    const current = await request.get(base + "/api/v1/security/ip-rules/" + rule.id, { headers: { origin: base } });
    if (current.status() === 200) {
      const row = await current.json() as { version: number };
      await request.delete(base + "/api/v1/security/ip-rules/" + rule.id, { headers: { origin: base, "content-type": "application/json" }, data: { tenantId, version: row.version } });
    }
  }
}
async function unsavedGuard(): Promise<Steps> {
  const p = spec.probes.unsavedGuard, steps: Steps = { beforeunload: false, blocked: false, stay: false, leave: false };
  await go(p.route);
  const field = page.getByLabel(p.field, { exact: true }).first();
  await field.waitFor({ state: "visible", timeout: 15000 });
  const next = (await field.inputValue()) === "6" ? "7" : "6";
  await field.selectOption(next);
  steps.beforeunload = await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  const link = page.locator(`aside a[href="${p.leaveTo}"]`).first();
  await link.click();
  await page.waitForTimeout(1200);
  const alert = page.locator("[role='alertdialog']").last();
  steps.blocked = pathOf(page) === p.route && await alert.isVisible();
  if (!steps.blocked) return steps;
  await page.keyboard.press("Escape");
  await alert.waitFor({ state: "hidden", timeout: 2500 }).catch(() => {});
  steps.stay = pathOf(page) === p.route && !await alert.isVisible() && (await field.inputValue()) === next;
  await link.click();
  await alert.waitFor({ state: "visible", timeout: 2500 }).catch(() => {});
  await alert.getByRole("button", { name: /나가기|이동/ }).first().click({ timeout: 2500 }).catch(() => {});
  await page.waitForURL(url => new URL(url).pathname === p.leaveTo, { timeout: 15000 }).catch(() => {});
  steps.leave = pathOf(page) === p.leaveTo;
  return steps;
}
async function toast(formId: string | undefined): Promise<Steps> {
  const p = spec.probes.toast, steps: Steps = { appear: false, dismiss: false };
  if (!formId) return steps;
  await go(p.route + "?formId=" + formId);
  const button = page.getByRole("button", { name: p.button }).first();
  if (!await button.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) return steps;
  await button.click();
  const present = () => page.evaluate(text => [...document.querySelectorAll("[role='status'], [role='alert'], [aria-live] *")].some(el => {
    if (!(el.textContent ?? "").includes(text) || !(el as HTMLElement).getBoundingClientRect().height) return false;
    for (let node: Element | null = el; node; node = node.parentElement) if (getComputedStyle(node).position === "fixed") return true;
    return false;
  }), p.text);
  steps.appear = await poll(present, 2500);
  if (steps.appear) steps.dismiss = await poll(async () => !await present(), 10000);
  return steps;
}
async function fixedUrlRow() {
  await go(spec.probes.copy.route);
  const row = page.locator("tbody tr").filter({ has: page.locator("a[href]") }).first();
  if (!await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) return null;
  const href = await row.locator("a[href]").first().evaluate(a => (a as HTMLAnchorElement).href);
  return { row, href };
}
async function copy(): Promise<Steps> {
  const steps: Steps = { button: false, clipboard: false };
  const target = await fixedUrlRow(); if (!target) return steps;
  const button = target.row.getByRole("button", { name: /복사/ });
  steps.button = await button.count() > 0;
  if (!steps.button) return steps;
  await page.evaluate(() => navigator.clipboard.writeText("")).catch(() => {});
  await button.first().click();
  steps.clipboard = await poll(async () => (await page.evaluate(() => navigator.clipboard.readText())) === target.href, 2500);
  return steps;
}
async function qr(): Promise<Steps> {
  const p = spec.probes.qr, steps: Steps = { button: false, image: false, download: false, value: false };
  const target = await fixedUrlRow(); if (!target) return steps;
  const button = target.row.getByRole("button", { name: /QR/i });
  steps.button = await button.count() > 0;
  if (!steps.button) return steps;
  await button.first().click();
  const dialog = page.locator("[role='dialog']").last();
  if (!await dialog.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) return steps;
  const graphic = dialog.locator("svg, canvas, img").first();
  await graphic.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  const box = await graphic.boundingBox().catch(() => null);
  steps.image = !!box && Math.min(box.width, box.height) >= p.minSize;
  steps.download = await poll(async () => await dialog.locator("a[download][href^='data:image/png'], a[download][href^='blob:']").count() > 0, 4000);
  steps.value = (await dialog.innerText()).includes(target.href);
  await page.keyboard.press("Escape");
  return steps;
}
async function sort(): Promise<Steps> {
  const p = spec.probes.sort, steps: Steps = { sortable: false, textAsc: false, numberAsc: false, numberDesc: false, ariaSort: false };
  await go(p.route);
  const table = page.locator("section", { has: page.locator("h2", { hasText: p.panel }) }).locator("table").first();
  if (!await table.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) return steps;
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  const column = async (name: string) => {
    const index = await table.locator("thead th").evaluateAll((ths, n) => ths.findIndex(th => (th.textContent ?? "").includes(n as string)), name);
    return table.locator("tbody tr").evaluateAll((trs, i) => trs.map(tr => (tr.children[i as number]?.textContent ?? "").trim()), index);
  };
  const header = (name: string) => table.locator("thead th", { hasText: name }).first();
  const press = async (name: string) => { const h = header(name), b = h.locator("button"); if (await b.count()) await b.first().click(); else await h.click(); await page.waitForTimeout(300); };
  steps.sortable = await table.locator("thead th[aria-sort], thead th button").count() > 0;
  await press(p.textColumn);
  const texts = await column(p.textColumn);
  steps.textAsc = texts.length > 1 && texts.every((t, i) => i === 0 || collator.compare(texts[i - 1], t) <= 0) && collator.compare(texts[0], texts[texts.length - 1]) < 0;
  await press(p.numberColumn);
  const asc = (await column(p.numberColumn)).map(Number);
  steps.numberAsc = asc.length > 1 && asc.every((n, i) => i === 0 || asc[i - 1] <= n) && asc[0] < asc[asc.length - 1];
  await press(p.numberColumn);
  const desc = (await column(p.numberColumn)).map(Number);
  steps.numberDesc = desc.length > 1 && desc.every((n, i) => i === 0 || desc[i - 1] >= n) && desc[0] > desc[desc.length - 1];
  steps.ariaSort = (await header(p.numberColumn).getAttribute("aria-sort")) === "descending";
  return steps;
}
async function breadcrumb(): Promise<Steps> {
  const steps: Steps = {};
  for (const target of spec.probes.breadcrumb.pages) {
    await go(target.route);
    const nav = page.locator("nav[aria-label*='경로'], nav[aria-label*='breadcrumb' i]").first();
    const shown = await nav.isVisible().catch(() => false);
    steps[target.route + ":nav"] = shown;
    steps[target.route + ":group"] = shown && (await nav.innerText()).includes(target.group);
    steps[target.route + ":current"] = shown && ((await nav.locator("[aria-current='page']").first().innerText().catch(() => "")).includes(target.current));
  }
  return steps;
}
async function skipLink(): Promise<Steps> {
  const p = spec.probes.skipLink, steps: Steps = { first: false, moves: false };
  await go(p.route); await resetFocus();
  await page.keyboard.press("Tab");
  steps.first = await page.evaluate(text => { const a = document.activeElement as HTMLAnchorElement | null; return !!a && a.tagName === "A" && (a.getAttribute("href") ?? "").startsWith("#") && (a.textContent ?? "").includes(text); }, p.text);
  if (steps.first) {
    await page.keyboard.press("Enter"); await page.waitForTimeout(250);
    steps.moves = await page.evaluate(() => { const main = document.querySelector("main"), active = document.activeElement; return !!main && !!active && (active === main || main.contains(active)); });
  }
  return steps;
}

const started = Date.now();
const { db } = await import("../../src/server/db");
const publication = await db.publication.findFirst({ where: { tenantId: "10000000-0000-4000-8000-000000000001", status: "active", form: { status: "published" } }, select: { formId: true }, orderBy: { createdAt: "desc" } });
await db.$disconnect();

const routeResults: Record<string, unknown>[] = [];
const domScores: number[] = [], visualScores: number[] = [];
for (const viewport of spec.viewports) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const route of spec.routes) {
    await go(route.path);
    const fits = await overflow();
    visualScores.push(fits ? 1 : 0);
    if (viewport.name === "desktop") {
      const dom = await domChecks();
      domScores.push(mean([dom.buttonsNamed, dom.controlsLabeled, dom.imagesAlt, dom.main, dom.liveRegion]));
      routeResults.push({ route: route.path, viewport: viewport.name, fits, ...dom });
    } else routeResults.push({ route: route.path, viewport: viewport.name, fits });
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

const probeRuns: [string, () => Promise<Steps>][] = [
  ["palette", palette], ["shortcuts", shortcuts], ["modalFocus", modalFocus], ["confirmDialog", confirmDialog],
  ["unsavedGuard", unsavedGuard], ["toast", () => toast(publication?.formId)], ["copy", copy], ["qr", qr],
  ["sort", sort], ["breadcrumb", breadcrumb], ["skipLink", skipLink],
];
const probes: Record<string, { score: number; steps: Steps; error?: string }> = {};
for (const [name, run] of probeRuns) {
  try { const steps = await run(); probes[name] = { score: ratio(steps), steps }; }
  catch (error) { probes[name] = { score: 0, steps: {}, error: String((error as Error).message).split("\n")[0].slice(0, 200) }; }
}
const focus = await focusVisible().catch(error => ({ score: 0, misses: [String(error)] }));
const motion = await reducedMotion().catch(() => ({ score: 0, max: -1 }));
await browser.close();

const scores = {
  error: Math.max(0, 100 - 20 * errors.length),
  dom: 100 * (0.8 * mean(domScores) + 0.1 * focus.score + 0.1 * motion.score),
  form: 100 * mean(Object.values(probes).map(p => p.score)),
  visual: 100 * mean(visualScores),
};
const total = weights.error * scores.error + weights.dom * scores.dom + weights.form * scores.form + weights.visual * scores.visual;
const round = (n: number) => Math.round(n * 100) / 100;
const summary = { label, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), total: round(total),
  scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round(v)])),
  probes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, round(v.score)])),
  focusVisible: focus, reducedMotion: motion, errors: errors.slice(0, 20), errorCount: errors.length, nativeDialogs };
await writeFile("autoresearch/eval/last-run.json", JSON.stringify({ ...summary, probeSteps: probes, routes: routeResults }, null, 2));
console.log(JSON.stringify(summary, null, 2));
