"use client";
import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import type { LegacyImportResult, LegacySectionPlan } from "@/contracts/migration";
type Sections = Record<string, Record<string, unknown>>;
const KEY_MAP: Record<string, string> = { "mg-profile": "profile", "mg-company": "company" };
const FIELD_LABELS: Record<string, string> = {
  name: "이름", phone: "연락처", department: "부서", jobTitle: "직책", address: "주소",
  businessNo: "사업자등록번호", billingEmail: "세금계산서 이메일", billingContactName: "세금계산서 담당자", billingContactPhone: "담당자 연락처",
};
function collect(): Sections {
  const sections: Sections = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("mg-")) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
      if (key === "mg-profile" && Array.isArray(parsed)) {
        const [, name, department, jobTitle, , , phone] = parsed as string[];
        sections.profile = { ...(name ? { name } : {}), ...(department ? { department } : {}), ...(jobTitle ? { jobTitle } : {}), ...(phone ? { phone } : {}) };
      } else if (key === "mg-company" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, string>;
        sections.company = {
          ...(raw.address ? { address: raw.address } : {}), ...(raw.email ? { billingEmail: raw.email } : {}),
          ...(raw.manager ? { billingContactName: raw.manager } : {}),
        };
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const section = KEY_MAP[key] ?? key;
        sections[section] = { ...(sections[section] ?? {}), ...(parsed as Record<string, unknown>) };
      }
    }
  } catch { /* localStorage 접근이 불가한 환경에서는 수집하지 않는다. */ }
  return sections;
}
function SectionTable({ title, plan }: { title: string; plan?: LegacySectionPlan }) {
  if (!plan) return null;
  return <Panel title={title}>{plan.status === "skipped" ? <p>{plan.skippedReason}</p> :
    <div className="cs-table-wrap"><table className="cs-table"><thead><tr>{["필드", "현재 값", "이관 값", "결과"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
      {plan.changes.map(c => <tr key={c.field}><td>{FIELD_LABELS[c.field] ?? c.field}</td><td>{c.from ?? "-"}</td><td>{c.to}</td><td>변경</td></tr>)}
      {plan.unchanged.map(f => <tr key={f}><td>{FIELD_LABELS[f] ?? f}</td><td colSpan={2}>동일</td><td>변경 없음</td></tr>)}
      {plan.quarantined.map(q => <tr key={q.field}><td>{FIELD_LABELS[q.field] ?? q.field}</td><td colSpan={2}>-</td><td>격리: {q.reason}</td></tr>)}
      {!plan.changes.length && !plan.unchanged.length && !plan.quarantined.length && <tr><td colSpan={4}>이관할 항목이 없습니다.</td></tr>}
    </tbody></table></div>}</Panel>;
}
export function LegacyImport() {
  const app = useApplication();
  const [sections, setSections] = useState<Sections | null>(null);
  const [result, setResult] = useState<LegacyImportResult>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [cleaned, setCleaned] = useState(false);
  function scan() { setSections(collect()); setResult(undefined); setCleaned(false); }
  function download() {
    if (!sections) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sections }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "catchsecu-legacy-export.json"; a.click(); URL.revokeObjectURL(url);
  }
  async function run(dryRun: boolean) {
    if (!sections) return;
    setBusy(true); setError("");
    try {
      const res = await api<LegacyImportResult>("/migration/legacy", { method: "POST", body: JSON.stringify({ dryRun, sections }) });
      setResult(res); if (!dryRun) app.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function cleanup() {
    try { const keys: string[] = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith("mg-")) keys.push(key); } keys.forEach(key => localStorage.removeItem(key)); } catch {}
    setCleaned(true); setSections(null);
  }
  const hasData = sections && Object.keys(sections).length > 0;
  return <div className="mg-narrow"><PageHeading title="로컬 데이터 이관" />
    <Panel><p>이 브라우저의 구형 로컬 저장소(<code>mg-*</code>)에 남은 프로필·회사 자료를 서버 DB로 이관합니다. 내보내기 → 검사 → 이관 순서로 진행하며, 비밀번호·토큰류 필드는 이관하지 않습니다. 원본은 이관 후에도 내려받은 파일로 보존하세요.</p>
      <div className="mg-flex">
        <ActionButton secondary onClick={scan} disabled={busy}>로컬 저장소 검색</ActionButton>
        {hasData && <><ActionButton secondary onClick={download}>내보내기 (백업)</ActionButton>
        <ActionButton secondary onClick={() => run(true)} disabled={busy}>검사하기</ActionButton>
        <ActionButton onClick={() => run(false)} disabled={busy || !result || !result.dryRun}>이관하기</ActionButton></>}
      </div>
      {sections && !hasData && <p role="status">이관할 로컬 자료가 없습니다.</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {result && <p role="status">{result.dryRun ? "검사 결과입니다. 이관하려면 이관하기를 누르세요." : "이관이 완료되었습니다."}
        {result.rejectedSecrets.length > 0 && <> 비밀 필드 {result.rejectedSecrets.length}개는 이관하지 않았습니다({result.rejectedSecrets.map(r => r.section + "." + r.field).join(", ")}).</>}
        {result.unknownSections.length > 0 && <> 알 수 없는 자료 {result.unknownSections.length}개는 격리했습니다({result.unknownSections.join(", ")}).</>}</p>}
    </Panel>
    {result && <><SectionTable title="프로필" plan={result.profile} /><SectionTable title="회사 정보" plan={result.company} /></>}
    {result?.applied && !cleaned && <Panel title="원본 정리"><p>서버 이관이 완료되었습니다. 내려받은 백업 파일을 보관했다면 브라우저의 구형 자료를 정리할 수 있습니다.</p>
      <ActionButton secondary onClick={cleanup}>브라우저 원본 정리</ActionButton></Panel>}
    {cleaned && <p role="status">브라우저의 구형 자료를 정리했습니다.</p>}
  </div>;
}
