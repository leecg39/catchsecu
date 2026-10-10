import { expect, test } from "vitest";
import { policyFixture } from "../fixtures/policy-details";
import { emptyPolicyDetails, emptyPolicyTrustee, emptyPolicySubprocessor, policyDetailsInput, policyPublishErrors } from "@/contracts/document-policy";
import { policyItemOptions } from "@/contracts/policy-item-options";
import { documentInput, documentPatch } from "@/contracts/documents";
import { publishedPolicyDetails, renderPolicyDetails } from "@/server/document-policy-render";

test("서비스 전체 항목을 필수·선택별로 중복 제거하고 새 수탁자만 독립 복사한다", () => {
  const options = policyItemOptions([{ items: [{ name: "이름", required: true }, { name: "Ａ", required: true }, { name: "별명", required: false }] },
    { items: [{ name: "이름", required: true }, { name: "a", required: true }, { name: "별명", required: true }, { name: "연락처", required: false }] }]);
  expect(options).toEqual({ requiredItems: ["이름", "Ａ", "별명"], optionalItems: ["별명", "연락처"] });
  const first = emptyPolicyTrustee(options), second = emptyPolicySubprocessor(options);
  first.requiredItems.pop(); second.optionalItems!.push("직접 작성");
  expect(options.requiredItems).toEqual(["이름", "Ａ", "별명"]); expect(options.optionalItems).toEqual(["별명", "연락처"]);
  expect(second.requiredItems).toEqual(options.requiredItems);
});
test("서비스 항목 100개는 초기 입력하고 101개는 임의 절삭 없이 수동 선택을 요구한다", () => {
  const values = Array.from({ length: 101 }, (_, i) => "항목 " + i);
  expect(emptyPolicyTrustee({ requiredItems: values.slice(0, 100), optionalItems: [] }).requiredItems).toHaveLength(100);
  expect(emptyPolicyTrustee({ requiredItems: values, optionalItems: ["별명"] })).toMatchObject({ requiredItems: [], optionalItems: ["별명"] });
});
test("신규 재수탁자 항목은 저장·게시 검증·본문에 포함하고 이전 자료에는 필드를 주입하지 않는다", () => {
  const legacy = policyFixture();
  expect(publishedPolicyDetails(policyDetailsInput.parse(legacy))).toEqual(legacy);
  const child = legacy.hosting.trustees[0].subprocessors[0];
  Object.assign(child, { requiredItems: [], optionalItems: [], legalBasis: "" });
  expect(policyPublishErrors(legacy)).toContain("IT 인프라 수탁자 1의 재수탁자 1 위탁 항목을 입력해주세요.");
  Object.assign(child, { requiredItems: ["백업 계정"], optionalItems: ["백업 별명"], legalBasis: "재위탁 처리 근거" });
  expect(policyPublishErrors(legacy)).toEqual([]);
  expect(policyDetailsInput.parse(legacy)).toEqual(legacy);
  for (const phrase of ["백업 계정", "백업 별명", "재위탁 처리 근거"]) expect(renderPolicyDetails(legacy).join("\n")).toContain(phrase);
  child.requiredItems = ["Ａ", "a"]; expect(policyDetailsInput.safeParse(legacy).success).toBe(false);
  child.requiredItems = Array.from({ length: 101 }, (_, i) => "항목" + i); expect(policyDetailsInput.safeParse(legacy).success).toBe(false);
});
test("재수탁자 링크형 전환 시 숨겨진 위탁 항목·처리 근거는 공개하지 않는다", () => {
  const draft = policyFixture(), child = draft.hosting.trustees[0].subprocessors[1];
  Object.assign(child, { requiredItems: ["숨은 필수"], optionalItems: ["숨은 선택"], legalBasis: "숨은 근거" });
  const result = publishedPolicyDetails(draft);
  expect(JSON.stringify(result)).not.toContain("숨은"); expect(renderPolicyDetails(result).join("\n")).not.toContain("숨은");
  expect(child.requiredItems).toEqual(["숨은 필수"]);
});

