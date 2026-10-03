"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { PdfDownload } from "../PdfDownload";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import { documentTypes, documentStates, documentInput, clauseInput, type DocumentRecord, type DocumentInput, type DocumentPreview, type DocumentOptions, type DocumentVersionRecord, type ClauseRecord, type ClauseInput } from "@/contracts/documents";
import type { Paged } from "@/contracts/forms";
import "./documents.css";

const listPath = (type?: string) => type === "privacy_policy" ? "/basic/result/policy" : "/basic/result/consent";
const editPath = (id: string) => "/basic/result/consent/edit?documentId=" + id;
const when = (date: string | null) => date ? new Date(date).toLocaleString("ko-KR") : "기한 없음";
const typeKeys = Object.keys(documentTypes) as DocumentInput["type"][];
export function Documents({ path }: { path: string }) {
  const params = useSearchParams();
  if (path.endsWith("/phrase")) return <ClauseManager />;
  if (path.endsWith("/create")) return <DocumentEditorPage key={params.toString()} type={typeKeys.includes(params.get("type") as DocumentInput["type"]) ? params.get("type") as DocumentInput["type"] : "consent"} />;
  if (path.endsWith("/edit")) return params.get("documentId") ? <DocumentEditorPage key={params.get("documentId")} id={params.get("documentId")!} /> : <Panel><p role="alert">문서 목록에서 수정할 문서를 선택해주세요.</p><Link href={listPath()}>문서 목록</Link></Panel>;
  return <DocumentList policy={path.endsWith("/policy")} />;
}
function DocumentList({ policy }: { policy: boolean }) {
  const app = useApplication(), canWrite = !!app.data?.capabilities.includes("document.write");
  const [service, setService] = useState(""), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [kind, setKind] = useState<DocumentInput["type"]>(policy ? "privacy_policy" : "consent");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20); const serviceId = service || app.data?.serviceId || "";
  const result = useResource<Paged<DocumentRecord>>(serviceId ? "/documents?" + new URLSearchParams({ serviceId, type: kind, search, status, page: String(page), pageSize: String(pageSize) }) : null);
  const maxPage = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize)); if (result.data && page > maxPage) setPage(maxPage);
  return <div className="documents-page"><PageHeading title={policy ? "처리방침 관리" : "동의서 목록"}>{canWrite && serviceId && <Link className="cs-button" href={`/basic/result/consent/create?type=${kind}&serviceId=${serviceId}`}>{policy ? "처리방침 생성" : "동의서 생성"}</Link>}</PageHeading>
    <div className="documents-nav"><Link href="/basic/info-usage-purpose">수집 목적·제공/수탁자</Link><Link href="/basic/result/consent/phrase">문구 관리</Link><Link href={policy ? listPath() : listPath("privacy_policy")}>{policy ? "동의서 목록" : "처리방침 관리"}</Link></div>
    <Panel><form className="documents-toolbar" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
      <label>서비스<select className="cs-input" aria-label="문서 서비스" value={serviceId} onChange={event => { setService(event.target.value); setPage(1); }}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!policy && <label>문서 유형<select className="cs-input" aria-label="문서 유형 필터" value={kind} onChange={event => { setKind(event.target.value as DocumentInput["type"]); setPage(1); }}>{typeKeys.filter(value => value !== "privacy_policy").map(value => <option key={value} value={value}>{documentTypes[value]}</option>)}</select></label>}
      <label>상태<select className="cs-input" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">전체</option>{Object.entries(documentStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>문서 제목<input className="cs-input" placeholder="제목 검색" value={query} onChange={event => setQuery(event.target.value)} /></label><ActionButton>검색</ActionButton><ActionButton type="button" secondary onClick={result.reload}>새로고침</ActionButton>
    </form><RemoteTable columns={["제목", "문서 유형", "상태", "게시 버전", "수정일", "관리"]} rows={(result.data?.items ?? []).map(row => ({ id: row.id, cells: [row.title, documentTypes[row.type], documentStates[row.status], row.latestNumber ? `v${row.latestNumber}${row.hasUnpublishedChanges ? " · 미게시 변경" : ""}` : "미게시", when(row.updatedAt), <Link key="open" href={editPath(row.id)}>상세·편집</Link>] }))}
      total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={result.loading} error={result.error?.message} />
    </Panel></div>;
}
function DocumentEditorPage({ id, type = "consent" }: { id?: string; type?: DocumentInput["type"] }) {
  const result = useResource<DocumentRecord>(id ? "/documents/" + id : null);
  if (id && !result.data) return <Panel>{result.error ? <><p role="alert">{result.error.message}</p><ActionButton onClick={result.reload}>다시 불러오기</ActionButton></> : <p role="status">문서를 불러오는 중입니다.</p>}</Panel>;
  return <DocumentEditor key={id ? id + ":" + result.data?.version : "new"} row={result.data} type={type} reload={result.reload} />;
}
function inputOf(row: DocumentRecord): DocumentInput { return { serviceId: row.serviceId, type: row.type, title: row.title, body: row.body, refusalNotice: row.refusalNotice, rightsContact: row.rightsContact, effectiveDate: row.effectiveDate, purposeIds: row.purposeIds, recipientIds: row.recipientIds }; }
function DocumentEditor({ row, type, reload }: { row?: DocumentRecord; type: DocumentInput["type"]; reload: () => void }) {
  const app = useApplication(), router = useRouter(), params = useSearchParams(), key = useRef(crypto.randomUUID());
  const [value, setValue] = useState<DocumentInput>(() => row ? inputOf(row) : { serviceId: params.get("serviceId") ?? "", type, title: documentTypes[type], body: "", refusalNotice: "", rightsContact: "", effectiveDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }), purposeIds: [], recipientIds: [] });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [templateId, setTemplateId] = useState("");
  const [action, setAction] = useState<"publish" | "unpublish" | "archive" | "restore" | "">(""), [expires, setExpires] = useState("");
  const serviceId = value.serviceId || app.data?.serviceId || "", canWrite = !!app.data?.capabilities.includes("document.write"), editable = canWrite && row?.status !== "archived";
  const options = useResource<DocumentOptions>(serviceId ? "/documents/options?serviceId=" + serviceId : null);
  const preview = useResource<DocumentPreview>(row ? "/documents/" + row.id + "/preview" : null);
  const dirty = !!row && JSON.stringify(value) !== JSON.stringify(inputOf(row));
  const patch = (changes: Partial<DocumentInput>) => { setValue(previous => ({ ...previous, ...changes })); setError(""); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const checked = documentInput.safeParse({ ...value, serviceId }); if (!checked.success) throw new Error(checked.error.issues.map(item => item.message).join(" "));
      const stored = await api<DocumentRecord>("/documents" + (row ? "/" + row.id : ""), { method: row ? "PATCH" : "POST", headers: row ? {} : { "Idempotency-Key": key.current }, body: JSON.stringify({ ...checked.data, ...(row ? { version: row.version } : {}) }) });
      if (row) reload(); else router.replace(editPath(stored.id));
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!row || busy) return; setBusy(true); setError("");
    try {
      if (action === "archive") { await api(`/documents/${row.id}`, { method: "DELETE", headers: { "If-Match": String(row.version) } }); router.push(listPath(row.type)); }
      else await api(`/documents/${row.id}/${action}`, { method: "POST", body: JSON.stringify({ version: row.version, ...(action === "publish" ? { expiresAt: expires ? new Date(expires).toISOString() : null } : {}) }) });
      setAction(""); reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function applyTemplate() {
    const template = options.data?.templates.find(item => item.id === templateId); if (!template || busy) return;
    if (!row) { patch({ body: template.body }); return; }
    setBusy(true); setError("");
    try { await api(`/documents/${row.id}/apply-clause`, { method: "POST", body: JSON.stringify({ version: row.version, templateId, templateVersion: template.version }) }); reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="documents-page"><PageHeading title={row ? row.title : documentTypes[type] + " 생성"}><Link href={listPath(value.type)}>목록으로</Link></PageHeading>
    {row && <div className="documents-toolbar"><strong>{documentStates[row.status]} · {row.latestNumber ? `게시 v${row.latestNumber}` : "미게시"}</strong>{row.hasUnpublishedChanges && row.latestNumber > 0 && <span>저장된 초안에 미게시 변경이 있습니다.</span>}
      {canWrite && (row.status === "archived" ? <ActionButton onClick={() => setAction("restore")}>초안으로 복원</ActionButton> : <>
        <ActionButton disabled={dirty || busy || !!preview.data?.publishErrors.length || (row.status === "published" && row.hasActivePublication && !row.hasUnpublishedChanges)} onClick={() => setAction("publish")}>게시하기</ActionButton>
        {row.status === "published" && <ActionButton secondary disabled={dirty || busy} onClick={() => setAction("unpublish")}>비공개로 전환</ActionButton>}
        <ActionButton secondary disabled={dirty || busy} onClick={() => setAction("archive")}>문서 보관</ActionButton></>)}
    </div>}
    {row?.status === "published" && !row.hasActivePublication && <p role="status">최신 게시본의 공개 링크가 종료되었습니다. 같은 내용으로도 다시 게시할 수 있습니다.</p>}
    {error && !action && <p role="alert" className="documents-error">{error}</p>}
    <div className="documents-grid"><Panel title="문서 초안"><form className="documents-fields" onSubmit={save}>
      <fieldset disabled={!editable || busy}><label>서비스<select className="cs-input" aria-label="문서 서비스" disabled={!!row} value={serviceId} onChange={event => { patch({ serviceId: event.target.value, purposeIds: [], recipientIds: [] }); setTemplateId(""); }}>{app.data?.services.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>문서 유형<select className="cs-input" disabled={!!row} value={value.type} onChange={event => { patch({ type: event.target.value as DocumentInput["type"] }); setTemplateId(""); }}>{typeKeys.map(item => <option key={item} value={item}>{documentTypes[item]}</option>)}</select></label>
        <label>문서 제목<input className="cs-input" required maxLength={200} value={value.title} onChange={event => patch({ title: event.target.value })} /></label>
        <label>시행일<input className="cs-input" type="date" required value={value.effectiveDate} onChange={event => patch({ effectiveDate: event.target.value })} /></label>
        <fieldset className="documents-selection"><legend>수집 목적</legend>{options.data?.purposes.map(item => <label key={item.id}><input type="checkbox" checked={value.purposeIds.includes(item.id)} onChange={event => patch({ purposeIds: event.target.checked ? [...value.purposeIds, item.id] : value.purposeIds.filter(id => id !== item.id) })} />{item.name}</label>)}
          {options.data && !options.data.purposes.length && <p>사용 중인 수집 목적이 없습니다.</p>}{value.purposeIds.filter(id => options.data && !options.data.purposes.some(item => item.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => patch({ purposeIds: value.purposeIds.filter(item => item !== id) })} />사용할 수 없는 목적 연결 · 해제 필요</label>)}</fieldset>
        <fieldset className="documents-selection"><legend>추가 제공·수탁자</legend><p>수집 목적에 연결된 제공·수탁자는 자동으로 포함됩니다.</p>{options.data?.recipients.map(item => <label key={item.id}><input type="checkbox" checked={value.recipientIds.includes(item.id)} onChange={event => patch({ recipientIds: event.target.checked ? [...value.recipientIds, item.id] : value.recipientIds.filter(id => id !== item.id) })} />{item.name} · {item.countryCode}</label>)}
          {value.recipientIds.filter(id => options.data && !options.data.recipients.some(item => item.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => patch({ recipientIds: value.recipientIds.filter(item => item !== id) })} />사용할 수 없는 제공·수탁자 연결 · 해제 필요</label>)}</fieldset>
        <Link href="/basic/info-usage-purpose">수집 목적·제공/수탁자 관리</Link>
        <div className="documents-toolbar"><label>저장된 문구<select className="cs-input" value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">문구 선택</option>{options.data?.templates.filter(item => item.type === value.type).map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label><ActionButton type="button" secondary disabled={!templateId || dirty || busy} onClick={applyTemplate}>본문에 적용</ActionButton></div>
        <label>안내 본문<textarea className="cs-input documents-body" maxLength={20000} value={value.body} onChange={event => patch({ body: event.target.value })} /></label>
        <label>동의 거부 안내<textarea className="cs-input" maxLength={3000} value={value.refusalNotice} onChange={event => patch({ refusalNotice: event.target.value })} /></label>
        <label>권리 행사·문의 안내<textarea className="cs-input" maxLength={2000} value={value.rightsContact} onChange={event => patch({ rightsContact: event.target.value })} /></label>
      </fieldset>{options.error && <p role="alert">{options.error.message}</p>}{editable && <ActionButton disabled={busy || !serviceId}>{busy ? "저장 중…" : "초안 저장·미리보기"}</ActionButton>}
      {dirty && <p role="status">변경 내용을 저장한 뒤 미리보기와 게시를 진행해주세요.</p>}
    </form></Panel><Panel title="저장한 내용 미리보기">{!row ? <p>초안을 저장하면 수집 목적과 제공·수탁자 안내를 함께 확인할 수 있습니다.</p> : preview.error ? <p role="alert">{preview.error.message}</p> : !preview.data ? <p role="status">미리보기를 불러오는 중입니다.</p> : <>
      {!!preview.data.publishErrors.length && <div className="documents-note"><strong>게시 전 확인</strong><ul>{preview.data.publishErrors.map(message => <li key={message}>{message}</li>)}</ul></div>}
      <pre className="document-content">{preview.data.renderedText}</pre></>}
    </Panel></div>
    {row && <DocumentVersions row={row} canWrite={canWrite} disabled={dirty} onChange={reload} />}
    {action && row && <Modal title={{ publish: "문서 게시", unpublish: "문서 비공개 전환", archive: "문서 보관", restore: "문서 복원" }[action]} onClose={() => { if (!busy) { setAction(""); setError(""); } }}>
      {action === "publish" ? <><p>미리보기의 내용과 기초 자료를 새 버전으로 고정하고 공개 링크를 만듭니다. 공개 링크를 아는 사람은 이 문서를 볼 수 있습니다.</p><label>공개 종료 일시 (선택)<input className="cs-input" type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></label></> : <p>{action === "restore" ? "초안으로 복원합니다. 이전에 회수한 공개 링크는 계속 닫혀 있습니다." : "이 문서의 모든 공개 링크를 회수합니다. 게시 버전과 이력은 보존합니다. 서비스에 연결된 처리방침은 먼저 연결을 해제해주세요."}</p>}
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={confirm}>{busy ? "처리 중…" : "확인"}</ActionButton>
    </Modal>}</div>;
}
function DocumentVersions({ row, canWrite, disabled, onChange }: { row: DocumentRecord; canWrite: boolean; disabled: boolean; onChange: () => void }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [first, setFirst] = useState(""), [second, setSecond] = useState(""), [revoke, setRevoke] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const result = useResource<Paged<DocumentVersionRecord>>(`/documents/${row.id}/versions?page=${page}&pageSize=${pageSize}`);
  const versions = result.data?.items ?? [], current = versions.find(item => item.id === first) ?? versions[0], previous = versions.find(item => item.id === second) ?? versions[1];
  async function confirm() {
    setBusy(true); setError(""); try { await api(`/documents/${row.id}/revoke`, { method: "POST", body: JSON.stringify({ version: row.version, publicationId: revoke }) }); setRevoke(""); onChange(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <Panel title="게시 버전과 공개 링크"><RemoteTable columns={["버전", "게시일", "공개 링크", "기한", "관리"]} rows={versions.map(version => ({ id: version.id, cells: ["v" + version.number, when(version.createdAt),
    <div key="links" className="documents-fields">{version.publications.map(link => <div key={link.id}>{link.url && link.status === "active" ? <Link href={link.url}>v{version.number} 공개 문서 열기</Link> : link.status === "revoked" ? "회수됨" : link.status === "expired" ? "만료됨" : "공개 중"}{!!link.displayCount && <span> · 서비스 연결 중</span>}</div>)}</div>,
    <div key="expires">{version.publications.map(link => <p key={link.id}>{when(link.expiresAt)}</p>)}</div>, <div key="action" className="documents-fields"><PdfDownload path={`/documents/${row.id}/versions/${version.number}/pdf`} label={`v${version.number} PDF 다운로드`} />{canWrite && row.status !== "archived" && version.publications.filter(link => link.status !== "revoked").map(link => <button className="cs-link" key={link.id} disabled={disabled} onClick={() => setRevoke(link.id)}>링크 회수</button>)}</div>,
  ] }))} total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={value => { setPage(value); setFirst(""); setSecond(""); }} onPageSize={size => { setPageSize(size); setPage(1); setFirst(""); setSecond(""); }} loading={result.loading} error={result.error?.message} />
    {current && <><div className="documents-toolbar"><label>확인할 버전<select className="cs-input" aria-label="확인할 버전" value={current.id} onChange={event => setFirst(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>v{version.number}</option>)}</select></label>
      {versions.length > 1 && <label>비교할 버전<select className="cs-input" aria-label="비교할 버전" value={previous?.id ?? ""} onChange={event => setSecond(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>v{version.number}</option>)}</select></label>}</div>
      <div className="documents-comparison"><VersionBody version={current} />{previous && <VersionBody version={previous} />}</div></>}
    {revoke && <Modal title="공개 링크 회수" onClose={() => { if (!busy) { setRevoke(""); setError(""); } }}><p>이 버전의 공개 링크를 닫습니다. 게시 이력과 다른 버전의 링크는 유지됩니다.</p>{error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={confirm}>회수 확인</ActionButton></Modal>}
  </Panel>;
}
function VersionBody({ version }: { version: DocumentVersionRecord }) { return <section><h3>v{version.number}</h3><pre className="document-content">{version.renderedText}</pre><details><summary>문서 해시 (SHA-256)</summary><code className="documents-hash">{version.contentHash}</code></details></section>; }
function ClauseManager() {
  const app = useApplication(), canWrite = !!app.data?.capabilities.includes("document.write");
  const [service, setService] = useState(""), [status, setStatus] = useState("active"), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState<{ row?: ClauseRecord }>(), [action, setAction] = useState<ClauseRecord>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const serviceId = service || app.data?.serviceId || "", result = useResource<Paged<ClauseRecord>>(serviceId ? "/clause-templates?" + new URLSearchParams({ serviceId, status, search, page: String(page), pageSize: String(pageSize) }) : null);
  const maxPage = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize)); if (result.data && page > maxPage) setPage(maxPage);
  async function confirm() {
    if (!action) return; setBusy(true); setError(""); try { await api("/clause-templates/" + action.id + (action.status === "archived" ? "/restore" : ""), action.status === "archived" ? { method: "POST", body: JSON.stringify({ version: action.version }) } : { method: "DELETE", headers: { "If-Match": String(action.version) } }); setAction(undefined); result.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="documents-page"><PageHeading title="동의서·처리방침 문구 관리">{canWrite && serviceId && <ActionButton onClick={() => setEditor({})}>문구 추가</ActionButton>}</PageHeading><div className="documents-nav"><Link href={listPath()}>동의서 목록</Link><Link href={listPath("privacy_policy")}>처리방침 관리</Link></div>
    <Panel><form className="documents-toolbar" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}><label>서비스<select className="cs-input" value={serviceId} onChange={event => { setService(event.target.value); setPage(1); }}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>상태<select className="cs-input" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">사용 중</option><option value="archived">보관함</option><option value="all">전체</option></select></label><label>문구 제목<input className="cs-input" value={query} onChange={event => setQuery(event.target.value)} /></label><ActionButton>검색</ActionButton></form>
      <RemoteTable columns={["제목", "문서 유형", "버전", "상태", "관리"]} rows={(result.data?.items ?? []).map(row => ({ id: row.id, cells: [row.title, documentTypes[row.type], "v" + row.version, row.status === "active" ? "사용 중" : "보관", <div className="forms-row-actions" key="actions"><button onClick={() => setEditor({ row })}>{canWrite && row.status === "active" ? "상세·수정" : "상세"}</button>{canWrite && <button onClick={() => setAction(row)}>{row.status === "active" ? "보관" : "복원"}</button>}</div>] }))}
        total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={result.loading} error={result.error?.message} />
    </Panel>{editor && <Modal title={editor.row ? "문구 상세·수정" : "문구 추가"} onClose={() => setEditor(undefined)}><ClauseEditor row={editor.row} serviceId={serviceId} canWrite={canWrite} onSaved={() => { setEditor(undefined); result.reload(); }} /></Modal>}
    {action && <Modal title={action.status === "active" ? "문구 보관" : "문구 복원"} onClose={() => { if (!busy) { setAction(undefined); setError(""); } }}><p>“{action.title}” 문구를 {action.status === "active" ? "보관" : "복원"}합니다. 이미 적용한 문서 내용은 유지됩니다.</p>{error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={confirm}>확인</ActionButton></Modal>}
  </div>;
}
function ClauseEditor({ row, serviceId, canWrite, onSaved }: { row?: ClauseRecord; serviceId: string; canWrite: boolean; onSaved: () => void }) {
  const [value, setValue] = useState<ClauseInput>(row ? { serviceId: row.serviceId, type: row.type, title: row.title, body: row.body } : { serviceId, type: "consent", title: "", body: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef(crypto.randomUUID()), editable = canWrite && row?.status !== "archived";
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const checked = clauseInput.parse(value); await api("/clause-templates" + (row ? "/" + row.id : ""), { method: row ? "PATCH" : "POST", headers: row ? {} : { "Idempotency-Key": key.current }, body: JSON.stringify({ ...checked, ...(row ? { version: row.version } : {}) }) }); onSaved(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <form className="documents-fields" onSubmit={save}><fieldset disabled={!editable || busy}><label>문서 유형<select className="cs-input" disabled={!!row} value={value.type} onChange={event => setValue({ ...value, type: event.target.value as DocumentInput["type"] })}>{typeKeys.map(type => <option key={type} value={type}>{documentTypes[type]}</option>)}</select></label><label>문구 제목<input className="cs-input" required maxLength={200} value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} /></label><label>문구 본문<textarea className="cs-input documents-body" required maxLength={20000} value={value.body} onChange={event => setValue({ ...value, body: event.target.value })} /></label></fieldset>{error && <p role="alert">{error}</p>}{editable && <ActionButton disabled={busy}>문구 저장</ActionButton>}</form>;
}
export function PublicDocument({ path }: { path: string }) {
  const token = path.match(/^\/document\/view\/([A-Za-z0-9_-]{43})$/)?.[1];
  const result = useResource<{ number: number; publishedAt: string; expiresAt: string | null; renderedText: string; contentHash: string }>(token ? "/public/documents/" + token : null);
  return <main className="document-public"><Panel>{!token || result.error ? <><h1>문서를 열 수 없습니다.</h1><p role="alert">{result.error?.message ?? "올바른 공개 문서 링크를 확인해주세요."}</p></> : !result.data ? <p role="status">문서를 불러오는 중입니다.</p> : <><div className="document-public-meta">게시 버전 v{result.data.number} · {when(result.data.publishedAt)}</div><PdfDownload path={"/public/documents/" + token + "/pdf"} /><pre className="document-content">{result.data.renderedText}</pre><details><summary>문서 해시 (SHA-256)</summary><code className="documents-hash">{result.data.contentHash}</code></details></>}</Panel></main>;
}
