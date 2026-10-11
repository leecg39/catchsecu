import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const mode = process.argv[2];
assert.ok(["prepare", "after-worker", "before", "restart"].includes(mode));
const directory = "docs/qa/R10-T04/final-acceptance";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/access-fixture.json", "utf8")) as {
  origin: string; tenantId: string; serviceId: string;
  owner: { email: string; password: string };
};
const origin = process.env.QA_ORIGIN ?? fixture.origin;

let cookie = "";
async function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: { "content-type": "application/json", cookie, origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}
async function json(path: string, expected: number, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await request(path, method, body, headers);
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function fingerprint() {
  const [documents, versions, subprocessors, notices, jobs, audits] = await Promise.all([
    db.document.findMany({ where: { tenantId: fixture.tenantId },
      select: { id: true, status: true, version: true, draftRevision: true }, orderBy: { id: "asc" } }),
    db.documentVersion.findMany({ where: { tenantId: fixture.tenantId },
      select: { id: true, documentId: true, number: true, contentHash: true }, orderBy: { id: "asc" } }),
    db.subprocessor.findMany({ where: { tenantId: fixture.tenantId },
      select: { id: true, serviceId: true, name: true, status: true, version: true }, orderBy: { id: "asc" } }),
    db.subprocessorNotice.findMany({ where: { tenantId: fixture.tenantId },
      select: { id: true, subprocessorId: true, subject: true, jobId: true }, orderBy: { id: "asc" } }),
    db.job.findMany({ where: { tenantId: fixture.tenantId, dedupeKey: { startsWith: "mail:subprocessor-notice:" } },
      select: { id: true, status: true, attempts: true, completedAt: true }, orderBy: { id: "asc" } }),
    db.auditEvent.findMany({ where: { tenantId: fixture.tenantId,
        resource: { in: ["subprocessor", "subprocessorNotice", "document"] } },
      select: { id: true, resourceId: true, action: true }, orderBy: { id: "asc" } }),
  ]);
  const state = {
    counts: { documents: documents.length, versions: versions.length, subprocessors: subprocessors.length,
      notices: notices.length, noticeJobs: jobs.length, audits: audits.length },
    documents, versions, subprocessors, notices, jobs, audits,
  };
  return { state, fingerprint: createHash("sha256").update(JSON.stringify(state)).digest("hex") };
}

async function signIn() {
  const login = await request("/auth/sign-in/email", "POST", { email: fixture.owner.email, password: fixture.owner.password });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await json("/context", 200, "POST", { serviceId: fixture.serviceId });
}

try {
  if (mode === "prepare") {
    await signIn();
    const create = await request(`/services/${fixture.serviceId}/subprocessors`, "POST",
      { name: "R10 최종 수용 수신자", email: "r10-acceptance@catchsecu.test", changeSummary: "R10-T04 최종 수용의 재위탁 고지 발송 검증" },
      { "Idempotency-Key": randomUUID() });
    let sub;
    if (create.status === 201) sub = await create.json();
    else if (create.status === 409) {
      const list = await json(`/services/${fixture.serviceId}/subprocessors?search=${encodeURIComponent("R10 최종 수용")}`, 200, "GET");
      sub = list.items.find((item: { name: string; status: string }) => item.name === "R10 최종 수용 수신자" && item.status === "active");
      assert.ok(sub, "duplicate create but no active subprocessor found");
    } else assert.fail(`subprocessor create → ${create.status} ${(await create.text()).slice(0, 200)}`);
    const send = await request(`/services/${fixture.serviceId}/subprocessor-notices`, "POST",
      { subprocessorId: sub.id, recipientVersion: sub.version, subject: "R10 재위탁 변경 고지", body: "R10-T04 수용검증용 재위탁 처리 변경 안내 본문입니다." },
      { "Idempotency-Key": randomUUID() });
    let notice;
    if (send.status === 201) notice = await send.json();
    else if (send.status === 409) {
      const list = await json(`/services/${fixture.serviceId}/subprocessor-notices`, 200, "GET");
      notice = list.items.find((item: { subprocessorId: string; subject: string }) => item.subprocessorId === sub.id && item.subject === "R10 재위탁 변경 고지");
      assert.ok(notice, "duplicate notice but not found in list");
    } else assert.fail(`notice send → ${send.status} ${(await send.text()).slice(0, 200)}`);
    assert.ok(notice.id);
    const { state, fingerprint: fp } = await fingerprint();
    const jobRow = await db.job.findFirst({ where: { tenantId: fixture.tenantId, dedupeKey: "mail:subprocessor-notice:" + notice.id } });
    assert.ok(jobRow, "notice mail job was not enqueued atomically");
    assert.ok(state.notices.some(n => n.id === notice.id));
    assert.ok(state.audits.some(a => a.action === "subprocessor.notice_queued" && a.resourceId === notice.id));
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/prepare.json`, JSON.stringify({
      result: "passed", checkedAt: new Date().toISOString(), subprocessorId: sub.id, noticeId: notice.id,
      jobId: jobRow.id, fingerprint: fp, ...state,
    }, null, 2) + "\n");
    console.log({ result: "passed", mode, noticeId: notice.id, jobId: jobRow.id, fingerprint: fp });
  } else if (mode === "after-worker") {
    await signIn();
    const prep = JSON.parse(await readFile(`${directory}/prepare.json`, "utf8"));
    const job = await db.job.findUnique({ where: { id: prep.jobId } });
    assert.ok(job, "notice mail job missing after worker");
    assert.equal(job.status, "done", `job status ${job.status}`);
    const notices = await json(`/services/${fixture.serviceId}/subprocessor-notices`, 200, "GET");
    const row = notices.items.find((item: { id: string }) => item.id === prep.noticeId);
    assert.ok(row && ["processed"].includes(row.status), `notice status ${row?.status}`);
    await writeFile(`${directory}/after-worker.json`, JSON.stringify({
      result: "passed", checkedAt: new Date().toISOString(),
      job: { id: job.id, status: job.status, attempts: job.attempts, completedAt: job.completedAt },
      noticeStatus: row.status,
    }, null, 2) + "\n");
    console.log({ result: "passed", mode, jobStatus: job.status, noticeStatus: row.status });
  } else {
    const { state, fingerprint: fp } = await fingerprint();
    if (mode === "restart") {
      const before = JSON.parse(await readFile(`${directory}/database-before.json`, "utf8"));
      assert.equal(fp, before.fingerprint, "database fingerprint changed across restart");
    }
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/database-${mode}.json`, JSON.stringify({
      result: "passed", checkedAt: new Date().toISOString(), mode, fingerprint: fp, ...state,
    }, null, 2) + "\n");
    console.log({ result: "passed", mode, fingerprint: fp, ...state.counts });
  }
} finally {
  await db.$disconnect();
}
