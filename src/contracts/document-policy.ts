import { z } from "zod";
import regionCodes from "@/data/region-codes.json";

const text = z.string().trim().max(3000);
const short = z.string().trim().max(200);
const observedCctvText = z.string().trim().max(70);
const enabled = z.boolean().nullable();
const items = z.array(short).max(101).overwrite(values => values.filter(Boolean)).refine(values => values.length <= 100, "항목은 100개 이내로 입력해주세요.")
  .refine(values => new Set(values.map(value => value.normalize("NFKC").toLocaleLowerCase("ko-KR"))).size === values.length, "중복된 항목을 제거해주세요.");
const country = z.string().refine(value => value === "" || regionCodes.includes(value), "올바른 국가·지역을 선택해주세요.");
const email = z.union([z.literal(""), z.email().max(254)]);
const url = z.string().trim().max(2000).refine(value => {
  if (!value) return true;
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/[\u0000-\u0020\u007f]/.test(value); } catch { return false; }
}, "사용자 정보가 없는 HTTPS 주소를 입력해주세요.");
const unit = z.enum(["", "DAY", "MONTH", "YEAR"]);
const contact = z.object({ department: short, contact: text }).strict();
const special = z.object({ selected: z.boolean(), purpose: text, items }).strict();
const agent = z.object({ name: short, representative: short, email, contact: text, address: text }).strict();
const party = z.object({ name: short, country, contact: text }).strict();
const subprocessor = z.object({ mode: z.enum(["direct", "link"]), name: short, country, contact: text, work: text,
  linkText: short, linkUrl: url,
  // Omission preserves previously saved drafts and their canonical publication hashes.
  requiredItems: items.optional(), optionalItems: items.optional(), legalBasis: text.optional(),
}).strict();
const trustee = subprocessor.extend({ requiredItems: items, optionalItems: items, legalBasis: text, subprocessors: z.array(subprocessor).max(30) });
const period = z.object({ prefix: short, amount: short, unit: z.enum(["", "일", "개월", "년"]),
  condition: z.enum(["", "또는", "해당없음"]), customPrefix: short }).strict();

