import { randomUUID, createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { requireContext } from "@/server/context";
import { exportSubmissions } from "@/server/submission-export";
import { submissionFilters } from "@/contracts/submissions";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { GET as formsGet, POST as formAction, PATCH as patchForm } from "@/app/api/v1/forms/[...segments]/route";
import { POST as submit } from "@/app/api/v1/public/forms/[...segments]/route";
import { GET as download } from "@/app/api/v1/forms/[id]/submissions/export/route";
import { PUT as uploadBytes, POST as uploadAction } from "@/app/api/v1/uploads/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
function req(path: string, method = "GET", cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "idempotency-key": randomUUID(), ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function account(name: string) {
  const email = "export-" + randomUUID() + "@catchsecu.test", password = "Response-export!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(login.status).toBe(200);
  return { user, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const owner = await account("응답 내보내기");
  const company = await db.company.create({ data: { name: "내보내기 시험", publicName: "내보내기", policy: { create: {} },
    memberships: { create: { userId: owner.user.id, role: "owner" } }, services: { create: { name: "응답 서비스", externalName: "응답" } } }, include: { services: true } });
  const serviceId = company.services[0].id, parent = randomUUID();
  const content = { body: "", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10000,
    questions: [
      { id: parent, type: "객관식 답변", label: "방식", required: true, options: ["온라인", "현장"] },
      { id: randomUUID(), type: "단문형 답변", label: "자유 답변", required: false },
      { id: randomUUID(), type: "단문형 답변", label: "숨긴 답변", required: false, condition: { questionId: parent, operator: "equals", value: "현장" } },
      { id: randomUUID(), type: "행렬형 단일 선택", label: "만족도", required: true, options: ["좋음", "보통"], rows: [{ id: randomUUID(), label: "과정" }, { id: randomUUID(), label: "강사" }] },
      { id: randomUUID(), type: "행렬형 복수 선택", label: "관심", required: false, options: ["기초,심화", '실습"과정'], rows: [{ id: randomUUID(), label: "다음 과정" }] },
      { id: randomUUID(), type: "파일 업로드", label: "참고 파일", required: false },
    ] };
  const created = await createForm(req("/forms", "POST", owner.cookie, { serviceId, title: "응답 내보내기 폼", content }));
  expect(created.status).toBe(201); const form = await created.json();
  const published = await formAction(req("/forms/" + form.id + "/publish", "POST", owner.cookie, { version: 1 }));
  expect(published.status).toBe(201);
  return { ...owner, company, serviceId, content, id: form.id as string, token: (await published.json()).token as string };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function response(f: Fixture, text = "한글 답변", file?: { id: string; uploadToken: string }) {
  const q = f.content.questions;
  const result = await submit(req("/public/forms/" + f.token + "/submissions", "POST", "", { consent: true, answers: {
    [q[0].id]: "온라인", [q[1].id]: text, [q[3].id]: { [q[3].rows![0].id]: "보통", [q[3].rows![1].id]: "좋음" },
    [q[4].id]: { [q[4].rows![0].id]: ["기초,심화", '실습"과정'] },
    ...(file ? { [q[5].id]: file.id } : {}),
  }, ...(file ? { attachments: { [q[5].id]: { fileId: file.id, token: file.uploadToken } } } : {}) }));
  expect(result.status).toBe(201); return (await result.json()).id as string;
}
const path = (f: Fixture, query = "") => "/forms/" + f.id + "/submissions/export" + query;
async function csv(f: Fixture, query = "") {
  const result = await download(req(path(f, query), "GET", f.cookie)); expect(result.status).toBe(200);
  const bytes = Buffer.from(await result.arrayBuffer()), rows = parse(bytes.toString("utf8"), { bom: true }) as string[][];
  return { result, bytes, rows };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("실제 CSV 바이트는 한글·줄바꿈·따옴표·행 순서와 복수 선택 배열을 보존하며 수식을 차단한다", async () => {
  const f = await fixture(), text = '=1+1,\n"한글"', id = await response(f, text), { result, bytes, rows } = await csv(f);
  expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf"); expect(bytes.toString()).toContain("\r\n");
  expect(result.headers.get("content-type")).toContain("text/csv"); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("content-disposition")).toContain('attachment; filename="responses-'); expect(result.headers.get("x-export-row-count")).toBe("1");
  expect(rows[1][0]).toBe(id);
  const question = rows[0].findIndex(value => value.endsWith("자유 답변"));
  expect(rows[1][question]).toBe("'" + text);
  expect(rows[1][rows[0].findIndex(value => value.endsWith("숨긴 답변"))]).toBe("");
  expect(rows[1][rows[0].findIndex(value => value.endsWith("행 1: 과정"))]).toBe("보통");
  expect(rows[1][rows[0].findIndex(value => value.endsWith("행 2: 강사"))]).toBe("좋음");
  expect(JSON.parse(rows[1][rows[0].findIndex(value => value.endsWith("행 1: 다음 과정"))])).toEqual(["기초,심화", '실습"과정']);
  const event = await db.auditEvent.findFirstOrThrow({ where: { action: "submission.exported", resourceId: f.id } });
  expect(event.detail).toMatchObject({ rowCount: 1, hasSearch: false }); expect(JSON.stringify(event.detail)).not.toContain("한글");
});

test("기간·상태·응답 ID 필터는 목록과 CSV에서 같고 종료 시각을 제외하며 빈 페이지를 보정한다", async () => {
  const f = await fixture(), a = await response(f), b = await response(f), c = await response(f);
  await db.submission.update({ where: { id: a }, data: { submittedAt: new Date("2026-10-01T00:00:00Z") } });
  await db.submission.update({ where: { id: b }, data: { submittedAt: new Date("2026-10-02T00:00:00Z") } });
  await db.submission.update({ where: { id: c }, data: { submittedAt: new Date("2026-10-01T12:00:00Z"), status: "withdrawn" } });
  const filters = "?from=2026-10-01T00%3A00%3A00Z&to=2026-10-02T00%3A00%3A00Z&status=submitted";
  const listing = await formsGet(req("/forms/" + f.id + "/submissions" + filters + "&page=999&pageSize=1", "GET", f.cookie));
  expect(listing.status).toBe(200); const list = await listing.json(); expect(list).toMatchObject({ total: 1, page: 1 }); expect(list.items[0].id).toBe(a);
  expect((await csv(f, filters)).rows.slice(1).map(row => row[0])).toEqual([a]);
  expect((await csv(f, "?search=" + b.toUpperCase())).rows[1][0]).toBe(b);
  expect((await csv(f, "?search=missing")).rows).toHaveLength(1);
  for (const query of ["?from=invalid", "?status=unknown", "?from=2026-10-02T00%3A00%3A00Z&to=2026-10-01T00%3A00%3A00Z", "?tenantId=" + f.company.id, "?page=2"])
    expect((await download(req(path(f, query), "GET", f.cookie))).status).toBe(422);
});

test("같은 질문 ID의 새 게시 버전은 별도 열을 사용하고 예전 답변을 최신 질문 이름으로 바꾸지 않는다", async () => {
  const f = await fixture(), before = await response(f, "첫 버전");
  const current = await (await formsGet(req("/forms/" + f.id, "GET", f.cookie))).json();
  const content = structuredClone(f.content); content.questions[1].label = "수정한 질문";
  const patched = await patchForm(req("/forms/" + f.id, "PATCH", f.cookie, { version: current.version, content })); expect(patched.status).toBe(200);
  const published = await formAction(req("/forms/" + f.id + "/publish", "POST", f.cookie, { version: (await patched.json()).version })); expect(published.status).toBe(201);
  f.token = (await published.json()).token; const after = await response(f, "둘째 버전"), { rows } = await csv(f);
  const first = rows[0].findIndex(value => value.endsWith("자유 답변")), second = rows[0].findIndex(value => value.endsWith("수정한 질문"));
  expect(rows[0][first]).toContain("v1"); expect(rows[0][second]).toContain("v2");
  expect(rows.find(row => row[0] === before)?.[first]).toBe("첫 버전"); expect(rows.find(row => row[0] === before)?.[second]).toBe("");
  expect(rows.find(row => row[0] === after)?.[first]).toBe(""); expect(rows.find(row => row[0] === after)?.[second]).toBe("둘째 버전");
});

test("보유 기한이 끝난 원문은 내보내지 않고 유효한 보존 조치 자료는 계속 읽는다", async () => {
  const f = await fixture(), expired = await response(f, "만료 비밀"), held = await response(f, "보존된 응답");
  await db.submission.updateMany({ where: { id: { in: [expired, held] } }, data: { retentionUntil: new Date(Date.now() - 1000) } });
  await db.submission.update({ where: { id: held }, data: { legalHold: true } });
  const { rows, bytes } = await csv(f); expect(bytes.toString()).not.toContain("만료 비밀"); expect(bytes.toString()).toContain("보존된 응답");
  expect(rows.find(row => row[0] === expired)?.[6]).toBe("보유 기한 종료");
});

test("다른 회사·조회 불가 역할·현재 권한 회수·로그아웃한 이전 Context는 CSV 원문을 읽지 못한다", async () => {
  const f = await fixture(); await response(f);
  expect((await download(req(path(f)))).status).toBe(401);
  const other = await fixture(); expect((await download(req(path(f), "GET", other.cookie))).status).toBe(404);
  const privacy = await account("개인정보 담당");
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: privacy.user.id, role: "privacy" } });
  await db.serviceGrant.create({ data: { memberId: member.id, tenantId: f.company.id, serviceId: f.serviceId, capabilities: ["submission.read"] } });
  const ctx = await requireContext(req("/context", "GET", privacy.cookie).headers, "submission.read");
  expect((await download(req(path(f), "GET", privacy.cookie))).status).toBe(200);
  await db.serviceGrant.deleteMany({ where: { memberId: member.id } });
  await expect(exportSubmissions(ctx, f.id, submissionFilters.parse({}), randomUUID())).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: member.id }, data: { role: "viewer" } });
  expect((await download(req(path(f), "GET", privacy.cookie))).status).toBe(403);
  const owner = await requireContext(req("/context", "GET", f.cookie).headers, "submission.read");
  await db.session.delete({ where: { id: owner.session.id } });
  await expect(exportSubmissions(owner, f.id, submissionFilters.parse({}), randomUUID())).rejects.toMatchObject({ status: 401 });
});

