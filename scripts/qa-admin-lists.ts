/** P03-T05 관리 목록 검색·페이지·정렬 실측 */
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const r = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
const cookie = r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const api = async (p: string) => { const res = await fetch(base + "/api/v1" + p, { headers: { cookie, origin: base } }); return { status: res.status, body: await res.json().catch(() => null) }; };
const tenant = env.SOLAPI_TENANT_ID!;
const svc = await db.service.findFirstOrThrow({ where: { tenantId: tenant } });
const ev: Record<string, unknown> = { checkedAt: new Date().toISOString() };
// members 검색
const memAll = await api("/members?pageSize=100");
const total = (memAll.body as { total?: number; items?: unknown[] }).total ?? (memAll.body as { items: unknown[] }).items.length;
const memSearch = await api("/members?search=" + encodeURIComponent("zzznotfound"));
const memHit = await api("/members?search=" + encodeURIComponent("owner@catchsecu"));
ev.members = { total, searchMiss: (memSearch.body as { total?: number }).total ?? (memSearch.body as { items: unknown[] }).items?.length, searchHitContainsOwner: JSON.stringify(memHit.body).includes("owner@catchsecu") };
// forms 검색 + 페이지 경계
const forms = await api("/forms?serviceId=" + svc.id + "&pageSize=2&page=1");
const forms2 = await api("/forms?serviceId=" + svc.id + "&pageSize=2&page=2");
const formsBad = await api("/forms?serviceId=" + svc.id + "&page=0");
const formsBad101 = await api("/forms?serviceId=" + svc.id + "&pageSize=101");
const items1 = (forms.body as { items: { id: string }[] }).items ?? [], items2 = (forms2.body as { items: { id: string }[] }).items ?? [];
ev.forms = { page1: items1.length, page2: items2.length, disjoint: !items1.some(a => items2.some(b => b.id === a.id)), page0: formsBad.status, size101: formsBad101.status };
// campaigns 검색
const camp = await api(`/campaigns?serviceId=${svc.id}&channel=sms&search=${encodeURIComponent("솔라피 라이브")}`);
ev.campaignSearch = { found: JSON.stringify(camp.body).includes("솔라피 라이브") };
// documents 목록
const docs = await api("/documents?serviceId=" + svc.id + "&pageSize=5");
ev.documents = { status: docs.status, total: (docs.body as { total?: number }).total ?? null };
// notices 목록 검색
const notices = await api("/notices?pageSize=5");
ev.notices = { status: notices.status, items: (notices.body as { items?: unknown[] }).items?.length ?? null };
console.log(JSON.stringify(ev, null, 1));
await writeFile("docs/qa/P03-T05/admin-lists.json", JSON.stringify(ev, null, 2));
