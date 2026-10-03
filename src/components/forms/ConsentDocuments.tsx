"use client";
import { useState } from "react";
import type { ConsentDisplaySnapshot, FormConsentBundle, FormDocumentOption, DocumentSelection } from "@/contracts/form-documents";
import type { Paged } from "@/contracts/forms";
import { useResource } from "@/lib/api";

export function ConsentDisplay({ display }: { display: ConsentDisplaySnapshot | null | undefined }) {
  if (!display) return null;
  return <div className="consent-display"><p><strong>{display.name}</strong></p><p>{display.startText}</p>
    {display.processorText && <p>{display.processorText}</p>}{display.policyText && <p>{display.policyText}</p>}
    {display.policy?.kind === "external" && <a className="cs-link" href={display.policy.url} target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>}
    {display.policy?.kind === "document" && <details><summary>개인정보 처리방침 v{display.policy.number} · {display.policy.title}</summary>
      <pre>{display.policy.renderedText}</pre><p className="consent-hash">본문 해시: {display.policy.contentHash}</p></details>}
  </div>;
}
export function ConsentDocuments({ bundle, selectable = false }: { bundle: FormConsentBundle | null | undefined; selectable?: boolean }) {
  if (!bundle?.documents.length) return null;
  return <div className="consent-documents">{bundle.documents.map(document => <section className="public-consent" key={document.key}>
    <h3>{document.title} · v{document.number}</h3><ConsentDisplay display={document.display} />
    <details><summary>동의 문서 전체 보기 · {document.kind === "collection" ? "수집·이용" : "제3자 제공"}</summary>
      <pre>{document.renderedText}</pre><p className="consent-hash">본문 해시: {document.contentHash}</p></details>
    <p>{document.required ? document.display.requiredText : document.display.optionalText}</p>
    {selectable ? <label className="cs-row"><input type="checkbox" name="documentConsents" value={document.key} required={document.required} />
      [{document.required ? "필수" : "선택"}] {document.title} v{document.number}에 동의합니다.</label> : <p>{document.required ? "필수" : "선택"} 동의 항목</p>}
  </section>)}</div>;
}
export function FormDocumentsEditor({ serviceId, selections, stored, onChange }: { serviceId: string; selections: DocumentSelection[];
  stored?: Record<string, Pick<FormDocumentOption, "title" | "number"> | undefined>; onChange: (value: DocumentSelection[]) => void }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [known, setKnown] = useState<Record<string, FormDocumentOption>>({});
  const result = useResource<Paged<FormDocumentOption>>("/forms/document-options?" + new URLSearchParams({ serviceId, page: String(page), pageSize: "20", search: query }));
  const candidates = { ...known, ...Object.fromEntries((result.data?.items ?? []).map(item => [item.documentVersionId, item])) };
  const labels = { ...stored, ...candidates };
  return <section className="form-document-editor"><h3>게시 문서 연결</h3>
    <p>같은 서비스의 공개 중인 동의서를 최대 10개 연결합니다. 폼의 보유 기간은 문서에 기재한 기간 이내여야 합니다.</p>
    <div className="forms-actions"><input className="cs-input" aria-label="동의 문서 검색" placeholder="문서 제목" value={search} onChange={event => setSearch(event.target.value)} />
      <button type="button" className="cs-button secondary" onClick={() => { setKnown(candidates); setQuery(search); setPage(1); }}>문서 검색</button></div>
    {result.error && <p role="alert">{result.error.message}</p>}{result.loading && <p role="status">문서를 불러오는 중입니다.</p>}
    {!result.loading && !result.error && <><select className="cs-input" aria-label="연결할 게시 문서" value="" disabled={selections.length >= 10} onChange={event => {
      const option = candidates[event.target.value]; if (!option) return;
      setKnown(candidates); onChange([...selections, { documentVersionId: option.documentVersionId, kind: "collection", required: true }]);
    }}><option value="">게시 문서 선택</option>{result.data?.items.filter(item => !selections.some(selected => selected.documentVersionId === item.documentVersionId)).map(item =>
      <option key={item.documentVersionId} value={item.documentVersionId}>{item.title} · v{item.number}{item.maximumRetentionDays !== null ? ` · 최대 ${item.maximumRetentionDays}일` : ""}</option>)}</select>
      <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개 · {page}페이지</span><button type="button" disabled={page <= 1} onClick={() => { setKnown(candidates); setPage(page - 1); }}>이전 문서</button>
        <button type="button" disabled={page * 20 >= (result.data?.total ?? 0)} onClick={() => { setKnown(candidates); setPage(page + 1); }}>다음 문서</button></div></>}
    {selections.map((selection, index) => <div className="form-document-selection" key={selection.documentVersionId}>
      <strong>{labels[selection.documentVersionId]?.title ?? `연결 문서 ${index + 1}`}{labels[selection.documentVersionId] ? ` · v${labels[selection.documentVersionId]?.number}` : ""}</strong>
      <select className="cs-input" aria-label={`문서 ${index + 1} 동의 유형`} value={selection.kind} onChange={event => onChange(selections.map((item, i) => i === index ? { ...item, kind: event.target.value as DocumentSelection["kind"] } : item))}>
        <option value="collection">수집·이용</option><option value="third_party">제3자 제공</option></select>
      <label><input type="checkbox" checked={selection.required} onChange={event => onChange(selections.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} /> 필수 동의</label>
      <button type="button" className="cs-link" onClick={() => onChange(selections.filter((_, i) => i !== index))}>연결 해제</button>
    </div>)}
  </section>;
}
