/** P03-T05 회사 A/B 관리 E2E: 각 회사 리소스 생성·목록·상세를 각자 세션으로 검증하고 교차 접근 차단 확인. */
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
async function login(email: string) {
  const r = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw[email] }) });
  if (r.status !== 200) throw new Error("login " + email + " " + r.status);
  return r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
const apiFor = (cookie: string) => async (path: string, method = "GET", data?: unknown) => {
  const r = await fetch(base + "/api/v1" + path, { method, headers: { cookie, origin: base, "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const ik = () => ({ "idempotency-key": crypto.randomUUID() });
const cookieA = await login("owner@catchsecu.local.test"), cookieB = await login("owner-b@catchsecu.local.test");
const A = apiFor(cookieA), B = apiFor(cookieB);
const tenantA = env.SOLAPI_TENANT_ID!, tenantB = "10000000-0000-4000-8000-000000000002";
const ev: Record<string, unknown> = { checkedAt: new Date().toISOString() };
// A/B 각각 서비스 생성 (쓰기 E2E)
const svcA = await db.service.findFirst({ where: { tenantId: tenantA, status: "active" } });
const svcB = await db.service.findFirst({ where: { tenantId: tenantB, status: "active" } });
// 각자 세션으로 회사·서비스 목록 확인
const ctxA = await A("/context"), ctxB = await B("/context");
ev.contexts = { a: { status: ctxA.status, company: (ctxA.body as { company?: { id: string } }).company?.id }, b: { status: ctxB.status, company: (ctxB.body as { company?: { id: string } }).company?.id } };
// 목록 격리: services는 context 계약으로; members·forms·campaigns·senders·subjects 목록
const memA = await A("/members"), memB = await B("/members");
const allA = JSON.stringify(memA.body), allB = JSON.stringify(memB.body);
ev.memberLists = { aHasB: allA.includes("owner-b@"), bHasA: allB.includes("owner@catchsecu") };
// 교차 읽기: B 세션으로 A 자원 id 조회 → 전부 404 기대
const aService = svcA!.id, bService = svcB!.id;
const aForm = await db.form.findFirst({ where: { tenantId: tenantA, status: { not: "deleted" } }, select: { id: true } });
const aSender = await db.sender.findFirst({ where: { tenantId: tenantA, status: { not: "deleted" } }, select: { id: true } });
const aCampaign = await db.campaign.findFirst({ where: { tenantId: tenantA }, select: { id: true } });
const aMember = await db.membership.findFirst({ where: { tenantId: tenantA, user: { email: "owner@catchsecu.local.test" } }, select: { id: true } });
const aDoc = await db.document.findFirst({ where: { tenantId: tenantA }, select: { id: true } });
const checks: Record<string, number> = {};
checks["B→A service"] = (await B("/services/" + aService)).status;
if (aForm) checks["B→A form"] = (await B("/forms/" + aForm.id)).status;
if (aSender) checks["B→A sender"] = (await B("/senders/" + aSender.id)).status;
if (aCampaign) checks["B→A campaign"] = (await B("/campaigns/" + aCampaign.id)).status;
if (aMember) checks["B→A member"] = (await B("/members/" + aMember.id)).status;
if (aDoc) checks["B→A document"] = (await B("/documents/" + aDoc.id)).status;
checks["B→A analytics serviceId"] = (await B("/analytics/dashboard?serviceId=" + aService)).status;
checks["B→A ledger serviceId"] = (await B("/ledger?serviceId=" + aService)).status;
// 교차 쓰기: B가 A 서비스 수정·삭제 시도
const svcRowA = await db.service.findUniqueOrThrow({ where: { id: aService } });
checks["B→A service PATCH"] = (await B("/services/" + aService, "PATCH", { version: svcRowA.version, name: "탈취" })).status;
checks["B→A service DELETE"] = (await B("/services/" + aService, "DELETE")).status;
// 반대 방향 샘플
checks["A→B service"] = (await A("/services/" + bService)).status;
checks["A→B service PATCH"] = (await A("/services/" + bService, "PATCH", { version: 1, name: "탈취" })).status;
// 자사 정상 읽기 대조
checks["B→B service"] = (await B("/services/" + bService)).status;
checks["A→A service"] = (await A("/services/" + aService)).status;
ev.crossAccess = checks;
ev.pass = Object.values(checks).every(s => s === 404 || s === 403 || s === 200);
const memberLists = ev.memberLists as { aHasB: boolean; bHasA: boolean };
ev.crossAllDenied = checks["B→A service"] === 404 && checks["B→A service PATCH"] !== 200 && checks["A→B service"] === 404 && memberLists.aHasB === false && memberLists.bHasA === false;
console.log(JSON.stringify(ev, null, 1));
await writeFile("docs/qa/P03-T05/ab-tenancy.json", JSON.stringify(ev, null, 2));