test("5,001건은 일부 CSV나 성공 감사 없이 거부한다", async () => {
  const f = await fixture(), original = await response(f), row = await db.submission.findUniqueOrThrow({ where: { id: original } });
  await db.submission.createMany({ data: Array.from({ length: 5000 }, () => ({ tenantId: row.tenantId, formVersionId: row.formVersionId, publicationId: row.publicationId,
    retentionUntil: row.retentionUntil, originalRetentionUntil: row.originalRetentionUntil })) });
  const rejected = await download(req(path(f), "GET", f.cookie)); expect(rejected.status).toBe(413);
  expect((await rejected.json()).error.code).toBe("SUBMISSION_EXPORT_ROWS");
  expect(await db.auditEvent.count({ where: { action: "submission.exported" } })).toBe(0);
});

test("실제 암호화 응답의 CSV가 20MB를 넘으면 중간 파일과 성공 감사 없이 거부한다", async () => {
  const f = await fixture(), original = await response(f), row = await db.submission.findUniqueOrThrow({ where: { id: original } });
  const question = await db.question.findFirstOrThrow({ where: { formVersionId: row.formVersionId, stableKey: f.content.questions[1].id } });
  const ids = Array.from({ length: 1100 }, () => randomUUID()), cipher = encrypt("가".repeat(20000));
  await db.submission.createMany({ data: ids.map(id => ({ id, tenantId: row.tenantId, formVersionId: row.formVersionId, publicationId: row.publicationId, retentionUntil: row.retentionUntil, originalRetentionUntil: row.originalRetentionUntil })) });
  await db.answer.createMany({ data: ids.map(id => ({ tenantId: row.tenantId, formVersionId: row.formVersionId, questionId: question.id, submissionId: id, valueType: question.type, valueCipher: cipher })) });
  const rejected = await download(req(path(f), "GET", f.cookie)); expect(rejected.status).toBe(413); expect((await rejected.json()).error.code).toBe("SUBMISSION_EXPORT_BYTES");
  expect(await db.auditEvent.count({ where: { action: "submission.exported" } })).toBe(0);
}, 30000);

