import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET as list } from "@/app/api/v1/audit-events/route";
import { GET as exportCsv } from "@/app/api/v1/audit-events/export/route";
import { parse } from "csv-parse/sync";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Audit fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Test-only-password!123";
const companyA = randomUUID(), companyB = randomUUID(), serviceA1 = randomUUID(), serviceA2 = randomUUID(), serviceB = randomUUID();
let adminId = "", privacyId = "", viewerId = "", adminCookie = "", privacyCookie = "", viewerCookie = "";
let eventService = "", eventMarketing = "", eventMember = "", eventInfo = "", eventMine = "";
function request(path: string, method = "GET", cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}) },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function addUser(email: string, role: "admin" | "privacy" | "viewer", tenantId = companyA) {
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: email.split("@")[0], email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const signed = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  expect(signed.status).toBe(200);
  return { id: user.id, memberId: member.id, cookie: cookies(signed) };
}
async function event(tenantId: string, action: string, serviceId: string | null, actorId: string, at: number,
  resourceId = randomUUID()) {
  return db.auditEvent.create({ data: { tenantId, serviceId, actorId, action, resource: action.split(".")[0],
    resourceId, requestId: randomUUID(), createdAt: new Date(Date.now() - at * 60000),
    detail: { email: "secret@example.test", token: "never-return-this-token", changedFields: ["status"] } } });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: companyA, name: "감사 회사 A", publicName: "A" },
    { id: companyB, name: "감사 회사 B", publicName: "B" }] });
  await db.service.createMany({ data: [{ id: serviceA1, tenantId: companyA, name: "=2+2", externalName: "A1" },
    { id: serviceA2, tenantId: companyA, name: "서비스 A2", externalName: "A2" },
    { id: serviceB, tenantId: companyB, name: "서비스 B", externalName: "B" }] });
  const admin = await addUser("audit-admin@test.local", "admin"); adminId = admin.id; adminCookie = admin.cookie;
  const privacy = await addUser("audit-privacy@test.local", "privacy"); privacyId = privacy.id; privacyCookie = privacy.cookie;
  const viewer = await addUser("audit-viewer@test.local", "viewer"); viewerId = viewer.id; viewerCookie = viewer.cookie;
  const other = await addUser("audit-other@test.local", "admin", companyB);
  await db.serviceGrant.createMany({ data: [
    { tenantId: companyA, memberId: privacy.memberId, serviceId: serviceA1, capabilities: ["service.read", "audit.read"] },
    { tenantId: companyA, memberId: viewer.memberId, serviceId: serviceA1, capabilities: ["service.read"] },
  ] });
  eventService = (await event(companyA, "service.updated", serviceA1, adminId, 5, "private-link-token-do-not-return")).id;
  eventMarketing = (await event(companyA, "marketing.granted", serviceA1, privacyId, 4)).id;
  eventMember = (await event(companyA, "member.updated", null, adminId, 3)).id;
  eventInfo = (await event(companyA, "submission.viewed", serviceA2, adminId, 2)).id;
  eventMine = (await event(companyA, "service.viewed", serviceA1, viewerId, 1)).id;
  await event(companyB, "service.updated", serviceB, other.id, 0);
  await db.rateLimit.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

