"use client";
import { AuthorAssetProvider, useAuthorAsset } from "./AuthorAssetProvider";
import { hasAuthorAssets } from "@/lib/author-assets";
import { QuestionChoiceSummary } from "./QuestionChoiceSummary";
import { QuestionSummary } from "./QuestionSummary";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, ActionButton, Modal, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { FormRecord, TemplateRecord, TemplatePage } from "@/contracts/forms";
import sourceTemplates from "./templates.json";
import { formLanguageLabel } from "@/contracts/form-language";

function TemplateThumbnail({ id, title }: { id: string | null; title: string }) {
  const { asset, loading } = useAuthorAsset(id);
  if (!id) return <span className="forms-template-thumbnail-placeholder" aria-hidden="true" />;
  if (!asset) return <span className="forms-template-thumbnail-placeholder" role="status">{loading ? "불러오는 중" : "이미지 없음"}</span>;
  return <img className="forms-template-thumbnail" src={asset.url} alt={title + " 대표 이미지"} loading="lazy" referrerPolicy="no-referrer" />;
}
function Preview({ id }: { id: string }) {
  const result = useResource<TemplateRecord>("/templates/" + id), row = result.data;
  if (result.error) return <div><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>미리보기 다시 불러오기</ActionButton></div>;
  if (!row) return <p role="status">템플릿을 불러오는 중입니다.</p>;
  return <AuthorAssetProvider scope={{ kind: "template", id: row.id, version: row.version }} enabled={hasAuthorAssets(row.content.questions) || !!row.thumbnailAssetId}><div className="cs-stack">
    <TemplateThumbnail id={row.thumbnailAssetId} title={row.title} />{row.description && <p style={{ whiteSpace: "pre-wrap" }}>{row.description}</p>}
    <p>캐치폼 서비스 언어: {formLanguageLabel(row.content.formLanguage)}</p><p style={{ whiteSpace: "pre-wrap" }}>{row.content.body}</p>
    {row.content.questions.map((question, index) => <section className="forms-note" key={question.id}><h3>Q{index + 1}. {question.label} {question.required && "(필수)"}</h3>
      <p>{question.type}</p><QuestionSummary question={question} questions={row.content.questions} language={row.content.formLanguage} /><QuestionChoiceSummary question={question} language={row.content.formLanguage} /></section>)}
    <p>개인정보 동의: {row.content.consentRequired ? "필수" : "선택"} · {row.content.consentPurpose || "별도 목적 없음"}</p>
    <p>보유 기간 {row.content.retentionDays}일 · 최대 응답 {row.content.maxResponses}건</p></div></AuthorAssetProvider>;
}
export function TemplateGallery() {
  const app = useApplication(), router = useRouter(), searchParams = useSearchParams();
  const [company, setCompany] = useState(searchParams.get("scope") === "company"), [sourcePreview, setSourcePreview] = useState<number | null>(null);
  const [preview, setPreview] = useState<TemplateRecord>(), [use, setUse] = useState<TemplateRecord>(), [remove, setRemove] = useState<TemplateRecord>();
  const [target, setTarget] = useState(""), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), scope: company ? "company" : "public", search });
  if (company && app.data?.serviceId) params.set("serviceId", app.data.serviceId);
  const result = useResource<TemplatePage>(app.data ? "/templates?" + params : null);
  const targets = result.data?.permissions.targets ?? [];
  return <><PageHeading title="캐치폼 템플릿"><p>목적에 맞는 템플릿을 저장하고 질문·동의·응답 설정을 새 캐치폼으로 복제하세요.</p>
    {result.data?.permissions.canCreate && <Link className="cs-button" href="/form/ai/create?templateEdit=new">템플릿 생성</Link>}</PageHeading>
    <div className="forms-tabs" role="tablist">{["캐치폼 템플릿", "서비스 템플릿"].map((label, index) => <button role="tab" aria-selected={company === (index === 1)}
      className={company === (index === 1) ? "active" : ""} key={label} onClick={() => { setCompany(index === 1); setPage(1); setError(""); }}>{label}</button>)}</div>
    {(company || !!result.data?.items.length || !!result.error) && <Panel><form className="forms-filter" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
      <input className="cs-input" aria-label="템플릿 검색" placeholder="제목·분류·설명" value={query} onChange={event => setQuery(event.target.value)} /><ActionButton secondary>검색</ActionButton></form>
      {result.error && <div><p role="alert">{result.error.message}</p><ActionButton secondary disabled={result.loading} onClick={result.reload}>템플릿 목록 다시 불러오기</ActionButton></div>}
      {!use && !remove && error && <p role="alert">{error}</p>}
      <RemoteTable columns={["제목", "설명", "분류", "서비스", "이용 범위", "질문 수", "수정일", "관리"]} rows={(result.data?.items ?? []).map(row => ({ id: row.id, cells: [
        row.title, row.description || "설명 없음", row.category, row.serviceName ?? "공용",
        row.licenseScope === "ACTIVE_SUBSCRIPTION" ? row.licenseAvailable ? "유효 구독" : "유료 구독 필요" : "서비스 구성원",
        row.content.questions.length, new Date(row.updatedAt).toLocaleDateString("ko-KR"),
        <div className="forms-row-actions" key="actions"><button onClick={() => setPreview(row)}>미리보기</button>
          {row.actions?.use && <button onClick={() => { setUse(row); setTarget(targets.find(service => service.id === app.data?.serviceId)?.id ?? targets[0]?.id ?? ""); setError(""); }}>사용하기</button>}
          {!row.actions?.use && row.licenseScope === "ACTIVE_SUBSCRIPTION" && !row.licenseAvailable && <span className="cs-muted">구독 필요</span>}
          {row.actions?.edit && <Link href={"/form/ai/create?templateEdit=" + row.id}>편집</Link>}
          {row.actions?.remove && <button onClick={() => { setRemove(row); setError(""); }}>삭제</button>}</div>] }))}
        total={result.data?.total ?? 0} page={result.data?.page ?? page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={result.loading} error={result.error?.message} empty="등록된 템플릿이 없습니다." />
    </Panel>}
    {!company && <><p className="cs-muted">아래 양식은 미리보기 전용입니다. 서비스 템플릿에서 직접 양식을 만들어 사용할 수 있습니다.</p>
      <div className="forms-gallery">{sourceTemplates.map((template, index) => <article className="forms-template" key={template.title}>
        <div className="forms-template-image"><img src={template.image} alt={template.title} /></div><h2>{template.title}</h2><p>{template.description}</p>
        <div className="forms-actions"><ActionButton secondary onClick={() => setSourcePreview(index)}>미리보기</ActionButton><span className="cs-muted">미리보기 전용</span></div></article>)}</div></>}
    {sourcePreview !== null && <Modal title={sourceTemplates[sourcePreview].title} onClose={() => setSourcePreview(null)}>
      <p>{sourceTemplates[sourcePreview].description}</p><img className="forms-preview-image" src={sourceTemplates[sourcePreview].image} alt={sourceTemplates[sourcePreview].title} /></Modal>}
    {preview && <Modal title={preview.title} onClose={() => setPreview(undefined)}><Preview key={preview.id} id={preview.id} /></Modal>}
    {use && <Modal title="템플릿으로 캐치폼 생성" onClose={() => { if (!busy) setUse(undefined); }}><form className="cs-stack" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError("");
      try {
        const payload = JSON.stringify({ serviceId: target, version: use.version });
        const scope = use.id + ":" + payload, key = keys.current.get(scope) ?? crypto.randomUUID(); keys.current.set(scope, key);
        const created = await api<FormRecord>("/templates/" + use.id + "/use", { method: "POST", body: payload, headers: { "Idempotency-Key": key } });
        keys.current.delete(scope); router.push("/form/ai/create?formId=" + created.id);
      } catch (error) { setError(errorText(error)); if (error instanceof ApiError && [403, 404, 409, 410].includes(error.status)) result.reload(); } finally { setBusy(false); }
    }}><p>{use.title}의 질문, 선택지, 동의 내용과 응답 설정을 복제합니다.</p>
      <label className="cs-label">생성할 서비스<select className="cs-input" aria-label="생성할 서비스" value={target} required onChange={event => setTarget(event.target.value)}>
        <option value="">서비스 선택</option>{targets.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "생성 중…" : "캐치폼 생성"}</ActionButton></form></Modal>}
    {remove && <Modal title="템플릿 삭제" onClose={() => { if (!busy) setRemove(undefined); }}><p>“{remove.title}” 템플릿을 삭제합니다. 이미 생성한 캐치폼은 유지됩니다.</p>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await api("/templates/" + remove.id, { method: "DELETE", headers: { "If-Match": String(remove.version) } }); setRemove(undefined); result.reload(); }
        catch (error) { setError(errorText(error)); if (error instanceof ApiError && [403, 404, 409, 410].includes(error.status)) result.reload(); } finally { setBusy(false); }
      }}>{busy ? "삭제 중…" : "템플릿 삭제 확인"}</ActionButton></Modal>}
  </>;
}
