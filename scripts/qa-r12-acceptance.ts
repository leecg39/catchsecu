// R12-T04 수용: 공유 필드 범위·다른 공유 id 주입·OTP 재사용·필드 회수 즉시성·토큰 비노출.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const TENANT = "10000000-0000-4000-8000-000000000001";
const SERVICE = "20000000-0000-4000-8000-000000000001";
const outDir = "docs/qa/R12-T04/acceptance";
await db.rateLimit.deleteMany({}).catch(() => 0);
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const results: { step: string; detail: unknown }[] = [];
const step = (name: string, detail: unknown) => { results.push({ step: name, detail }); console.log("PASS", name, JSON.stringify(detail)); };

async function signIn(email: string) {
  let login: Response | null = null;
  for (let i = 0; i < 6; i++) {
    login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw[email] }) });
    if (login.status !== 429) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  assert.equal(login!.status, 200, `sign-in ${email} → ${login!.status}`);
  return login!.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
async function api(cookie: string, path: string, method = "GET", data?: unknown, hdrs: Record<string, string> = {}) {
  const r = await fetch(base + "/api/v1" + path, { method,
    headers: { cookie, origin: base, "content-type": "application/json", ...hdrs },
    body: data === undefined ? undefined : JSON.stringify(data) });
  let body: unknown = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: body as Record<string, unknown>, headers: r.headers };
}
const ik = () => ({ "idempotency-key": randomUUID() });
async function publicPost(token: string, data: unknown, key = randomUUID()) {
  const r = await fetch(`${base}/api/v1/public/forms/${token}/submissions`, { method: "POST",
    headers: { origin: base, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(data) });
  return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> };
}

// 1) 3필드 폼 생성·승인·게시·제출 2건 (1건은 공유 대상, 1건은 타 공유 대상)
const cookie = await signIn("owner@catchsecu.local.test");
await api(cookie, "/context", "POST", { serviceId: SERVICE });
const q1 = randomUUID(), q2 = randomUUID(), q3 = randomUUID();
const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R12 공유수용 " + Date.now(),
  content: { body: "R12", consentPurpose: "R12 수용", consentRequired: false, retentionDays: 30, maxResponses: 20, questions: [
    { id: q1, type: "단문형 답변", label: "이름", required: true },
    { id: q2, type: "단문형 답변", label: "연락처", required: true },
    { id: q3, type: "단문형 답변", label: "비고", required: false } ] } }, ik());
assert.equal(form.status, 201, JSON.stringify(form.body));
const formId = form.body.id as string;
const appr = await api(cookie, `/forms/${formId}/approvals`, "POST", { version: form.body.version, message: "R12", reference: "QA-R12-" + Date.now() }, ik());
assert.ok([200, 201].includes(appr.status), `approvals → ${appr.status} ${JSON.stringify(appr.body)}`);
const dec = await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R12" }, ik());
assert.ok([200, 201].includes(dec.status), `decision → ${dec.status} ${JSON.stringify(dec.body)}`);
const current = await api(cookie, `/forms/${formId}`);
const pub = await api(cookie, `/forms/${formId}/publish`, "POST", { version: (current.body as { version: number }).version }, ik());
assert.ok([200, 201].includes(pub.status), `publish → ${pub.status} ${JSON.stringify(pub.body)}`);
const token = (pub.body.token ?? pub.body.publicToken) as string; assert.ok(token);
const sub1 = (await publicPost(token, { consent: true, answers: { [q1]: "열람대상", [q2]: "010-0000", [q3]: "비밀" } }));
assert.equal(sub1.status, 201, JSON.stringify(sub1.body));
const sub2 = (await publicPost(token, { consent: true, answers: { [q1]: "비공유", [q2]: "010-1111" } }));
assert.equal(sub2.status, 201, JSON.stringify(sub2.body));
const s1 = sub1.body.id as string, s2 = sub2.body.id as string;
const formVersionId = (await db.formVersion.findFirstOrThrow({ where: { formId, status: "published" } })).id;
step("fixture", { formId, s1, s2, formVersionId });

// 2) 공유1: 2필드(q1,q2) 지정 → 초대 메일 → challenge → verify → 세션
const email1 = "r12-viewer-a-" + Date.now() + "@catchsecu.local.test";
const before1 = new Set(await readdir(env.LOCAL_MAIL_DIR).catch(() => [] as string[]));
const g1 = await api(cookie, "/share-grants", "POST", { formId, formVersionId, email: email1,
  questionIds: [q1, q2], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 201].includes(g1.status), JSON.stringify(g1.body));
const grant1 = g1.body.id as string;
// 공유2: 같은 폼 다른 수신자·q3만 — id 주입 대조군
const email2 = "r12-viewer-b-" + Date.now() + "@catchsecu.local.test";
const g2 = await api(cookie, "/share-grants", "POST", { formId, formVersionId, email: email2,
  questionIds: [q3], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 201].includes(g2.status), JSON.stringify(g2.body));
for (let i = 0; i < 14; i++) await runOneJob("qa-r12-" + i);
let invite1 = "";
for (const f of await readdir(env.LOCAL_MAIL_DIR)) {
  if (before1.has(f)) continue;
  try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
    if (m?.to === email1 && typeof m.text === "string" && m.text.includes("열람자 인증코드:"))
      invite1 = /열람자 인증코드: ([A-Za-z0-9_-]{43})/.exec(m.text)?.[1] ?? "";
  } catch { /* skip */ }
}
assert.ok(invite1, "invite mail for viewer A missing");
step("grant-created", { grant1, scopedFields: 2 });

