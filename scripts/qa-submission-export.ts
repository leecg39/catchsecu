import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { FormRecord, SubmissionRecord, Paged } from "../src/contracts/forms";
import type { AnswerValue } from "../src/contracts/questions";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const people = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const fixture = JSON.parse(await readFile(".local/p04-question-rules-fixture.json", "utf8")) as { userId: string; companyId: string; formId: string; submissionId: string };
const person = people.people[1], phase = process.argv[2];
assert(["prepare", "finish"].includes(phase)); assert.equal(fixture.userId, person.id); assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const cases: { label: string; status: number }[] = [], sessions: string[] = [], startedAt = new Date();
async function request(label: string, path: string, cookie = "", method = "GET", value?: unknown, expected = 200) {
  const result = await fetch(origin + path, { method, redirect: "manual", headers: { cookie, ...(method !== "GET" ? { origin } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(result.status, expected, label); cases.push({ label, status: result.status }); return result;
}
async function download(label: string, cookie: string, query = "") {
  const result = await request(label, "/api/v1/forms/" + fixture.formId + "/submissions/export" + query, cookie);
  assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert(result.headers.get("content-disposition")?.startsWith("attachment;")); assert(result.headers.get("content-type")?.startsWith("text/csv"));
  const bytes = Buffer.from(await result.arrayBuffer()); assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const rows = parse(bytes.toString("utf8"), { bom: true }) as string[][]; assert.equal(Number(result.headers.get("x-export-row-count")), rows.length - 1);
  return { rows, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
}
async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert.equal(user.status, "active"); assert.equal(user.platformAdmin, false);
  const login = await request("합성 구성원 로그인", "/api/v1/auth/sign-in/email", "", "POST", { email: person.email, password: person.password });
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie); sessions.push(cookie);
  await request("시험 회사 선택", "/api/v1/context", cookie, "POST", { companyId: fixture.companyId });
  const form = await (await request("질문 정의 조회", "/api/v1/forms/" + fixture.formId, cookie)).json() as FormRecord;
  const listing = await (await request("실제 응답 목록", "/api/v1/forms/" + fixture.formId + "/submissions", cookie)).json() as Paged<SubmissionRecord>;
  const all = await download("전체 응답 실제 CSV 다운로드", cookie);
  assert.equal(all.rows.length - 1, listing.total); assert.deepEqual(all.rows.slice(1).map(row => row[0]), listing.items.map(row => row.id));
  const columns = all.rows[0];
  for (const item of listing.items) {
    const row = all.rows.find(value => value[0] === item.id)!;
    for (const [index, question] of form.content.questions.entries()) {
      const header = "[v1 · 질문 " + (index + 1) + "] " + question.label, value = item.values[question.id];
      if (question.rows) for (const [rowIndex, matrixRow] of question.rows.entries()) {
        const cell = row[columns.indexOf(header + " · 행 " + (rowIndex + 1) + ": " + matrixRow.label)];
        const answer = value && typeof value === "object" && !Array.isArray(value) && matrixRow.id in value ? (value as Record<string, string | string[]>)[matrixRow.id] : undefined;
        assert.equal(cell, Array.isArray(answer) ? JSON.stringify(answer) : answer ?? "");
      } else assert.equal(row[columns.indexOf(header)], Array.isArray(value) ? JSON.stringify(value) : value ?? "");
    }
  }
  const original = await db.submission.findUniqueOrThrow({ where: { id: fixture.submissionId }, include: { answers: { include: { question: true } } } });
  const correctedRow = all.rows.find(row => row[0] === original.id)!;
  assert.equal(original.tenantId, fixture.companyId); assert.equal(original.status, "corrected");
  for (const answer of original.answers) {
    const value = decrypt<AnswerValue>(answer.valueCipher), question = answer.question;
    if (typeof value === "string") assert.equal(correctedRow[columns.indexOf("[v1 · 질문 " + (question.order + 1) + "] " + question.label)], value);
  }
  if (phase === "prepare") {
    const status = "?status=corrected", filtered = await (await request("정정 상태 목록 필터", "/api/v1/forms/" + fixture.formId + "/submissions" + status, cookie)).json() as Paged<SubmissionRecord>;
    assert.deepEqual((await download("동일 상태 CSV 필터", cookie, status)).rows.slice(1).map(row => row[0]), filtered.items.map(row => row.id));
    assert.deepEqual((await download("응답 ID CSV 검색", cookie, "?search=" + fixture.submissionId.toUpperCase())).rows.slice(1).map(row => row[0]), [fixture.submissionId]);
    assert.equal((await download("빈 결과 CSV", cookie, "?search=missing-export-result")).rows.length, 1);
    await request("잘못된 상태 차단", "/api/v1/forms/" + fixture.formId + "/submissions/export?status=invalid", cookie, "GET", undefined, 422);
    await request("회사 필드 위조 차단", "/api/v1/forms/" + fixture.formId + "/submissions/export?tenantId=" + fixture.companyId, cookie, "GET", undefined, 422);
    await request("CSV 변경 메서드 차단", "/api/v1/forms/" + fixture.formId + "/submissions/export", cookie, "PUT", undefined, 405);
    await request("미인증 CSV 차단", "/api/v1/forms/" + fixture.formId + "/submissions/export", "", "GET", undefined, 401);
    await writeFile(".local/p06-export-checkpoint.json", JSON.stringify({ userId: person.id, formId: fixture.formId, sha256: all.sha256, byteLength: all.byteLength, rowCount: all.rows.length - 1, columnCount: columns.length }), { mode: 0o600 });
  } else {
    const previous = JSON.parse(await readFile(".local/p06-export-checkpoint.json", "utf8")) as { userId: string; formId: string; sha256: string; byteLength: number };
    assert.equal(previous.userId, person.id); assert.equal(previous.formId, fixture.formId); assert.equal(previous.sha256, all.sha256); assert.equal(previous.byteLength, all.byteLength);
  }
  const events = await db.auditEvent.findMany({ where: { tenantId: fixture.companyId, actorId: person.id, resourceId: fixture.formId, action: "submission.exported", createdAt: { gte: startedAt } }, select: { detail: true } });
  assert.equal(events.length, phase === "prepare" ? 4 : 1); assert(events.every(event => !JSON.stringify(event.detail).includes(fixture.submissionId)));
  await writeFile("docs/qa/P06-T02/export-http-" + phase + ".json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases,
    database: { rowCount: all.rows.length - 1, columnCount: columns.length, correctedValuesMatch: true, nativeMatrixValuesMatch: true, auditCount: events.length },
    download: { sha256: all.sha256, byteLength: all.byteLength, bom: true, privateNoStore: true, matchesBeforeRestart: phase === "finish" } }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, rows: all.rows.length - 1, columns: columns.length, auditCount: events.length }));
}
try { await main(); } finally {
  for (const cookie of sessions) { const result: Response = await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }); assert.equal(result.status, 200); }
  await db.$disconnect();
}