// These are independent product DTO names mapped to the observed client state.
// Limits not observed in the source are resource limits, not legal retention rules.
export const policyDetailsInput = z.object({
  schemaVersion: z.literal(1),
  children: z.object({ enabled, purpose: text, requiredItems: items, optionalItems: items, guardianItems: items, periods: z.array(period).max(3) }).strict(),
  hosting: z.object({ mode: z.enum(["unanswered", "outsourced", "internal"]), trustees: z.array(trustee).max(30) }).strict(),
  development: z.object({ enabled, trustees: z.array(trustee).max(30) }).strict(),
  inactiveUsers: z.object({ action: z.enum(["unanswered", "separate", "withdraw", "custom"]), amount: short, unit, customText: text }).strict(),
  withdrawals: z.object({ action: z.enum(["unanswered", "delete", "retain"]), amount: short, unit, items }).strict(),
  cctv: z.object({ enabled, purposes: items, customPurpose: text, installations: z.array(z.object({
    location: observedCctvText, count: observedCctvText, operatingHours: observedCctvText,
    storagePeriod: observedCctvText, storageUnit: unit, storageLocation: observedCctvText,
    outsourced: enabled, trustee: party,
  }).strict()).max(30), managers: z.array(z.object({ department: short, nameAndPosition: text, role: z.enum(["IN_CHARGE", "HANDS_ON"]) }).strict()).max(30) }).strict(),
  automatedDecisions: z.object({ enabled, overview: text, processedInformation: text, decisionRelation: text, procedure: text,
    specialInformation: enabled, sensitive: special, children: special, contacts: z.array(contact).max(30) }).strict(),
  officers: z.object({ name: short, position: short, email, departmentEnabled: enabled,
    department: z.object({ name: short, contact: text, officerName: short }).strict(),
    updatePath: text, deletePath: text, domesticAgentEnabled: enabled, domesticAgents: z.array(agent).max(30),
    dpoEnabled: enabled, dpo: z.object({ name: short, address: text, contact: text }).strict(),
  }).strict(),
  sensitiveDisclosure: z.object({ enabled, locations: text, optOut: text }).strict(),
  overseasTransfer: z.object({ enabled, refusal: text, effect: text }).strict(),
  deviceProcessing: z.object({ enabled, functions: text, items }).strict(),
  behavioralAdvertising: z.object({ enabled }).strict(),
  preservation: z.object({ commerceItems: items, accessItems: items }).strict(),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 131072, "구조화 처리방침은 128KiB 이내로 작성해주세요.");
export type PolicyDetails = z.infer<typeof policyDetailsInput>;
export type PolicyTrustee = z.infer<typeof trustee>;
export type PolicyItemOptions = { requiredItems: string[]; optionalItems: string[] };

export function emptyPolicySubprocessor(options?: PolicyItemOptions): PolicyTrustee["subprocessors"][number] {
  // More than 100 choices require an explicit selection; never silently truncate.
  return { mode: "direct", name: "", country: "", contact: "", work: "", linkText: "", linkUrl: "",
    requiredItems: options && options.requiredItems.length <= 100 ? [...options.requiredItems] : [],
    optionalItems: options && options.optionalItems.length <= 100 ? [...options.optionalItems] : [], legalBasis: "" };
}
export function emptyPolicyTrustee(options?: PolicyItemOptions): PolicyTrustee {
  const child = emptyPolicySubprocessor(options);
  return { ...child, requiredItems: child.requiredItems!, optionalItems: child.optionalItems!, legalBasis: "", subprocessors: [] };
}
export function emptyPolicyDetails(): PolicyDetails {
  return {
    schemaVersion: 1,
    children: { enabled: null, purpose: "", requiredItems: [], optionalItems: [], guardianItems: [], periods: [] },
    hosting: { mode: "unanswered", trustees: [] }, development: { enabled: null, trustees: [] },
    inactiveUsers: { action: "unanswered", amount: "", unit: "", customText: "" }, withdrawals: { action: "unanswered", amount: "", unit: "", items: [] },
    cctv: { enabled: null, purposes: [], customPurpose: "", installations: [], managers: [] },
    automatedDecisions: { enabled: null, overview: "", processedInformation: "", decisionRelation: "", procedure: "", specialInformation: null,
      sensitive: { selected: false, purpose: "", items: [] }, children: { selected: false, purpose: "", items: [] }, contacts: [] },
    officers: { name: "", position: "", email: "", departmentEnabled: null, department: { name: "", contact: "", officerName: "" },
      updatePath: "", deletePath: "", domesticAgentEnabled: null, domesticAgents: [], dpoEnabled: null, dpo: { name: "", address: "", contact: "" } },
    sensitiveDisclosure: { enabled: null, locations: "", optOut: "" }, overseasTransfer: { enabled: null, refusal: "", effect: "" },
    deviceProcessing: { enabled: null, functions: "", items: [] }, behavioralAdvertising: { enabled: null },
    preservation: { commerceItems: [], accessItems: [] },
  };
}

export function policyPublishErrors(value: PolicyDetails): string[] {
  const errors: string[] = [];
  const need = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  const { children, hosting, development, inactiveUsers, withdrawals, cctv, automatedDecisions: decisions, officers } = value;
  if (children.enabled) {
    need(children.purpose, "아동 정보의 처리 목적을 입력해주세요.");
    need(children.requiredItems.length + children.optionalItems.length, "아동 정보의 수집 항목을 입력해주세요.");
    need(children.guardianItems.length, "법정대리인 확인 항목을 입력해주세요.");
    need(children.periods.length, "아동 정보의 보유기간을 입력해주세요.");
    children.periods.forEach((period, index) => {
      need(period.prefix && (period.prefix !== "직접입력" || period.customPrefix), `아동 보유기간 ${index + 1}의 기준을 입력해주세요.`);
      if (period.prefix !== "관련법령에 따른 기간") need(period.amount && (["즉시", "해당없음"].includes(period.amount) || period.unit), `아동 보유기간 ${index + 1}의 기간·단위를 입력해주세요.`);
    });
  }
  const verifyTrustees = (rows: PolicyTrustee[], label: string) => {
    need(rows.length, label + " 수탁자를 입력해주세요.");
    rows.forEach((row, index) => {
      const title = `${label} 수탁자 ${index + 1}`;
      if (row.mode === "link") need(row.linkText && row.linkUrl, title + "의 링크 문구·주소를 입력해주세요.");
      else need(row.name && row.country && row.contact && row.work && row.requiredItems.length + row.optionalItems.length, title + "의 이름·국가·연락처·업무·항목을 입력해주세요.");
      row.subprocessors.forEach((child, position) => {
        need(child.mode === "link" ? child.linkText && child.linkUrl && child.country : child.name && child.country && child.contact && child.work,
          `${title}의 재수탁자 ${position + 1} 정보를 완성해주세요.`);
        // Legacy rows without these fields remain publishable; explicit new rows require items.
        if (child.mode === "direct" && (child.requiredItems !== undefined || child.optionalItems !== undefined || child.legalBasis !== undefined))
          need((child.requiredItems?.length ?? 0) + (child.optionalItems?.length ?? 0), `${title}의 재수탁자 ${position + 1} 위탁 항목을 입력해주세요.`);
      });
    });
  };
  if (hosting.mode === "outsourced") verifyTrustees(hosting.trustees, "IT 인프라");
  if (development.enabled) verifyTrustees(development.trustees, "개발·유지보수");
  if (inactiveUsers.action === "separate") need(inactiveUsers.amount && inactiveUsers.unit, "미사용자 분리 보관 기간·단위를 입력해주세요.");
  if (inactiveUsers.action === "custom") need(inactiveUsers.customText, "미사용자 처리 방법을 입력해주세요.");
  if (withdrawals.action === "retain") need(withdrawals.amount && withdrawals.unit && withdrawals.items.length, "탈퇴 후 보관 기간·단위·항목을 입력해주세요.");
  if (cctv.enabled) {
    need(cctv.purposes.length || cctv.customPurpose, "CCTV 설치 목적을 입력해주세요.");
    need(cctv.installations.length, "CCTV 설치 정보를 입력해주세요.");
    cctv.installations.forEach((row, index) => {
      need(row.location && row.count && row.operatingHours && row.storagePeriod && row.storageLocation && row.outsourced !== null, `CCTV ${index + 1}의 설치·촬영·보관·위탁 여부를 완성해주세요.`);
      if (row.outsourced) need(row.trustee.name && row.trustee.country && row.trustee.contact, `CCTV ${index + 1} 수탁자 정보를 입력해주세요.`);
    });
    for (const role of ["IN_CHARGE", "HANDS_ON"]) need(cctv.managers.some(row => row.role === role && row.department && row.nameAndPosition), role === "IN_CHARGE" ? "CCTV 관리책임자 정보를 입력해주세요." : "CCTV 접근 담당자 정보를 입력해주세요.");
    need(cctv.managers.every(row => row.department && row.nameAndPosition), "CCTV 담당자의 부서·이름·직위를 완성해주세요.");
  }
  if (decisions.enabled) {
    need(decisions.overview && decisions.processedInformation && decisions.decisionRelation && decisions.procedure, "자동화된 결정의 개요·정보·연관성·절차를 입력해주세요.");
    need(decisions.specialInformation !== null, "자동화된 결정의 민감·아동 정보 처리 여부를 선택해주세요.");
    need(decisions.contacts.length && decisions.contacts.every(row => row.department && row.contact), "자동화된 결정의 요청 부서·연락처를 입력해주세요.");
    if (decisions.specialInformation) {
      need(decisions.sensitive.selected || decisions.children.selected, "자동화된 결정에서 처리하는 특별 정보 유형을 선택해주세요.");
      for (const row of [decisions.sensitive, decisions.children]) if (row.selected) need(row.purpose && row.items.length, "자동화된 결정의 특별 정보 목적·항목을 입력해주세요.");
    }
  }
  if (officers.name || officers.position || officers.email) need(officers.name && officers.position && officers.email, "개인정보 보호책임자의 이름·직책·이메일을 입력해주세요.");
  if (officers.departmentEnabled) need(officers.department.name && officers.department.contact && officers.department.officerName, "권리행사 부서·연락처·담당자를 입력해주세요.");
  if (officers.domesticAgentEnabled) need(officers.domesticAgents.length && officers.domesticAgents.every(row => row.name && row.representative && row.email && row.contact && row.address), "국내대리인의 이름·대표자·이메일·연락처·주소를 입력해주세요.");
  if (officers.dpoEnabled) need(officers.dpo.name && officers.dpo.address && officers.dpo.contact, "DPO 이름·주소·연락처를 입력해주세요.");
  if (value.sensitiveDisclosure.enabled) need(value.sensitiveDisclosure.locations && value.sensitiveDisclosure.optOut, "민감정보 공개 위치와 공개 제한 방법을 입력해주세요.");
  if (value.overseasTransfer.enabled) need(value.overseasTransfer.refusal && value.overseasTransfer.effect, "국외이전 거부 방법과 영향을 입력해주세요.");
  if (value.deviceProcessing.enabled) need(value.deviceProcessing.functions && value.deviceProcessing.items.length, "기기 내부 처리 기능과 항목을 입력해주세요.");
  return errors;
}
