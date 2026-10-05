// P03-T03 활동 검토 보유·파기: dev 서버(3100)+ catchsecu_dev에서 실제 브라우저 UI 검증.
// 자격증명은 .local/recovery-members.json에서만 읽고 출력하지 않는다.
import { chromium, type BrowserContext } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";
import { sweepActivityReviewRetention } from "../src/server/activity-reviews";

assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const base = new URL(env.BETTER_AUTH_URL).origin;
const out = "docs/qa/P03-T03/revalidation/", states = out + "states/";
await mkdir(states, { recursive: true });
const f = JSON.parse(await readFile(".local/recovery-members.json", "utf8"));
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => { results.push({ step, ok, detail }); console.log(ok ? "PASS" : "FAIL", step, detail); };

const req = (path: string, input?: unknown, cookie = "", key = randomUUID()) =>
  new Request(base + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin: base, cookie, ...(input ? { "content-type": "application/json", "idempotency-key": key } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
async function loginCookie(who: "owner" | "member") {
  const p = f.people[who];
  const res = await auth.handler(req("/auth/sign-in/email", { email: p.email, password: p.password }));
  assert.equal(res.status, 200, who + " sign-in");
  const cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId: p.id }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: f.companyId } });
  return cookie;
}
const ownerCookie = await loginCookie("owner"), memberCookie = await loginCookie("member");
async function addSession(context: BrowserContext, cookie: string) {
  await context.addCookies(cookie.split("; ").map(pair => { const [name, ...rest] = pair.split("="); return { name, value: rest.join("="), url: base }; }));
}

// 1) 정책 UI에서 활동 검토 보유 기간 1일 저장 (비밀번호 확인 포함)
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await addSession(context, ownerCookie);
const page = await context.newPage();
await page.goto(base + "/set/company/policy", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.getByRole("tab", { name: "파기일자 설정" }).click();
await page.waitForTimeout(1000);
const retentionToggle = page.locator(".member-check", { hasText: "종결된 검토에 보유 기한" });
const toggleInput = retentionToggle.locator("input[type=checkbox]");
if (!(await toggleInput.isChecked())) await retentionToggle.click();
const daysInput = page.locator('input[aria-label="활동 검토 보유 기간"]');
await daysInput.fill("1");
await page.screenshot({ path: states + "retention-policy-field.png" });
await page.getByRole("button", { name: "저장하기" }).click();
await page.waitForTimeout(800);
await page.fill('input[aria-label="현재 비밀번호"]', f.people.owner.password);
await page.getByRole("button", { name: "정책 적용" }).click();
await page.waitForTimeout(2500);
let body = await page.locator("body").innerText();
const savedPolicy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: f.companyId } });
record("policy-ui-save", /정책을 저장했습니다|다음 요청부터/.test(body) && savedPolicy.activityReviewRetentionDays === 1, "policy=" + savedPolicy.activityReviewRetentionDays);

// 2) API로 검토 요청→답변→처리 완료 (생성/답변 UI는 기존 라운드에서 검증됨)
const event = await db.auditEvent.create({ data: { tenantId: f.companyId, serviceId: f.services[0].id, actorId: f.people.member.id, action: "submission.read", resource: "submission", resourceId: randomUUID(), requestId: randomUUID(), detail: { syntheticQA: true, purpose: "retention browser" } } });
const createRes = await fetch(base + "/api/v1/activity-reviews", { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": randomUUID(), origin: base }, body: JSON.stringify({ auditEventId: event.id, title: "브라우저 파기 검증", message: "보유 기한 브라우저 검증 메시지" }) });
const created = await createRes.json();
if (createRes.status !== 201) { console.log("create failed:", createRes.status, created); process.exit(1); }
const reviewId = created.id as string;
const act = (cookie: string, version: number, action: string, message: string) =>
  fetch(base + "/api/v1/activity-reviews/" + reviewId + "/actions", { method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": randomUUID(), origin: base }, body: JSON.stringify({ version, action, message }) });
assert.equal((await act(memberCookie, 1, "response", "답변")).status, 200);
assert.equal((await act(ownerCookie, 2, "resolve", "처리 완료")).status, 200);
const closed = await db.activityReview.findUniqueOrThrow({ where: { id: reviewId } });
record("retention-snapshot", closed.status === "resolved" && !!closed.retentionUntil, "until=" + closed.retentionUntil?.toISOString());

// 3) 기한을 과거로 이동(정책 변경 없는 시험용 조정) 후 sweep → 승인 대기
await db.$executeRaw`UPDATE "ActivityReview" SET "retentionUntil"=CURRENT_TIMESTAMP-INTERVAL '1 hour',"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${reviewId}`;
const swept = await sweepActivityReviewRetention();
const awaiting = await db.activityReview.findUniqueOrThrow({ where: { id: reviewId } });
record("sweep-awaiting", swept.pending >= 1 && awaiting.destructionStatus === "awaiting", "pending=" + swept.pending + " status=" + awaiting.destructionStatus);

// 4) UI: 목록 배지 → 상세 파기 승인 2단계 → 파기 완료
await page.goto(base + "/my-page/info-activity-log", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const tab = page.getByRole("tab", { name: "보낸 요청" });
if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); }
body = await page.locator("body").innerText();
record("list-badge", /파기 승인 대기/.test(body), body.match(/파기[^\n]*/)?.[0] ?? "");
await page.screenshot({ path: states + "retention-awaiting-list.png" });
const detail = await page.locator("text=브라우저 파기 검증").first();
await detail.click();
await page.waitForTimeout(2000);
body = await page.locator("body").innerText();
record("detail-awaiting", /파기 승인 대기|보유 기한/.test(body), "");
await page.screenshot({ path: states + "retention-awaiting-detail.png" });
await page.getByRole("button", { name: "메시지 파기 승인" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: states + "retention-confirm.png" });
await page.getByRole("button", { name: "파기 승인 확정" }).click();
await page.waitForTimeout(2500);
body = await page.locator("body").innerText();
const destroyed = await db.activityReview.findUniqueOrThrow({ where: { id: reviewId } });
const messages = await db.activityReviewMessage.count({ where: { reviewId } });
record("destroy-approved", /메시지 파기 완료/.test(body) && destroyed.destructionStatus === "destroyed" && messages === 0 && !!destroyed.destroyedAt, "status=" + destroyed.destructionStatus + " messages=" + messages);
await page.screenshot({ path: states + "retention-destroyed.png" });

// 5) 모바일 390px: 신규 UI가 기존 공통 헤더(MY 배지)의 기존 오버플로 외에 추가 오버플로를 만들지 않는지 비교
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const baseline = await page.evaluate(() => document.documentElement.scrollWidth);
await page.goto(base + "/my-page/info-activity-log", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const reviewWidth = await page.evaluate(() => document.documentElement.scrollWidth);
record("mobile-no-extra-overflow", reviewWidth <= baseline, "baseline=" + baseline + " reviews=" + reviewWidth);
await page.screenshot({ path: states + "retention-mobile.png" });

await browser.close();
await writeFile(out + "activity-retention-browser.json", JSON.stringify({ results, reviewId, ranAt: new Date().toISOString() }, null, 2));
await db.$disconnect();
if (results.some(r => !r.ok)) process.exit(1);
console.log("all browser checks passed:", results.length);