describe("회사 격리 감사 이벤트 조회", () => {
  test("인증·역할·서비스 범위와 안전 DTO", async () => {
    expect((await list(request("/audit-events"))).status).toBe(401);
    expect((await list(request("/audit-events", "GET", viewerCookie))).status).toBe(403);
    const limited = await list(request("/audit-events?kind=all", "GET", privacyCookie));
    expect(limited.status).toBe(200);
    const limitedBody = await limited.json();
    expect(limitedBody.items.map((item: { id: string }) => item.id)).toEqual([eventMine, eventMarketing, eventService]);
    expect(limitedBody.items.every((item: { actorName: string | null; resourceId: string | null }) =>
      item.actorName === null && item.resourceId === null)).toBe(true);
    expect(JSON.stringify(limitedBody)).not.toContain("never-return-this-token");
    expect(JSON.stringify(limitedBody)).not.toContain("secret@example.test");
    const expectedTotal = await db.auditEvent.count({ where: { tenantId: companyA } });
    const full = await list(request("/audit-events", "GET", adminCookie));
    expect(full.status).toBe(200);
    const fullBody = await full.json();
    expect(fullBody.total).toBe(expectedTotal);
    expect(fullBody.items.some((item: { id: string; actorName: string | null }) =>
      item.id === eventInfo && item.actorName === "audit-admin")).toBe(true);
    expect(fullBody.items.find((item: { id: string }) => item.id === eventService).resourceId).toBeNull();
    expect(JSON.stringify(fullBody)).not.toContain("never-return-this-token");
    expect(JSON.stringify(fullBody)).not.toContain("private-link-token-do-not-return");
    expect((await list(request("/audit-events?serviceId=" + serviceB, "GET", adminCookie))).status).toBe(404);
    expect((await list(request("/audit-events?serviceId=" + serviceA2, "GET", privacyCookie))).status).toBe(404);
  });
  test("종류·기간·검색·페이지 필터가 DB에 적용된다", async () => {
    const service = await (await list(request("/audit-events?kind=service", "GET", adminCookie))).json();
    expect(service.items.map((item: { id: string }) => item.id)).toEqual([eventMine, eventService]);
    const marketing = await (await list(request("/audit-events?kind=marketing", "GET", adminCookie))).json();
    expect(marketing.items.map((item: { id: string }) => item.id)).toEqual([eventMarketing]);
    const member = await (await list(request("/audit-events?kind=member", "GET", adminCookie))).json();
    expect(member.items.map((item: { id: string }) => item.id)).toEqual([eventMember]);
    const info = await (await list(request("/audit-events?kind=info", "GET", privacyCookie))).json();
    expect(info.total).toBe(0);
    const searched = await (await list(request("/audit-events?search=service.updated&searchField=action", "GET", adminCookie))).json();
    expect(searched.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    const page1 = await (await list(request("/audit-events?kind=service&pageSize=1&page=1", "GET", adminCookie))).json();
    const page2 = await (await list(request("/audit-events?kind=service&pageSize=1&page=2", "GET", adminCookie))).json();
    expect(page1.items.map((item: { id: string }) => item.id)).toEqual([eventMine]);
    expect(page2.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    const cutoff = new Date(Date.now() - 2.5 * 60000).toISOString();
    const recent = await (await list(request("/audit-events?kind=service&from=" + encodeURIComponent(cutoff), "GET", adminCookie))).json();
    expect(recent.items.map((item: { id: string }) => item.id)).toEqual([eventMine]);
    const boundary = (await db.auditEvent.findUniqueOrThrow({ where: { id: eventMine }, select: { createdAt: true } })).createdAt.toISOString();
    const before = await (await list(request("/audit-events?kind=service&to=" + encodeURIComponent(boundary), "GET", adminCookie))).json();
    expect(before.items.map((item: { id: string }) => item.id)).toEqual([eventService]);
    expect((await list(request("/audit-events?from=2026-13-01", "GET", adminCookie))).status).toBe(422);
    expect((await list(request("/audit-events?from=" + encodeURIComponent(new Date().toISOString()) +
      "&to=2020-01-01T00%3A00%3A00.000Z", "GET", adminCookie))).status).toBe(422);
  });
  test("본인 활동은 조회하되 다른 처리자 조회·검색은 차단한다", async () => {
    const mine = await list(request("/audit-events?scope=mine", "GET", viewerCookie));
    expect(mine.status).toBe(200);
    const data = await mine.json();
    expect(data.items.map((item: { action: string }) => item.action)).toContain("session.created");
    expect(data.items.map((item: { id: string }) => item.id)).toContain(eventMine);
    expect(data.total).toBe(2);
    expect(data.items[0].actorName).toBe("audit-viewer");
    expect(data.items[0].resourceId).toBeNull();
    expect((await list(request("/audit-events?scope=mine&actorId=" + adminId, "GET", viewerCookie))).status).toBe(403);
    expect((await list(request("/audit-events?search=admin&searchField=actor", "GET", privacyCookie))).status).toBe(403);
    expect((await list(request("/audit-events?actorId=" + adminId, "GET", privacyCookie))).status).toBe(403);
  });
  test("CSV는 같은 필터 전체 행을 안전하게 내보내고 원장 삭제를 막는다", async () => {
    const path = "/audit-events/export?kind=service&page=1&pageSize=1";
    expect((await exportCsv(request(path))).status).toBe(401);
    expect((await exportCsv(request(path, "GET", viewerCookie))).status).toBe(403);
    const response = await exportCsv(request(path, "GET", adminCookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("audit-events.csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const exportEvent = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers.get("x-request-id")! } });
    expect(exportEvent).toMatchObject({ tenantId: companyA, actorId: adminId, action: "audit.exported",
      resource: "auditEvent", serviceId: null,
      detail: { scope: "company", kind: "service", rowCount: 2, hasSearch: false } });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const csv = bytes.toString("utf8");
    expect(csv).not.toContain("never-return-this-token");
    expect(csv).not.toContain("private-link-token-do-not-return");
    const rows = parse(csv, { bom: true }) as string[][];
    expect(rows.length).toBe(3);
    expect(rows.slice(1).map(row => row[0])).toEqual([eventMine, eventService]);
    expect(rows[2][2]).toBe("'=2+2");
    const limited = await exportCsv(request("/audit-events/export?kind=service", "GET", privacyCookie));
    expect(limited.status).toBe(200);
    const limitedRows = parse(await limited.text(), { bom: true }) as string[][];
    expect(limitedRows.every((row, index) => index === 0 || row[3] === "비공개")).toBe(true);
    expect((await exportCsv(request("/audit-events/export?serviceId=" + serviceB, "GET", adminCookie))).status).toBe(404);
    const mine = await exportCsv(request("/audit-events/export?scope=mine&kind=service", "GET", viewerCookie));
    expect(mine.status).toBe(200);
    expect((parse(await mine.text(), { bom: true }) as string[][]).slice(1).map(row => row[0])).toEqual([eventMine]);
    const searched = await exportCsv(request("/audit-events/export?search=secret%40example.test", "GET", adminCookie));
    expect(searched.status).toBe(200);
    const searchedEvent = await db.auditEvent.findFirstOrThrow({ where: { requestId: searched.headers.get("x-request-id")! } });
    expect(searchedEvent.detail).toMatchObject({ hasSearch: true, rowCount: 0 });
    expect(JSON.stringify(searchedEvent.detail)).not.toContain("secret@example.test");
    await expect(db.auditEvent.delete({ where: { id: eventService } })).rejects.toThrow();
  });
  test("5,000건 초과 내보내기는 일부만 내려주지 않는다", async () => {
    await db.auditEvent.createMany({ data: Array.from({ length: 5001 }, (_, index) => ({
      tenantId: companyA, actorId: adminId, serviceId: serviceA1, action: "audit.export_overflow",
      resource: "audit", resourceId: randomUUID(), requestId: randomUUID(), detail: { index },
    })) });
    const response = await exportCsv(request("/audit-events/export?search=audit.export_overflow", "GET", adminCookie));
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await db.auditEvent.count({ where: { requestId: response.headers.get("x-request-id")! } })).toBe(0);
  });
  test.each([
    { kind: "authority", actions: ["mfa_policy.updated", "mfa_exception.created", "ip_access.updated", "ip_rule.created", "policy.updated"] },
    { kind: "info", actions: ["consent_receipt.pdf_downloaded"] },
  ])("$kind includes its security/receipt producers with matching masked list and CSV", async ({ kind, actions }) => {
    const ids = [];
    for (const action of actions) ids.push((await event(companyA, action, serviceA1, adminId, 0)).id);
    const query = "?kind=" + kind + "&serviceId=" + serviceA1 + "&pageSize=100";
    const r = await list(request("/audit-events" + query, "GET", privacyCookie)); expect(r.status).toBe(200);
    const data = await r.json(); expect(data.items.map((row: { id: string }) => row.id).sort()).toEqual(ids.sort());
    expect(data.items.every((row: { resourceId: string | null; actorName: string | null }) => row.resourceId === null && row.actorName === null)).toBe(true);
    const exported = await exportCsv(request("/audit-events/export" + query, "GET", privacyCookie)); expect(exported.status).toBe(200);
    const csv = parse(await exported.text(), { bom: true }) as string[][];
    expect(csv.slice(1).map(row => row[0]).sort()).toEqual(ids.sort());
    expect(JSON.stringify(csv)).not.toContain("never-return-this-token");
  });
});

// The form-specific path must not return a service's other forms or the company-wide audit stream.
import { GET as formLog } from "@/app/api/v1/forms/[...segments]/route";
import { requireContext } from "@/server/context";
import { formAuditEvents } from "@/server/form-audit-events";
import { auditEventQuery } from "@/server/audit-events";
const formA = randomUUID(), siblingForm = randomUUID(), foreignForm = randomUUID();
const formEventIds: string[] = [];
describe("폼별 감사 조회·내보내기", () => {
  beforeAll(async () => {
    const other = await db.membership.findFirstOrThrow({ where: { tenantId: companyB } });
    for (const [id, tenantId, serviceId, ownerId] of [[formA, companyA, serviceA1, adminId], [siblingForm, companyA, serviceA1, adminId], [foreignForm, companyB, serviceB, other.userId]]) {
      await db.form.create({ data: { id, tenantId, serviceId, ownerId, title: "감사 범위 시험" } });
      const version = await db.formVersion.create({ data: { tenantId, formId: id, number: 1, title: "감사 범위 시험", status: "draft" } });
      const question = await db.question.create({ data: { tenantId, formVersionId: version.id, stableKey: randomUUID(), type: "파일 업로드", label: "파일", required: false, order: 0 } });
      await db.formVersion.update({ where: { id: version.id }, data: { status: "published" } });
      const publication = await db.publication.create({ data: { tenantId, formId: id, formVersionId: version.id, tokenHash: randomUUID(), tokenCipher: "test-only", maxResponses: 100 } });
      const submission = await db.submission.create({ data: { tenantId, formVersionId: version.id, publicationId: publication.id, retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } });
      const file = await db.fileObject.create({ data: { tenantId, serviceId, ownerKind: "member", ownerId, publicationId: publication.id, formVersionId: version.id, questionId: question.id, submissionId: submission.id, storageKey: randomUUID(), nameCipher: encrypt("test.txt"), sha256: "a".repeat(64), mime: "text/plain", size: 1, status: "pending", expiresAt: new Date(Date.now() + 86400000) } });
      for (const [resource, resourceId, action] of [["form", id, "submission.list_viewed"], ["submission", submission.id, "submission.corrected"], ["file", file.id, "file.downloaded"]]) {
        const row = await db.auditEvent.create({ data: { tenantId, serviceId, actorId: ownerId, resource, resourceId, action, requestId: randomUUID(), detail: { secret: "form-log-must-not-leak" } } });
        if (id === formA) formEventIds.push(row.id);
      }
    }
  });
  test("선택 폼만 조회하고 동일 서비스의 다른 폼·회사 및 비밀 필드는 제외한다", async () => {
    const r = await formLog(request(`/forms/${formA}/audit-events?pageSize=100`, "GET", adminCookie)); expect(r.status).toBe(200);
    const data = await r.json(); expect(data.total).toBe(3); expect(data.items.map((r: { id: string }) => r.id).sort()).toEqual(formEventIds.sort());
    expect(JSON.stringify(data)).not.toContain("form-log-must-not-leak");
    expect(data.items.every((row: { formName: string }) => row.formName === "감사 범위 시험")).toBe(true);
    const submitted = data.items.find((row: { resource: string }) => row.resource === "submission");
    expect(submitted.submissionId).toBe(submitted.resourceId);
    expect(data.items.find((row: { resource: string }) => row.resource === "file").submissionId).toBe(submitted.resourceId);
    const limited = await (await formLog(request(`/forms/${formA}/audit-events`, "GET", privacyCookie))).json();
    expect(limited.items.every((r: { actorName: string | null; resourceId: string | null }) => r.actorName === null && r.resourceId === null)).toBe(true);
    expect(limited.items.every((r: { formName: string | null; submissionId: string | null }) => r.formName === null && r.submissionId === null)).toBe(true);
    expect((await formLog(request(`/forms/${foreignForm}/audit-events`, "GET", adminCookie))).status).toBe(404);
    expect((await formLog(request(`/forms/${randomUUID()}/audit-events`, "GET", adminCookie))).status).toBe(404);
  });
  test("검색·페이지·CSV가 같은 범위를 쓰며 CSV는 전체 필터 행을 내보낸다", async () => {
    const r = await formLog(request(`/forms/${formA}/audit-events?search=corrected&pageSize=1`, "GET", adminCookie)); expect(r.status).toBe(200);
    const data = await r.json(); expect(data.total).toBe(1); expect(data.items[0].action).toBe("submission.corrected");
    const csv = await formLog(request(`/forms/${formA}/audit-events/export?pageSize=1`, "GET", adminCookie)); expect(csv.status).toBe(200);
    expect(csv.headers.get("cache-control")).toBe("private, no-store");
    const rows = parse(await csv.text(), { bom: true }) as string[][];
    expect(rows.slice(1).map(row => row[0]).sort()).toEqual(formEventIds.sort()); expect(rows[1][2]).toBe("'=2+2");
    expect(rows[0].slice(-2)).toEqual(["캐치폼·개인정보 업로드명", "응답 ID"]);
    expect(rows.slice(1).every(row => row[7] === "감사 범위 시험")).toBe(true);
    const limitedCsv = await formLog(request(`/forms/${formA}/audit-events/export`, "GET", privacyCookie));
    expect((parse(await limitedCsv.text(), { bom: true }) as string[][]).slice(1).every(row => row[7] === "" && row[8] === "")).toBe(true);
    const literal = await (await formLog(request(`/forms/${formA}/audit-events?search=%25_`, "GET", adminCookie))).json(); expect(literal.total).toBe(0);
    const access = await db.auditEvent.findFirstOrThrow({ where: { requestId: csv.headers.get("x-request-id")! } }); expect(access).toMatchObject({ action: "audit.exported", serviceId: serviceA1, detail: { rowCount: 3 } });
  });
  test("미인증·뷰어·다른 서비스·자기활동 우회·잘못된 중첩 경로를 거부한다", async () => {
    const path = `/forms/${formA}/audit-events`;
    expect((await formLog(request(path))).status).toBe(401);
    expect((await formLog(request(path, "GET", viewerCookie))).status).toBe(403);
    expect((await formLog(request(path + "?scope=mine", "GET", adminCookie))).status).toBe(422);
    expect((await formLog(request(path + "?serviceId=" + serviceA2, "GET", adminCookie))).status).toBe(404);
    expect((await formLog(request(path + "/export/extra", "GET", adminCookie))).status).toBe(404);
    expect((await formLog(request(path + "?search=admin&searchField=actor", "GET", privacyCookie))).status).toBe(403);
  });
  test("미리 읽은 권한도 회수 후 현재 서비스 권한으로 다시 검사한다", async () => {
    const ctx = await requireContext(request("/context", "GET", privacyCookie).headers, "audit.read");
    const grant = await db.serviceGrant.findFirstOrThrow({ where: { memberId: ctx.member.id, serviceId: serviceA1 } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: ["service.read"] } });
    try { await expect(formAuditEvents(ctx, formA, auditEventQuery.parse({}), randomUUID())).rejects.toMatchObject({ status: 404 }); }
    finally { await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } }); }
  });
  test("폼 로그 CSV 상한을 넘으면 부분 파일과 성공 감사 없이 거부한다", async () => {
    await db.auditEvent.createMany({ data: Array.from({ length: 5001 }, () => ({ tenantId: companyA, serviceId: serviceA1, actorId: adminId, resource: "form", resourceId: formA, action: "form.audit_overflow", requestId: randomUUID(), detail: {} })) });
    const r = await formLog(request(`/forms/${formA}/audit-events/export?search=form.audit_overflow`, "GET", adminCookie)); expect(r.status).toBe(413);
    expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")! } })).toBe(0);
  });
  test("회사·서비스가 어긋난 원장 참조와 없는 ID로 다른 폼의 이름을 추론하지 않는다", async () => {
    const ids: string[] = [];
    for (const [resourceId, serviceId] of [[foreignForm, serviceA1], [formA, serviceA2], [randomUUID(), serviceA1]]) {
      const row = await db.auditEvent.create({ data: { tenantId: companyA, serviceId, actorId: adminId,
        resource: "form", resourceId, action: "form.context_test", requestId: randomUUID(), detail: {} } });
      ids.push(row.id);
    }
    const response = await list(request("/audit-events?search=form.context_test", "GET", adminCookie));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items.map((row: { id: string }) => row.id).sort()).toEqual(ids.sort());
    expect(data.items.every((row: { formName: string | null; submissionId: string | null }) => row.formName === null && row.submissionId === null)).toBe(true);
  });
  test("회사 목록과 CSV의 응답 참조가 같고 제목의 CSV 수식을 실행하지 않는다", async () => {
    await db.form.update({ where: { id: formA }, data: { title: "=2+3" } });
    const row = await db.auditEvent.findFirstOrThrow({ where: { id: { in: formEventIds }, resource: "submission" } });
    const listResponse = await list(request("/audit-events?kind=info&search=submission.corrected&pageSize=100", "GET", adminCookie));
    const item = (await listResponse.json()).items.find((item: { id: string }) => item.id === row.id);
    expect(item).toMatchObject({ formName: "=2+3", submissionId: row.resourceId });
    const csv = await exportCsv(request("/audit-events/export?kind=info&search=submission.corrected", "GET", adminCookie));
    const exported = (parse(await csv.text(), { bom: true }) as string[][]).find(item => item[0] === row.id)!;
    expect(exported[7]).toBe("'=2+3"); expect(exported[8]).toBe(row.resourceId);
  });
  test("내보내기 사건은 연결 폼만 표시하며 검색 조건이나 응답 원문을 노출하지 않는다", async () => {
    const job = await db.exportJob.create({ data: { tenantId: companyA, serviceId: serviceA1, formId: formA,
      requesterId: adminId, requestKeyHash: randomUUID(), filtersCipher: encrypt({ secret: "export-filter-private" }),
      expiresAt: new Date(Date.now() + 86400000) } });
    const row = await db.auditEvent.create({ data: { tenantId: companyA, serviceId: serviceA1, actorId: adminId,
      resource: "export", resourceId: job.id, action: "export.created", requestId: randomUUID(), detail: {} } });
    const response = await formLog(request(`/forms/${formA}/audit-events?search=export.created`, "GET", adminCookie));
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ id: row.id, formName: "=2+3", submissionId: null });
    expect(JSON.stringify(data)).not.toContain("export-filter-private");
    expect(JSON.stringify(data)).not.toContain(job.filtersCipher);
  });
});
