"use client";
import type { ReactNode } from "react";
import { emptyPolicyDetails, emptyPolicyTrustee, emptyPolicySubprocessor, type PolicyDetails, type PolicyTrustee, type PolicyItemOptions } from "@/contracts/document-policy";
import { policyItemKey } from "@/contracts/policy-item-options";
import regionCodes from "@/data/region-codes.json";
import { ActionButton } from "../shared";
import { useConfirm } from "../ux/confirm";

function Text({ label, value, set, limit = 3000, multiline = false }: { label: string; value: string; set: (value: string) => void; limit?: number; multiline?: boolean }) {
  return <label>{label}{multiline ? <textarea className="cs-input" maxLength={limit} value={value} onChange={e => set(e.target.value)} /> : <input className="cs-input" maxLength={limit} value={value} onChange={e => set(e.target.value)} />}</label>;
}
function Items({ label, value, set }: { label: string; value: string[]; set: (value: string[]) => void }) {
  return <label>{label}<small>한 줄에 한 항목씩 입력해주세요. 최대 100개, 항목당 200자입니다.</small><textarea className="cs-input" value={value.join("\n")} onChange={e => set(e.target.value.split("\n"))} /></label>;
}
function TrusteeItems({ label, value, set, choices }: { label: string; value: string[]; set: (value: string[]) => void; choices?: string[] }) {
  const selected = new Set(value.filter(Boolean).map(policyItemKey));
  return <div className="policy-item-picker"><Items label={label} value={value} set={set} />
    <label>{label} · 서비스 항목 추가<select className="cs-input" value="" disabled={!choices?.length || selected.size >= 100}
      onChange={event => { if (event.target.value && !selected.has(policyItemKey(event.target.value))) set([...value.filter(Boolean), event.target.value]); }}>
      <option value="">추가할 항목 선택</option>{choices?.map(name => <option key={policyItemKey(name)} value={name} disabled={selected.has(policyItemKey(name))}>{name}</option>)}
    </select></label>
  </div>;
}
function Choice<T extends string>({ label, value, options, set }: { label: string; value: T; options: readonly (readonly [T, string])[]; set: (value: T) => void }) {
  return <label>{label}<select className="cs-input" value={value} onChange={e => set(e.target.value as T)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}
function Flag({ label, value, set }: { label: string; value: boolean | null; set: (value: boolean | null) => void }) {
  return <Choice label={label} value={value === null ? "" : String(value)} options={[["", "미작성"], ["true", "예"], ["false", "아니요"]]} set={value => set(value === "" ? null : value === "true")} />;
}
function Country({ label, value, set }: { label: string; value: string; set: (value: string) => void }) {
  return <Choice label={label} value={value} set={set} options={[["", "국가·지역 선택"], ...regionCodes.map(code => [code, new Intl.DisplayNames(["ko"], { type: "region" }).of(code) + ` (${code})`] as const)]} />;
}
function Repeat<T>({ label, value, set, create, children, max = 30, unavailable = false }: { label: string; value: T[]; set: (value: T[]) => void; create: () => NoInfer<T>; children: (row: T, set: (row: T) => void, index: number) => ReactNode; max?: number; unavailable?: boolean }) {
  return <div className="policy-repeat">{value.map((row, index) => <fieldset className="policy-row" key={index}><legend>{label} {index + 1}</legend>{children(row, next => set(value.map((current, i) => i === index ? next : current)), index)}<ActionButton type="button" secondary onClick={() => set(value.filter((_, i) => i !== index))}>{label} {index + 1} 삭제</ActionButton></fieldset>)}
    <ActionButton type="button" secondary disabled={unavailable || value.length >= max} onClick={() => set([...value, create()])}>{label} 추가</ActionButton></div>;
}
const unitOptions = [["", "단위 선택"], ["DAY", "일"], ["MONTH", "개월"], ["YEAR", "년"]] as const;
type Party = PolicyTrustee["subprocessors"][number];
function PartyFields({ value, set, label }: { value: Party; set: (value: Party) => void; label: string }) {
  const patch = (change: Partial<Party>) => set({ ...value, ...change });
  return <>
    <Choice label={label + " 입력 방법"} value={value.mode} options={[["direct", "직접 입력"], ["link", "목록 링크"]]} set={mode => patch({ mode })} />
    {value.mode === "link" ? <><Text label={label + " 링크 문구"} value={value.linkText} limit={200} set={linkText => patch({ linkText })} /><Text label={label + " 링크 주소 (HTTPS)"} value={value.linkUrl} limit={2000} set={linkUrl => patch({ linkUrl })} /></> : <><Text label={label + " 이름"} value={value.name} limit={200} set={name => patch({ name })} /><Text label={label + " 연락처"} value={value.contact} set={contact => patch({ contact })} /><Text label={label + " 위탁 업무"} value={value.work} multiline set={work => patch({ work })} /></>}
    <Country label={label + " 국가·지역"} value={value.country} set={country => patch({ country })} />
  </>;
}
function Trustees({ label, value, set, options }: { label: string; value: PolicyTrustee[]; set: (value: PolicyTrustee[]) => void; options?: PolicyItemOptions }) {
  return <><p>새 수탁자·재수탁자에는 이 서비스에서 사용 중인 모든 수집 목적의 필수·선택 항목이 입력됩니다. 기존 입력은 유지되며 항목을 추가하거나 삭제할 수 있습니다.</p>
    {!options && <p role="status">서비스 항목을 불러온 후 수탁자·재수탁자를 추가할 수 있습니다. 불러오기 실패 시 아래에서 다시 시도해주세요.</p>}
    {options && (options.requiredItems.length > 100 || options.optionalItems.length > 100) && <p role="status">서비스 항목이 100개를 넘는 구분은 자동 입력하지 않습니다. 필수·선택 각각 최대 100개를 직접 선택해주세요.</p>}
    <Repeat label={label} value={value} set={set} unavailable={!options} create={() => emptyPolicyTrustee(options)}>{(row, setRow, i) => {
    const patch = (change: Partial<PolicyTrustee>) => setRow({ ...row, ...change }), prefix = label + " " + (i + 1);
    return <><PartyFields label={prefix} value={row} set={change => patch(change)} /><TrusteeItems label={prefix + " 필수 위탁 항목"} value={row.requiredItems} choices={options?.requiredItems} set={requiredItems => patch({ requiredItems })} /><TrusteeItems label={prefix + " 선택 위탁 항목"} value={row.optionalItems} choices={options?.optionalItems} set={optionalItems => patch({ optionalItems })} /><Text label={prefix + " 처리 근거"} value={row.legalBasis} set={legalBasis => patch({ legalBasis })} />
      <Repeat label={prefix + " 재수탁자"} value={row.subprocessors} set={subprocessors => patch({ subprocessors })} unavailable={!options} create={() => emptyPolicySubprocessor(options)}>{(child, setChild, index) => {
        const childLabel = prefix + " 재수탁자 " + (index + 1);
        return <><PartyFields label={childLabel} value={child} set={setChild} />{child.mode === "direct" && <>
          <TrusteeItems label={childLabel + " 필수 위탁 항목"} value={child.requiredItems ?? []} choices={options?.requiredItems} set={requiredItems => setChild({ ...child, requiredItems })} />
          <TrusteeItems label={childLabel + " 선택 위탁 항목"} value={child.optionalItems ?? []} choices={options?.optionalItems} set={optionalItems => setChild({ ...child, optionalItems })} />
          <Text label={childLabel + " 처리 근거"} value={child.legalBasis ?? ""} set={legalBasis => setChild({ ...child, legalBasis })} />
        </>}</>;
      }}</Repeat></>;
  }}</Repeat></>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <details className="policy-section"><summary>{title}</summary><div>{children}</div></details>; }

export function PolicyDetailsEditor({ value, set, itemOptions }: { value: PolicyDetails | null | undefined; set: (value: PolicyDetails | null) => void; itemOptions?: PolicyItemOptions }) {
  const ask = useConfirm();
  if (!value) return <div className="policy-editor"><h2>처리방침 세부 항목</h2><p>아동, 위탁, 영상정보, 권리행사 담당자 등의 정보를 항목별로 작성할 수 있습니다.</p><ActionButton type="button" secondary onClick={() => set(emptyPolicyDetails())}>세부 항목 작성</ActionButton></div>;
  const empty = emptyPolicyDetails();
  const patch = <K extends keyof PolicyDetails>(key: K, change: Partial<PolicyDetails[K]>) => set({ ...value, [key]: { ...value[key] as object, ...change } });
  const p = value.children, h = value.hosting, d = value.development, n = value.inactiveUsers, w = value.withdrawals, c = value.cctv, a = value.automatedDecisions, o = value.officers;
  return <div className="policy-editor"><h2>처리방침 세부 항목</h2><p>해당 구역을 펼쳐 작성해주세요. ‘아니요’로 변경하면 해당 구역의 세부 입력이 초기화됩니다. 변경 내용은 초안 저장 후 반영됩니다.</p>
    <Section title="아동·법정대리인 정보"><Flag label="만 14세 미만 아동 정보 수집" value={p.enabled} set={enabled => patch("children", { ...(enabled === false ? empty.children : {}), enabled })} />
      {p.enabled && <><Text label="아동 정보 처리 목적" value={p.purpose} multiline set={purpose => patch("children", { purpose })} /><Items label="아동 필수 수집 항목" value={p.requiredItems} set={requiredItems => patch("children", { requiredItems })} /><Items label="아동 선택 수집 항목" value={p.optionalItems} set={optionalItems => patch("children", { optionalItems })} /><Items label="법정대리인 확인 항목" value={p.guardianItems} set={guardianItems => patch("children", { guardianItems })} />
        <Repeat label="아동 보유기간" value={p.periods} max={3} set={periods => patch("children", { periods })} create={() => ({ prefix: "수집일부터", amount: "", unit: "" as const, condition: "" as const, customPrefix: "" })}>{(row, setRow, i) => <>
          <Text label={`아동 보유기간 ${i + 1} 기준`} value={row.prefix} limit={200} set={prefix => setRow({ ...row, prefix })} /><small>예: 수집일부터, 관련법령에 따른 기간, 직접입력</small>
          {row.prefix === "직접입력" && <Text label={`아동 보유기간 ${i + 1} 직접입력 기준`} value={row.customPrefix} limit={200} set={customPrefix => setRow({ ...row, customPrefix })} />}
          {row.prefix !== "관련법령에 따른 기간" && <><Text label={`아동 보유기간 ${i + 1} 기간`} value={row.amount} limit={200} set={amount => setRow({ ...row, amount })} /><Choice label={`아동 보유기간 ${i + 1} 단위`} value={row.unit} options={[["", "단위 선택"], ["일", "일"], ["개월", "개월"], ["년", "년"]]} set={unit => setRow({ ...row, unit })} /></>}
          <Choice label={`아동 보유기간 ${i + 1} 연결 조건`} value={row.condition} options={[["", "없음"], ["또는", "또는"], ["해당없음", "해당없음"]]} set={condition => setRow({ ...row, condition })} /></>}</Repeat></>}
    </Section>
    <Section title="IT 인프라·개발 위탁"><Choice label="IT 인프라 운영 방식" value={h.mode} options={[["unanswered", "미작성"], ["outsourced", "클라우드 서비스·IDC 이용"], ["internal", "자체 구축·관리 (국내)"]]} set={mode => patch("hosting", { mode, ...(mode === "internal" ? { trustees: [] } : {}) })} />
      {h.mode === "outsourced" && <Trustees label="IT 인프라 수탁자" value={h.trustees} options={itemOptions} set={trustees => patch("hosting", { trustees })} />}
      <Flag label="개발·유지보수 위탁" value={d.enabled} set={enabled => patch("development", { ...(enabled === false ? empty.development : {}), enabled })} />
      {d.enabled && <Trustees label="개발·유지보수 수탁자" value={d.trustees} options={itemOptions} set={trustees => patch("development", { trustees })} />}
    </Section>
    <Section title="미사용·탈퇴 회원 정보"><Choice label="장기 미사용자 처리 방법" value={n.action} options={[["unanswered", "미작성"], ["separate", "분리 보관"], ["withdraw", "회원탈퇴 처리"], ["custom", "별도 내부 정책"]]} set={action => patch("inactiveUsers", { ...empty.inactiveUsers, action })} />
      {n.action === "separate" && <><Text label="분리 시점부터 보관 기간" value={n.amount} limit={200} set={amount => patch("inactiveUsers", { amount })} /><Choice label="미사용자 보관 단위" value={n.unit} options={unitOptions} set={unit => patch("inactiveUsers", { unit })} /></>}
      {n.action === "custom" && <Text label="미사용자 내부 정책" multiline value={n.customText} set={customText => patch("inactiveUsers", { customText })} />}
      <Choice label="회원탈퇴 후 처리" value={w.action} options={[["unanswered", "미작성"], ["delete", "개인정보 삭제"], ["retain", "일부 정보 보관"]]} set={action => patch("withdrawals", { ...empty.withdrawals, action })} />
      {w.action === "retain" && <><Text label="탈퇴 후 보관 기간" value={w.amount} limit={200} set={amount => patch("withdrawals", { amount })} /><Choice label="탈퇴 후 보관 단위" value={w.unit} options={unitOptions} set={unit => patch("withdrawals", { unit })} /><Items label="탈퇴 후 보관 항목" value={w.items} set={items => patch("withdrawals", { items })} /></>}
    </Section>
    <Section title="영상정보처리기기 (CCTV)"><Flag label="CCTV 운영" value={c.enabled} set={enabled => patch("cctv", { ...(enabled === false ? empty.cctv : {}), enabled })} />
      {c.enabled && <><Items label="CCTV 설치 목적" value={c.purposes} set={purposes => patch("cctv", { purposes })} /><Text label="CCTV 기타 설치 목적" value={c.customPurpose} set={customPurpose => patch("cctv", { customPurpose })} />
        <Repeat label="CCTV 설치" value={c.installations} set={installations => patch("cctv", { installations })} create={() => ({ location: "", count: "", operatingHours: "", storagePeriod: "", storageUnit: "DAY" as const, storageLocation: "", outsourced: null, trustee: { name: "", country: "", contact: "" } })}>{(row, setRow, i) => <>
          {([["location", "설치 위치·촬영 범위"], ["count", "설치 대수"], ["operatingHours", "촬영 시간"], ["storagePeriod", "보관 기간"], ["storageLocation", "보관 장소"]] as const).map(([key, label]) => <Text key={key} label={`CCTV ${i + 1} ${label}`} value={row[key]} limit={70} set={text => setRow({ ...row, [key]: text })} />)}
          <Choice label={`CCTV ${i + 1} 보관 단위`} value={row.storageUnit} options={unitOptions} set={storageUnit => setRow({ ...row, storageUnit })} />
          <Flag label={`CCTV ${i + 1} 관리 위탁`} value={row.outsourced} set={outsourced => setRow({ ...row, outsourced, ...(outsourced === false ? { trustee: { name: "", country: "", contact: "" } } : {}) })} />
          {row.outsourced && <><Text label={`CCTV ${i + 1} 수탁자 이름`} value={row.trustee.name} limit={200} set={name => setRow({ ...row, trustee: { ...row.trustee, name } })} /><Country label={`CCTV ${i + 1} 수탁자 국가·지역`} value={row.trustee.country} set={country => setRow({ ...row, trustee: { ...row.trustee, country } })} /><Text label={`CCTV ${i + 1} 수탁자 연락처`} value={row.trustee.contact} set={contact => setRow({ ...row, trustee: { ...row.trustee, contact } })} /></>}</>}</Repeat>
        <Repeat label="CCTV 담당자" value={c.managers} set={managers => patch("cctv", { managers })} create={() => ({ role: "IN_CHARGE" as const, department: "", nameAndPosition: "" })}>{(row, setRow, i) => <><Choice label={`CCTV 담당자 ${i + 1} 역할`} value={row.role} options={[["IN_CHARGE", "관리책임자"], ["HANDS_ON", "접근 담당자"]]} set={role => setRow({ ...row, role })} /><Text label={`CCTV 담당자 ${i + 1} 부서`} value={row.department} limit={200} set={department => setRow({ ...row, department })} /><Text label={`CCTV 담당자 ${i + 1} 이름·직위`} value={row.nameAndPosition} set={nameAndPosition => setRow({ ...row, nameAndPosition })} /></>}</Repeat></>}
    </Section>
    <Section title="자동화된 결정"><Flag label="자동화된 결정 사용" value={a.enabled} set={enabled => patch("automatedDecisions", { ...(enabled === false ? empty.automatedDecisions : {}), enabled })} />
      {a.enabled && <>{([["overview", "결정 개요"], ["processedInformation", "처리 정보"], ["decisionRelation", "정보와 결정의 연관성"], ["procedure", "처리 절차"]] as const).map(([key, label]) => <Text key={key} label={"자동화된 결정 " + label} value={a[key]} multiline set={text => patch("automatedDecisions", { [key]: text })} />)}
        <Flag label="자동화된 결정의 민감·아동 정보 처리" value={a.specialInformation} set={specialInformation => patch("automatedDecisions", { specialInformation, ...(specialInformation === false ? { sensitive: empty.automatedDecisions.sensitive, children: empty.automatedDecisions.children } : {}) })} />
        {a.specialInformation && ([["sensitive", "민감정보"], ["children", "아동 정보"]] as const).map(([key, label]) => <div key={key}><label className="policy-check"><input type="checkbox" checked={a[key].selected} onChange={e => patch("automatedDecisions", { [key]: e.target.checked ? { ...a[key], selected: true } : { selected: false, purpose: "", items: [] } })} />{label} 처리</label>{a[key].selected && <><Text label={"자동화 " + label + " 목적"} multiline value={a[key].purpose} set={purpose => patch("automatedDecisions", { [key]: { ...a[key], purpose } })} /><Items label={"자동화 " + label + " 항목"} value={a[key].items} set={items => patch("automatedDecisions", { [key]: { ...a[key], items } })} /></>}</div>)}
        <Repeat label="자동화 결정 요청 창구" value={a.contacts} set={contacts => patch("automatedDecisions", { contacts })} create={() => ({ department: "", contact: "" })}>{(row, setRow, i) => <><Text label={`자동화 결정 창구 ${i + 1} 부서`} value={row.department} limit={200} set={department => setRow({ ...row, department })} /><Text label={`자동화 결정 창구 ${i + 1} 연락처`} value={row.contact} set={contact => setRow({ ...row, contact })} /></>}</Repeat></>}
    </Section>
    <Section title="책임자·권리행사·대리인"><Text label="개인정보 보호책임자 이름" value={o.name} limit={200} set={name => patch("officers", { name })} /><Text label="개인정보 보호책임자 직책" value={o.position} limit={200} set={position => patch("officers", { position })} /><Text label="개인정보 보호책임자 이메일" value={o.email} limit={254} set={email => patch("officers", { email })} />
      <Flag label="별도 권리행사 담당 부서" value={o.departmentEnabled} set={departmentEnabled => patch("officers", { departmentEnabled, ...(departmentEnabled === false ? { department: empty.officers.department } : {}) })} />
      {o.departmentEnabled && ([["name", "부서 이름"], ["contact", "연락처"], ["officerName", "담당자 이름"]] as const).map(([key, label]) => <Text key={key} label={"권리행사 " + label} value={o.department[key]} limit={key === "contact" ? 3000 : 200} set={text => patch("officers", { department: { ...o.department, [key]: text } })} />)}
      <Text label="정보 조회·수정 방법" value={o.updatePath} multiline set={updatePath => patch("officers", { updatePath })} /><Text label="동의 철회·삭제 방법" value={o.deletePath} multiline set={deletePath => patch("officers", { deletePath })} />
      <Flag label="국내대리인 지정" value={o.domesticAgentEnabled} set={domesticAgentEnabled => patch("officers", { domesticAgentEnabled, ...(domesticAgentEnabled === false ? { domesticAgents: [] } : {}) })} />
      {o.domesticAgentEnabled && <Repeat label="국내대리인" value={o.domesticAgents} set={domesticAgents => patch("officers", { domesticAgents })} create={() => ({ name: "", representative: "", email: "", contact: "", address: "" })}>{(row, setRow, i) => <>{([["name", "이름"], ["representative", "대표자"], ["email", "이메일"], ["contact", "연락처"], ["address", "주소"]] as const).map(([key, label]) => <Text key={key} label={`국내대리인 ${i + 1} ${label}`} value={row[key]} limit={key === "name" || key === "representative" ? 200 : key === "email" ? 254 : 3000} set={text => setRow({ ...row, [key]: text })} />)}</>}</Repeat>}
      <Flag label="DPO 지정" value={o.dpoEnabled} set={dpoEnabled => patch("officers", { dpoEnabled, ...(dpoEnabled === false ? { dpo: empty.officers.dpo } : {}) })} />
      {o.dpoEnabled && ([["name", "이름"], ["address", "주소"], ["contact", "연락처"]] as const).map(([key, label]) => <Text key={key} label={"DPO " + label} value={o.dpo[key]} limit={key === "name" ? 200 : 3000} set={text => patch("officers", { dpo: { ...o.dpo, [key]: text } })} />)}
    </Section>
    <Section title="민감정보·국외이전"><Flag label="민감정보 공개" value={value.sensitiveDisclosure.enabled} set={enabled => patch("sensitiveDisclosure", { ...(enabled === false ? empty.sensitiveDisclosure : {}), enabled })} />
      {value.sensitiveDisclosure.enabled && <><Text label="민감정보 공개 위치" value={value.sensitiveDisclosure.locations} multiline set={locations => patch("sensitiveDisclosure", { locations })} /><Text label="민감정보 공개 제한 방법" value={value.sensitiveDisclosure.optOut} multiline set={optOut => patch("sensitiveDisclosure", { optOut })} /></>}
      <Flag label="개인정보 국외이전" value={value.overseasTransfer.enabled} set={enabled => patch("overseasTransfer", { ...(enabled === false ? empty.overseasTransfer : {}), enabled })} />
      {value.overseasTransfer.enabled && <><Text label="국외이전 거부 방법" value={value.overseasTransfer.refusal} multiline set={refusal => patch("overseasTransfer", { refusal })} /><Text label="국외이전 거부 시 영향" value={value.overseasTransfer.effect} multiline set={effect => patch("overseasTransfer", { effect })} /></>}
    </Section>
    <Section title="기기 내부 처리·광고·보존 항목"><Flag label="기기 내부 개인정보 처리" value={value.deviceProcessing.enabled} set={enabled => patch("deviceProcessing", { ...(enabled === false ? empty.deviceProcessing : {}), enabled })} />
      {value.deviceProcessing.enabled && <><Text label="기기 내부 처리 기능" value={value.deviceProcessing.functions} multiline set={functions => patch("deviceProcessing", { functions })} /><Items label="기기 내부 처리 항목" value={value.deviceProcessing.items} set={items => patch("deviceProcessing", { items })} /></>}
      <Flag label="행태정보 기반 맞춤형 광고" value={value.behavioralAdvertising.enabled} set={enabled => patch("behavioralAdvertising", { enabled })} />
      <Items label="전자상거래 관련 보존 항목" value={value.preservation.commerceItems} set={commerceItems => patch("preservation", { commerceItems })} /><Items label="접속 관련 보존 항목" value={value.preservation.accessItems} set={accessItems => patch("preservation", { accessItems })} />
    </Section>
    <ActionButton type="button" secondary onClick={async () => { if (await ask({ title: "세부 항목 제거", message: "초안에서 처리방침 세부 항목을 모두 제거할까요? 게시된 버전은 보존됩니다.", confirmLabel: "초안에서 제거", cancelLabel: "유지" })) set(null); }}>초안의 세부 항목 제거</ActionButton>
  </div>;
}
