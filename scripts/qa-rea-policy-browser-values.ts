import { mkdir, writeFile } from "node:fs/promises";
import { policyFixture } from "../tests/fixtures/policy-details";
const p = policyFixture(), a = p.automatedDecisions, o = p.officers, c = p.cctv, i = p.hosting.trustees[0], d = p.development.trustees[0];
const values: Record<string, string> = {
  "아동 정보 처리 목적": p.children.purpose, "아동 필수 수집 항목": p.children.requiredItems.join("\n"), "아동 선택 수집 항목": p.children.optionalItems.join("\n"), "법정대리인 확인 항목": p.children.guardianItems.join("\n"),
  "아동 보유기간 1 기준": "직접입력", "아동 보유기간 1 직접입력 기준": "교육 종료일부터", "아동 보유기간 1 기간": "3", "아동 보유기간 1 단위": "개월", "아동 보유기간 1 연결 조건": "또는",
  "IT 인프라 수탁자 1 이름": i.name, "IT 인프라 수탁자 1 연락처": i.contact, "IT 인프라 수탁자 1 위탁 업무": i.work, "IT 인프라 수탁자 1 국가·지역": i.country, "IT 인프라 수탁자 1 필수 위탁 항목": i.requiredItems.join("\n"), "IT 인프라 수탁자 1 선택 위탁 항목": i.optionalItems.join("\n"), "IT 인프라 수탁자 1 처리 근거": i.legalBasis,
  "개발·유지보수 수탁자 1 입력 방법": "link", "개발·유지보수 수탁자 1 링크 문구": d.linkText, "개발·유지보수 수탁자 1 링크 주소 (HTTPS)": d.linkUrl, "개발·유지보수 수탁자 1 국가·지역": d.country, "개발·유지보수 수탁자 1 필수 위탁 항목": d.requiredItems.join("\n"), "개발·유지보수 수탁자 1 선택 위탁 항목": d.optionalItems.join("\n"), "개발·유지보수 수탁자 1 처리 근거": d.legalBasis,
  "분리 시점부터 보관 기간": p.inactiveUsers.amount, "미사용자 보관 단위": p.inactiveUsers.unit, "탈퇴 후 보관 기간": p.withdrawals.amount, "탈퇴 후 보관 단위": p.withdrawals.unit, "탈퇴 후 보관 항목": p.withdrawals.items.join("\n"),
  "CCTV 설치 목적": c.purposes.join("\n"), "CCTV 기타 설치 목적": c.customPurpose,
  "CCTV 1 설치 위치·촬영 범위": c.installations[0].location, "CCTV 1 설치 대수": c.installations[0].count, "CCTV 1 촬영 시간": c.installations[0].operatingHours, "CCTV 1 보관 기간": c.installations[0].storagePeriod, "CCTV 1 보관 장소": c.installations[0].storageLocation, "CCTV 1 관리 위탁": "true", "CCTV 1 수탁자 이름": c.installations[0].trustee.name, "CCTV 1 수탁자 국가·지역": c.installations[0].trustee.country, "CCTV 1 수탁자 연락처": c.installations[0].trustee.contact,
  "CCTV 담당자 1 부서": c.managers[0].department, "CCTV 담당자 1 이름·직위": c.managers[0].nameAndPosition, "CCTV 담당자 2 역할": "HANDS_ON", "CCTV 담당자 2 부서": c.managers[1].department, "CCTV 담당자 2 이름·직위": c.managers[1].nameAndPosition,
  "자동화된 결정 결정 개요": a.overview, "자동화된 결정 처리 정보": a.processedInformation, "자동화된 결정 정보와 결정의 연관성": a.decisionRelation, "자동화된 결정 처리 절차": a.procedure, "자동화 민감정보 목적": a.sensitive.purpose, "자동화 민감정보 항목": a.sensitive.items.join("\n"), "자동화 아동 정보 목적": a.children.purpose, "자동화 아동 정보 항목": a.children.items.join("\n"), "자동화 결정 창구 1 부서": a.contacts[0].department, "자동화 결정 창구 1 연락처": a.contacts[0].contact,
  "개인정보 보호책임자 이름": o.name, "개인정보 보호책임자 직책": o.position, "개인정보 보호책임자 이메일": o.email, "권리행사 부서 이름": o.department.name, "권리행사 연락처": o.department.contact, "권리행사 담당자 이름": o.department.officerName, "정보 조회·수정 방법": o.updatePath, "동의 철회·삭제 방법": o.deletePath,
  "국내대리인 1 이름": o.domesticAgents[0].name, "국내대리인 1 대표자": o.domesticAgents[0].representative, "국내대리인 1 이메일": o.domesticAgents[0].email, "국내대리인 1 연락처": o.domesticAgents[0].contact, "국내대리인 1 주소": o.domesticAgents[0].address,
  "DPO 이름": o.dpo.name, "DPO 주소": o.dpo.address, "DPO 연락처": o.dpo.contact,
  "민감정보 공개 위치": p.sensitiveDisclosure.locations, "민감정보 공개 제한 방법": p.sensitiveDisclosure.optOut, "국외이전 거부 방법": p.overseasTransfer.refusal, "국외이전 거부 시 영향": p.overseasTransfer.effect,
  "기기 내부 처리 기능": p.deviceProcessing.functions, "기기 내부 처리 항목": p.deviceProcessing.items.join("\n"), "전자상거래 관련 보존 항목": p.preservation.commerceItems.join("\n"), "접속 관련 보존 항목": p.preservation.accessItems.join("\n"),
};
for (let k = 0; k < i.subprocessors.length; k++) {
  const row = i.subprocessors[k], prefix = `IT 인프라 수탁자 1 재수탁자 ${k + 1} `;
  values[prefix + "입력 방법"] = row.mode;
  if (row.mode === "direct") { values[prefix + "이름"] = row.name; values[prefix + "연락처"] = row.contact; values[prefix + "위탁 업무"] = row.work; }
  else { values[prefix + "링크 문구"] = row.linkText; values[prefix + "링크 주소 (HTTPS)"] = row.linkUrl; }
  values[prefix + "국가·지역"] = row.country;
}
values["아동 보유기간 2 기준"] = "관련법령에 따른 기간";
const directory = "docs/qa/R10-T04/structured-policy"; await mkdir(directory, { recursive: true });
await writeFile(directory + "/input-fields.json", JSON.stringify(values, null, 2) + "\n");
await writeFile(directory + "/expected-policy.json", JSON.stringify(p, null, 2) + "\n");
console.log({ fields: Object.keys(values).length });