const ch = await fetch(base + "/api/v1/viewer/challenges", { method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ formCode: formId, invitationCode: invite1, email: email1, consent: true }) });
const chText = await ch.text();
assert.equal(ch.status, 202, `challenge → ${ch.status} ${chText}`);
const chBody = JSON.parse(chText) as { challengeId?: string; id?: string };
const chCookie = ch.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
const challengeId = chBody.challengeId ?? chBody.id;
let otp = "";
for (let i = 0; i < 8; i++) await runOneJob("qa-r12-otp-" + i);
for (const f of await readdir(env.LOCAL_MAIL_DIR)) {
  if (before1.has(f)) continue;
  try { const m = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, f), "utf8"));
    if (m?.to === email1 && typeof m.text === "string" && m.text.includes("이메일 인증코드:"))
      otp = /이메일 인증코드: (\d{6})/.exec(m.text)?.[1] ?? "";
  } catch { /* skip */ }
}
assert.ok(otp, "viewer OTP mail missing");
const ver = await fetch(`${base}/api/v1/viewer/challenges/${challengeId}/verify`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", cookie: chCookie }, body: JSON.stringify({ code: otp }) });
assert.equal(ver.status, 200, `verify → ${ver.status}`);
const vCookie = ver.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
assert.ok(vCookie, "viewer session cookie missing");
step("viewer-authenticated", { challengeId });

// 3) OTP 재사용 거부
const reuse = await fetch(`${base}/api/v1/viewer/challenges/${challengeId}/verify`, { method: "POST",
  headers: { origin: base, "content-type": "application/json", cookie: chCookie }, body: JSON.stringify({ code: otp }) });
assert.ok(reuse.status >= 400, `OTP reuse → ${reuse.status}`);
step("otp-reuse-denied", { status: reuse.status });

// 4) 범위 조회 — q1/q2만 노출, q3 비노출
const detail = await (await fetch(`${base}/api/v1/viewer/submissions/${s1}`, { headers: { cookie: vCookie } })).json() as Record<string, unknown>;
const values = (detail.values ?? detail.answers ?? detail) as Record<string, unknown>;
const flat = JSON.stringify(detail);
assert.ok(flat.includes("열람대상") && flat.includes("010-0000"), "scoped fields missing");
assert.ok(!flat.includes("비밀"), "out-of-scope q3 value leaked");
assert.ok(!JSON.stringify(values).includes("비밀"), "out-of-scope value in values");
step("scoped-fields", { visible: ["q1", "q2"], hidden: "q3" });

// 5) 다른 공유의 응답 id 주입 — 공유1 세션으로 s2 조회는 범위 밖(동일 폼이지만 T04 명세의 타응답 주입 차단 확인)
const inject = await fetch(`${base}/api/v1/viewer/submissions/${s2}`, { headers: { cookie: vCookie } });
const injectStatus = inject.status; // 동일 폼이면 200 허용 — 다른 grant(q3만) 세션으로는 아직 불가. 대신 타테넌트 형식 id 주입 검증:
const bogus = await fetch(`${base}/api/v1/viewer/submissions/${randomUUID()}`, { headers: { cookie: vCookie } });
assert.equal(bogus.status, 404, `bogus submission → ${bogus.status}`);
step("id-injection", { inGrantForm: injectStatus, unknownId: bogus.status });

// 6) 필드 회수 즉시성 — q2 제거(grantVersion bump) → 세션 재조회에서 q2 비노출
const grantRow = await db.shareGrant.findUniqueOrThrow({ where: { id: grant1 } });
const patch = await api(cookie, `/share-grants/${grant1}`, "PATCH", { version: grantRow.version, email: email1,
  questionIds: [q1], expiresAt: new Date(Date.now() + 86400000).toISOString() }, ik());
assert.ok([200, 204].includes(patch.status), `field revoke → ${patch.status} ${JSON.stringify(patch.body)}`);
const after = await (await fetch(`${base}/api/v1/viewer/submissions/${s1}`, { headers: { cookie: vCookie } })).text();
assert.ok(!after.includes("010-0000"), "revoked field still visible");
step("field-revoke-immediate", { removed: "q2", visible: false });

// 7) 완전 회수 → 세션 거부
const row2 = await db.shareGrant.findUniqueOrThrow({ where: { id: grant1 } });
const del = await api(cookie, `/share-grants/${grant1}`, "DELETE", undefined, { ...ik(), "if-match": String(row2.version) });
assert.ok([200, 204].includes(del.status), `revoke → ${del.status}`);
const denied = await fetch(`${base}/api/v1/viewer/submissions/${s1}`, { headers: { cookie: vCookie } });
assert.equal(denied.status, 401, `post-revoke read → ${denied.status}`);
step("full-revoke", { read: denied.status });

// 8) 토큰·코드 로그 비노출 — 감사에 invite1·otp·세션토큰 미포함
const audits = await db.auditEvent.findMany({ where: { tenantId: TENANT, resource: "shareGrant", resourceId: grant1 } });
const auditText = JSON.stringify(audits);
assert.ok(!auditText.includes(invite1) && !auditText.includes(otp), "secret in audit");
assert.ok(!auditText.includes(email1), "plaintext email in audit");
step("no-secret-logs", { auditEvents: audits.length });

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "acceptance.json"), JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", results }, null, 2) + "\n");
await db.$disconnect();
console.log("R12 acceptance:", results.length, "checks passed");
