"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import { importMapping, importStatusLabels, type ImportJobRecord, type ImportMapping, type ImportOptions, type ImportPreview } from "@/contracts/imports";
import { basisLabels, normalizedCatalogName } from "@/contracts/processing-catalog";
import type { Paged } from "@/contracts/forms";
import "./imports.css";

const base = "/form/info-upload";
const jobUrl = (id: string, step = "") => base + step + "?jobId=" + encodeURIComponent(id);
const date = (value: string) => new Date(value).toLocaleString("ko-KR");
export function Imports({ path }: { path: string }) {
  const id = useSearchParams().get("jobId"), app = useApplication();
  if (!app.data) return <p role="status">회사 정보를 불러오는 중입니다.</p>;
  if (!app.data.capabilities.includes("import.read")) return <Panel><p role="alert">개인정보 업로드를 사용할 권한이 없습니다.</p></Panel>;
  return <div className="imports-page">{id ? <ImportWorkspace key={id} id={id} path={path} /> : <ImportList />}</div>;
}
function ImportList() {
  const app = useApplication(), [service, setService] = useState(""), [page, setPage] = useState(1), [size, setSize] = useState(20);
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const serviceId = service || app.data?.serviceId || "";
  const result = useResource<Paged<ImportJobRecord>>(serviceId ? "/imports?" + new URLSearchParams({ serviceId, page: String(page), pageSize: String(size), search }) : null);
  const lastPage = Math.max(1, Math.ceil((result.data?.total ?? 0) / size));
  if (result.data && page > lastPage) setPage(lastPage);
  return <><PageHeading title="개인정보 업로드"><p>CSV 파일의 수집 근거와 보유 기한을 확인하고 응답으로 등록합니다.</p><Link className="cs-link" href="/form/manage">캐치폼 목록</Link></PageHeading>
    <div className="forms-filter"><label>서비스 <select aria-label="업로드 서비스" value={serviceId} onChange={e => { setService(e.target.value); setPage(1); }}>
      {app.data?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
    {serviceId && app.data?.capabilities.includes("import.write") && <UploadStart key={serviceId} serviceId={serviceId} />}
    <Panel title="업로드 작업"><form className="forms-filter" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}>
      <input className="cs-input" aria-label="업로드 작업 검색" placeholder="작업 제목 검색" value={query} onChange={e => setQuery(e.target.value)} /><ActionButton>검색</ActionButton></form>
      <RemoteTable columns={["제목", "상태", "전체 / 반영 / 오류 / 중복", "시작일", "임시 자료 만료", "작업"]} page={page} pageSize={size} total={result.data?.total ?? 0} loading={result.loading} error={result.error?.message}
        onPage={setPage} onPageSize={n => { setSize(n); setPage(1); }} rows={(result.data?.items ?? []).map(row => ({ id: row.id, cells: [
          <Link key="title" href={jobUrl(row.id, row.status === "uploading" ? "" : row.status === "draft" ? "/agreement" : "/recipient")}>{row.title}</Link>, importStatusLabels[row.status] ?? row.status,
          `${row.totalRows} / ${row.importedRows} / ${row.invalidRows} / ${row.skippedRows}`, date(row.createdAt), date(row.expiresAt),
          row.formId && app.data?.capabilities.includes("submission.read") ? <Link key="responses" className="cs-link" href={"/form/manage/applicant/" + row.formId}>응답 관리</Link> : "—",
        ] }))} />
    </Panel></>;
}
function UploadStart({ serviceId }: { serviceId: string }) {
  const router = useRouter(), [file, setFile] = useState<File>(), [title, setTitle] = useState(""), [encoding, setEncoding] = useState("utf-8");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const pending = useRef<{ key: string; fingerprint: string; row?: ImportJobRecord } | undefined>(undefined);
  async function upload(event: FormEvent) {
    event.preventDefault(); if (busy || !file) return; setBusy(true); setError("");
    try {
      if (!file.name.toLowerCase().endsWith(".csv") || file.size < 1 || file.size > 10485760) throw new Error("CSV 파일을 1바이트 이상, 10MB 이하로 선택해주세요.");
      setProgress("파일을 확인하고 있습니다."); const bytes = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2, "0")).join("");
      const input = { serviceId, title: title.trim(), name: file.name, mime: "text/csv", size: file.size, sha256: hash, encoding }, fingerprint = JSON.stringify(input);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { key: crypto.randomUUID(), fingerprint };
      const current = pending.current!;
      if (!current.row) current.row = await api<ImportJobRecord>("/imports", { method: "POST", body: fingerprint, headers: { "Idempotency-Key": current.key } });
      setProgress("파일을 업로드하고 있습니다.");
      await api("/uploads/" + current.row.fileId + "/content", { method: "PUT", body: bytes, headers: { "Content-Type": "text/csv" } });
      setProgress("악성코드 검사와 CSV 헤더 확인 중입니다.");
      await api("/uploads/" + current.row.fileId + "/complete", { method: "POST" });
      const latest = await api<ImportJobRecord>("/imports/" + current.row.id);
      if (latest.status === "uploading") await api("/imports/" + latest.id + "/inspect", { method: "POST", body: JSON.stringify({ version: latest.version }) });
      router.push(jobUrl(latest.id, "/agreement"));
    } catch (cause) { setError(errorText(cause)); setProgress(""); } finally { setBusy(false); }
  }
  return <Panel title="CSV 파일 등록"><form onSubmit={upload} className="import-upload">
    <label>작업 제목<input className="cs-input" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label>
    <label>인코딩<select value={encoding} onChange={e => setEncoding(e.target.value)} disabled={busy}><option value="utf-8">UTF-8 / UTF-8 BOM</option><option value="euc-kr">EUC-KR / Windows-949</option></select></label>
    <label>CSV 파일<input type="file" accept=".csv,text/csv" required onChange={e => setFile(e.target.files?.[0])} disabled={busy} /></label>
    <p className="import-help">최대 10MB · 10,000행 · 100열. 첫 행은 항목 이름이어야 합니다. 파일과 임시 행은 최대 24시간 보관합니다.</p>
    {error && <p role="alert">{error}</p>}<p role="status">{progress}</p><ActionButton disabled={busy || !file}>파일 업로드 및 확인</ActionButton>
  </form></Panel>;
}
function ImportWorkspace({ id, path }: { id: string; path: string }) {
  const result = useResource<ImportJobRecord>("/imports/" + id), [override, setOverride] = useState<ImportJobRecord>();
  const row = override ?? result.data, app = useApplication(), router = useRouter();
  const [sourceDirty, setSourceDirty] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<"commit" | "clean">();
  const running = !!row && ["committing", "retry"].includes(row.status);
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = setInterval(() => { api<ImportJobRecord>("/imports/" + id, { signal: controller.signal }).then(setOverride).catch(cause => { if (cause.name !== "AbortError") setError(errorText(cause)); }); }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [id, running]);
  if (!row) return <Panel>{result.error ? <p role="alert">{result.error.message}</p> : <p role="status">업로드 작업을 불러오는 중입니다.</p>}</Panel>;
  const alive = new Date(row.expiresAt) > new Date() && !["cancelled", "archived", "expired"].includes(row.status);
  const editable = alive && ["draft", "validated"].includes(row.status), canWrite = !!app.data?.capabilities.includes("import.write");
  async function action(kind: string) {
    if (!row || busy) return; setBusy(true); setError("");
    try {
      setOverride(await api<ImportJobRecord>("/imports/" + id + (kind === "clean" ? "" : "/" + kind), kind === "clean" ?
        { method: "DELETE", headers: { "If-Match": String(row.version) } } : { method: "POST", body: JSON.stringify({ version: row.version }) }));
      setConfirm(undefined);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const step = path.endsWith("/agreement") ? 2 : path.endsWith("/recipient") ? 3 : 1;
  return <><PageHeading title={row.title}><Link className="cs-link" href={base}>업로드 목록</Link></PageHeading>
    <nav className="import-steps" aria-label="업로드 단계">{["파일 확인", "수집 근거·컬럼 설정", "검증·반영"].map((label, i) =>
      <Link key={label} aria-current={step === i + 1 ? "step" : undefined} href={jobUrl(id, i === 1 ? "/agreement" : i === 2 ? "/recipient" : "")}>{i + 1}. {label}</Link>)}</nav>
    <Panel><div className="forms-between"><strong role="status">{importStatusLabels[row.status]} · {row.importedRows} / {row.totalRows}행 반영</strong>
      <ActionButton secondary disabled={busy} onClick={() => api<ImportJobRecord>("/imports/" + id).then(setOverride).catch(cause => setError(errorText(cause)))}>상태 새로고침</ActionButton></div>
      <p>정상 {row.validRows} · 오류 {row.invalidRows} · 중복 {row.skippedRows} · 임시 자료 만료 {date(row.expiresAt)}</p>
      {running && <><progress aria-label="반영 진행률" value={row.importedRows} max={Math.max(1, row.validRows)} /><p>원본 삭제와 응답 반영이 진행 중입니다. 이 화면을 닫아도 처리는 계속됩니다.</p></>}
      {row.lastError && <p role="alert">처리가 중단되었습니다. 권한·서비스·파일 상태를 확인한 뒤 다시 시도해주세요. ({row.lastError})</p>}
      {!alive && <p>임시 원문을 정리했습니다. 반영된 응답은 응답 관리에서 확인할 수 있습니다.</p>}
      {row.formId && app.data?.capabilities.includes("submission.read") && <Link className="cs-button" href={"/form/manage/applicant/" + row.formId}>반영된 응답 관리</Link>}
      {canWrite && <div className="forms-actions">{row.status === "failed" && alive && <ActionButton disabled={busy} onClick={() => action("retry")}>반영 다시 시도</ActionButton>}
        {alive && !running && <ActionButton secondary disabled={busy} onClick={() => setConfirm("clean")}>{row.formId ? "임시 자료 삭제 및 작업 보관" : "업로드 취소"}</ActionButton>}</div>}
      {error && <p role="alert">{error}</p>}
    </Panel>
    {step === 1 && <Panel title="파일 확인"><p>{row.fileName} · {row.encoding} · {row.fileStatus === "ready" ? "안전 검사 완료" : row.fileStatus}</p>
      {row.headers.length > 0 && <><p>컬럼: {row.headers.join(" · ")}</p><Link className="cs-button" href={jobUrl(id, "/agreement")}>수집 근거 설정</Link></>}
      {row.status === "uploading" && <p>아직 파일 확인을 마치지 못했습니다. 원래 업로드 화면에서 재시도하거나 이 작업을 취소하고 새 파일을 등록해주세요.</p>}</Panel>}
    {step === 2 && editable && canWrite && <MappingEditor key={row.id + ":" + row.version} row={row} onSaved={saved => { setSourceDirty(false); setOverride(saved); router.push(jobUrl(id, "/recipient")); }} />}
    {step === 2 && !editable && <Panel><p>수집 근거는 반영 시작 후 변경할 수 없습니다.</p><Link className="cs-link" href={jobUrl(id, "/recipient")}>검증 결과 확인</Link></Panel>}
    {step === 3 && alive && <>
      {editable && canWrite && row.mapping && <SourceEditor key={"source:" + row.version} row={row} onDirty={setSourceDirty} onSaved={saved => { setSourceDirty(false); setOverride(saved); }} />}
      {editable && !row.mapping && <Panel><Link className="cs-button" href={jobUrl(id, "/agreement")}>수집 근거와 컬럼을 먼저 설정해주세요</Link></Panel>}
      {editable && canWrite && row.mapping && <Panel><div className="forms-actions"><ActionButton secondary disabled={busy || sourceDirty} onClick={() => action("validate")}>행 검증</ActionButton>
        {row.status === "validated" && <ActionButton disabled={busy || sourceDirty || !row.validRows} onClick={() => setConfirm("commit")}>정상 {row.validRows}행 반영</ActionButton>}</div>
        <p>검증 단계에서는 응답을 만들지 않습니다. 반영 전에 수집 근거와 실패 사유를 확인해주세요.</p></Panel>}
      {!["uploading", "draft"].includes(row.status) && <ImportRows key={"rows:" + row.version} row={row} />}
    </>}
    {confirm && <Modal title={confirm === "commit" ? "정상 행 반영" : "임시 자료 정리"} onClose={() => { if (!busy) setConfirm(undefined); }}>
      <p>{confirm === "commit" ? `정상 ${row.validRows}행을 응답으로 등록합니다. 오류·중복 ${row.invalidRows + row.skippedRows}행은 반영하지 않습니다. 원본 파일은 반영 전에 삭제합니다.` : "원본과 남은 임시 행을 삭제하고 이 작업을 정리합니다. 이미 등록된 응답의 파기는 응답 관리에서 요청할 수 있습니다."}</p>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={() => action(confirm)}>확인하고 {confirm === "commit" ? "반영" : "정리"}</ActionButton></Modal>}
  </>;
}
const typeLabels = { text: "텍스트", email: "이메일", phone: "전화번호", number: "숫자", date: "날짜" };
function ColumnSelect({ label, value, onChange, headers, required = false }: { label: string; value: number | null; onChange: (value: number | null) => void; headers: string[]; required?: boolean }) {
  return <select aria-label={label} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))} required={required}>
    <option value="">{required ? "컬럼 선택" : "매핑하지 않음"}</option>{headers.map((h, i) => <option key={i} value={i}>{i + 1}. {h}</option>)}</select>;
}
function DateSetting({ label, value, onChange, headers }: { label: string; value: ImportMapping["collectedAt"]; onChange: (v: ImportMapping["collectedAt"]) => void; headers: string[] }) {
  return <fieldset><legend>{label}</legend><select aria-label={label + " 지정 방식"} value={value.mode} onChange={e => onChange(e.target.value === "column" ? { mode: "column", column: 0 } : { mode: "fixed", value: "" })}><option value="column">CSV 컬럼</option><option value="fixed">고정 날짜</option></select>
    {value.mode === "column" ? <ColumnSelect required label={label + " 컬럼"} value={value.column} onChange={column => onChange({ mode: "column", column: column ?? 0 })} headers={headers} /> :
      <input type="date" aria-label={label + " 고정 날짜"} required value={value.value.slice(0, 10)} onChange={e => onChange({ mode: "fixed", value: e.target.value })} />}</fieldset>;
}
function MappingEditor({ row, onSaved }: { row: ImportJobRecord; onSaved: (row: ImportJobRecord) => void }) {
  const result = useResource<ImportOptions>("/imports/options?serviceId=" + row.serviceId);
  return <Panel title="수집 근거와 컬럼 설정">{result.error ? <p role="alert">{result.error.message}</p> : !result.data ? <p role="status">수집 목적을 불러오는 중입니다.</p> :
    result.data.purposes.length ? <MappingForm row={row} options={result.data} onSaved={onSaved} /> : <p>사용 중인 수집 목적이 없습니다. <Link className="cs-link" href="/basic/info-usage-purpose">수집 목적을 등록해주세요.</Link></p>}</Panel>;
}
function MappingForm({ row, options, onSaved }: { row: ImportJobRecord; options: ImportOptions; onSaved: (row: ImportJobRecord) => void }) {
  const autoFields = (purposeId: string) => (options.purposes.find(p => p.id === purposeId)?.items ?? []).map(item => {
    const index = row.headers.findIndex(h => normalizedCatalogName(h) === normalizedCatalogName(item.name));
    return { name: item.name, column: index < 0 ? null : index, type: /메일/.test(item.name) ? "email" as const : /전화/.test(item.name) ? "phone" as const : "text" as const };
  });
  const [mapping, setMapping] = useState<ImportMapping>(() => row.mapping ?? { purposeId: options.purposes[0].id, fields: autoFields(options.purposes[0].id),
    collectedAt: { mode: "fixed", value: "" }, retentionUntil: null, consentColumn: null, evidenceColumn: null, sourceStatement: "", source: "internal", sourceRecipientId: null });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const purpose = options.purposes.find(p => p.id === mapping.purposeId);
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const parsed = importMapping.safeParse(mapping); if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      onSaved(await api<ImportJobRecord>("/imports/" + row.id, { method: "PATCH", body: JSON.stringify({ version: row.version, mapping: parsed.data }) }));
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className="import-mapping" onSubmit={save}><label>수집 목적<select value={mapping.purposeId} onChange={e => setMapping({ ...mapping, purposeId: e.target.value, fields: autoFields(e.target.value), retentionUntil: null })}>
    {!purpose && <option value={mapping.purposeId}>사용할 수 없는 목적</option>}{options.purposes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {purpose && <div className="import-summary"><strong>{basisLabels[purpose.lawfulBasis]} · {purpose.retentionMode === "days" ? purpose.retentionDays + "일 보유" : purpose.retentionReason}</strong><p>{purpose.purpose}</p><p>{purpose.basisReference}</p></div>}
    <div className="cs-table-wrap"><table className="cs-table"><thead><tr><th>수집 항목</th><th>CSV 컬럼</th><th>검증 형식</th><th>정보주체 조회 항목</th></tr></thead><tbody>{mapping.fields.map((f, i) => <tr key={f.name}><td>{f.name} {purpose?.items[i]?.required && <span>(필수)</span>}</td>
      <td><ColumnSelect label={f.name + " 컬럼"} headers={row.headers} required={purpose?.items[i]?.required} value={f.column} onChange={column => setMapping({ ...mapping, fields: mapping.fields.map((v, j) => j === i ? { ...v, column } : v) })} /></td>
      <td><select aria-label={f.name + " 검증 형식"} value={f.type} disabled={!!f.subjectRole} onChange={e => setMapping({ ...mapping, fields: mapping.fields.map((v, j) => j === i ? { ...v, type: e.target.value as typeof f.type } : v) })}>{Object.entries(typeLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></td><td><select aria-label={f.name + " 정보주체 항목"} value={f.subjectRole ?? ""} onChange={e => setMapping({ ...mapping, fields: mapping.fields.map((v, j) => j === i ? { ...v, subjectRole: (e.target.value || undefined) as "name" | "email" | undefined, ...(e.target.value ? { type: e.target.value === "email" ? "email" as const : "text" as const } : {}) } : v) })}><option value="">지정하지 않음</option><option value="name">정보주체 이름</option><option value="email">정보주체 이메일</option></select></td></tr>)}</tbody></table></div>
    <DateSetting label="원 수집일" headers={row.headers} value={mapping.collectedAt} onChange={collectedAt => setMapping({ ...mapping, collectedAt })} />
    {purpose && purpose.retentionMode !== "days" && <DateSetting label="보유 종료일" headers={row.headers} value={mapping.retentionUntil ?? { mode: "fixed", value: "" }} onChange={retentionUntil => setMapping({ ...mapping, retentionUntil })} />}
    {purpose?.lawfulBasis === "consent" && <label>행별 동의 컬럼<ColumnSelect required label="동의 컬럼" headers={row.headers} value={mapping.consentColumn} onChange={consentColumn => setMapping({ ...mapping, consentColumn })} /><small>동의 값: true, 1, y, yes, 동의, 동의함</small></label>}
    <label>수집 근거 설명<textarea required maxLength={3000} value={mapping.sourceStatement} onChange={e => setMapping({ ...mapping, sourceStatement: e.target.value })} placeholder="언제, 어떤 경로로 수집한 자료인지 기록해주세요." /></label>
    <label>행별 증거 컬럼 (선택)<ColumnSelect label="증거 컬럼" headers={row.headers} value={mapping.evidenceColumn} onChange={evidenceColumn => setMapping({ ...mapping, evidenceColumn })} /></label>
    <p className="import-help">날짜만 있는 값은 한국 시간 자정으로 처리합니다. 이미 보유 기한이 끝난 행은 반영하지 않습니다.</p>
    {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>설정 저장 후 다음</ActionButton></form>;
}
function SourceEditor({ row, onSaved, onDirty }: { row: ImportJobRecord; onSaved: (row: ImportJobRecord) => void; onDirty: (value: boolean) => void }) {
  const options = useResource<ImportOptions>("/imports/options?serviceId=" + row.serviceId), [mapping, setMapping] = useState(row.mapping!);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = mapping.source !== row.mapping?.source || mapping.sourceRecipientId !== row.mapping?.sourceRecipientId;
  return <Panel title="원자료 출처"><form className="import-mapping" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { onSaved(await api<ImportJobRecord>("/imports/" + row.id, { method: "PATCH", body: JSON.stringify({ version: row.version, mapping }) })); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }}>
    <label>출처<select value={mapping.source} onChange={e => { onDirty(e.target.value !== row.mapping?.source || row.mapping?.sourceRecipientId !== null); setMapping({ ...mapping, source: e.target.value as ImportMapping["source"], sourceRecipientId: null }); }}><option value="internal">직접 수집</option><option value="third_party">외부 제공자로부터 수령</option></select></label>
    {mapping.source === "third_party" && <label>원자료 제공자<select required value={mapping.sourceRecipientId ?? ""} onChange={e => { onDirty(mapping.source !== row.mapping?.source || (e.target.value || null) !== row.mapping?.sourceRecipientId); setMapping({ ...mapping, sourceRecipientId: e.target.value || null }); }}><option value="">제공자를 선택해주세요</option>{options.data?.recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
    {options.error && <p role="alert">{options.error.message}</p>}{error && <p role="alert">{error}</p>}
    {dirty && <><p>출처 변경을 저장한 뒤 행 검증을 다시 진행해주세요.</p><ActionButton disabled={busy}>출처 변경 저장</ActionButton></>}
    <Link className="cs-link" href={jobUrl(row.id, "/agreement")}>수집 근거·컬럼 수정</Link></form></Panel>;
}
function ImportRows({ row }: { row: ImportJobRecord }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20), [errorsOnly, setErrorsOnly] = useState(false);
  const result = useResource<ImportPreview>("/imports/" + row.id + "/rows?" + new URLSearchParams({ page: String(page), pageSize: String(size), errorsOnly: String(errorsOnly) }));
  return <Panel title="행별 검증 결과"><div className="forms-between"><label><input type="checkbox" checked={errorsOnly} onChange={e => { setErrorsOnly(e.target.checked); setPage(1); }} /> 오류·중복만 보기</label>
    <a className="cs-link" href={"/api/v1/imports/" + row.id + "/errors.csv"} download>실패행 CSV 다운로드</a></div>
    <p className="import-help">반영된 행의 임시 원문은 삭제됩니다. 중복 행은 연결된 응답이 파기되면 함께 제거됩니다.</p>
    <RemoteTable columns={["CSV 행 / 줄", "처리 상태", "검증 사유", ...row.headers]} page={page} pageSize={size} total={result.data?.total ?? 0} loading={result.loading} error={result.error?.message}
      onPage={setPage} onPageSize={n => { setSize(n); setPage(1); }} rows={(result.data?.items ?? []).map(r => ({ id: String(r.rowNo), cells: [
        `${r.rowNo} / ${r.lineNo}`, ({ valid: "정상", error: "오류", duplicate: "중복", imported: "반영 완료" } as Record<string, string>)[r.status], r.errors.map(e => e.field + ": " + e.message).join(" / ") || "—",
        ...row.headers.map((_, i) => r.values ? (r.values[i] ?? "") : "원문 삭제됨"),
      ] }))} /></Panel>;
}
