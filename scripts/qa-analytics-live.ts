/** P12-T02 잔여: 대시보드↔독립SQL·원장집계↔SQL·월마감 스냅샷 재집계/불변 검증. */
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await (await import("node:fs/promises")).readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const r = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email: "owner@catchsecu.local.test", password: pw["owner@catchsecu.local.test"] }) });
if (r.status !== 200) throw new Error("login " + r.status);
const cookie = r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function api(path: string, method = "GET", data?: unknown) {
  const res = await fetch(base + "/api/v1" + path, { method, headers: { cookie, origin: base, "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const tenant = env.SOLAPI_TENANT_ID!;
const month = new Date().toISOString().slice(0, 7);
const from = month + "-01T00:00:00.000Z", to = new Date(new Date(from).getTime() + 31 * 86400000 > Date.now() ? Date.now() : 0).toISOString();
// 실제 월 경계: 다음달 1일
const [y, m] = month.split("-").map(Number);
const toBoundary = new Date(Date.UTC(y, m, 1)).toISOString(), fromBoundary = new Date(Date.UTC(y, m - 1, 1)).toISOString();
const dash = await api(`/analytics/dashboard?from=${fromBoundary}&to=${toBoundary}`);
if (dash.status !== 200) throw new Error("dashboard " + dash.status + " " + JSON.stringify(dash.body));
const sql = await db.$queryRawUnsafe<{ forms: bigint; retained: bigint; period: bigint }[]>(`
  SELECT (SELECT COUNT(*) FROM "Form" f WHERE f."tenantId"=$1 AND f."sourceType"='form' AND f.status<>'deleted') forms,
    (SELECT COUNT(*) FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
      WHERE s."tenantId"=$1 AND f."tenantId"=$1 AND s.status NOT IN ('destroying','destroyed') AND (s."legalHold" OR s."retentionUntil">now())) retained,
    (SELECT COUNT(*) FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
      WHERE s."tenantId"=$1 AND s."submittedAt">=$2 AND s."submittedAt"<$3 AND s.status NOT IN ('destroying','destroyed')
      AND (s."legalHold" OR s."retentionUntil">now())) period`, tenant, new Date(fromBoundary), new Date(toBoundary));
const svcCount = await db.service.count({ where: { tenantId: tenant, status: "active" } });
const t = (dash.body as { totals: Record<string, number> }).totals;
const checks: Record<string, [number | bigint, number | bigint]> = {
  services: [svcCount, t.services], forms: [sql[0].forms, t.forms],
  retainedSubmissions: [sql[0].retained, t.retainedSubmissions], periodSubmissions: [sql[0].period, t.periodSubmissions] };
const mismatched = Object.entries(checks).filter(([, [a, b]]) => Number(a) !== Number(b));
// 원장 집계 대조
const ledger = await api("/ledger?currency=KRW&pageSize=100");
const account = await db.creditAccount.findFirst({ where: { tenantId: tenant, currency: "KRW" } });
const txCount = await db.ledgerTransaction.count({ where: { tenantId: tenant, currency: "KRW" } });
const lb = ledger.body as { available: string; held: string; total: number };
// 월 마감 → 스냅샷 = 재집계 일치 → 재호출 불변
const close1 = await api("/analytics/closes", "POST", { month });
if (![200, 201].includes(close1.status)) throw new Error("close " + close1.status + " " + JSON.stringify(close1.body));
const snap1 = (close1.body as { close: { totals: Record<string, number> } }).close.totals;
const snapMismatch = Object.keys(t).filter(k => Number(snap1[k]) !== Number(t[k]));
const close2 = await api("/analytics/closes", "POST", { month });
const identical = JSON.stringify((close2.body as { close: object }).close) === JSON.stringify((close1.body as { close: object }).close);
const get1 = await api(`/analytics/closes?month=${month}`);
const out = {
  checkedAt: new Date().toISOString(), dashboardVsSql: Object.fromEntries(Object.entries(checks).map(([k, [a, b]]) => [k, { sql: Number(a), api: b, ok: Number(a) === Number(b) }])),
  mismatched: mismatched.map(([k]) => k), ledger: { apiAvailable: lb.available, dbAvailable: String(account?.available ?? 0), apiTotal: lb.total, sqlTotal: txCount, match: String(account?.available ?? 0) === lb.available && txCount <= lb.total },
  close: { month, created1: (close1.body as { created?: boolean }).created, snapshotMatchesLive: snapMismatch.length === 0, snapMismatch, recloseIdenticalSnapshot: identical, created2: (close2.body as { created?: boolean }).created, getStatus: get1.status },
};
console.log(JSON.stringify(out, null, 1));
await writeFile("docs/qa/P12-T02/live-recompute.json", JSON.stringify(out, null, 2));
if (mismatched.length || snapMismatch.length || !identical) process.exit(1);