test("행렬의 행을 펼친 열이 1,000개를 넘으면 성공 감사 없이 거부한다", async () => {
  const f = await fixture(), current = await (await formsGet(req("/forms/" + f.id, "GET", f.cookie))).json();
  const content = { ...f.content, questions: Array.from({ length: 11 }, (_, i) => ({ id: randomUUID(), type: "행렬형 단일 선택", label: "행렬 " + i, required: false,
    options: ["확인"], rows: Array.from({ length: 100 }, (_, j) => ({ id: randomUUID(), label: "행 " + j })) })) };
  const changed = await patchForm(req("/forms/" + f.id, "PATCH", f.cookie, { version: current.version, content })); expect(changed.status).toBe(200);
  const published = await formAction(req("/forms/" + f.id + "/publish", "POST", f.cookie, { version: (await changed.json()).version })); expect(published.status).toBe(201);
  const token = (await published.json()).token;
  expect((await submit(req("/public/forms/" + token + "/submissions", "POST", "", { answers: {}, consent: true }))).status).toBe(201);
  const rejected = await download(req(path(f), "GET", f.cookie)); expect(rejected.status).toBe(413); expect((await rejected.json()).error.code).toBe("SUBMISSION_EXPORT_COLUMNS");
  expect(await db.auditEvent.count({ where: { action: "submission.exported" } })).toBe(0);
});

