import { emptyPolicyDetails, type PolicyDetails, type PolicyTrustee } from "@/contracts/document-policy";

// Draft-only fields hidden by a selection must never leak through the public JSON snapshot.
export function publishedPolicyDetails(input: PolicyDetails): PolicyDetails {
  const value = structuredClone(input), empty = emptyPolicyDetails();
  const cleanTrustees = (rows: PolicyTrustee[]) => rows.map(row => {
    const cleanParty = <T extends PolicyTrustee["subprocessors"][number]>(party: T): T => party.mode === "direct"
      ? { ...party, linkText: "", linkUrl: "" } : { ...party, name: "", contact: "", work: "" };
    return { ...cleanParty(row), subprocessors: row.subprocessors.map(child => {
      const clean = cleanParty(child);
      if (child.mode === "link") {
        // Only clear fields actually present; legacy snapshots must retain their shape.
        if (child.requiredItems !== undefined) clean.requiredItems = [];
        if (child.optionalItems !== undefined) clean.optionalItems = [];
        if (child.legalBasis !== undefined) clean.legalBasis = "";
      }
      return clean;
    }) };
  });
  for (const key of ["children", "development", "cctv", "automatedDecisions", "sensitiveDisclosure", "overseasTransfer", "deviceProcessing"] as const) {
    if (value[key].enabled !== true) Object.assign(value[key], empty[key], { enabled: value[key].enabled });
  }
  if (value.hosting.mode !== "outsourced") value.hosting.trustees = [];
  value.hosting.trustees = cleanTrustees(value.hosting.trustees); value.development.trustees = cleanTrustees(value.development.trustees);
  if (value.inactiveUsers.action !== "separate") Object.assign(value.inactiveUsers, { amount: "", unit: "" });
  if (value.inactiveUsers.action !== "custom") value.inactiveUsers.customText = "";
  if (value.withdrawals.action !== "retain") Object.assign(value.withdrawals, { amount: "", unit: "", items: [] });
  for (const period of value.children.periods) {
    if (period.prefix !== "직접입력") period.customPrefix = "";
    if (period.prefix === "관련법령에 따른 기간") Object.assign(period, { amount: "", unit: "" });
    if (["즉시", "해당없음"].includes(period.amount)) period.unit = "";
  }
  for (const row of value.cctv.installations) if (row.outsourced !== true) row.trustee = { name: "", country: "", contact: "" };
  for (const key of ["sensitive", "children"] as const) if (value.automatedDecisions.specialInformation !== true || !value.automatedDecisions[key].selected) value.automatedDecisions[key] = empty.automatedDecisions[key];
  if (value.officers.departmentEnabled !== true) value.officers.department = empty.officers.department;
  if (value.officers.domesticAgentEnabled !== true) value.officers.domesticAgents = [];
  if (value.officers.dpoEnabled !== true) value.officers.dpo = empty.officers.dpo;
  return value;
}

