import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { expertStatusLabels } from "@/contracts/expert-assignments";
import { invitationStatuses, memberStatuses, roleLabels } from "@/contracts/members";
import { createExpertInput, updateExpertInput } from "@/server/expert-assignments";
import { inviteInput, memberInput } from "@/server/members";

const firstService = "00000000-0000-4000-8000-000000000001";
const secondService = "00000000-0000-4000-8000-000000000002";
const companyId = "00000000-0000-4000-8000-000000000003";

test("구성원·초대 DTO는 역할과 상태 계약을 빠짐없이 노출한다", () => {
  expect(Object.keys(roleLabels)).toEqual([
    "owner", "admin", "editor", "viewer", "privacy", "sender", "billing", "security", "auditor",
  ]);
  expect(memberStatuses).toEqual({ active: "활성", suspended: "정지", revoked: "제외" });
  expect(invitationStatuses).toEqual({ pending: "대기", accepted: "수락", revoked: "취소", expired: "만료" });
  expect(expertStatusLabels).toEqual({ active: "활성", expired: "만료", revoked: "회수", unavailable: "사용 불가" });
});

test("초대와 구성원 변경 입력은 역할·서비스 범위·version을 엄격히 검사한다", () => {
  expect(inviteInput.safeParse({ email: "USER@example.test", role: "viewer", serviceIds: [firstService] }).data)
    .toMatchObject({ email: "user@example.test", role: "viewer", serviceIds: [firstService] });
  expect(inviteInput.safeParse({ email: "user@example.test", role: "owner", serviceIds: [firstService] }).success).toBe(false);
  expect(inviteInput.safeParse({ email: "user@example.test", role: "viewer", serviceIds: [] }).success).toBe(false);
  expect(inviteInput.safeParse({ email: "user@example.test", role: "viewer", serviceIds: [firstService, firstService] }).success).toBe(false);
  expect(memberInput.safeParse({ version: 1, role: "editor", serviceIds: [firstService, secondService], status: "active" }).success).toBe(true);
  expect(memberInput.safeParse({ version: 0, role: "editor" }).success).toBe(false);
  expect(memberInput.safeParse({ version: 1 }).success).toBe(false);
  expect(memberInput.safeParse({ version: 1, status: "revoked" }).success).toBe(false);
});

test("전문가 배정 입력은 회사·중복 없는 서비스 범위·만료 시각 형식·version을 검사한다", () => {
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  expect(createExpertInput.safeParse({ companyId, expertEmail: "EXPERT@example.test", serviceIds: [firstService], expiresAt }).data)
    .toMatchObject({ companyId, expertEmail: "expert@example.test", serviceIds: [firstService] });
  expect(createExpertInput.safeParse({ companyId, expertEmail: "expert@example.test", serviceIds: [firstService, firstService], expiresAt }).success).toBe(false);
  expect(createExpertInput.safeParse({ companyId, expertEmail: "expert@example.test", serviceIds: [], expiresAt }).success).toBe(false);
  expect(updateExpertInput.safeParse({ version: 1, serviceIds: [secondService] }).success).toBe(true);
  expect(updateExpertInput.safeParse({ version: 0, serviceIds: [secondService] }).success).toBe(false);
  expect(updateExpertInput.safeParse({ version: 1 }).success).toBe(false);
});

test("Prisma 모델과 SQL migration은 R04의 회사 범위 관계와 상태 제약을 함께 선언한다", async () => {
  const [schema, accessMigration, expertMigration, ownerMigration] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("prisma/migrations/20261003140000_service_access_requests/migration.sql", "utf8"),
    readFile("prisma/migrations/20261003150000_expert_assignments/migration.sql", "utf8"),
    readFile("prisma/migrations/20261002110000_last_owner_guard/migration.sql", "utf8"),
  ]);
  for (const model of ["Membership", "ServiceGrant", "Invitation", "AccessRequest", "ExpertAssignment", "ExpertAssignmentService"])
    expect(schema).toContain(`model ${model} {`);
  for (const marker of ["AccessRequest_requester_fkey", "AccessRequest_service_fkey", "AccessRequest_reviewer_fkey", "AccessRequest_one_pending_key"])
    expect(accessMigration).toContain(marker);
  for (const marker of ["ExpertAssignment_state_check", "ExpertAssignmentService_scope_key", "Membership_expertAssignment_fkey"])
    expect(expertMigration).toContain(marker);
  expect(ownerMigration).toContain("protect_last_company_owner");
  expect(ownerMigration).toContain("FOR UPDATE");
});