test("실제 검사한 첨부는 파일 권한이 있을 때만 이름을 내보내고 파일 ID와 저장소 키를 제외한다", async () => {
  const f = await fixture(), bytes = Buffer.from("첨부 검사 합성 자료"), name = "=참고.txt";
  const created = await submit(req("/public/forms/" + f.token + "/uploads", "POST", "", { questionId: f.content.questions[5].id, name, mime: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
  expect(created.status).toBe(201); const file = await created.json();
  const headers = { origin, "x-upload-token": file.uploadToken };
  expect((await uploadBytes(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { ...headers, "content-type": "text/plain" }, body: bytes }))).status).toBe(200);
  expect((await uploadAction(new Request(origin + "/api/v1/uploads/" + file.id + "/complete", { method: "POST", headers }))).status).toBe(200);
  await response(f, "첨부 답변", file);
  const owner = await csv(f), column = owner.rows[0].findIndex(label => label.endsWith("참고 파일"));
  expect(owner.rows[1][column]).toBe("'" + name); expect(owner.bytes.toString()).not.toContain(file.id);
  const privacy = await account("파일 권한 없는 담당자"), member = await db.membership.create({ data: { tenantId: f.company.id, userId: privacy.user.id, role: "privacy" } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId: f.serviceId, capabilities: ["submission.read"] } });
  const result = await download(req(path(f), "GET", privacy.cookie)); expect(result.status).toBe(200);
  const rows = parse(Buffer.from(await result.arrayBuffer()).toString("utf8"), { bom: true }) as string[][];
  expect(rows[1][column]).toBe("첨부파일"); expect(JSON.stringify(rows)).not.toContain(name);
});

test("내보내기는 실제 응답 잠금을 기다린 뒤 변경된 보유 기한을 재검사한다", async () => {
  const f = await fixture(), id = await response(f, "동시 변경 원문");
  let release!: () => void, ready!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
  const writer = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR UPDATE`;
    ready(); await hold;
    await tx.submission.update({ where: { id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
  });
  await locked;
  const downloading = download(req(path(f), "GET", f.cookie));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Submission"%' AND query LIKE '%FOR SHARE%') AS waiting`;
      waiting = rows[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally { release(); await writer; }
  const result = await downloading; expect(result.status).toBe(200); const text = await result.text();
  expect(text).not.toContain("동시 변경 원문"); expect(text).toContain("보유 기한 종료");
});
