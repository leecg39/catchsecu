import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(origin, "http://localhost:3121");
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const out = "docs/qa/R08-T03/current", file = ".local/rea-fullstack/r08-template-list.json";
const owner = JSON.parse(await readFile(".local/rea-fullstack/r07-list-fixture.json", "utf8")) as { email: string; password: string; tenantId: string };
type Fixture = { tenantId: string; serviceId: string; templateIds: string[]; formId?: string };
let cookie = "";
async function request(path: string, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); assert.equal(response.status, expected, path + ": " + value.error?.code);
  return { response, value };
}
try {
  const login = await request("/auth/sign-in/email", "POST", { email: owner.email, password: owner.password });
  cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await request("/context", "POST", { companyId: owner.tenantId });
  const services = (await request("/services")).value.items as { id: string }[]; assert.ok(services.length);
  const old = await readFile(file, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  const fixture: Fixture = old ? JSON.parse(old) : { tenantId: owner.tenantId, serviceId: services[0].id, templateIds: [] };
  assert.equal(fixture.tenantId, owner.tenantId);
  const save = () => writeFile(file, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  await save();
  for (let i = fixture.templateIds.length + 1; i <= 13; i++) {
    const created = await request("/templates", "POST", { serviceId: fixture.serviceId, title: "R08 목록 템플릿 " + String(i).padStart(2, "0"), category: "QA",
      description: "URL 복원과 합성 레코드 삭제 검증", content: { body: "시험용", questions: [{ id: randomUUID(), type: "단문형 답변", label: "시험 항목", required: false }],
        consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 } }, 201);
    fixture.templateIds.push(created.value.id); await save();
  }
  const last = await db.formTemplate.findUniqueOrThrow({ where: { id: fixture.templateIds[12] } });
  if (last.status === "active") await request("/templates/" + last.id + "/archive", "POST", { version: last.version });
  const rows = await db.formTemplate.findMany({ where: { id: { in: fixture.templateIds } }, select: { id: true, tenantId: true, serviceId: true, title: true, version: true, status: true }, orderBy: { title: "asc" } });
  assert.equal(rows.length, 13); assert.equal(rows.filter(row => row.status === "active").length, 12);
  assert.ok(rows.every(row => row.tenantId === fixture.tenantId && row.serviceId === fixture.serviceId));
  if (!fixture.formId) {
    const created = await request("/forms", "POST", { serviceId: fixture.serviceId, title: "R08 목록 폼", content: {
      body: "목록 복원 시험", questions: [{ id: randomUUID(), type: "단문형 답변", label: "시험 항목", required: false }],
      consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 } }, 201);
    fixture.formId = created.value.id; await save();
  }
  const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, select: { id: true, tenantId: true, serviceId: true, title: true, version: true, status: true } });
  assert.equal(form.tenantId, fixture.tenantId); assert.equal(form.serviceId, fixture.serviceId);
  await mkdir(out, { recursive: true });
  await writeFile(out + "/template-list-fixture.json", JSON.stringify({ at: new Date().toISOString(), result: "passed", createdViaHttp: true, rows, form }, null, 2));
  console.log({ result: "passed", active: 12, archived: 1 });
} finally { await db.$disconnect(); }
