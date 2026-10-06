// P11-T04 가상 조직 인증 + P10 가상 PG: dev 서버(3100)+catchsecu_dev 실제 브라우저 검증.
// 자격증명은 .local/recovery-members.json에서만 읽고 출력하지 않는다.
import { chromium, type BrowserContext } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";

assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const base = new URL(env.BETTER_AUTH_URL).origin;
const out = "docs/qa/P11-T04/virtual-auth/", states = out + "states/";
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
const ownerCookie = await loginCookie("owner");
async function addSession(context: BrowserContext, cookie: string) {
  await context.addCookies(cookie.split("; ").map(pair => { const [name, ...rest] = pair.split("="); return { name, value: rest.join("="), url: base }; }));
}

// 정리: 동일 태그의 이전 라운드 잔여물 삭제 — 이메일은 소문자 저장이므로 태그도 소문자로
const tag = ("qa-" + randomUUID().slice(0, 8)).toLowerCase();
await db.ssoProvider.deleteMany({ where: { tenantId: f.companyId, protocol: "gpki", name: { startsWith: "QA-" } } }).catch(() => {});
// 이전 라운드의 JIT viewer 구성원 정리 — 구성원 쿼터가 JIT 가입을 차단할 수 있다(실제 동작)
const staleUsers = await db.user.findMany({ where: { email: { startsWith: "qa-", endsWith: "@catchsecu.test" } }, select: { id: true } });
if (staleUsers.length) {
  const ids = staleUsers.map(u => u.id);
  await db.membership.deleteMany({ where: { userId: { in: ids } } });
  await db.account.deleteMany({ where: { userId: { in: ids }, providerId: { startsWith: "sso:" } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  // User 행은 감사 로그가 참조하므로 삭제 불가 — 소속 해제로 쿼터만 회복한다.
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await addSession(context, ownerCookie);
const page = await context.newPage();

// 1) SSO 관리 화면에서 가상 GPKI 공급자 등록
await page.goto(base + "/security/sso", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "SSO 연결 등록" }).click();
await page.waitForTimeout(800);
await page.locator("select").selectOption("gpki");
await page.waitForTimeout(400);
await page.fill('input[placeholder="예: 본사 Entra ID"]', `${tag} 가상 GPKI`);
await page.screenshot({ path: states + "01-virtual-provider-form.png" });
await page.getByRole("button", { name: /등록|저장/ }).last().click();
await page.waitForTimeout(2500);
const body = await page.locator("body").innerText();
const provider = await db.ssoProvider.findFirst({ where: { tenantId: f.companyId, protocol: "gpki", name: { startsWith: tag } } });
record("virtual-provider-ui-create", !!provider && provider.preflightOk && body.includes("가상 GPKI"), "provider=" + provider?.id);

// 2) 활성화 + 디렉터리 등록(이메일 있는 구성원·없는 구성원)
if (provider) {
  const row = page.locator("tr", { hasText: tag });
  await row.getByRole("button", { name: "사용", exact: true }).click();
  await page.waitForTimeout(1500);
  await row.getByRole("button", { name: "디렉터리" }).click();
  await page.waitForTimeout(1000);
  const addMember = async (orgCode: string, emp: string, name: string, email: string, pin: string) => {
    await page.fill('input[name="orgCode"]', orgCode);
    await page.fill('input[name="employeeNo"]', emp);
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="pin"]', pin);
    await page.getByRole("button", { name: "디렉터리에 등록" }).click();
    await page.waitForTimeout(1200);
  };
  await addMember(`${tag}-ORG`, "EMP-1", "가상홍길동", `${tag}-m1@catchsecu.test`, "4321");
  await addMember(`${tag}-ORG`, "EMP-2", "무메일임", "", "9876");
  await page.screenshot({ path: states + "02-directory-members.png" });
  const modalText = await page.locator("body").innerText();
  const members = await db.virtualOrgMember.findMany({ where: { providerId: provider.id } });
  record("directory-ui-crud", members.length === 2 && modalText.includes("가상홍길동") && modalText.includes("mock"), "members=" + members.length);
  await page.keyboard.press("Escape");
  await page.locator("button", { hasText: "닫기" }).first().click().catch(() => {});
} else record("directory-ui-crud", false, "provider missing");

// 3) 공개 /login/gpki — 이메일 등록 구성원 로그인 → 대시보드
const publicContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pub = await publicContext.newPage();
await pub.goto(base + "/login/gpki", { waitUntil: "domcontentloaded" });
await pub.waitForTimeout(1500);
await pub.screenshot({ path: states + "03-gpki-login-form.png" });
const loginText = await pub.locator("body").innerText();
await pub.fill('input[name="orgCode"]', `${tag}-ORG`);
await pub.fill('input[name="employeeNo"]', "EMP-1");
await pub.fill('input[name="pin"]', "4321");
await pub.getByRole("button", { name: /인증 로그인/ }).click();
await pub.waitForTimeout(3000);
const landed = pub.url();
const jitUser = await db.user.findUnique({ where: { email: `${tag}-m1@catchsecu.test` } });
const jitMember = jitUser && await db.membership.findFirst({ where: { tenantId: f.companyId, userId: jitUser.id } });
const jitSession = jitUser && await db.session.findFirst({ where: { userId: jitUser.id } });
// viewer 권한 신규 구성원은 /dashboard 또는 /service/none으로 도착한다 — 세션+소속 생성이 핵심 증거
record("gpki-login-jit", ["/dashboard", "/service/none"].some(p => landed.includes(p)) && !!jitMember && !!jitSession && loginText.includes("가상 인증"), "url=" + landed + " role=" + jitMember?.role);
await pub.screenshot({ path: states + "04-gpki-logged-in.png" });

// 4) 이메일 미등록 구성원 → email-register 화면 → 등록 후 로그인
const pub2 = await (await browser.newContext()).newPage();
await pub2.goto(base + "/login/gpki", { waitUntil: "domcontentloaded" });
await pub2.waitForTimeout(1200);
await pub2.fill('input[name="orgCode"]', `${tag}-ORG`);
await pub2.fill('input[name="employeeNo"]', "EMP-2");
await pub2.fill('input[name="pin"]', "9876");
await pub2.getByRole("button", { name: /인증 로그인/ }).click();
await pub2.waitForTimeout(1800);
const regText = await pub2.locator("body").innerText();
const emailStepShown = regText.includes("등록할 이메일") || regText.includes("디렉터리에 이메일이 없습니다");
await pub2.screenshot({ path: states + "05-email-register.png" });
await pub2.fill('input[type="email"]', `${tag}-m2@catchsecu.test`);
await pub2.getByRole("button", { name: /이메일 등록/ }).click();
await pub2.waitForTimeout(3000);
const member2 = await db.virtualOrgMember.findFirst({ where: { providerId: provider!.id, employeeNo: "EMP-2" } });
const user2 = await db.user.findUnique({ where: { email: `${tag}-m2@catchsecu.test` } });
record("email-register-flow", emailStepShown && ["/dashboard", "/service/none"].some(p => pub2.url().includes(p)) && member2?.emailCipher !== null && !!user2, "url=" + pub2.url());
await pub2.screenshot({ path: states + "06-email-register-done.png" });

// 5) 가상 PG: 주문 생성 → 결제 내역 화면에서 가상 승인 → 환불 요청 → 가상 환불 승인
// 구독 트리거는 orderable·비trial·유효기간 내 버전만 허용 — 전용 QA 플랜을 명시 생성
const plan = await db.billingPlan.create({ data: { id: "qa-vpg-" + tag, name: "QA 가상결제 플랜 " + tag,
  versions: { create: { number: 1, cycle: "month", priceKrw: 10000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } } },
  include: { versions: true } });
const version = plan.versions[0];
await db.billingSubscription.deleteMany({ where: { tenantId: f.companyId, status: "pending" } }).catch(() => {});
const subscription = await db.billingSubscription.create({ data: { tenantId: f.companyId, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: version.priceKrw, currency: "KRW" } });
const orderRes = await fetch(base + "/api/v1/billing/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID(), cookie: ownerCookie, origin: base }, body: JSON.stringify({ subscriptionId: subscription.id }) });
const order = await orderRes.json();
record("order-created", orderRes.status === 201 && !!order.id, "order=" + order.id);

await page.goto(base + "/pay/license-service", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.screenshot({ path: states + "07-pay-history-pending.png" });
const payText = await page.locator("body").innerText();
const virtualButtons = payText.includes("가상 승인") && payText.includes("가상 실패");
await page.getByRole("button", { name: "가상 승인" }).first().click();
await page.waitForTimeout(2500);
const paidOrder = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
const activeSub = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
record("virtual-checkout-ui", virtualButtons && paidOrder.status === "paid" && activeSub.status === "active", "status=" + paidOrder.status + "/" + activeSub.status);
await page.screenshot({ path: states + "08-virtual-paid.png" });

// 환불 요청 후 가상 환불 승인 — 이 주문의 li 안에서만 조작(다른 주문의 폼과 혼동 방지)
const orderItem = page.locator("li", { hasText: plan.name });
await orderItem.locator('input[name="amount"]').fill("3000");
await orderItem.locator('input[name="reason"]').fill("QA 가상 환불");
await orderItem.getByRole("button", { name: "환불 요청" }).click();
await page.waitForTimeout(2000);
const requested = await db.paymentRefund.findFirst({ where: { orderId: order.id, status: "requested" } });
await page.screenshot({ path: states + "09-refund-requested.png" });
const bodyAfterRefund = await page.locator("body").innerText();
if (requested && bodyAfterRefund.includes("가상 환불 승인")) {
  await page.getByRole("button", { name: "가상 환불 승인" }).first().click();
  await page.waitForTimeout(2500);
}
const settled = requested && await db.paymentRefund.findUnique({ where: { id: requested.id } });
record("virtual-refund-ui", !!requested && settled?.status === "refunded", "refund=" + settled?.status);
await page.screenshot({ path: states + "10-virtual-refunded.png" });

// 6) 모바일 뷰포트 오버플로 확인
const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await mob.goto(base + "/login/gpki", { waitUntil: "domcontentloaded" });
await mob.waitForTimeout(1200);
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
record("mobile-no-overflow", overflow <= 12, "overflow=" + overflow);
await mob.screenshot({ path: states + "11-mobile-login.png" });

await writeFile(out + "virtual-auth-results.json", JSON.stringify({ tag, runAt: new Date().toISOString(), results }, null, 2));
await browser.close();
await db.$disconnect();
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `${failed.length} FAILED` : "ALL PASS");
process.exit(failed.length ? 1 : 0);
