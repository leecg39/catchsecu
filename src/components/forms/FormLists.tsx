"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { formStatus, type FormDeletionState, type FormPage, type FormRecord } from "@/contracts/forms";
import { QuestionSummary } from "./QuestionSummary";
import { ConsentDisplay, ConsentDocuments } from "./ConsentDocuments";
import { Marketing } from "./Marketing";
import { FixedUrls } from "./FixedUrls";

export function FormLists({ kind }: { kind: "manage" | "marketing" | "fixed" }) {
  if (kind === "fixed") return <FixedUrls />;
  if (kind === "marketing") return <Marketing />;
  return <ManageForms />;
}
function ManageForms() {
  const app = useApplication();
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [expanded, setExpanded] = useState(false);
  const [favorite, setFavorite] = useState(false), [status, setStatus] = useState(""), [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [archive, setArchive] = useState<FormRecord>();
  const [sort, setSort] = useState("createdAt"), [direction, setDirection] = useState("desc");
  const [preview, setPreview] = useState<FormRecord>(), [remove, setRemove] = useState<FormRecord>();
  const [designate, setDesignate] = useState<FormRecord>();
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState("");
  const copyKeys = useRef(new Map<string, string>());
  const params = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize), favorite: String(favorite), sort, direction });
  if (status) params.set("status", status);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (app.data?.serviceId) params.set("serviceId", app.data.serviceId);
  const result = useResource<FormPage>(app.data ? "/forms?" + params : null);
  const shownPage = result.data?.page ?? page;
  async function perform(id: string, action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(id); setError(""); setMessage("");
    try { await action(); setMessage(message); result.reload(); } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && [403, 404, 409, 410].includes(cause.status)) result.reload();
    } finally { setBusy(""); }
  }
  return <><PageHeading title="캐치폼·업로드 목록"><p>캐치폼과 수집한 응답을 관리할 수 있습니다.</p>
    {result.data?.permissions.canViewImports && <Link href="/form/info-upload" className="cs-button secondary">업로드 작업 목록</Link>}
    <div className="forms-actions">{result.data?.permissions.canCreate && <Link href="/form/ai/create?new=1" className="cs-button">캐치폼 생성</Link>}
      {result.data?.permissions.canImport && <Link href="/form/info-upload" className="cs-button secondary">개인정보 업로드</Link>}</div></PageHeading>
    <Panel><form className="forms-filter" onSubmit={event => { event.preventDefault(); setSearch(query); setPage(1); }}>
      <input className="cs-input" aria-label="캐치폼 검색" placeholder="캐치폼명 또는 생성자명을 입력해주세요." value={query} onChange={event => setQuery(event.target.value)} />
      <ActionButton>검색</ActionButton><ActionButton type="button" secondary onClick={() => setExpanded(!expanded)}>상세 검색 {expanded ? "닫기" : "열기"}</ActionButton></form>
      {expanded && <div className="forms-expanded"><div className="forms-filter"><label>생성 시작일<input type="date" aria-label="시작일" value={start} onChange={event => { setStart(event.target.value); setPage(1); }} /></label>
        <label>생성 종료일<input type="date" aria-label="종료일" value={end} onChange={event => { setEnd(event.target.value); setPage(1); }} /></label>
        <label>공개상태 <select aria-label="공개상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">보관 제외</option><option value="all">전체</option>
          {Object.entries(formStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <ActionButton secondary onClick={() => { setQuery(""); setSearch(""); setStart(""); setEnd(""); setStatus(""); setFavorite(false); setPage(1); }}>검색 조건 초기화</ActionButton>
      </div></div>}
      <div className="forms-between"><p>{app.data?.services.find(service => service.id === app.data?.serviceId)?.name ?? "접근 가능한 서비스"}</p>
        <label>정렬 <select aria-label="캐치폼 정렬 기준" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="createdAt">생성일</option><option value="name">캐치폼명</option></select></label>
        <label>순서 <select aria-label="캐치폼 정렬 순서" value={direction} onChange={event => { setDirection(event.target.value); setPage(1); }}><option value="desc">내림차순</option><option value="asc">오름차순</option></select></label>
        <label><input type="checkbox" checked={favorite} onChange={event => { setFavorite(event.target.checked); setPage(1); }} /> 즐겨찾기만 보기</label></div>
      {error && <p role="alert">{error}</p>}<p role="status">{message}</p>
      <RemoteTable columns={["#", "즐겨찾기", "공개상태", "서비스 명", "캐치폼 명", "생성자", "현재 게시 응답", "생성일", "보유 기간", "설정"]}
        page={shownPage} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} total={result.data?.total ?? 0}
        loading={result.loading} error={result.error?.message} rows={(result.data?.items ?? []).map((form, index) => ({ id: form.id, cells: [
          (shownPage - 1) * pageSize + index + 1,
          <button key="favorite" disabled={!!busy} aria-label={form.title + " 즐겨찾기"} aria-pressed={form.favorite} onClick={() => perform(form.id,
            () => api("/forms/" + form.id + "/favorite", { method: form.favorite ? "DELETE" : "PUT" }), "즐겨찾기를 변경했습니다.")}>{form.favorite ? "★" : "☆"}</button>,
          formStatus[form.status], form.serviceName,
          form.actions?.responses ? <Link key="responses" href={"/form/manage/applicant/" + form.id}>{form.title}</Link> : <button key="preview-title" className="cs-link" onClick={() => setPreview(form)}>{form.title}</button>, form.ownerName,
          form.publication ? form.publication.responseCount + " / " + form.publication.maxResponses : "-",
          new Date(form.createdAt).toLocaleDateString("ko-KR"), form.content.retentionDays === null ? "미지정" : form.content.retentionDays + "일",
          <div key="actions" className="forms-row-actions">
            {form.actions?.preview && <button disabled={!!busy} onClick={() => setPreview(form)}>미리보기</button>}
            {form.actions?.edit && <Link className="cs-link" href={"/form/ai/create?formId=" + form.id}>편집</Link>}
            {form.actions?.edit && form.content.retentionDays === null && result.data?.permissions.canDesignateRetention && <button disabled={!!busy} onClick={() => { setError(""); setDesignate(form); }}>보유 지정</button>}
            {form.actions?.registerTemplate && <Link className="cs-link" href={"/form/ai/create?templateEdit=new&formId=" + form.id}>템플릿 등록</Link>}
            {form.actions?.copy && <button disabled={!!busy} onClick={() => {
                const key = copyKeys.current.get(form.id) ?? crypto.randomUUID();
                copyKeys.current.set(form.id, key);
                perform(form.id, async () => { await api("/forms/" + form.id + "/copy", { method: "POST", body: "{}", headers: { "Idempotency-Key": key } }); copyKeys.current.delete(form.id); }, "캐치폼을 복사했습니다.");
              }}>복사</button>}
            {form.actions?.share && <Link className="cs-link" href={"/form/ai/share?formId=" + form.id}>공유</Link>}
            {(form.actions?.pause || form.actions?.resume) && <button disabled={!!busy} onClick={() => perform(form.id,
                () => api("/forms/" + form.id + (form.status === "published" ? "/pause" : "/resume"), { method: "POST", body: JSON.stringify({ version: form.version }) }),
                form.status === "published" ? "공개를 중지했습니다." : "공개를 재개했습니다.")}>{form.status === "published" ? "일시 중지" : "공개 재개"}</button>}
            {form.actions?.archive && <button disabled={!!busy} onClick={() => { setError(""); setArchive(form); }}>보관</button>}
            {form.actions?.checkDeletion && <button disabled={!!busy} onClick={() => { setError(""); setRemove(form); }}>완전 삭제</button>}
          </div>,
        ] }))} />
    </Panel>{preview && <Modal title="캐치폼 미리보기" onClose={() => setPreview(undefined)}><FormPreview key={preview.id} id={preview.id} /></Modal>}
    {remove && <Modal title="캐치폼 완전 삭제" onClose={() => { if (!busy) setRemove(undefined); }}><DeleteForm key={remove.id} form={remove} busy={!!busy} error={error} onDelete={state => perform(remove.id, async () => {
      await api("/forms/" + remove.id + "/purge", { method: "DELETE", headers: { "If-Match": String(state.version) } }); setRemove(undefined);
    }, "캐치폼을 완전 삭제했습니다.")} /></Modal>}
    {archive && <Modal title="캐치폼 보관" onClose={() => { if (!busy) setArchive(undefined); }}>
      <p>“{archive.title}” 캐치폼의 공개를 종료하고 보관합니다. 기존 응답 기록은 유지됩니다.</p>
      {error && <p role="alert">{error}</p>}
      <ActionButton disabled={!!busy} onClick={() => perform(archive.id, async () => {
        await api("/forms/" + archive.id, { method: "DELETE", headers: { "If-Match": String(archive.version) } }); setArchive(undefined);
      }, "캐치폼을 보관했습니다.")}>보관</ActionButton></Modal>}
    {designate && <DesignateRetention key={designate.id} form={designate} busy={!!busy} error={error} onSaved={() => setDesignate(undefined)} />}
  </>;
}
function DesignateRetention({ form, busy, error, onSaved }: { form: FormRecord; busy: boolean; error: string; onSaved: () => void }) {
  const [days, setDays] = useState(365), [confirmed, setConfirmed] = useState(false);
  return <Modal title="보유 기간 사후 지정" onClose={() => { if (!busy) onSaved(); }}>
    <div className="cs-stack">
      <p>“{form.title}” 캐치폼은 보유 기간이 미지정되어 접수 시점의 회사 기본 보유 기간이 적용되고 있습니다. 이 폼의 보유 기간을 직접 지정합니다.</p>
      <label className="cs-label">보유 기간 (일)<input className="cs-input" aria-label="지정할 보유 기간" type="number" min={1} max={36500} value={days} onChange={event => setDays(Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> 이미 접수된 응답의 보유 기한은 그대로 유지되고 이후 접수 건부터 지정한 기간이 적용되는 것을 확인했습니다.</label>
      {error && <p role="alert">{error}</p>}
      <ActionButton disabled={busy || !confirmed || !Number.isInteger(days) || days < 1 || days > 36500}
        onClick={() => { void api("/forms/" + form.id + "/retention", { method: "PATCH", body: JSON.stringify({ version: form.version, retentionDays: days }) }).then(onSaved); }}>보유 기간 지정</ActionButton>
    </div>
  </Modal>;
}
function FormPreview({ id }: { id: string }) {
  const result = useResource<FormRecord>("/forms/" + id), form = result.data;
  if (result.error) return <p role="alert">{result.error.message}</p>;
  if (!form) return <p role="status">캐치폼을 불러오는 중입니다.</p>;
  return <div className="cs-stack"><h3>{form.title}</h3><p>{formStatus[form.status]} · {form.hasDraft ? "현재 초안" : "게시 버전"} {form.draftNumber}</p>
    <p style={{ whiteSpace: "pre-wrap" }}>{form.content.body}</p>{form.content.questions.map((question, index) => <section className="forms-note" key={question.id}>
      <h3>Q{index + 1}. {question.label} {question.required && "(필수)"}</h3><p>{question.type}</p>
      {question.options?.length ? <ul>{question.options.map(option => <li key={option}>{option}</li>)}</ul> : null}<QuestionSummary question={question} questions={form.content.questions} />
    </section>)}<p>보유 기간 {form.content.retentionDays === null ? "미지정 (회사 기본 보유 기간 적용)" : form.content.retentionDays + "일"} · 최대 응답 {form.content.maxResponses}건 · {form.content.verify ? "본인인증 사용" : "본인인증 미사용"}</p>
    <p>개인정보 동의: {form.content.consentRequired ? "필수" : "선택"} · {form.content.consentPurpose || "별도 목적 없음"}</p>
    <ConsentDisplay display={form.consentBundle?.display} /><ConsentDocuments bundle={form.consentBundle} /></div>;
}
function DeleteForm({ form, busy, error, onDelete }: { form: FormRecord; busy: boolean; error: string; onDelete: (state: FormDeletionState) => void }) {
  const result = useResource<FormDeletionState>("/forms/" + form.id + "/deletion"), state = result.data;
  const [confirmed, setConfirmed] = useState(false);
  return <div className="cs-stack"><p>“{form.title}” 캐치폼의 질문·초안·즐겨찾기를 영구 삭제합니다. 감사 기록은 유지되며 삭제한 내용을 복구할 수 없습니다.</p>
    {result.loading && <p role="status">삭제 조건을 확인하는 중입니다.</p>}{result.error && <p role="alert">{result.error.message}</p>}{error && <p role="alert">{error}</p>}
    {state && !state.canPurge && <><ul>{state.reasons.map(reason => <li key={reason.code}>{reason.message}</li>)}</ul>
      {!!state.references.submissions && state.canReadResponses && <Link href={"/form/manage/applicant/" + form.id}>응답과 파기 요청 관리</Link>}</>}
    {state?.canPurge && <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> 삭제할 캐치폼과 복구 불가 안내를 확인했습니다.</label>}
    <ActionButton disabled={busy || !state?.canPurge || !confirmed} onClick={() => { if (state) onDelete(state); }}>완전 삭제</ActionButton>
    <ActionButton secondary disabled={busy} onClick={() => { setConfirmed(false); result.reload(); }}>삭제 조건 다시 확인</ActionButton>
  </div>;
}
