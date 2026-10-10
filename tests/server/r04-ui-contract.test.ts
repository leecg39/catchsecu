import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import routeMatrix from "../../docs/planning/09-rea-fullstack/route-matrix.json";
import routeManifest from "../../src/data/route-manifest.json";
import { listHref, oneOf, pageSize, positivePage } from "@/lib/list-url-state";

const sourcePaths = ["/set/member", "/set/authority", "/oauth2/invite/signup", "/expert/select-company"] as const;
const source = (path: string) => readFile(path, "utf8");

test("R04-T03의 네 원본 경로와 전문가 운영 부가 경로가 전용 화면에 연결된다", async () => {
  expect(routeMatrix.filter(row => row.ui_task === "R04-T03").map(row => row.path).sort()).toEqual([...sourcePaths].sort());
  for (const path of sourcePaths) expect(routeManifest.find(row => row.path === path), path).toBeDefined();
  const [management, auth, publicPages, clone] = await Promise.all([
    source("src/components/management/index.tsx"), source("src/components/auth/AuthPages.tsx"),
    source("src/components/PublicPages.tsx"), source("src/components/CloneApp.tsx"),
  ]);
  expect(management).toContain("path==='/set/member'||path==='/set/authority'");
  expect(management).toContain("<LiveMembers authority={path==='/set/authority'}/>");
  expect(auth).toContain('path === "/oauth2/invite/signup"');
  expect(publicPages).toContain('path === "/expert/select-company"');
  expect(clone).toContain('path === "/admin/expert-assignments"');
});

test("구성원·전문가 목록은 로딩·빈 상태·오류 재시도·충돌·입력 보호를 제공한다", async () => {
  const [members, admin, select, invitation] = await Promise.all([
    source("src/components/management/members.tsx"), source("src/components/ExpertAssignmentsAdmin.tsx"),
    source("src/components/ExpertSelectPage.tsx"), source("src/components/auth/InvitationAccept.tsx"),
  ]);
  for (const marker of ["구성원 권한을 확인하는 중입니다.", "구성원 관리 권한이 없습니다.", "목록 다시 불러오기", "VERSION_CONFLICT", "최신 정보 다시 불러오기", "useUnsavedChanges(dirty || busy)"])
    expect(members).toContain(marker);
  for (const marker of ["다시 시도", "VERSION_CONFLICT", "최신 배정 다시 불러오기", "useUnsavedChanges(dirty || busy)"])
    expect(admin).toContain(marker);
  for (const marker of ["배정된 회사를 불러오는 중입니다.", "검색 결과가 없습니다.", "다시 시도", "이전 페이지", "다음 페이지"])
    expect(select).toContain(marker);
  for (const marker of ["초대를 확인하는 중입니다.", "초대 다시 확인", "수락 중…", "초대 로그인 방법 다시 확인"])
    expect(invitation).toContain(marker);
});

test("목록 query parser는 잘못된 값과 과도한 페이지 크기를 안전한 기본값으로 복구한다", () => {
  expect(positivePage("3")).toBe(3);
  expect(positivePage("-1")).toBe(1);
  expect(positivePage("1.5")).toBe(1);
  expect(pageSize("50")).toBe(50);
  expect(pageSize("5000")).toBe(20);
  expect(oneOf("invitations", ["members", "invitations"] as const, "members")).toBe("invitations");
  expect(oneOf("admin", ["members", "invitations"] as const, "members")).toBe("members");
});

test("목록 URL은 소유 query를 갱신하고 다른 화면 문맥은 보존한다", () => {
  expect(listHref("/set/member", "company=a&page=9&q=old", { tab: "invitations", q: "kim@example.test", status: "pending", page: 2, pageSize: 50 }))
    .toBe("/set/member?company=a&page=2&q=kim%40example.test&tab=invitations&status=pending&pageSize=50");
  expect(listHref("/expert/select-company", "q=검색&page=2", { q: "", page: 1 }))
    .toBe("/expert/select-company");
});
