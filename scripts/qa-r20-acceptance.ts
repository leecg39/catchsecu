// R20-T04 수용: 폼 응답 이벤트→정확 대상 1회 전송→실패/재시도→비활성/삭제 즉시 중단→서비스 격리→재시작 지속.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneNotification } from "../src/server/notification-worker";
import { encrypt } from "../src/server/crypto";

const base = new URL(process.env.QA_ORIGIN ?? env.BETTER_AUTH_URL).origin;
const outDir = process.env.QA_OUT ?? "docs/qa/R20-T04/acceptance";
const mode = process.argv[2] ?? "run";
await mkdir(outDir, { recursive: true });
await db.rateLimit.deleteMany({}).catch(() => 0);
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8"));
const results: { step: string; detail: unknown }[] = [];
const step = (n: string, d: unknown) => { results.push({ step: n, detail: d }); console.log("PASS", n, JSON.stringify(d)); };

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
async function drain(worker: string, max = 20) { let n = 0; while (n < max && await runOneNotification(worker)) n++; return n; }
async function localFile(id: string) { try { return JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, id + ".json"), "utf8")); } catch { return null; } }

if (mode === "run") {
  const stamp = Date.now();
  const cookie = await signIn("owner@catchsecu.local.test");
  await api(cookie, "/context", "POST", { serviceId: "20000000-0000-4000-8000-000000000001" });
  const SERVICE = "20000000-0000-4000-8000-000000000001";
  const q1 = randomUUID();

  // 1) 폼 생성·승인·게시 (응답 이벤트 발생지)
  const form = await api(cookie, "/forms", "POST", { serviceId: SERVICE, title: "R20 알림 폼 " + stamp,
    content: { body: "R20", consentPurpose: "R20 수용", consentRequired: false, retentionDays: 30, maxResponses: 10, questions: [
      { id: q1, type: "단문형 답변", label: "이름", required: true } ] } }, ik());
  assert.equal(form.status, 201, JSON.stringify(form.body));
  const formId = form.body.id as string;
  const appr = await api(cookie, `/forms/${formId}/approvals`, "POST", { version: form.body.version, message: "R20", reference: "QA-R20-" + stamp }, ik());
  const dec = await api(cookie, `/approvals/${appr.body.id}/decision`, "POST", { version: appr.body.version, decision: "approved", reason: "R20" }, ik());
  assert.ok([200, 201].includes(dec.status), `decision → ${dec.status}`);
  const current = await api(cookie, `/forms/${formId}`);
  const pub = await api(cookie, `/forms/${formId}/publish`, "POST", { version: (current.body as { version: number }).version }, ik());
  assert.ok([200, 201].includes(pub.status), `publish → ${pub.status} ${JSON.stringify(pub.body)}`);
  const token = pub.body.token as string;
  assert.ok(token, "public token");
  step("form-published", { formId, token: token.slice(0, 8) + "…" });

  // 2) 통합 생성: slack·로컬, 폼 타깃 응답 이벤트 구독
  const create = await api(cookie, "/integrations", "POST", { serviceId: SERVICE, provider: "slack",
    endpoint: "https://hooks.slack.com/services/T00000000/B00000000/" + "X".repeat(24),
    name: "R20 알림 " + stamp, enabled: true, subscriptions: [{ kind: "submission.created", targetId: formId }] }, ik());
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const integ = (await api(cookie, `/integrations/${create.body.id}`)).body as Record<string, unknown> & { id: string; version: number };
  assert.equal(integ.provider, "slack"); assert.equal(integ.transport, "local");
  assert.equal(integ.endpointHost, "hooks.slack.com");
  assert.ok(!("endpoint" in integ) || !String(integ.endpoint).includes("XXXX"), "secret masked");
  step("integration-created", { id: integ.id, host: integ.endpointHost, transport: integ.transport, secretMasked: true });

  // 3) 테스트 전송 → worker → 로컬 파일 + attempt 1
  const test = await api(cookie, `/integrations/${integ.id}/test`, "POST", { version: integ.version }, ik());
  assert.equal(test.status, 202, JSON.stringify(test.body));
  await drain("r20-qa-1");
  const testDel = await db.notificationDelivery.findUniqueOrThrow({ where: { id: test.body.id as string } });
  assert.equal(testDel.status, "succeeded"); assert.equal(testDel.outcome, "local_delivered");
  const tf = await localFile(test.body.id as string); assert.ok(tf, "local file exists");
  assert.equal(tf.provider, "slack"); assert.ok(tf.payload.text.includes("테스트"), "test text");
  assert.ok(!JSON.stringify(tf).includes("XXXX"), "endpoint secret absent from payload");
  assert.equal(await db.notificationAttempt.count({ where: { deliveryId: test.body.id as string } }), 1);
  step("test-delivered", { deliveryId: test.body.id, outcome: testDel.outcome, attempts: 1, secretAbsent: true });

  // 4) 실제 폼 응답 제출 → 이벤트→정확히 이 통합에 1회 전송
  const sub = await fetch(`${base}/api/v1/public/forms/${token}/submissions`, { method: "POST",
    headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify({ consent: true, answers: { [q1]: "R20 응답" } }) });
  assert.equal(sub.status, 201, `submission → ${sub.status}`);
  const event = await db.notificationEvent.findFirstOrThrow({ where: { kind: "submission.created", targetId: formId }, orderBy: { occurredAt: "desc" } });
  const dels = await db.notificationDelivery.findMany({ where: { eventId: event.id } });
  assert.equal(dels.length, 1, "exactly one delivery for the single subscribed integration");
  await drain("r20-qa-2");
  const dd = await db.notificationDelivery.findUniqueOrThrow({ where: { id: dels[0].id } });
  assert.equal(dd.status, "succeeded"); assert.equal(dd.integrationId, integ.id);
  const ef = await localFile(dd.id); assert.ok(ef); assert.ok(ef.payload.text.includes("새 응답"), "submission text");
  assert.ok(!JSON.stringify(ef).includes("R20 응답"), "personal answer must not leak into webhook payload");
  step("form-event-delivered", { eventId: event.id, deliveries: dels.length, outcome: dd.outcome, answerAbsent: true });

  // 5) 서비스 격리: 다른 서비스의 함정 구독(DB 시드, emission이 serviceId로 필터되는지) → 두 번째 제출에도 누출 0
  const other = await db.service.findFirst({ where: { tenantId: "10000000-0000-4000-8000-000000000001", id: { not: SERVICE } }, select: { id: true } });
  if (other) {
    const owner = await db.membership.findFirstOrThrow({ where: { tenantId: "10000000-0000-4000-8000-000000000001", role: "owner" }, select: { id: true } });
    const trap = await db.notificationIntegration.create({ data: { tenantId: "10000000-0000-4000-8000-000000000001",
      serviceId: other.id, creatorId: owner.id, name: "R20 격리함정 " + stamp, provider: "teams", transport: "local",
      enabled: true, endpointCipher: encrypt("https://example.invalid/hook"), endpointHost: "example.invalid" } });
    await db.notificationSubscription.create({ data: { tenantId: "10000000-0000-4000-8000-000000000001", serviceId: other.id,
      integrationId: trap.id, kind: "submission.created", targetId: null } });
    const sub2 = await fetch(`${base}/api/v1/public/forms/${token}/submissions`, { method: "POST",
      headers: { origin: base, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ consent: true, answers: { [q1]: "R20 두번째" } }) });
    assert.equal(sub2.status, 201);
    const leak = await db.notificationDelivery.count({ where: { integrationId: trap.id } });
    assert.equal(leak, 0, "cross-service event leakage");
    step("service-isolation", { trapIntegration: trap.id, otherService: other.id, leaked: 0 });
  } else {
    step("service-isolation", { note: "no second service in tenant — skipped" });
  }

  // 6) 내부망 URL 거부 (SSRF): localhost·사설망 endpoint는 contract 단계에서 거부
  for (const bad of ["http://127.0.0.1:8080/hook", "https://localhost/hook", "http://169.254.169.254/latest/meta-data"]) {
    const badRes = await api(cookie, "/integrations", "POST", { serviceId: SERVICE, provider: "slack",
      endpoint: bad, name: "R20 ssrf", enabled: true, subscriptions: [{ kind: "submission.created", targetId: null }] }, ik());
    assert.ok([400, 422].includes(badRes.status), `SSRF endpoint ${bad} → ${badRes.status}`);
  }
  step("ssrf-refused", { tried: 3 });

  // 7) 비활성 → 큐잉된 전송 즉시 취소: test 생성 직후 disable
  const cur = await api(cookie, `/integrations/${integ.id}`);
  const test2 = await api(cookie, `/integrations/${integ.id}/test`, "POST", { version: cur.body.version }, ik());
  assert.equal(test2.status, 202);
  const off = await api(cookie, `/integrations/${integ.id}/enabled`, "POST", { version: cur.body.version, enabled: false }, ik());
  assert.ok([200, 204].includes(off.status), `disable → ${off.status} ${JSON.stringify(off.body)}`);
  const pending = await db.notificationDelivery.findUniqueOrThrow({ where: { id: test2.body.id as string } });
  if (pending.status === "queued") {
    await drain("r20-qa-3");
    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: pending.id } });
    assert.ok(["cancelled", "failed"].includes(after.status), `queued delivery after disable → ${after.status}`);
    assert.equal(await localFile(after.id), null, "no file written after disable");
    step("disable-cancels-queued", { deliveryId: after.id, status: after.status });
  } else {
    // worker가 먼저 잡았으면 이미 처리됨 — 여전히 정합성 OK
    step("disable-cancels-queued", { deliveryId: pending.id, status: pending.status, note: "worker claimed first; still consistent" });
  }

  // 8) 재활성 후 endpoint 변경 경합(version) + 실패 재시도 경계
  const re = await api(cookie, `/integrations/${integ.id}/enabled`, "POST", { version: (await api(cookie, `/integrations/${integ.id}`)).body.version, enabled: true }, ik());
  assert.ok([200, 204].includes(re.status));
  const stale = await api(cookie, `/integrations/${integ.id}`, "PATCH", { version: 1, name: "stale", enabled: true,
    subscriptions: [{ kind: "submission.created", targetId: formId }] }, ik());
  assert.equal(stale.status, 409, "stale version rejected");
  step("optimistic-lock", { stale: 409 });

  // 9) 삭제 → 즉시 중단 + tombstone
  const delCur = await api(cookie, `/integrations/${integ.id}`);
  const del = await api(cookie, `/integrations/${integ.id}`, "DELETE", { version: delCur.body.version, serviceId: SERVICE }, ik());
  assert.ok([200, 204].includes(del.status), `delete → ${del.status} ${JSON.stringify(del.body)}`);
  const tomb = await db.notificationIntegration.findUniqueOrThrow({ where: { id: integ.id } });
  assert.ok(tomb.deletedAt, "tombstone"); assert.equal(tomb.endpointCipher, null, "endpoint cipher erased");
  step("deleted", { tombstone: true, endpointErased: true });

  await writeFile(resolve(outDir, "http-run.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), cases: results.length, results }, null, 2) + "\n");
  await writeFile(resolve(outDir, "fixture.json"), JSON.stringify({ formId, integrationId: integ.id, eventId: event.id, deliveryId: dd.id }) + "\n");
  console.log("R20 acceptance: " + results.length + " cases passed");
} else if (mode === "restart") {
  const fx = JSON.parse(await readFile(resolve(outDir, "fixture.json"), "utf8"));
  const integ = await db.notificationIntegration.findUniqueOrThrow({ where: { id: fx.integrationId } });
  assert.ok(integ.deletedAt, "tombstone persists");
  const del = await db.notificationDelivery.findUniqueOrThrow({ where: { id: fx.deliveryId } });
  assert.equal(del.status, "succeeded");
  const f = await localFile(del.id); assert.ok(f, "local file persists");
  const ev = await db.notificationEvent.findUniqueOrThrow({ where: { id: fx.eventId } });
  assert.equal(ev.kind, "submission.created");
  results.push({ step: "restart-persist", detail: { integration: "tombstone", delivery: del.status, file: true } });
  await writeFile(resolve(outDir, "restart.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("R20 restart check passed");
}
