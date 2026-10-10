import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const output = "docs/qa/R10-T03/catalog-flow";
const browser = JSON.parse(await readFile(output + "/browser.json", "utf8"));
const checks: { name: string; status: number; code?: string }[] = [];
const cookies: Record<string, string> = {};
async function request(path: string, actor: string, method = "GET", input?: unknown, extra: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[actor] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function check(name: string, path: string, actor: string, status: number, method = "GET", input?: unknown, extra?: Record<string, string>) {
  const response = await request(path, actor, method, input, extra);
  const value = await response.json().catch(() => null);
  checks.push({ name, status: response.status, code: value?.error?.code });
  assert.equal(response.status, status, name + ": " + JSON.stringify(value)); return value;
}
try {
  for (const actor of ["owner", "viewer", "other"]) {
    const { email, password } = fixture[actor];
    assert.ok(email.startsWith("rea-"));
    const response = await request("/auth/sign-in/email", "", "POST", { email, password });
    assert.equal(response.status, 200, actor + " login");
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  for (const kind of ["purpose", "recipient"] as const) {
    const row = browser[kind], path = kind === "purpose" ? "/processing-purposes" : "/recipients";
    const fields = kind === "purpose" ?
      ["serviceId", "name", "purpose", "lawfulBasis", "basisReference", "items", "recipientIds", "retentionMode", "retentionDays", "retentionReason"] :
      ["serviceId", "name", "kind", "countryCode", "purpose", "items", "retentionMode", "retentionDays", "retentionReason", "contact", "transferMethod", "transferTiming", "refusalNotice"];
    const input = Object.fromEntries(fields.map(key => [key, row[key]]));
    const latest = await check(kind + " owner read", path + "/" + row.id, "owner", 200);
    assert.equal(latest.version, row.version);
    const history = await check(kind + " owner history", path + "/" + row.id + "/history", "owner", 200);
    assert.equal(history.total, row.version);
    await check(kind + " anonymous denied", path + "/" + row.id, "", 401);
    await check(kind + " viewer ungranted read denied", path + "/" + row.id, "viewer", 403);
    await check(kind + " viewer create denied", path, "viewer", 403, "POST", input, { "Idempotency-Key": randomUUID() });
    await check(kind + " other tenant read denied", path + "/" + row.id, "other", 404);
    await check(kind + " other tenant update denied", path + "/" + row.id, "other", 404, "PATCH", { ...input, version: row.version });
    await check(kind + " other tenant archive denied", path + "/" + row.id, "other", 404, "DELETE", undefined, { "If-Match": String(row.version) });
    await check(kind + " other tenant history denied", path + "/" + row.id + "/history", "other", 404);
    await check(kind + " stale update denied", path + "/" + row.id, "owner", 409, "PATCH", { ...input, version: row.version - 1 });
    await check(kind + " stale archive denied", path + "/" + row.id, "owner", 409, "DELETE", undefined, { "If-Match": String(row.version - 1) });
    await check(kind + " tenant body injection denied", path, "owner", 422, "POST", { ...input, tenantId: fixture.other.companyId }, { "Idempotency-Key": randomUUID() });
    await check(kind + " duplicate name denied", path, "owner", 409, "POST", input, { "Idempotency-Key": randomUUID() });
  }
  await writeFile(output + "/http.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length }));
} finally {
  for (const actor of Object.keys(cookies)) await request("/auth/sign-out", actor, "POST", {}).catch(() => undefined);
}
