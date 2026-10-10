"use client";
import { useRef, useState, type FormEvent } from "react";
import { GuardedLink as Link, useNavigationGuard, useUnsavedChanges } from "../ux/navigation-guard";
import { useConfirm } from "../ux/confirm";
import { useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton } from "../shared";
import { useApplication } from "../ApplicationContext";
import { ApiError, api, errorText, useResource } from "@/lib/api";
import { displayInput, nameModes, type DisplayInput, type DisplayRecord, type DisplayKind, type DocumentOptions } from "@/contracts/documents";
import "../forms/documents.css";
const labels = { startText: "동의서 시작 문구", processorText: "수탁사 안내 문구", policyText: "개인정보 처리방침 안내 문구", requiredText: "거부권 및 거부 시 불이익 문구 (필수 동의서)", optionalText: "거부권 및 거부 시 불이익 문구 (선택 동의서)" } as const;
export function ConsentDisplay() {
  const params = useSearchParams(), app = useApplication(), [service, setService] = useState(params.get("serviceId") ?? ""), [kind, setKind] = useState<DisplayKind>("collection"), [message, setMessage] = useState("");
  const guard = useNavigationGuard(), [saving, setSaving] = useState(false);
  const serviceId = service || app.data?.serviceId || "";
  const result = useResource<DisplayRecord>(serviceId ? `/services/${serviceId}/consent-display/${kind}` : null);
  const options = useResource<DocumentOptions>(serviceId ? "/documents/options?serviceId=" + serviceId : null);
  return <div className="documents-page documents-display"><PageHeading title="서비스 내 동의서 표시 설정" /><div className="documents-toolbar"><label>서비스<select className="cs-input" aria-label="표시 설정 서비스" value={serviceId} disabled={saving} onChange={event => { const next = event.target.value; void guard.confirmLeave().then(leave => { if (leave) { setService(next); setMessage(""); } }); }}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Link href="/basic/result/policy">처리방침 관리</Link></div>
    <div className="mg-tabs" role="tablist" aria-label="동의서 종류">{(["collection", "third_party"] as const).map(value => <button key={value} className={value === kind ? "active" : ""} role="tab" aria-selected={value === kind} disabled={saving} onClick={async () => { if (value !== kind && await guard.confirmLeave()) { setKind(value); setMessage(""); } }}>{value === "collection" ? "개인정보 수집·이용 동의서" : "개인정보 제3자 제공 동의서"}</button>)}</div>
    {message && <p role="status">{message}</p>}{result.error ? <Panel><p role="alert">{result.error instanceof ApiError ? result.error.message : "표시 설정을 불러오지 못했습니다. 연결 상태를 확인한 후 다시 시도해주세요."}</p><ActionButton secondary onClick={result.reload}>표시 설정 다시 불러오기</ActionButton></Panel> : !result.data ? <Panel><p role="status">설정을 불러오는 중입니다.</p></Panel> :
      <DisplayEditor key={serviceId + ":" + kind + ":" + result.data.version} row={result.data} options={options.data} error={options.error ? options.error instanceof ApiError ? options.error.message : "처리방침 목록을 불러오지 못했습니다. 연결 상태를 확인해주세요." : undefined}
        onBusyChange={setSaving} onOptionsReload={options.reload} onReload={() => { setMessage(""); result.reload(); options.reload(); }}
        onSaved={() => { setMessage("표시 설정을 저장했습니다."); result.reload(); }} />}
  </div>;
}
function DisplayEditor({ row, options, error: optionsError, onSaved, onReload, onOptionsReload, onBusyChange }: {
  row: DisplayRecord; options?: DocumentOptions; error?: string; onSaved: () => void; onReload: () => void; onOptionsReload: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [value, setValue] = useState<DisplayInput>({ version: row.version, nameMode: row.nameMode, startText: row.startText, processorText: row.processorText, policyText: row.policyText, requiredText: row.requiredText, optionalText: row.optionalText, policyMode: row.policyMode, externalUrl: row.externalUrl, publicationId: row.publicationId });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const [initialValue] = useState(() => JSON.stringify(value)), ask = useConfirm();
  const dirty = JSON.stringify(value) !== initialValue;
  useUnsavedChanges(dirty || busy);
  const lock = useRef(false);
  const serviceName = row.serviceName, companyName = row.companyName;
  const names = { service_company: `${serviceName}(${companyName})`, company_service: `${companyName}(${serviceName})`, service: serviceName, company: companyName };
  const sameLink = value.policyMode === row.policyMode && value.externalUrl === row.externalUrl && value.publicationId === row.publicationId;
  const policy = options?.policies.find(item => item.publicationId === value.publicationId);
  async function reloadLatest() {
    if (busy) return;
    if (dirty && !await ask({ title: "저장하지 않은 변경 사항", message: "입력한 표시 설정을 버리고 최신 설정을 불러올까요?", confirmLabel: "최신 설정 불러오기", cancelLabel: "계속 편집" })) return;
    onReload();
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current || conflict) return; lock.current = true; setBusy(true); onBusyChange(true); setError("");
    try { const checked = displayInput.safeParse(value); if (!checked.success) throw new Error(checked.error.issues.map(item => item.message).join(" "));
      await api(`/services/${row.serviceId}/consent-display/${row.kind}`, { method: "PATCH", body: JSON.stringify(checked.data) }); onSaved();
    } catch (cause) { setError(cause instanceof TypeError ? "저장 요청을 확인하지 못했습니다. 연결 상태를 확인한 후 다시 시도해주세요." : errorText(cause)); setConflict(cause instanceof ApiError && cause.code === "VERSION_CONFLICT"); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div className="documents-grid"><Panel><form className="documents-fields" onSubmit={save}><fieldset disabled={busy || conflict}><label>서비스명(회사명) 표시 방식<select className="cs-input" aria-label="서비스명 표시 방식" value={value.nameMode} onChange={event => setValue({ ...value, nameMode: event.target.value as DisplayInput["nameMode"] })}>{Object.entries(nameModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <label key={key}>{labels[key]}<textarea className="cs-input" aria-label={labels[key]} maxLength={200} value={value[key]} onChange={event => setValue({ ...value, [key]: event.target.value })} /><small>{value[key].length} / 200</small></label>)}
    <label>처리방침 링크<select className="cs-input" aria-label="처리방침 링크" value={value.policyMode} onChange={event => setValue({ ...value, policyMode: event.target.value as DisplayInput["policyMode"], externalUrl: "", publicationId: null })}><option value="none">없음</option><option value="document">게시한 처리방침 연결</option><option value="external">외부 처리방침 링크</option></select></label>
    {value.policyMode === "external" && <label>외부 처리방침 주소<input className="cs-input" type="url" placeholder="https://" required value={value.externalUrl} onChange={event => setValue({ ...value, externalUrl: event.target.value })} /></label>}
    {value.policyMode === "document" && <label>처리방침 게시 버전<select className="cs-input" required value={value.publicationId ?? ""} onChange={event => setValue({ ...value, publicationId: event.target.value || null })}><option value="">공개 중인 버전 선택</option>{options?.policies.map(item => <option key={item.publicationId} value={item.publicationId}>{item.title} · v{item.number}</option>)}{value.publicationId && options && !options.policies.some(item => item.publicationId === value.publicationId) && <option value={value.publicationId}>종료된 처리방침 · 다시 선택해주세요</option>}</select></label>}
  </fieldset>{error && <p role="alert">{error}</p>}
    {conflict && <div><p>입력한 내용을 유지했습니다. 최신 설정을 확인한 후 다시 수정해주세요.</p><ActionButton secondary type="button" disabled={busy} onClick={reloadLatest}>최신 표시 설정 불러오기</ActionButton></div>}
    {optionsError && <p role="alert">{optionsError} <button type="button" disabled={busy} onClick={onOptionsReload}>처리방침 목록 다시 불러오기</button></p>}
    <ActionButton disabled={busy || conflict || (value.policyMode === "document" && !options)}>{busy ? "저장 중…" : "수정사항 적용"}</ActionButton></form></Panel>
    <Panel title="동의서 표시 미리보기"><h3>{names[value.nameMode]}</h3>{(Object.keys(labels) as (keyof typeof labels)[]).map(key => value[key] ? <section key={key}><h4>{labels[key]}</h4><p className="document-content">{value[key]}</p></section> : null)}
      {value.policyMode === "document" && <p>{policy ? `${policy.title} · v${policy.number}` : "처리방침 게시 버전을 선택해주세요."}</p>}
      {value.policyMode === "external" && <p className="documents-hash">{value.externalUrl}</p>}
      {sameLink && row.policyUrl && <a className="cs-link" href={row.policyUrl} rel="noreferrer">저장한 처리방침 열기</a>}
    </Panel></div>;
}
