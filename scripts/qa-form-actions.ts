import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { fingerprint, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import type { FormDeletionState, FormPage, FormRecord, Paged } from "../src/contracts/forms";
import type { MemberRecord, MemberRole } from "../src/contracts/members";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "roles", "finish"].includes(phase));
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const people = [source.people[1], source.people[2]], cookies = ["", ""], cases: { label: string; status: number }[] = [];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function request(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: {
    cookie: cookies[actor] ?? "", ...(method === "GET" ? {} : { origin }),
    ...(input === undefined ? {} : { "content-type": "application/json" }),
    ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(response.status, expected, label + ": HTTP " + response.status);
  cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200) {
  return await (await request(label, path, actor, method, input, expected)).json() as T;
}
async function snapshot(tenantId: string) {
  const forms = await db.form.findMany({ where: { tenantId }, select: { id: true, version: true, status: true, publishedVersionId: true }, orderBy: { id: "asc" } });
  const versions = await db.formVersion.findMany({ where: { tenantId }, include: versionInclude, orderBy: { id: "asc" } });
  const publications = await db.publication.findMany({ where: { tenantId }, select: { id: true, formId: true, formVersionId: true, status: true, expiresAt: true, responseCount: true }, orderBy: { id: "asc" } });
  const submissions = await db.submission.findMany({ where: { tenantId }, select: { id: true, formVersionId: true, status: true, answers: { select: { id: true, valueCipher: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  const members = await db.membership.findMany({ where: { tenantId }, select: { id: true, role: true, version: true, status: true, grants: { select: { serviceId: true, capabilities: true }, orderBy: { serviceId: "asc" } } }, orderBy: { id: "asc" } });
  const writeAuditCount = await db.auditEvent.count({ where: { tenantId, action: { not: "submission.list_viewed" } } });
  return { forms, versions: versions.map(row => ({ id: row.id, formId: row.formId, status: row.status, hash: fingerprint(row) })), publications,
    submissions: submissions.map(row => ({ ...row, answers: row.answers.map(answer => ({ id: answer.id, cipherHash: hash(answer.valueCipher) })) })), members, writeAuditCount };
}
type Checkpoint = { tenantId: string; serviceIds: string[]; formIds: string[]; memberId: string; databaseHash: string; database: Awaited<ReturnType<typeof snapshot>> };
async function read(label: string, id: string, actor = 1) { const value = await data<FormRecord>(label, "/forms/" + id, actor); assert(value.actions); return value; }
async function verify(c: Checkpoint) {
  const page = await data<FormPage>("조회자의 현재 목록과 생성 권한", "/forms?status=all", 1);
  assert.equal(page.total, 3); assert.deepEqual(page.permissions, { canCreate: false, canImport: false, canViewImports: false });
  assert(page.items.every(row => row.actions?.preview && !row.actions.edit && !row.actions.responses && !row.publication?.token));
  const archived = await read("조회자의 보관 폼 읽기", c.formIds[0]); assert(!archived.actions!.copy && !archived.actions!.checkDeletion);
  const expired = await read("조회자의 만료 폼 읽기", c.formIds[1]); assert(!expired.actions!.share && !expired.actions!.resume);
  const owner = await read("소유자의 보관 폼 작업 권한", c.formIds[0], 0); assert(owner.actions!.copy && owner.actions!.checkDeletion && owner.actions!.responses && !owner.actions!.edit);
  const ownerExpired = await read("소유자의 만료 공개 링크 작업 권한", c.formIds[1], 0); assert(!ownerExpired.actions!.share && !ownerExpired.actions!.resume && ownerExpired.actions!.edit);
  const deletion = await data<FormDeletionState>("소유자의 참조 및 응답 안내", "/forms/" + c.formIds[0] + "/deletion"); assert(!deletion.canPurge && deletion.canReadResponses && deletion.references.submissions === 1);
  await request("조회자의 복사 API 차단", "/forms/" + c.formIds[0] + "/copy", 1, "POST", {}, 403);
  const viewerDeletion = await data<FormDeletionState>("조회자의 삭제 불가 사유와 응답 권한", "/forms/" + c.formIds[0] + "/deletion", 1);
  assert(!viewerDeletion.canPurge && !viewerDeletion.canReadResponses && viewerDeletion.reasons.some(reason => reason.code === "WRITE_REQUIRED"));
  await request("조회자의 응답 API 차단", "/forms/" + c.formIds[0] + "/submissions", 1, "GET", undefined, 403);
  await request("익명 목록 차단", "/forms", 2, "GET", undefined, 401);
  const actual = await snapshot(c.tenantId); assert.equal(hash(actual), c.databaseHash, "재조회·재시작 이후 독립 DB 동일");
  assert.equal(actual.submissions.length, 1); assert.equal(actual.members.find(row => row.id === c.memberId)?.role, "viewer");
  return actual;
}
try {
  for (let index = 0; index < people.length; index++) {
    const person = people[index]; assert(/^p03-(member|foreign)-.+@catchsecu\.local\.test$/.test(person.email));
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
    const response = await request("합성 계정 " + index + " 로그인", "/auth/sign-in/email", index, "POST", { email: person.email, password: person.password });
    cookies[index] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookies[index]);
  }
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    // Resume the empty fixture created by this script before an input failure. Do not reset rate limits.
    const empty = await db.company.findFirst({ where: { name: { startsWith: "P04 작업 권한 검증 " }, status: "active", services: { every: { forms: { none: {} } } }, invitations: { none: {} },
      memberships: { some: { userId: people[0].id, role: "owner", status: "active" }, every: { userId: people[0].id } } }, orderBy: { createdAt: "desc" } });
    if (empty) await request("기존 빈 시험 회사 선택", "/context", 0, "POST", { companyId: empty.id });
    const company = empty ? await data<{ id: string }>("기존 빈 합성 시험 회사 재사용", "/companies/" + empty.id)
      : await data<{ id: string }>("독립 권한 시험 회사 생성", "/companies", 0, "POST", { name: "P04 작업 권한 검증 " + randomUUID(), publicName: "P04 작업 권한 검증" }, 201);
    const services = await data<Paged<{ id: string; name: string }>>("기본 시험 서비스 조회", "/services"); assert([1, 2].includes(services.total));
    const second = services.items.find(service => service.name === "두 번째 시험 서비스")
      ?? await data<{ id: string }>("두 번째 시험 서비스 생성", "/services", 0, "POST", { name: "두 번째 시험 서비스", externalName: "권한 시험" }, 201);
    const firstService = services.items.find(service => service.id !== second.id); assert(firstService);
    const serviceIds = [firstService.id, second.id], questionId = randomUUID();
    const content = formContentSchema.parse({ body: "현재 역할·서비스 권한 검증", questions: [{ id: questionId, type: "단문형 답변", label: "합성 응답", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5 });
    const first = await data<FormRecord>("첫 서비스 폼 생성", "/forms", 0, "POST", { serviceId: serviceIds[0], title: "권한 A", content }, 201);
    const last = await data<FormRecord>("두 번째 서비스 폼 생성", "/forms", 0, "POST", { serviceId: serviceIds[1], title: "권한 B", content }, 201);
    const publication = await data<{ token: string }>("첫 폼 게시", "/forms/" + first.id + "/publish", 0, "POST", { version: first.version }, 201);
    await request("공개 합성 응답 저장", "/public/forms/" + publication.token + "/submissions", 2, "POST", { answers: { [questionId]: "역할 시험 답변" }, consent: false }, 201);
    const invitation = await data<{ id: string }>("합성 편집자 초대 생성", "/invitations", 0, "POST", { email: people[1].email, role: "editor", serviceIds }, 201);
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + invitation.id + ":1" } }); assert.equal(job.tenantId, company.id);
    const payload = decrypt<{ to: string; text: string }>(job.payloadCipher); assert.equal(payload.to, people[1].email);
    const link = payload.text.split("\n").find(line => line.startsWith(origin + "/oauth2/invite/signup?")); assert(link);
    const token = new URL(link).searchParams.get("token"); assert(token);
    await request("현재 계정 초대 미리보기", "/invitations/preview", 1, "POST", { token });
    const accepted = await data<{ memberId: string }>("합성 편집자 초대 수락", "/invitations/accept", 1, "POST", { token });
    let member = await data<MemberRecord>("수락한 구성원 버전 조회", "/members/" + accepted.memberId);
    async function role(next: MemberRole, ids = serviceIds) { member = await data<MemberRecord>("역할·서비스 변경: " + next, "/members/" + member.id, 0, "PATCH", { version: member.version, role: next, serviceIds: ids }); }
    const editor = await read("편집자의 게시 폼 작업 권한", first.id); assert(editor.actions!.edit && editor.actions!.copy && editor.actions!.share && editor.actions!.pause && !editor.actions!.responses);
    const editorList = await data<FormPage>("편집자의 선택 서비스 생성·업로드", "/forms?serviceId=" + serviceIds[0], 1); assert.deepEqual(editorList.permissions, { canCreate: true, canImport: true, canViewImports: true });
    await role("viewer");
    const viewer = await read("동일 세션 역할 회수 즉시 반영", first.id); assert(!viewer.actions!.edit && !viewer.actions!.copy && !viewer.actions!.share);
    await request("회수된 초안 저장 권한 차단", "/forms/" + first.id + "/draft", 1, "PATCH", { version: viewer.version, title: "차단" }, 403);
    await request("회수된 일시중지 권한 차단", "/forms/" + first.id + "/pause", 1, "POST", { version: viewer.version }, 403);
    await request("조회자 즐겨찾기 허용", "/forms/" + first.id + "/favorite", 1, "PUT");
    await role("privacy");
    const privacy = await read("개인정보 담당자 응답 권한", first.id); assert(privacy.actions!.responses && !privacy.actions!.edit && !privacy.actions!.copy);
    const responses = await data<Paged<unknown>>("개인정보 담당자 실제 응답 조회", "/forms/" + first.id + "/submissions", 1); assert.equal(responses.total, 1);
    await request("개인정보 담당자 폼 복사 차단", "/forms/" + first.id + "/copy", 1, "POST", {}, 403);
    await role("editor", [serviceIds[1]]);
    await request("제외된 서비스 상세 차단", "/forms/" + first.id, 1, "GET", undefined, 403);
    await request("제외된 서비스 선택 목록 차단", "/forms?serviceId=" + serviceIds[0], 1, "GET", undefined, 403);
    const restricted = await data<FormPage>("현재 할당 서비스만 전체 목록에 포함", "/forms", 1); assert.equal(restricted.total, 1); assert.equal(restricted.items[0].id, last.id);
    await role("editor");
    const current = await read("서비스 재할당 권한 복구", first.id); assert(current.actions!.edit);
    const archiveResponse = await fetch(origin + "/api/v1/forms/" + first.id, { method: "DELETE", headers: { cookie: cookies[0], origin, "if-match": String(current.version) } }); assert.equal(archiveResponse.status, 204); cases.push({ label: "소유자 폼 보관", status: archiveResponse.status });
    const archived = await read("보관 폼은 복사·삭제 조건만 허용", first.id); assert(archived.actions!.copy && archived.actions!.checkDeletion && !archived.actions!.edit && !archived.actions!.share && !archived.actions!.archive);
    const deletion = await data<FormDeletionState>("편집자의 삭제 조건·응답 링크 제한", "/forms/" + first.id + "/deletion", 1); assert(!deletion.canPurge && !deletion.canReadResponses);
    const copy = await data<FormRecord>("보관 폼의 독립 복사 허용", "/forms/" + first.id + "/copy", 1, "POST", { title: "권한 C 독립 복사" }, 201); assert.notEqual(copy.id, first.id);
    const expiresAt = new Date(Date.now() + 4000).toISOString();
    const expiring = await data<{ version: number }>("두 번째 폼 실제 만료 게시", "/forms/" + last.id + "/publish", 0, "POST", { version: last.version, expiresAt }, 201);
    await request("만료 전 폼 일시 중지", "/forms/" + last.id + "/pause", 0, "POST", { version: expiring.version });
    const paused = await read("만료 전 재개·공유 권한", last.id); assert(paused.actions!.resume && paused.actions!.share);
    await setTimeout(Math.max(0, new Date(expiresAt).getTime() - Date.now()) + 150);
    const expired = await read("실제 만료 후 재개·공유 권한 회수", last.id); assert(!expired.actions!.resume && !expired.actions!.share);
    await request("실제 만료 공개 재개 API 차단", "/forms/" + last.id + "/resume", 1, "POST", { version: expired.version }, 409);
    await role("viewer");
    const independent = await snapshot(company.id);
    checkpoint = { tenantId: company.id, serviceIds, formIds: [first.id, last.id, copy.id], memberId: member.id, databaseHash: hash(independent), database: independent };
    await writeFile(".local/p04-actions-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
  } else {
    checkpoint = JSON.parse(await readFile(".local/p04-actions-checkpoint.json", "utf8"));
    assert((await db.company.findUniqueOrThrow({ where: { id: checkpoint.tenantId } })).name.startsWith("P04 작업 권한 검증 "));
    for (let actor = 0; actor < 2; actor++) await request((phase === "finish" ? "재시작 후 시험 회사 선택 " : "기존 시험 회사 선택 ") + actor, "/context", actor, "POST", { companyId: checkpoint.tenantId });
    if (phase === "roles") {
      const before = await snapshot(checkpoint.tenantId); assert.equal(hash(before), checkpoint.databaseHash);
      let member = await data<MemberRecord>("기존 합성 구성원 버전", "/members/" + checkpoint.memberId);
      async function role(next: MemberRole, ids = checkpoint.serviceIds) { member = await data<MemberRecord>("동일 세션 역할·서비스 변경: " + next, "/members/" + member.id, 0, "PATCH", { version: member.version, role: next, serviceIds: ids }); }
      await role("editor");
      const editor = await read("편집자 보관 폼 복사·삭제 조건", checkpoint.formIds[0]); assert(editor.actions!.copy && editor.actions!.checkDeletion && !editor.actions!.edit && !editor.actions!.responses);
      const list = await data<FormPage>("편집자 선택 서비스 생성·업로드", "/forms?serviceId=" + checkpoint.serviceIds[0] + "&status=all", 1); assert.deepEqual(list.permissions, { canCreate: true, canImport: true, canViewImports: true });
      await role("viewer");
      const viewer = await read("동일 세션 회수된 편집자 권한", checkpoint.formIds[1]); assert(!viewer.actions!.edit && !viewer.actions!.copy && !viewer.actions!.responses);
      await request("회수된 저장 권한의 실제 거부", "/forms/" + viewer.id + "/draft", 1, "PATCH", { version: viewer.version, title: "차단" }, 403);
      await request("회수된 재개 권한의 실제 거부", "/forms/" + viewer.id + "/resume", 1, "POST", { version: viewer.version }, 403);
      await role("privacy");
      const privacy = await read("개인정보 담당자 응답 권한 허용", checkpoint.formIds[0]); assert(privacy.actions!.responses && !privacy.actions!.copy && !privacy.actions!.edit);
      const submissions = await data<Paged<unknown>>("개인정보 담당자 실제 응답 읽기", "/forms/" + privacy.id + "/submissions", 1); assert.equal(submissions.total, 1);
      const permission = await data<FormPage>("개인정보 담당자 생성 불가·업로드 가능", "/forms?serviceId=" + checkpoint.serviceIds[0] + "&status=all", 1); assert.deepEqual(permission.permissions, { canCreate: false, canImport: true, canViewImports: true });
      await role("editor", [checkpoint.serviceIds[1]]);
      await request("회수된 서비스 폼 상세 차단", "/forms/" + checkpoint.formIds[0], 1, "GET", undefined, 403);
      await request("회수된 서비스 선택 목록 차단", "/forms?serviceId=" + checkpoint.serviceIds[0], 1, "GET", undefined, 403);
      const restricted = await data<FormPage>("할당 서비스만 전체 목록에 표시", "/forms?status=all", 1); assert.equal(restricted.total, 1); assert.equal(restricted.items[0].id, checkpoint.formIds[1]);
      await role("editor");
      const expired = await read("편집자 복구 후 만료된 공개 링크 제한", checkpoint.formIds[1]); assert(expired.actions!.edit && !expired.actions!.share && !expired.actions!.resume);
      await request("만료된 재개 API 실제 거부", "/forms/" + expired.id + "/resume", 1, "POST", { version: expired.version }, 409);
      await role("viewer");
      const actual = await snapshot(checkpoint.tenantId);
      for (const key of ["forms", "versions", "publications", "submissions"] as const) assert.equal(hash(actual[key]), hash(before[key]), key + " 업무 원본 보존");
      checkpoint.database = actual; checkpoint.databaseHash = hash(actual);
      await writeFile(".local/p04-actions-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
    }
  }
  const independentDatabase = await verify(checkpoint);
  for (let actor = 0; actor < 2; actor++) { await request("합성 세션 종료 " + actor, "/auth/sign-out", actor, "POST", {}); cookies[actor] = ""; }
  await writeFile(`docs/qa/P04-T04/actions/http-${phase}.json`, JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, independentDatabase,
    matchesBeforeRestart: phase === "finish", syntheticSessionsClosed: true, userAdminAccountUntouched: true, actualUiVerified: false,
    invitationTransport: "local queue only; one synthetic invitation decrypted; no worker or external delivery invoked" }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, forms: independentDatabase.forms.length, submissions: independentDatabase.submissions.length }));
} finally {
  for (const cookie of cookies.filter(Boolean)) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