const units = { "": "", DAY: "일", MONTH: "개월", YEAR: "년" };
export function renderPolicyDetails(value: PolicyDetails): string[] {
  const lines: string[] = [];
  const section = (title: string) => lines.push("", title);
  const line = (label: string, value: string | string[]) => {
    const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : value;
    if (text) lines.push(label + ": " + text);
  };
  const party = (row: PolicyTrustee | PolicyTrustee["subprocessors"][number], label: string) => {
    line(label, row.mode === "link" ? row.linkText + " · " + row.linkUrl : row.name);
    line("국가·지역", row.country);
    if (row.mode === "direct") { line("연락처", row.contact); line("위탁 업무", row.work); }
  };
  const trustees = (rows: PolicyTrustee[]) => rows.forEach((row, index) => {
    party(row, `수탁자 ${index + 1}`);
    line("필수 위탁 항목", row.requiredItems); line("선택 위탁 항목", row.optionalItems); line("처리 근거", row.legalBasis);
    row.subprocessors.forEach((child, i) => {
      party(child, `재수탁자 ${i + 1}`);
      if (child.mode === "direct") {
        line("필수 위탁 항목", child.requiredItems ?? []); line("선택 위탁 항목", child.optionalItems ?? []); line("처리 근거", child.legalBasis ?? "");
      }
    });
  });
  const p = value.children;
  if (p.enabled !== null) {
    section("만 14세 미만 아동의 개인정보");
    if (!p.enabled) lines.push("만 14세 미만 아동의 개인정보를 수집하지 않습니다.");
    else {
      line("처리 목적", p.purpose); line("필수 수집 항목", p.requiredItems); line("선택 수집 항목", p.optionalItems); line("법정대리인 확인 항목", p.guardianItems);
      for (const period of p.periods) line("보유기간", [period.prefix === "직접입력" ? period.customPrefix : period.prefix,
        ...(period.prefix === "관련법령에 따른 기간" ? [] : [period.amount, period.unit]), period.condition].filter(Boolean).join(" "));
    }
  }
  if (value.hosting.mode !== "unanswered") {
    section("IT 인프라 운영");
    if (value.hosting.mode === "internal") lines.push("국내에서 자체 구축·관리합니다."); else trustees(value.hosting.trustees);
  }
  if (value.development.enabled !== null) {
    section("개발·유지보수 위탁");
    if (value.development.enabled) trustees(value.development.trustees); else lines.push("개발·유지보수 업무를 위탁하지 않습니다.");
  }
  const inactive = value.inactiveUsers;
  if (inactive.action !== "unanswered") {
    section("장기 미사용자 정보 처리");
    if (inactive.action === "separate") lines.push(`운영 중인 고객정보와 분리하여 보관하고 분리 시점부터 ${inactive.amount}${units[inactive.unit]} 이후 삭제합니다.`);
    else if (inactive.action === "withdraw") lines.push("회원탈퇴 처리합니다.");
    else lines.push(inactive.customText);
  }
  const withdrawal = value.withdrawals;
  if (withdrawal.action !== "unanswered") {
    section("회원탈퇴 후 정보 처리");
    if (withdrawal.action === "delete") lines.push("회원탈퇴 시 개인정보를 삭제합니다.");
    else { line("보관 기간", withdrawal.amount + units[withdrawal.unit]); line("보관 항목", withdrawal.items); }
  }
  const cctv = value.cctv;
  if (cctv.enabled !== null) {
    section("고정형 영상정보처리기기 운영");
    if (!cctv.enabled) lines.push("고정형 영상정보처리기기를 운영하지 않습니다.");
    else {
      line("설치 목적", cctv.purposes); line("기타 설치 목적", cctv.customPurpose);
      cctv.installations.forEach((row, index) => {
        line(`설치 ${index + 1} 위치·촬영 범위`, row.location); line("설치 대수", row.count); line("촬영 시간", row.operatingHours);
        line("보관 기간", row.storagePeriod + units[row.storageUnit]); line("보관 장소", row.storageLocation);
        if (row.outsourced !== null) line("관리 위탁", row.outsourced ? "위탁" : "직접 관리");
        if (row.outsourced) { line("수탁자", row.trustee.name); line("국가·지역", row.trustee.country); line("연락처", row.trustee.contact); }
      });
      for (const manager of cctv.managers) line(manager.role === "IN_CHARGE" ? "관리책임자 부서·이름·직위" : "접근 담당자 부서·이름·직위", [manager.department, manager.nameAndPosition]);
    }
  }
  const decision = value.automatedDecisions;
  if (decision.enabled !== null) {
    section("자동화된 결정");
    if (!decision.enabled) lines.push("자동화된 결정을 하지 않습니다.");
    else {
      line("결정 개요", decision.overview); line("처리 정보", decision.processedInformation); line("정보와 결정의 연관성", decision.decisionRelation); line("처리 절차", decision.procedure);
      if (decision.specialInformation !== null) line("민감·아동 정보 처리", decision.specialInformation ? "처리함" : "처리하지 않음");
      if (decision.specialInformation) for (const [label, row] of [["민감정보", decision.sensitive], ["아동 정보", decision.children]] as const) if (row.selected) {
        line(label + " 처리 목적", row.purpose); line(label + " 항목", row.items);
      }
      for (const row of decision.contacts) line("요청 부서·연락처", [row.department, row.contact]);
    }
  }
  const officer = value.officers;
  if (officer.name || officer.position || officer.email) { section("개인정보 보호책임자"); line("이름", officer.name); line("직책", officer.position); line("이메일", officer.email); }
  if (officer.departmentEnabled) { section("권리행사 담당 부서"); line("부서", officer.department.name); line("연락처", officer.department.contact); line("담당자", officer.department.officerName); }
  if (officer.updatePath || officer.deletePath) { section("정보주체의 권리행사 방법"); line("조회·수정 방법", officer.updatePath); line("동의 철회·삭제 방법", officer.deletePath); }
  if (officer.domesticAgentEnabled) {
    section("국내대리인"); officer.domesticAgents.forEach((row, i) => {
      line(`대리인 ${i + 1}`, row.name); line("대표자", row.representative); line("이메일", row.email); line("연락처", row.contact); line("주소", row.address);
    });
  }
  if (officer.dpoEnabled) { section("개인정보 보호 담당자 (DPO)"); line("이름", officer.dpo.name); line("주소", officer.dpo.address); line("연락처", officer.dpo.contact); }
  if (value.sensitiveDisclosure.enabled !== null) {
    section("민감정보 공개");
    if (value.sensitiveDisclosure.enabled) { line("공개 위치", value.sensitiveDisclosure.locations); line("공개 제한 방법", value.sensitiveDisclosure.optOut); }
    else lines.push("민감정보를 공개하지 않습니다.");
  }
  if (value.overseasTransfer.enabled !== null) {
    section("개인정보 국외이전");
    if (value.overseasTransfer.enabled) { line("거부 방법", value.overseasTransfer.refusal); line("거부 시 영향", value.overseasTransfer.effect); }
    else lines.push("개인정보를 국외로 이전하지 않습니다.");
  }
  if (value.deviceProcessing.enabled !== null) {
    section("기기 내부 개인정보 처리");
    if (value.deviceProcessing.enabled) { line("처리 기능", value.deviceProcessing.functions); line("처리 항목", value.deviceProcessing.items); }
    else lines.push("기기 내부에서 개인정보를 처리하지 않습니다.");
  }
  if (value.behavioralAdvertising.enabled !== null) { section("행태정보 기반 맞춤형 광고"); lines.push(value.behavioralAdvertising.enabled ? "행태정보를 활용한 맞춤형 광고를 제공합니다." : "행태정보를 활용한 맞춤형 광고를 제공하지 않습니다."); }
  if (value.preservation.commerceItems.length || value.preservation.accessItems.length) { section("보존 정보"); line("전자상거래 관련 항목", value.preservation.commerceItems); line("접속 관련 항목", value.preservation.accessItems); }
  return lines;
}
