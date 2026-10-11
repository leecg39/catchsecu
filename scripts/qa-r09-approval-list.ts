import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { policySettings, type PolicyRecord } from "../src/contracts/security";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3121");
const privateFile = ".local/rea-fullstack/r09-approval-list.json";
const directory = "docs/qa/R09-T03/current";
const owner = JSON.parse(await readFile(".local/rea-fullstack/r07-list-fixture.json", "utf8")) as {
  email: string; password: string;
};
type Desired = "pending" | "rejected" | "approved" | "consumed";
type Entry = { index: number; desired: Desired; formId?: string; approvalId?: string };
type Fixture = { tenantId?: string; serviceId?: string; entries: Entry[] };
const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8").catch(error => {
  if (error.code !== "ENOENT") throw error;
  return JSON.stringify({ entries: Array.from({ length: 12 }, (_, index) => ({
    index: index + 1,
    desired: (["pending", "rejected", "approved", "consumed"] as Desired[])[index % 4],
  })) });
}));
let cookie = "";
const save = () => writeFile(privateFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });

async function request(path: string, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const value = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${path}: ${value?.error?.code ?? response.status}`);
  return value;
}

try {
  const login = await fetch(origin + "/api/v1/auth/sign-in/email", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: owner.email, password: owner.password }), signal: AbortSignal.timeout(30000),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  if (!fixture.tenantId) {
    fixture.tenantId = (await request("/companies", "POST", {
      name: "R09 승인 목록 검증", publicName: "R09 승인 목록 검증",
    }, 201)).id;
    await save();
  }
  await request("/context", "POST", { companyId: fixture.tenantId });
  if (!fixture.serviceId) {
    const services = await request("/services") as { items: { id: string }[] };
    assert.ok(services.items.length);
    fixture.serviceId = services.items[0].id;
    await save();
  }
  const policy = await request("/security/policy") as PolicyRecord;
  if (!policy.requireApproval || !policy.approvalReferenceRequired) {
    const settings = Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, policy[key as keyof PolicyRecord]]));
    await request("/security/policy", "PATCH", {
      ...settings, tenantId: fixture.tenantId, version: policy.version, password: owner.password,
      requireApproval: true, approvalReferenceRequired: true,
    });
  }
  for (const entry of fixture.entries) {
    if (!entry.formId) {
      const form = await request("/forms", "POST", {
        serviceId: fixture.serviceId,
        title: `R09 승인 목록 ${String(entry.index).padStart(2, "0")}`,
        content: {
          body: "승인 내역 URL 복원 검증",
          questions: [{ id: randomUUID(), type: "단문형 답변", label: "검증 항목", required: false }],
          consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10,
        },
      }, 201);
      entry.formId = form.id;
      await save();
    }
    if (!entry.approvalId) {
      const form = await request(`/forms/${entry.formId}`);
      const approval = await request(`/forms/${entry.formId}/approvals`, "POST", {
        version: form.version, message: `R09 목록 ${entry.index} 검토 요청`, reference: `R09-${entry.index}`,
      }, 201);
      entry.approvalId = approval.id;
      await save();
    }
    let approval = await request(`/approvals/${entry.approvalId}`) as { status: string; version: number };
    if (entry.desired !== "pending" && approval.status === "pending") {
      approval = await request(`/approvals/${entry.approvalId}/decision`, "POST", {
        version: approval.version,
        decision: entry.desired === "rejected" ? "rejected" : "approved",
        reason: entry.desired === "rejected" ? "목록 반려 상태 검증" : "목록 승인 상태 검증",
      });
    }
    if (entry.desired === "consumed" && approval.status === "approved") {
      const form = await request(`/forms/${entry.formId}`);
      await request(`/forms/${entry.formId}/publish`, "POST", { version: form.version }, 201);
    }
  }
  const ids = fixture.entries.map(entry => entry.approvalId!);
  const rows = await db.approvalRequest.findMany({
    where: { id: { in: ids }, tenantId: fixture.tenantId },
    select: { id: true, formId: true, status: true, version: true, form: { select: { title: true, serviceId: true } } },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(rows.length, 12);
  for (const desired of ["pending", "rejected", "approved", "consumed"] as const)
    assert.equal(rows.filter(row => row.status === desired).length, 3);
  assert.ok(rows.every(row => row.form.serviceId === fixture.serviceId));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/approval-list-fixture.json`, JSON.stringify({
    result: "passed", checkedAt: new Date().toISOString(), createdViaHttp: true,
    tenantId: fixture.tenantId, serviceId: fixture.serviceId,
    counts: Object.fromEntries(["pending", "rejected", "approved", "consumed"].map(status => [status, rows.filter(row => row.status === status).length])),
    rows,
  }, null, 2) + "\n");
  console.log({ result: "passed", approvals: rows.length, statuses: { pending: 3, rejected: 3, approved: 3, consumed: 3 } });
} finally {
  await db.$disconnect();
}
