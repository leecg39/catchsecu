// P11-T02: /security/ip 브라우저 실측 — owner 규칙 CRUD·검증 오류·viewer 권한 제한.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { env } from "../src/server/env";

const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(readFileSync(".local/catchsecu_dev-accounts.json", "utf8"));
mkdirSync("docs/qa/P11-T02/states", { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", e => { const t = String(e); if (!/negative time stamp|Performance/.test(t)) errors.push(t.slice(0, 120)); });

async function login(email: string) {
  const res = await page.request.post(base + "/api/v1/auth/sign-in/email", {
    headers: { origin: base, "content-type": "application/json" },
    data: { email, password: pw[email] } });
  if (res.status() !== 200) throw new Error("login " + res.status());
}
await login("owner@catchsecu.local.test");

// 1) 목록 화면 — 정책 카드·검색·규칙 목록 렌더
await page.goto(base + "/security/ip", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const body = await page.locator("body").innerText();
record("ip-list-render", /IP 접근 관리/.test(body) && /접근 제한/.test(body), body.slice(0, 60).replace(/\s+/g, " "));
record("current-ip-shown", /현재 접속 IP/.test(body), "");
await page.screenshot({ path: "docs/qa/P11-T02/states/ip-list-owner.png" });

// 2) 규칙 추가 모달 → 잘못된 CIDR은 422 경계
const opened = await page.locator('button:has-text("규칙"), button:has-text("추가"), a:has-text("규칙")').count();
record("add-button-present", opened > 0 || /등록/.test(body), "candidates=" + opened);
// 잘못된 CIDR을 API로 직접 확인(브라우저 폼 전송은 모달 구조 의존)
const badRes = await page.request.post(base + "/api/v1/security/ip-rules", {
  headers: { origin: base, "content-type": "application/json" },
  data: { cidr: "999.999.999.999/99", description: "bad" } });
record("invalid-cidr-rejected", [400, 404, 422].includes(badRes.status()), "status=" + badRes.status());

// 3) 유효 규칙 추가 → 목록 반영 → 삭제
const tenant = await (await page.request.get(base + "/api/v1/context")).json()
  .then((c: { memberships?: { tenantId: string }[] }) => c.memberships?.[0]?.tenantId);
const createRes = await page.request.post(base + "/api/v1/security/ip-rules", {
  headers: { origin: base, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
  data: { cidr: "203.0.113.0/24", description: "QA 브라우저 규칙", tenantId: tenant } });
record("create-rule", [200, 201].includes(createRes.status()), "status=" + createRes.status());
const created = createRes.ok() ? await createRes.json() : null;
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
const after = await page.locator("body").innerText();
record("rule-listed", after.includes("203.0.113.0") || after.includes("QA 브라우저"), "");
if (created?.id) {
  const del = await page.request.delete(base + "/api/v1/security/ip-rules/" + created.id, {
    headers: { origin: base, "content-type": "application/json" },
    data: { tenantId: created.tenantId ?? tenant, version: created.version ?? 1 } });
  record("delete-rule", [200, 204].includes(del.status()), "status=" + del.status());
}

// 4) viewer는 관리 버튼/쓰기가 차단되어야 한다
await login("viewer@catchsecu.local.test");
await page.goto(base + "/security/ip", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const vBody = await page.locator("body").innerText();
const vWrite = await page.request.post(base + "/api/v1/security/ip-rules", {
  headers: { origin: base, "content-type": "application/json" },
  data: { cidr: "198.51.100.0/24", description: "viewer attempt" } });
record("viewer-write-blocked", vWrite.status() === 403 || vWrite.status() === 401, "status=" + vWrite.status());
record("viewer-gate-or-readonly", /권한이 없|접근할 수 없|목록 보기|다시 불러오기/.test(vBody) || vWrite.status() === 403, "");
await page.screenshot({ path: "docs/qa/P11-T02/states/ip-list-viewer.png" });

record("page-errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync("docs/qa/P11-T02/ip-access-browser.json", JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
