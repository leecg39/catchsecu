import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3121");
const directory = "docs/qa/R09-T03/current", file = ".local/rea-fullstack/r09-list.json";
const mode = process.argv[2]; assert.ok(["prepare", "after", "restart"].includes(mode));
type Fixture = { tenantId: string; serviceId: string; formId?: string; ids: string[] };
const owner = JSON.parse(await readFile(".local/rea-fullstack/r07-list-fixture.json", "utf8")) as { email: string; password: string; tenantId: string };
let cookie = "";
async function request(path: string, method = "GET", body?: unknown, expected = 200, headers: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID(), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json(); assert.equal(response.status, expected, path + ": " + value?.error?.code); return { response, value };
}
try {
  await mkdir(directory, { recursive: true });
  const old = await readFile(file, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  let fixture: Fixture;
  if (mode === "prepare") {
    const login = await request("/auth/sign-in/email", "POST", { email: owner.email, password: owner.password });
    cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    await request("/context", "POST", { companyId: owner.tenantId });
    const services = (await request("/services")).value.items as { id: string }[]; assert.ok(services.length);
    fixture = old ? JSON.parse(old) : { tenantId: owner.tenantId, serviceId: services[0].id, ids: [] };
    const save = () => writeFile(file, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    await save(); assert.equal(fixture.tenantId, owner.tenantId);
    if (!fixture.formId) {
      const created = await request("/forms", "POST", { serviceId: fixture.serviceId, title: "R09 목록 전용 폼", content: { body: "고정 URL 목록 검증", questions: [{ id: randomUUID(), type: "단문형 답변", label: "시험 항목", required: false }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 } }, 201);
      fixture.formId = created.value.id; await save();
    }
    const form = (await request("/forms/" + fixture.formId)).value;
    if (form.status === "draft") await request("/forms/" + fixture.formId + "/publish", "POST", { version: form.version }, 201);
    for (let i = fixture.ids.length + 1; i <= 12; i++) {
      const row = (await request("/fixed-urls", "POST", { formId: fixture.formId, name: "R09 목록 주소 " + String(i).padStart(2, "0") }, 201)).value;
      fixture.ids.push(row.id); await save();
    }
    const last = await db.fixedUrl.findUniqueOrThrow({ where: { id: fixture.ids[11] } });
    if (last.status === "active") await request("/fixed-urls/" + last.id, "DELETE", undefined, 204, { "If-Match": String(last.version) });
  } else { assert.ok(old); fixture = JSON.parse(old); }
  const rows = await db.fixedUrl.findMany({ where: { id: { in: fixture.ids } }, select: { id: true, tenantId: true, name: true, slug: true, status: true, version: true, publicationId: true }, orderBy: { id: "asc" } });
  const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, select: { id: true, tenantId: true, serviceId: true, status: true, version: true, publishedVersionId: true } });
  const audits = await db.auditEvent.findMany({ where: { resourceId: { in: [...fixture.ids, fixture.formId!] } }, select: { id: true, resourceId: true, action: true }, orderBy: { id: "asc" } });
  assert.equal(rows.length, 12); assert.ok(rows.every(row => row.tenantId === fixture.tenantId)); assert.equal(form.serviceId, fixture.serviceId);
  assert.equal(rows.filter(row => row.status === "active").length, mode === "prepare" ? 11 : 10);
  assert.equal(audits.filter(row => row.action === "fixed_url.revoked").length, mode === "prepare" ? 1 : 2);
  const state = { rows, form, audits }, fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (mode === "restart") assert.equal(fingerprint, JSON.parse(await readFile(directory + "/database-after.json", "utf8")).fingerprint);
  await writeFile(directory + "/database-" + mode + ".json", JSON.stringify({ result: "passed", at: new Date().toISOString(), mode, fingerprint, scope: "Only owned R09 synthetic form/fixed URLs and business audits", ...state }, null, 2) + "\n");
  console.log({ result: "passed", mode, rows: rows.length, active: rows.filter(row => row.status === "active").length, audits: audits.length, fingerprint });
} finally { await db.$disconnect(); }
