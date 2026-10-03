import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
import type { Prisma } from "../src/generated/prisma/client";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert(["http://localhost:3100", "http://127.0.0.1:3100"].includes(origin));
assert.equal(env.MAIL_TRANSPORT, "local", "로컬 메일함에서만 검증합니다.");
type Person = { id: string; email: string; password: string; cookie: string };
type RecordVersion = { id: string; version: number };
const tag = randomUUID().slice(0, 8), people: Person[] = [], sessions = new Set<string>();
const cases: { label: string; status: number }[] = [];
let adminCookie = "", companyId = "", serviceId = "", secondServiceId = "", memberId = "", assignmentId = "";
async function http(label: string, path: string, method: string, cookie: string, value: unknown, expected: number, headers: Record<string, string> = {}) {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: {
    ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label + " HTTP");
  cases.push({ label, status: response.status }); return response;
}
async function api<T>(label: string, path: string, method = "GET", person?: Person, value?: unknown, expected = 200, headers: Record<string, string> = {}): Promise<T> {
  const response = await http(label, "/api/v1" + path, method, person?.cookie ?? "", value, expected, headers);
  return (await response.json().catch(() => undefined)) as T;
}
function eligible(): Prisma.JobWhereInput { const now = new Date(); return { OR: [{ status: { in: ["queued", "retry"] }, dueAt: { lte: now } }, { status: "leased", leaseUntil: { lt: now } }] }; }
async function saveFixture() {
  await writeFile(".local/p03-members-fixture.json", JSON.stringify({ people: people.map(person => ({ id: person.id, email: person.email, password: person.password })),
    companyId, serviceId, secondServiceId, memberId, assignmentId, tag }, null, 2), { mode: 0o600 });
}
async function mailFor(email: string, dedupeKey?: string) {
  const queued = await db.job.findMany({ where: { type: "mail", ...(dedupeKey ? { dedupeKey } : {}) }, orderBy: { createdAt: "desc" } });
  const selected = queued.find(row => decrypt<{ to: string }>(row.payloadCipher).to === email);
  assert(selected, "합성 계정의 메일 작업이 없습니다.");
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await db.job.findUniqueOrThrow({ where: { id: selected.id } })).status === "done") break;
    const due = await db.job.findMany({ where: eligible() });
    assert(due.every(row => row.type === "mail" && people.some(person => person.email === decrypt<{ to: string }>(row.payloadCipher).to)),
      "다른 사용자의 대기 작업을 처리하지 않습니다.");
    assert(await runOneJob("p03-members-http"), "메일 worker가 작업을 찾지 못했습니다.");
  }
  assert.equal((await db.job.findUniqueOrThrow({ where: { id: selected.id } })).status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, selected.id + ".json"), "utf8")) as { to: string; text: string };
  assert.equal(mail.to, email); return mail;
}
async function login(person: Person) {
  const response = await http("합성 계정 로그인", "/api/v1/auth/sign-in/email", "POST", "", { email: person.email, password: person.password }, 200);
  person.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert(person.cookie); sessions.add(person.cookie);
}
async function register(name: string) {
  const person: Person = { id: "", email: "p03-" + name + "-" + tag + "@catchsecu.local.test", password: randomBytes(24).toString("base64url") + "!1aA", cookie: "" };
  people.push(person); await saveFixture();
  await http("가입", "/api/v1/auth/sign-up/email", "POST", "", { name: "P03 " + name, email: person.email, password: person.password, callbackURL: origin + "/login" }, 200);
  const mail = await mailFor(person.email), link = mail.text.match(/https?:\/\/\S+/)?.[0];
  assert(link && new URL(link).origin === origin);
  const verified = await fetch(link, { redirect: "manual" }); assert.equal(verified.status, 302);
  const user = await db.user.findUniqueOrThrow({ where: { email: person.email } }); assert(user.emailVerified);
  person.id = user.id; await saveFixture(); await login(person); return person;
}
async function invite(owner: Person, recipient: Person, serviceIds: string[]) {
  return api<RecordVersion>("초대 생성", "/invitations", "POST", owner, { email: recipient.email, role: "viewer", serviceIds }, 201, { "Idempotency-Key": randomUUID() });
}
function inviteToken(text: string) {
  const href = text.split("\n").find(line => line.startsWith(origin)); assert(href);
  const token = new URL(href).searchParams.get("token"); assert(token); return token;
}
async function main() {
  assert.equal(await db.job.count({ where: eligible() }), 0, "기존 작업이 대기 중이면 이 검증을 시작하지 않습니다.");
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const owner = await register("owner"), invited = await register("member"), foreign = await register("foreign"), expert = await register("expert");
  const company = await api<RecordVersion>("회사 A 생성", "/companies", "POST", owner, { name: "P03 구성원 HTTP " + tag, publicName: "P03 구성원 HTTP" }, 201);
  companyId = company.id; await saveFixture();
  const owned = await api<{ items: { id: string }[] }>("기본 서비스 조회", "/services", "GET", owner); serviceId = owned.items[0].id;
  secondServiceId = (await api<RecordVersion>("두 번째 서비스 생성", "/services", "POST", owner, { name: "P03 권한 서비스", externalName: "P03 권한 서비스", type: "app" }, 201)).id;
  await saveFixture();
  await api("회사 B 생성", "/companies", "POST", foreign, { name: "P03 다른 회사 " + tag, publicName: "P03 다른 회사" }, 201);
  const ownList = await api<{ items: { id: string }[]; total: number }>("실제 소속 회사 목록", "/companies?search=" + encodeURIComponent("P03 구성원 HTTP " + tag), "GET", owner);
  assert.equal(ownList.total, 1); assert.equal(ownList.items[0].id, companyId);
  assert.equal((await api<{ total: number }>("다른 회사 목록 격리", "/companies?search=" + encodeURIComponent("P03 구성원 HTTP " + tag), "GET", foreign)).total, 0);
  const pending = await invite(owner, invited, [serviceId]), originalToken = inviteToken((await mailFor(invited.email, "mail:invitation:" + pending.id + ":1")).text);
  await api("초대 재발송", "/invitations/" + pending.id + "/resend", "POST", owner, { version: 1 });
  const token = inviteToken((await mailFor(invited.email, "mail:invitation:" + pending.id + ":2")).text);
  await api("이전 링크 무효", "/invitations/preview", "POST", invited, { token: originalToken }, 404);
  await api("다른 이메일 수락 거부", "/invitations/accept", "POST", foreign, { token }, 404, { "Idempotency-Key": randomUUID() });
  await api("본인 초대 미리보기", "/invitations/preview", "POST", invited, { token });
  const acceptKey = randomUUID(), accepted = await api<{ memberId: string }>("초대 수락", "/invitations/accept", "POST", invited, { token }, 200, { "Idempotency-Key": acceptKey });
  memberId = accepted.memberId; await saveFixture();
  await api("수락 재시도 중복 방지", "/invitations/accept", "POST", invited, { token }, 200, { "Idempotency-Key": acceptKey });
  assert.equal(await db.membership.count({ where: { tenantId: companyId, userId: invited.id } }), 1);
  await api("조회자 관리 차단", "/members", "GET", invited, undefined, 403);
  await api("타회사 구성원 차단", "/members/" + memberId, "GET", foreign, undefined, 404);
  await api("편집자 역할 변경", "/members/" + memberId, "PATCH", owner, { version: 1, role: "editor", serviceIds: [serviceId, secondServiceId] });
  const form = await api<RecordVersion>("부여된 편집 권한 사용", "/forms", "POST", invited, { serviceId, title: "P03 회수 확인 폼",
    content: { body: "", questions: [{ id: randomUUID(), type: "단문형 답변", label: "시험 답변", required: true }],
      consentRequired: true, consentPurpose: "권한 회수 검증", retentionDays: 30, maxResponses: 10 } }, 201, { "Idempotency-Key": randomUUID() });
  await api("한 서비스 권한 회수", "/members/" + memberId, "PATCH", owner, { version: 2, serviceIds: [secondServiceId] });
  await api("회수 후 직접 폼 URL 차단", "/forms/" + form.id, "GET", invited, undefined, 403);
  await api("전체 서비스 권한 회수", "/members/" + memberId, "PATCH", owner, { version: 3, serviceIds: [] });
  assert.equal((await api<{ total: number }>("회수 후 목록", "/services", "GET", invited)).total, 0);
  await api("조회자와 서비스 범위 복원", "/members/" + memberId, "PATCH", owner, { version: 4, role: "viewer", serviceIds: [secondServiceId] });
  await api("역할 회수 후 쓰기 차단", "/forms", "POST", invited, { serviceId: secondServiceId, title: "금지" }, 403);
  await api("구성원 정지", "/members/" + memberId, "PATCH", owner, { version: 5, status: "suspended" });
  await api("정지 직후 세션 차단", "/context", "GET", invited, undefined, 401);
  await api("구성원 복구", "/members/" + memberId, "PATCH", owner, { version: 6, status: "active" });
  await login(invited);
  await api("복구 후 재로그인", "/services/" + secondServiceId, "GET", invited);
  await api("구성원 제외", "/members/" + memberId, "DELETE", owner, undefined, 204, { "If-Match": "7" });
  await api("제외 직후 세션 차단", "/context", "GET", invited, undefined, 401);
  const again = await invite(owner, invited, [secondServiceId]);
  const nextToken = inviteToken((await mailFor(invited.email, "mail:invitation:" + again.id + ":1")).text);
  await login(invited);
  const restored = await api<{ memberId: string }>("새 초대 재참여", "/invitations/accept", "POST", invited, { token: nextToken }, 200, { "Idempotency-Key": randomUUID() });
  assert.equal(restored.memberId, memberId);
  await api("소유권 암호 재확인 실패", "/members/" + memberId + "/transfer", "POST", owner, { version: 9, password: "Wrong-password!123" }, 401);
  await api("소유권 이전", "/members/" + memberId + "/transfer", "POST", owner, { version: 9, password: owner.password });
  await api("이전 소유자 권한 즉시 회수", "/members/" + memberId + "/transfer", "POST", owner, { version: 10, password: owner.password }, 403);
  const previousOwner = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: companyId, userId: owner.id } } });
  await api("소유권 원상 복원", "/members/" + previousOwner.id + "/transfer", "POST", invited, { version: previousOwner.version, password: invited.password });
  await api("현재 소유자 제거 차단", "/members/" + previousOwner.id, "DELETE", owner, undefined, 409, { "If-Match": "3" });
  const cancelled = await invite(owner, expert, [secondServiceId]);
  const cancelledJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + cancelled.id + ":1" } });
  const cancelledToken = inviteToken(decrypt<{ text: string }>(cancelledJob.payloadCipher).text);
  await api("초대 취소", "/invitations/" + cancelled.id, "DELETE", owner, undefined, 200, { "If-Match": "1" });
  await api("취소 링크 거부", "/invitations/preview", "POST", expert, { token: cancelledToken }, 410);
  const credentials = JSON.parse(await readFile(".local/requested-admin-credentials.json", "utf8")) as { email: string; password: string };
  assert((await db.user.findUniqueOrThrow({ where: { email: credentials.email } })).platformAdmin);
  const admin: Person = { ...credentials, id: "", cookie: "" }; await login(admin); adminCookie = admin.cookie;
  const assignment = await api<RecordVersion>("전문가 배정", "/expert-assignments", "POST", admin, { companyId, expertEmail: expert.email,
    serviceIds: [secondServiceId], expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201);
  assignmentId = assignment.id; await saveFixture();
  assert.equal((await api<{ total: number }>("전문가 전체 회사 검색", "/expert-assignments?scope=mine&search=" + encodeURIComponent("P03 구성원 HTTP " + tag), "GET", expert)).total, 1);
  assert.equal((await api<{ total: number }>("전문가 빈 검색", "/expert-assignments?scope=mine&search=없는회사", "GET", expert)).total, 0);
  await api("전문가 회사 선택", "/context", "POST", expert, { companyId });
  await api("배정 외 서비스 차단", "/services/" + serviceId, "GET", expert, undefined, 403);
  await api("전문가 범위 변경", "/expert-assignments/" + assignmentId, "PATCH", admin, { version: 1, serviceIds: [serviceId] });
  await api("이전 배정 범위 차단", "/services/" + secondServiceId, "GET", expert, undefined, 403);
  await api("배정 회수", "/expert-assignments/" + assignmentId, "DELETE", admin, undefined, 204, { "If-Match": "2" });
  await api("회수 후 회사 선택 차단", "/context", "POST", expert, { companyId }, 404);
  await api("회수 후 서비스 차단", "/services/" + serviceId, "GET", expert, undefined, 403);
  await api("전문가 재배정", "/expert-assignments", "POST", admin, { companyId, expertEmail: expert.email,
    serviceIds: [secondServiceId], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await api("최종 배정 회수", "/expert-assignments/" + assignmentId, "DELETE", admin, undefined, 204, { "If-Match": "4" });
  const evidence = { checkedAt: new Date().toISOString(), result: "passed", tag, cases, mailTransport: "local", browserVerified: false,
    database: { activeOwners: await db.membership.count({ where: { tenantId: companyId, role: "owner", status: "active" } }),
      member: await db.membership.findUnique({ where: { id: memberId }, select: { role: true, status: true, version: true } }),
      expert: await db.expertAssignment.findUnique({ where: { id: assignmentId }, select: { status: true, version: true } }),
      expertGrants: await db.serviceGrant.count({ where: { member: { expertAssignmentId: assignmentId } } }),
      acceptedInvitations: await db.invitation.count({ where: { tenantId: companyId, status: "accepted" } }),
      auditEvents: await db.auditEvent.count({ where: { tenantId: companyId } }) } };
  assert.equal(evidence.database.activeOwners, 1); assert.equal(evidence.database.expertGrants, 0);
  await writeFile("docs/qa/P03-T02/http-database.json", JSON.stringify(evidence, null, 2) + "\n");
  await saveFixture();
  console.log(JSON.stringify({ result: "passed", httpCases: cases.length, activeOwners: evidence.database.activeOwners, expertGrants: 0 }));
}
try { await main(); }
catch { console.error("구성원 HTTP 검증 실패. 비밀 값은 출력하지 않습니다. 마지막 완료 단계: " + (cases.at(-1)?.label ?? "준비")); process.exitCode = 1; }
finally {
  for (const cookie of sessions) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie } }).catch(() => {});
  if (adminCookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie: adminCookie } }).catch(() => {});
  await db.$disconnect();
}
