"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import { basisLabels, itemKinds, recipientKinds, retentionModes, purposeInput, recipientInput,
  type PurposeInput, type RecipientInput, type PurposeRecord, type RecipientRecord, type CatalogHistory } from "@/contracts/processing-catalog";
import type { Paged } from "@/contracts/forms";
import regionCodes from "@/data/region-codes.json";
import "./processing-catalog.css";

type Kind = "purposes" | "recipients";
type Record = PurposeRecord | RecipientRecord;
const endpoint = (kind: Kind) => kind === "purposes" ? "/processing-purposes" : "/recipients";
const countryNames = new Intl.DisplayNames(["ko"], { type: "region" });
const countries = [...regionCodes].sort((a, b) => (countryNames.of(a) ?? a).localeCompare(countryNames.of(b) ?? b, "ko"));
const retentionText = (row: Pick<PurposeInput, "retentionMode" | "retentionDays" | "retentionReason">) =>
  row.retentionMode === "days" ? row.retentionDays + "일" : retentionModes[row.retentionMode] + " · " + row.retentionReason;

export function ProcessingCatalog({ policy = false }: { policy?: boolean }) {
  const app = useApplication(), canWrite = !!app.data?.capabilities.includes("document.write");
  const [kind, setKind] = useState<Kind>("purposes"), [service, setService] = useState("");
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [status, setStatus] = useState("active");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState<{ kind: Kind; row?: Record }>(), [history, setHistory] = useState<{ kind: Kind; row: Record }>();
  const [action, setAction] = useState<{ kind: Kind; row: Record }>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const serviceId = service || app.data?.serviceId || "";
  const params = new URLSearchParams({ serviceId, search, status, page: String(page), pageSize: String(pageSize) });
  const result = useResource<Paged<Record>>(serviceId ? endpoint(kind) + "?" + params : null);
  const lastPage = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));
  if (result.data && page > lastPage) setPage(lastPage);
  const changed = () => { setEditor(undefined); result.reload(); };
  async function confirmAction() {
    if (!action || busy) return; setBusy(true); setError("");
    try {
      const restore = action.row.status === "archived";
      await api(endpoint(action.kind) + "/" + action.row.id + (restore ? "/restore" : ""), restore
        ? { method: "POST", body: JSON.stringify({ version: action.row.version }) }
        : { method: "DELETE", headers: { "If-Match": String(action.row.version) } });
      setAction(undefined); result.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <><PageHeading title={policy ? "처리방침 기초 자료" : "개인정보 수집·이용 목적"}>
    {canWrite && serviceId && <ActionButton onClick={() => setEditor({ kind })}>{kind === "purposes" ? "수집 목적 추가" : "제공·수탁자 추가"}</ActionButton>}
  </PageHeading><p className="catalog-description">서비스별 수집 목적, 개인정보 항목, 보유 기준과 제공·수탁자를 관리합니다.</p>
    <p><Link className="cs-link" href={policy ? "/basic/result/policy" : "/basic/result/consent"}>문서 생성·관리로 이동</Link></p><Panel><div className="catalog-toolbar"><label>서비스<select className="cs-input" aria-label="자료 서비스" value={serviceId} onChange={event => { setService(event.target.value); setPage(1); }}>
      {!serviceId && <option value="">서비스를 선택해주세요</option>}{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div role="tablist" aria-label="수집 근거 자료" className="catalog-tabs">{(["purposes", "recipients"] as const).map(value =>
        <button role="tab" aria-selected={kind === value} className={kind === value ? "active" : ""} key={value} onClick={() => { setKind(value); setPage(1); setSearch(""); setQuery(""); }}>{value === "purposes" ? "수집 목적" : "제공·수탁자"}</button>)}</div></div>
      <form className="catalog-toolbar" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
        <input className="cs-input" aria-label="자료 이름 검색" placeholder="이름으로 검색" value={query} onChange={event => setQuery(event.target.value)} />
        <ActionButton>검색</ActionButton><select className="cs-input" aria-label="자료 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="active">사용 중</option><option value="archived">보관함</option><option value="all">전체</option></select>
        <ActionButton type="button" secondary onClick={result.reload}>새로고침</ActionButton></form>
      <RemoteTable columns={["이름", kind === "purposes" ? "수집 근거" : "유형 / 국가·지역", "처리 목적", "보유 기준", "상태", "관리"]}
        rows={(result.data?.items ?? []).map(row => ({ id: row.id, cells: [row.name,
          "lawfulBasis" in row ? basisLabels[row.lawfulBasis] : recipientKinds[row.kind] + " / " + countryNames.of(row.countryCode),
          row.purpose, retentionText(row), row.status === "active" ? "사용 중" : "보관",
          <div className="forms-row-actions" key="actions"><button onClick={() => setEditor({ kind, row })}>{canWrite && row.status === "active" ? "상세·수정" : "상세"}</button>
            <button onClick={() => setHistory({ kind, row })}>변경 이력</button>
            {canWrite && <button onClick={() => { setError(""); setAction({ kind, row }); }}>{row.status === "active" ? "보관" : "복원"}</button>}</div>,
        ] }))} total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
        loading={result.loading} error={result.error?.message} />
    </Panel>{editor && <Modal title={editor.row ? editor.row.name : editor.kind === "purposes" ? "수집 목적 추가" : "제공·수탁자 추가"} onClose={() => setEditor(undefined)}>
      <CatalogEditor kind={editor.kind} row={editor.row} serviceId={serviceId} canWrite={canWrite} onSaved={changed} />
    </Modal>}{history && <Modal title="변경 이력" onClose={() => setHistory(undefined)}><History kind={history.kind} row={history.row} /></Modal>}
    {action && <Modal title={action.row.status === "active" ? "자료 보관" : "자료 복원"} onClose={() => { if (!busy) setAction(undefined); }}>
      <p>“{action.row.name}” 자료를 {action.row.status === "active" ? "보관합니다. 변경 이력은 유지하고 새 수집 근거에서는 선택할 수 없게 합니다." : "다시 사용합니다. 연결 자료와 중복 이름을 확인합니다."}</p>
      {action.kind === "recipients" && action.row.status === "active" && <p>사용 중인 수집 목적의 연결을 먼저 해제하거나 해당 목적을 보관해주세요.</p>}
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={confirmAction}>확인</ActionButton>
    </Modal>}</>;
}
type RetentionValue = Pick<PurposeInput, "retentionMode" | "retentionDays" | "retentionReason">;
function RetentionFields({ value, change }: { value: RetentionValue; change: (value: Partial<RetentionValue>) => void }) {
  return <fieldset className="catalog-fields"><legend>보유 기간</legend><label>기간 유형<select className="cs-input" aria-label="보유 기간 유형" value={value.retentionMode} onChange={event => {
    const mode = event.target.value as PurposeInput["retentionMode"]; change({ retentionMode: mode, retentionDays: mode === "days" ? 30 : null });
  }}>{Object.entries(retentionModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {value.retentionMode === "days" ? <label>보유 일수<input className="cs-input" aria-label="보유 일수" type="number" min={1} max={36500} required value={value.retentionDays ?? ""} onChange={event => change({ retentionDays: event.target.value ? Number(event.target.value) : null })} /></label>
      : <label>종료·보존 기준<textarea className="cs-input" aria-label="종료·보존 기준" maxLength={2000} required value={value.retentionReason} onChange={event => change({ retentionReason: event.target.value })} /></label>}
  </fieldset>;
}
const defaults = { name: "", purpose: "", retentionMode: "days" as const, retentionDays: 30, retentionReason: "" };
function CatalogEditor({ kind, row, serviceId, canWrite, onSaved }: { kind: Kind; row?: Record; serviceId: string; canWrite: boolean; onSaved: () => void }) {
  const initialPurpose = row && "lawfulBasis" in row ? row : undefined, initialRecipient = row && "kind" in row ? row : undefined;
  const [purpose, setPurpose] = useState<PurposeInput>(() => initialPurpose ? {
    serviceId: initialPurpose.serviceId, name: initialPurpose.name, purpose: initialPurpose.purpose, lawfulBasis: initialPurpose.lawfulBasis, basisReference: initialPurpose.basisReference,
    items: initialPurpose.items, recipientIds: initialPurpose.recipientIds, retentionMode: initialPurpose.retentionMode, retentionDays: initialPurpose.retentionDays, retentionReason: initialPurpose.retentionReason,
  } : { ...defaults, serviceId, lawfulBasis: "consent", basisReference: "", items: [{ name: "", kind: "general", required: true }], recipientIds: [] });
  const [recipient, setRecipient] = useState<RecipientInput>(() => initialRecipient ? {
    serviceId: initialRecipient.serviceId, name: initialRecipient.name, kind: initialRecipient.kind, countryCode: initialRecipient.countryCode, purpose: initialRecipient.purpose,
    items: initialRecipient.items, retentionMode: initialRecipient.retentionMode, retentionDays: initialRecipient.retentionDays, retentionReason: initialRecipient.retentionReason,
    contact: initialRecipient.contact, transferMethod: initialRecipient.transferMethod, transferTiming: initialRecipient.transferTiming, refusalNotice: initialRecipient.refusalNotice,
  } : { ...defaults, serviceId, kind: "third_party", countryCode: "KR", items: [], contact: "", transferMethod: "", transferTiming: "", refusalNotice: "" });
  const [itemText, setItemText] = useState(initialRecipient?.items.join("\n") ?? "");
  const [selected, setSelected] = useState<RecipientRecord[]>(initialPurpose?.recipients ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const creation = useRef<{ payload: string; key: string } | null>(null), readOnly = !canWrite || row?.status === "archived";
  const common = kind === "purposes" ? purpose : recipient;
  const changePurpose = (patch: Partial<PurposeInput>) => setPurpose(value => ({ ...value, ...patch }));
  const changeRecipient = (patch: Partial<RecipientInput>) => setRecipient(value => ({ ...value, ...patch }));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || readOnly) return; setError("");
    const result = kind === "purposes" ? purposeInput.safeParse({ ...purpose, recipientIds: selected.map(item => item.id) }) : recipientInput.safeParse({ ...recipient, items: itemText.split(/\r?\n/).map(item => item.trim()).filter(Boolean) });
    if (!result.success) { setError(result.error.issues.map(issue => issue.message).join(" · ")); return; }
    setBusy(true);
    const payload = JSON.stringify(result.data);
    if (!creation.current || creation.current.payload !== payload) creation.current = { payload, key: crypto.randomUUID() };
    try {
      await api(endpoint(kind) + (row ? "/" + row.id : ""), { method: row ? "PATCH" : "POST",
        body: JSON.stringify({ ...result.data, ...(row ? { version: row.version } : {}) }),
        ...(row ? {} : { headers: { "Idempotency-Key": creation.current.key } }) });
      onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className="catalog-editor" onSubmit={submit}>
    {row && <p className="cs-muted">개정 {row.version} · {new Date(row.updatedAt).toLocaleString("ko-KR")}{row.status === "archived" ? " · 보관함의 자료는 복원 후 수정할 수 있습니다." : ""}</p>}
    <fieldset disabled={readOnly || busy} className="catalog-fields">
      <label>이름<input className="cs-input" aria-label="자료 이름" required maxLength={200} value={common.name} onChange={event => kind === "purposes" ? changePurpose({ name: event.target.value }) : changeRecipient({ name: event.target.value })} /></label>
      <label>처리 목적<textarea className="cs-input" aria-label="처리 목적" required maxLength={3000} rows={3} value={common.purpose} onChange={event => kind === "purposes" ? changePurpose({ purpose: event.target.value }) : changeRecipient({ purpose: event.target.value })} /></label>
      {kind === "purposes" ? <>
        <label>수집 근거<select className="cs-input" aria-label="수집 근거" value={purpose.lawfulBasis} onChange={event => changePurpose({ lawfulBasis: event.target.value as PurposeInput["lawfulBasis"] })}>
          {Object.entries(basisLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>근거 문서·조항·증빙 설명<textarea className="cs-input" aria-label="수집 근거 설명" maxLength={3000} required={purpose.lawfulBasis !== "consent"} value={purpose.basisReference} onChange={event => changePurpose({ basisReference: event.target.value })} /></label>
        <p className="cs-muted">수집 근거 설정 자료입니다. 개별 정보주체의 동의 내역은 수집 과정에서 별도로 기록합니다.</p>
        <fieldset className="catalog-fields"><legend>개인정보 항목</legend>{purpose.items.map((item, index) => <div className="catalog-item" key={index}>
          <input className="cs-input" aria-label={"개인정보 항목 " + (index + 1)} required maxLength={200} value={item.name} onChange={event => changePurpose({ items: purpose.items.map((value, i) => i === index ? { ...value, name: event.target.value } : value) })} />
          <select className="cs-input" aria-label={"항목 분류 " + (index + 1)} value={item.kind} onChange={event => changePurpose({ items: purpose.items.map((value, i) => i === index ? { ...value, kind: event.target.value as typeof item.kind } : value) })}>
            {Object.entries(itemKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <label><input type="checkbox" checked={item.required} onChange={event => changePurpose({ items: purpose.items.map((value, i) => i === index ? { ...value, required: event.target.checked } : value) })} />필수</label>
          <button type="button" className="cs-link" aria-label={"항목 " + (index + 1) + " 삭제"} disabled={purpose.items.length === 1} onClick={() => changePurpose({ items: purpose.items.filter((_, i) => i !== index) })}>삭제</button>
        </div>)}<ActionButton secondary type="button" disabled={purpose.items.length >= 100} onClick={() => changePurpose({ items: [...purpose.items, { name: "", kind: "general", required: true }] })}>항목 추가</ActionButton></fieldset>
      </> : <>
        <label>유형<select className="cs-input" aria-label="제공·수탁자 유형" value={recipient.kind} onChange={event => changeRecipient({ kind: event.target.value as RecipientInput["kind"] })}>
          {Object.entries(recipientKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>국가·지역<select className="cs-input" aria-label="국가·지역" value={recipient.countryCode} onChange={event => changeRecipient({ countryCode: event.target.value })}>
          {countries.map(code => <option key={code} value={code}>{countryNames.of(code)} ({code})</option>)}</select></label>
        <label>처리하는 개인정보 항목<textarea className="cs-input" aria-label="제공 개인정보 항목" required maxLength={20100} placeholder="한 줄에 항목 하나씩 입력해주세요." rows={4} value={itemText} onChange={event => setItemText(event.target.value)} /></label>
        <label>연락처<input className="cs-input" aria-label="제공자 연락처" maxLength={1000} required={recipient.countryCode !== "KR" && recipient.kind !== "source"} value={recipient.contact} onChange={event => changeRecipient({ contact: event.target.value })} /></label>
        {recipient.countryCode !== "KR" && recipient.kind !== "source" && <fieldset className="catalog-fields"><legend>국외 처리 정보</legend>
          <label>이전 방법<textarea className="cs-input" aria-label="국외 이전 방법" maxLength={2000} required value={recipient.transferMethod} onChange={event => changeRecipient({ transferMethod: event.target.value })} /></label>
          <label>이전 시기<textarea className="cs-input" aria-label="국외 이전 시기" maxLength={2000} required value={recipient.transferTiming} onChange={event => changeRecipient({ transferTiming: event.target.value })} /></label>
          <label>거부 방법·절차 및 영향<textarea className="cs-input" aria-label="국외 이전 거부 안내" maxLength={3000} required value={recipient.refusalNotice} onChange={event => changeRecipient({ refusalNotice: event.target.value })} /></label>
        </fieldset>}
      </>}
      <RetentionFields value={common} change={kind === "purposes" ? changePurpose : changeRecipient} />
      {kind === "purposes" && <RecipientPicker serviceId={purpose.serviceId} selected={selected} change={setSelected} />}
    </fieldset>{error && <p role="alert">{error}</p>}{!readOnly && <ActionButton disabled={busy}>{busy ? "저장 중…" : "자료 저장"}</ActionButton>}
  </form>;
}
function RecipientPicker({ serviceId, selected, change }: { serviceId: string; selected: RecipientRecord[]; change: (value: RecipientRecord[]) => void }) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const result = useResource<Paged<RecipientRecord>>("/recipients?" + new URLSearchParams({ serviceId, search, page: String(page), pageSize: "10", status: "active" }));
  const lastPage = Math.max(1, Math.ceil((result.data?.total ?? 0) / 10));
  if (result.data && page > lastPage) setPage(lastPage);
  return <fieldset className="catalog-fields"><legend>연결할 제공·수탁자 ({selected.length})</legend>
    <div className="catalog-selected">{selected.map(row => <button className="cs-link" type="button" key={row.id} onClick={() => change(selected.filter(item => item.id !== row.id))}>{row.name} · 연결 해제</button>)}</div>
    <input className="cs-input" aria-label="연결할 제공자 검색" placeholder="제공·수탁자 이름 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
    {result.loading && <p role="status">제공·수탁자를 불러오는 중입니다.</p>}{result.error && <p role="alert">{result.error.message}</p>}
    {result.data?.items.map(row => <label className="catalog-check" key={row.id}><input type="checkbox" checked={selected.some(item => item.id === row.id)} onChange={event => change(event.target.checked ? [...selected, row] : selected.filter(item => item.id !== row.id))} />{row.name} · {recipientKinds[row.kind]} · {countryNames.of(row.countryCode)}</label>)}
    {result.data?.total === 0 && <p>연결할 자료가 없습니다. 제공·수탁자 탭에서 먼저 등록해주세요.</p>}
    {!!result.data?.total && <div className="catalog-toolbar"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button>
      <span>{page} / {Math.ceil(result.data.total / 10)}</span><button type="button" disabled={page * 10 >= result.data.total} onClick={() => setPage(page + 1)}>다음</button></div>}
  </fieldset>;
}
function History({ kind, row }: { kind: Kind; row: Record }) {
  const [page, setPage] = useState(1);
  const result = useResource<CatalogHistory>(endpoint(kind) + "/" + row.id + "/history?page=" + page + "&pageSize=10");
  return <div className="catalog-editor"><p>저장 당시의 설정입니다. 연결된 제공자의 후속 수정은 이전 개정본을 바꾸지 않습니다.</p>
    {result.error && <p role="alert">{result.error.message}</p>}{result.loading && <p role="status">이력을 불러오는 중입니다.</p>}
    {result.data?.items.map(item => { const value = item.snapshot as Record;
      return <details key={item.id}><summary>개정 {item.version} · {new Date(item.createdAt).toLocaleString("ko-KR")} · {value.status === "active" ? "사용 중" : "보관"}</summary>
        <dl className="catalog-history"><dt>이름</dt><dd>{value.name}</dd><dt>목적</dt><dd>{value.purpose}</dd><dt>보유 기준</dt><dd>{retentionText(value)}</dd>
          {"lawfulBasis" in value ? <><dt>수집 근거</dt><dd>{basisLabels[value.lawfulBasis]} · {value.basisReference || "별도 설명 없음"}</dd>
            <dt>개인정보 항목</dt><dd>{value.items.map(field => <p key={field.name}>{field.name} · {itemKinds[field.kind]} · {field.required ? "필수" : "선택"}</p>)}</dd>
            <dt>당시 제공·수탁자</dt><dd>{value.recipients.length ? value.recipients.map(party => <p key={party.id}>{party.name} · {recipientKinds[party.kind]} · {countryNames.of(party.countryCode)} · {party.purpose} · {retentionText(party)}</p>) : "연결 없음"}</dd></>
            : <><dt>제공·수탁자 유형</dt><dd>{recipientKinds[value.kind]} · {countryNames.of(value.countryCode)}</dd><dt>항목</dt><dd>{value.items.join(", ")}</dd>
              <dt>연락처</dt><dd>{value.contact || "-"}</dd><dt>국외 처리</dt><dd>{[value.transferMethod, value.transferTiming, value.refusalNotice].filter(Boolean).join(" · ") || "-"}</dd></>}
        </dl></details>;
    })}{result.data && result.data.total > 10 && <div className="catalog-toolbar"><ActionButton secondary disabled={page === 1} onClick={() => setPage(page - 1)}>이전</ActionButton>
      <span>{page} / {Math.ceil(result.data.total / 10)}</span><ActionButton secondary disabled={page * 10 >= result.data.total} onClick={() => setPage(page + 1)}>다음</ActionButton></div>}
  </div>;
}
