import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import type { MemberRecord } from "../src/contracts/members";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert(["http://localhost:3100", "http://127.0.0.1:3100"].includes(origin));
const fixture = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as {
  people: { id: string; email: string; password: string }[]; companyId: string; secondServiceId: string; memberId: string;
};
const owner = fixture.people[0], cases: { label: string; status: number }[] = [];
let cookie = "", original: MemberRecord | undefined, archived = false;
async function request<T>(label: string, path: string, method = "GET", value?: unknown, expected = 200, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: {
    ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label);
  cases.push({ label, status: response.status });
  if (path === "/auth/sign-in/email") cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return await response.json().catch(() => undefined) as T;
}
async function main() {
  assert.equal(await db.membership.count({ where: { tenantId: fixture.companyId, userId: owner.id, role: "owner", status: "active" } }), 1);
  await request("합성 소유자 로그인", "/auth/sign-in/email", "POST", { email: owner.email, password: owner.password });
  await request("합성 회사 선택", "/context", "POST", { companyId: fixture.companyId });
  original = await request<MemberRecord>("현재 구성원 조회", "/members/" + fixture.memberId);
  const service = await request<{ version: number; status: string }>("현재 서비스 조회", "/services/" + fixture.secondServiceId);
  assert.equal(service.status, "active");
  let member = await request<MemberRecord>("서비스 권한 부여", "/members/" + fixture.memberId, "PATCH", {
    version: original.version, role: "viewer", serviceIds: [fixture.secondServiceId],
  });
  await request("서비스 보관", "/services/" + fixture.secondServiceId, "DELETE", undefined, 204, { "If-Match": String(service.version) });
  archived = true;
  member = await request<MemberRecord>("보관 상태 DTO 조회", "/members/" + fixture.memberId);
  assert.equal(member.grants.find(grant => grant.serviceId === fixture.secondServiceId)?.serviceStatus, "archived");
  member = await request<MemberRecord>("기존 보관 권한 유지·역할 변경", "/members/" + fixture.memberId, "PATCH", {
    version: member.version, role: "editor", serviceIds: [fixture.secondServiceId],
  });
  member = await request<MemberRecord>("보관 서비스 권한 회수", "/members/" + fixture.memberId, "PATCH", { version: member.version, serviceIds: [] });
  await request("회수 후 보관 권한 재부여 차단", "/members/" + fixture.memberId, "PATCH", { version: member.version, serviceIds: [fixture.secondServiceId] }, 404);
  assert.equal(await db.serviceGrant.count({ where: { tenantId: fixture.companyId, memberId: fixture.memberId } }), 0);
}
try { await main(); }
catch { console.error("보관 서비스 HTTP 검증 실패. 마지막 완료 단계: " + (cases.at(-1)?.label ?? "준비")); process.exitCode = 1; }
finally {
  try {
    if (cookie && archived) {
      const service = await request<{ version: number }>("복원 전 서비스 조회", "/services/" + fixture.secondServiceId);
      await request("합성 서비스 원상 복원", "/services/" + fixture.secondServiceId, "PATCH", { version: service.version, status: "active" });
    }
    if (cookie && original) {
      const member = await request<MemberRecord>("복원 전 구성원 조회", "/members/" + fixture.memberId);
      await request("합성 구성원 원상 복원", "/members/" + fixture.memberId, "PATCH", {
        version: member.version, role: original.role, status: original.status, serviceIds: original.grants.map(grant => grant.serviceId),
      });
      const row = await db.membership.findUniqueOrThrow({ where: { id: fixture.memberId }, include: { grants: true } });
      assert.equal(row.role, original.role); assert.equal(row.status, original.status);
      assert.deepEqual(row.grants.map(grant => grant.serviceId).sort(), original.grants.map(grant => grant.serviceId).sort());
      assert.equal((await db.service.findUniqueOrThrow({ where: { id: fixture.secondServiceId } })).status, "active");
    }
    if (!process.exitCode) {
      await writeFile("docs/qa/P03-T02/archive-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", browserVerified: false,
        cases, revokedGrants: 0, fixtureRestored: true }, null, 2) + "\n");
      console.log(JSON.stringify({ result: "passed", httpCases: cases.length, fixtureRestored: true }));
    }
  } catch { console.error("합성 계정의 원상 복원을 확인하지 못했습니다. 비밀 값은 출력하지 않습니다."); process.exitCode = 1; }
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie } }).catch(() => {});
  await db.$disconnect();
}