test("전체 구조화 입력이 손실 없이 왕복하고 선택 구역의 게시 필수 항목을 검증한다", () => {
  const value = policyFixture(); expect(policyDetailsInput.parse(value)).toEqual(value); expect(policyPublishErrors(value)).toEqual([]);
  expect(policyPublishErrors(emptyPolicyDetails())).toEqual([]);
  value.children.purpose = ""; value.hosting.trustees[0].subprocessors[0].contact = ""; value.cctv.managers[1].nameAndPosition = ""; value.officers.domesticAgents[0].address = "";
  expect(policyDetailsInput.safeParse(value).success).toBe(true);
  expect(policyPublishErrors(value)).toEqual(expect.arrayContaining(["아동 정보의 처리 목적을 입력해주세요.", "IT 인프라 수탁자 1의 재수탁자 1 정보를 완성해주세요.", "CCTV 접근 담당자 정보를 입력해주세요.", "국내대리인의 이름·대표자·이메일·연락처·주소를 입력해주세요."]));
});
test.each([
  (p: ReturnType<typeof policyFixture>) => { p.hosting.trustees[0].country = "ZZ"; },
  (p: ReturnType<typeof policyFixture>) => { p.development.trustees[0].linkUrl = "javascript:alert(1)"; },
  (p: ReturnType<typeof policyFixture>) => { p.development.trustees[0].linkUrl = "https://user:password@example.test/"; },
  (p: ReturnType<typeof policyFixture>) => { p.children.requiredItems = ["Ａ", "a"]; },
  (p: ReturnType<typeof policyFixture>) => { p.children.requiredItems = ["x".repeat(201)]; },
  (p: ReturnType<typeof policyFixture>) => { p.cctv.installations[0].count = "x".repeat(71); },
  (p: ReturnType<typeof policyFixture>) => { p.officers.email = "invalid email"; },
  (p: ReturnType<typeof policyFixture>) => { p.officers.domesticAgents = Array(31).fill(p.officers.domesticAgents[0]); },
])("잘못된 구조화 입력을 거부한다 (%#)", mutate => { const p = policyFixture(); mutate(p); expect(policyDetailsInput.safeParse(p).success).toBe(false); });
test("미관측 키·버전·전체 용량을 거부하고 줄 끝 빈 항목은 정리한다", () => {
  expect(policyDetailsInput.safeParse({ ...policyFixture(), unknown: true }).success).toBe(false);
  expect(policyDetailsInput.safeParse({ ...policyFixture(), schemaVersion: 2 }).success).toBe(false);
  const value = policyFixture(); value.cctv.managers = Array.from({ length: 30 }, () => ({ role: "IN_CHARGE", department: "x".repeat(200), nameAndPosition: "한".repeat(3000) }));
  expect(policyDetailsInput.safeParse(value).success).toBe(false);
  value.cctv.managers = []; value.children.requiredItems = ["이름", ""]; expect(policyDetailsInput.parse(value).children.requiredItems).toEqual(["이름"]);
});
test("동의서에는 구조화 처리방침을 입력할 수 없고 이전 필드 없는 문서는 유효하다", () => {
  const row = { serviceId: "cb4c34a0-3d5b-4d32-a9f2-7d5d0b6f4358", type: "consent", title: "합성", body: "", rightsContact: "", refusalNotice: "", effectiveDate: "2026-10-10", purposeIds: [], recipientIds: [] };
  expect(documentInput.safeParse(row).success).toBe(true);
  expect(documentInput.safeParse({ ...row, policyDetails: policyFixture() }).success).toBe(false);
  expect(documentPatch.safeParse({ ...row, policyDetails: policyFixture(), version: 1 }).success).toBe(false);
});
test("화면에서 숨긴 초안 정보는 공개 JSON과 본문에서 모두 제거하고 초안은 보존한다", () => {
  const draft = policyFixture(); draft.children.enabled = false; draft.cctv.installations[0].outsourced = false; draft.officers.domesticAgentEnabled = null;
  draft.hosting.mode = "internal"; draft.development.trustees[0].contact = "숨겨진 직접입력 연락처"; draft.automatedDecisions.specialInformation = false;
  const publicData = publishedPolicyDetails(draft), text = JSON.stringify(publicData);
  for (const hidden of ["아동 교육 신청", "합성 영상 관리사", "합성 국내대리인", "합성 인프라", "숨겨진 직접입력 연락처", "접근성 선택 지원"]) expect(text).not.toContain(hidden);
  expect(draft.children.purpose).toBe("아동 교육 신청"); expect(draft.officers.domesticAgents).toHaveLength(1);
  expect(policyDetailsInput.safeParse(publicData).success).toBe(true);
});
test("게시 본문에 모든 활성 구역의 실제 내용을 한국어로 렌더링한다", () => {
  const rendered = renderPolicyDetails(policyFixture()).join("\n");
  for (const value of ["아동 교육 신청", "아동 이름", "아동 별명", "보호자 연락처", "교육 종료일부터 3 개월 또는", "관련법령에 따른 기간", "합성 인프라", "infra@example.test", "서비스 자료 보관", "계정 이름", "계정 사진", "인프라 위탁 근거 안내", "합성 재수탁자", "sub@example.test", "백업 자료 관리", "재수탁자 목록", "https://example.test/subprocessors", "개발 수탁자 안내", "https://example.test/development", "문의 내용", "오류 화면", "유지보수 위탁 근거 안내", "12개월", "7일", "탈퇴 처리 기록", "시설안전 및 화재예방", "출입 구역 점검", "합성 사무실 출입구", "설치 대수: 2", "24시간", "14일", "접근 제한 보관실", "합성 영상 관리사", "cctv@example.test", "안전 관리부", "가상 책임자·팀장", "시설 운영부", "가상 담당자·매니저", "합성 학습 과정 추천", "수강 이력 분석", "이력과 난이도 비교", "분석 후 추천 결과 안내", "접근성 선택 지원", "접근성 요청", "아동 과정 선택 지원", "아동 수강 단계", "추천 검토부", "review@example.test", "가상 보호책임자", "개인정보 담당 이사", "privacy@example.test", "권리 지원부", "rights@example.test", "가상 권리 담당자", "설정에서 정보 조회·수정 요청", "권리 창구에 삭제 요청", "합성 국내대리인", "가상 대표", "agent@example.test", "합성 대리인 전화", "합성 국내 주소", "가상 DPO", "합성 DPO 주소", "dpo@example.test", "본인이 작성한 공개 게시물", "게시물 공개 설정 변경", "국외 기능 이용 중단 요청", "해당 기능 제공 제한", "기기 내부 사진 분류", "로컬 사진", "맞춤형 광고를 제공합니다", "합성 거래 기록", "합성 접속 기록"]) expect(rendered).toContain(value);
});
test("탈퇴·별도정책·아니요 선택은 보유기간 등 다른 선택지의 문구와 섞이지 않는다", () => {
  const p = emptyPolicyDetails(); p.inactiveUsers = { action: "withdraw", amount: "숨은기간", unit: "YEAR", customText: "숨은정책" }; p.withdrawals.action = "delete"; p.cctv.enabled = false; p.development.enabled = false; p.automatedDecisions.enabled = false; p.sensitiveDisclosure.enabled = false; p.overseasTransfer.enabled = false; p.deviceProcessing.enabled = false; p.behavioralAdvertising.enabled = false;
  const rendered = renderPolicyDetails(publishedPolicyDetails(p)).join("\n"); expect(rendered).toContain("회원탈퇴 처리합니다."); expect(rendered).not.toContain("숨은"); expect(rendered).toContain("회원탈퇴 시 개인정보를 삭제합니다.");
  p.inactiveUsers.action = "custom"; p.inactiveUsers.customText = "합성 별도 정책"; expect(renderPolicyDetails(p).join("\n")).toContain("합성 별도 정책");
});
