import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import routeMatrix from "../../docs/planning/09-rea-fullstack/route-matrix.json";
import routeManifest from "../../src/data/route-manifest.json";

const paths = [
  "/company-info",
  "/service/none",
  "/set/company",
  "/set/company/edit",
  "/set/service",
  "/set/service/modification",
] as const;

async function source(path: string) {
  return readFile(path, "utf8");
}

test("R03-T03의 여섯 경로가 계획과 원본 경로 목록에 모두 연결된다", () => {
  expect(routeMatrix.filter(row => row.ui_task === "R03-T03").map(row => row.path).sort()).toEqual([...paths].sort());
  for (const path of paths) {
    const route = routeManifest.find(row => row.path === path);
    expect(route, path).toBeDefined();
    expect(route?.sourceObserved, path).toBe(true);
  }
});

test("회사 온보딩, 접근요청, 회사·서비스 관리 경로가 전용 화면에 매핑된다", async () => {
  const [clone, publicPages, management] = await Promise.all([
    source("src/components/CloneApp.tsx"),
    source("src/components/PublicPages.tsx"),
    source("src/components/management/index.tsx"),
  ]);
  expect(clone).toContain('path === "/company-info"');
  expect(clone).toContain("<CompanyOnboarding />");
  expect(publicPages).toContain('path === "/service/none"');
  expect(publicPages).toContain("<ServiceAccessPage />");
  for (const contract of [
    "case '/set/company':return <LiveCompany/>",
    "case '/set/company/edit':return <LiveCompany edit/>",
    "case '/set/service':return <LiveServices/>",
    "case '/set/service/modification':return <LiveServiceEditor/>",
  ]) expect(management).toContain(contract);
});

test("회사와 서비스 화면은 로딩·빈 목록·오류 재시도·충돌 복구·권한별 편집 상태를 제공한다", async () => {
  const management = await source("src/components/management/live.tsx");
  for (const marker of [
    "서비스를 불러오는 중입니다.", "등록된 서비스가 없습니다.", "목록 다시 불러오기",
    "VERSION_CONFLICT", "최신 서비스 불러오기", "회사 정보를 불러오는 중입니다.",
    "다시 불러오기", "최신 회사 불러오기", 'capabilities.includes("company.manage")',
    'capabilities.includes("service.manage")', "사업자등록증", "회사 폐쇄 요청",
  ]) expect(management).toContain(marker);
});

test("목록 검색·상태·페이지와 편집 query는 입력 변경 때 안전한 조회 상태를 만든다", async () => {
  const management = await source("src/components/management/live.tsx");
  expect(management).toContain('setQuery(search); setPage(1)');
  expect(management).toContain('setStatus(e.target.value); setPage(1)');
  expect(management).toContain('setSort(e.target.value); setPage(1)');
  expect(management).toContain('setDirection(e.target.value); setPage(1)');
  expect(management).toContain('encodeURIComponent(query)');
  expect(management).toContain('"&sort=" + sort + "&direction=" + direction');
  expect(management).toContain('setPage(currentPage - 1)');
  expect(management).toContain('setPage(currentPage + 1)');
  expect(management).toContain('useSearchParams().get("id")');
  expect(management).toContain('href={"/set/service/modification?id=" + service.id}');
  expect(management).toContain("useUnsavedChanges(dirty || busy)");
});

test("서비스 접근 화면은 세션·권한 조회, 빈 상태, 검증, 요청 이력과 페이지 복구를 구분한다", async () => {
  const access = await source("src/components/ServiceAccessPage.tsx");
  for (const marker of [
    "회사와 서비스 권한을 확인하는 중입니다.", "다시 시도", "현재 접근할 수 있는 서비스가 없습니다.",
    "요청할 서비스를 선택해주세요.", "요청 내역을 불러오는 중입니다.", "요청 내역 다시 시도",
    "서비스 접근 요청을 등록했습니다.", "요청을 취소했습니다.", "내 요청 내역",
    "이전 요청 페이지", "다음 요청 페이지", "권한 상태 새로고침",
  ]) expect(access).toContain(marker);
  expect(access).toContain('scope=mine&pageSize=10&page=" + page');
  expect(access).toContain("useUnsavedChanges(!!serviceId || !!reason || busy)");
  expect(access).toContain("options.some(item => item.id === serviceId)");
});

test("공통 API는 새 조회와 오류를 화면 상태로 돌려주고 캐시된 회사·서비스를 사용하지 않는다", async () => {
  const [api, context] = await Promise.all([source("src/lib/api.ts"), source("src/components/ApplicationContext.tsx")]);
  expect(api).toContain('credentials: "same-origin", cache: "no-store"');
  expect(api).toContain('new ApiError("서버에 연결하지 못했습니다.');
  expect(api).toContain("if (!response.ok) throw new ApiError");
  expect(context).toContain('useResource<Application>("/context")');
  expect(context).toContain("Context.Provider value={resource}");
});
