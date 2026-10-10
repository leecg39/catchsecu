"use client";
import { AuthorAssetProvider } from "./AuthorAssetProvider";
import { hasAuthorAssets } from "@/lib/author-assets";
import { QuestionChoiceSummary } from "./QuestionChoiceSummary";
import { QuestionSummary } from "./QuestionSummary";
import { ConsentDisplay, ConsentDocuments, ConsentItems } from "./ConsentDocuments";
import type { FormConsentBundle } from "@/contracts/form-documents";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { approvalInputDirty, createApprovalInputState, updateApprovalInput, type ApprovalInputState, type ApprovalInputValues } from "@/lib/approval-input";
import type { FormContent, FormRecord, Paged } from "@/contracts/forms";
import { approvalStatusLabels, approvalStatuses } from "@/contracts/security";
import { ActionButton, PageHeading, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { useApplication } from "../ApplicationContext";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";

type Approval = {
  id: string; formId: string; title: string; serviceName: string; requesterName: string; reviewerName: string | null;
  requestedBy: string; canCancel?: boolean; formRevision: number; version: number; status: keyof typeof approvalStatusLabels;
  createdAt: string; decidedAt: string | null; message: string; reference: string; reason: string | null;
  snapshot: { title: string; content: FormContent; consentBundle?: FormConsentBundle };
};
type History = Paged<Approval> & { policy: { requireApproval: boolean; referenceRequired: boolean; requestTemplate: string; approvalRevision: number }; canRequest: boolean; canReview: boolean };
export function ApprovalPanel({ form, dirty: formDirty, onChanged }: { form: FormRecord; dirty: boolean; onChanged: () => Promise<void> }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const approvalPath = "/forms/" + form.id + "/approvals?page=" + page + "&pageSize=" + pageSize;
  const result = useResource<History>(approvalPath);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false), [drafts, setDrafts] = useState<Record<string, ApprovalInputState>>({});
  const pendingKey = useRef<{ payload: string; key: string } | null>(null);
  const lock = useRef(false), ask = useConfirm();
  const inputDirty = Object.values(drafts).some(approvalInputDirty);
  useUnsavedChanges(inputDirty || busy, "저장하지 않은 승인 요청 또는 검토 의견이 있습니다. 이 화면을 나가면 입력한 내용이 사라집니다.");
  function currentDraft(key: string, initial?: Partial<ApprovalInputValues>) { return drafts[key] ?? createApprovalInputState(initial); }
  function changeDraft(key: string, initial: Partial<ApprovalInputValues>, field: keyof ApprovalInputValues, value: string) {
    setDrafts(current => ({ ...current, [key]: updateApprovalInput(current[key] ?? createApprovalInputState(initial), field, value) }));
  }
  function clearDraft(key: string) { setDrafts(current => Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== key))); }
  async function mutate(path: string, method: string, data: unknown, options: { create?: boolean; draftKey?: string } = {}) {
    if (lock.current || conflict) return false;
    if (formDirty) { setError("수정한 폼 설정을 먼저 임시저장한 후 승인 작업을 진행해주세요."); return false; }
    lock.current = true; setError(""); setNotice(""); setBusy(true);
    try {
      const payload = JSON.stringify(data);
      if (options.create && pendingKey.current?.payload !== payload) pendingKey.current = { payload, key: crypto.randomUUID() };
      await api(path, { method, body: payload, ...(options.create ? { headers: { "Idempotency-Key": pendingKey.current!.key } } : {}) });
      pendingKey.current = null; if (options.draftKey) clearDraft(options.draftKey); setConflict(false); result.reload();
      try { await onChanged(); setNotice("승인 내역에 반영했습니다."); }
      catch (cause) { setNotice("승인 변경은 반영됐습니다. 최신 폼 정보를 다시 불러와주세요."); setError(errorText(cause)); }
      return true;
    } catch (cause) {
      setError(errorText(cause) + (cause instanceof ApiError && cause.status === 409 ? " 작성 중인 입력은 유지했습니다." : ""));
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function reloadLatest() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const latest = await api<History>(approvalPath), pending = new Set(latest.items.filter(item => item.status === "pending").map(item => "decision:" + item.id));
      const active = latest.items.some(item => item.status === "pending" || item.status === "approved");
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key === "request" ? latest.canRequest && !active : pending.has(key))));
      await onChanged(); setConflict(false); result.reload(); setNotice("최신 승인 상태를 불러왔습니다.");
    } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (result.error) return <Panel><p role="alert">{result.error.message} <button type="button" className="cs-link" onClick={result.reload}>다시 시도</button></p></Panel>;
  if (!result.data) return <Panel><p role="status">게시 승인 상태를 불러오는 중입니다.</p></Panel>;
  const data = result.data, active = data.items.some(item => item.status === "pending" || item.status === "approved");
  const requestKey = "request", request = currentDraft(requestKey, { message: data.policy.requestTemplate });
  return <Panel title="캐치폼 사용 승인"><p>{data.policy.requireApproval ? "회사 정책에 따라 현재 초안의 승인이 필요합니다." : "현재 회사 정책에서는 바로 게시할 수 있습니다."}</p>
    {data.policy.requireApproval && data.canRequest && form.hasDraft && !active && data.page === 1 && form.status !== "archived" &&
      <form className="approval-request" key={data.policy.approvalRevision} onSubmit={event => {
        event.preventDefault(); void mutate("/forms/" + form.id + "/approvals", "POST", { version: form.version,
          message: request.values.message, reference: request.values.reference }, { create: true, draftKey: requestKey });
      }}><label>승인 요청 메시지<textarea className="cs-input" aria-label="승인 요청 메시지" name="message" rows={4} maxLength={4000} required value={request.values.message}
          onChange={event => changeDraft(requestKey, { message: data.policy.requestTemplate }, "message", event.target.value)} /></label>
        <label>증빙 번호{data.policy.referenceRequired ? " (필수)" : " (선택)"}<input className="cs-input" aria-label="증빙 번호" name="reference" maxLength={200}
          required={data.policy.referenceRequired} value={request.values.reference}
          onChange={event => changeDraft(requestKey, { message: data.policy.requestTemplate }, "reference", event.target.value)} /></label>
        {formDirty && <p>수정한 설정을 임시저장한 후 승인을 요청해주세요.</p>}
        <ActionButton disabled={busy || formDirty || conflict}>승인 요청하기</ActionButton></form>}
    {error && <p role="alert">{error}</p>}<p role="status">{notice}</p>{conflict && <div><p className="cs-muted">다른 곳에서 승인 상태가 변경됐습니다. 작성 중인 입력은 최신 상태를 확인할 때까지 유지됩니다.</p>
      <button type="button" className="cs-link" disabled={busy} onClick={reloadLatest}>최신 승인 상태 다시 불러오기</button></div>}
    {data.items.map(row => { const decisionKey = "decision:" + row.id, decision = currentDraft(decisionKey); return <article className="approval-entry" key={row.id}>
      <header><strong>{approvalStatusLabels[row.status]}</strong><span>{row.requesterName} · {new Date(row.createdAt).toLocaleString("ko-KR")}</span></header>
      <p className="approval-text">{row.message}</p>{row.reference && <p>증빙 번호: {row.reference}</p>}
      {row.reason && <p className="approval-text">처리 의견: {row.reason} · {row.reviewerName}</p>}
      <details><summary>검토한 질문·설정 보기</summary><ApprovalSnapshot id={row.id} snapshot={row.snapshot} /></details>
      {row.status === "pending" && <div className="approval-decisions">
        {data.canReview && <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget);
          const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
          if (decision === "approved" || decision === "rejected") void mutate("/approvals/" + row.id + "/decision", "POST",
            { version: row.version, decision, reason: String(values.get("reason")) }, { draftKey: decisionKey });
        }}><fieldset disabled={busy || formDirty || conflict}><label>검토 의견<textarea className="cs-input" aria-label="검토 의견" name="reason" rows={2} required maxLength={4000}
              value={decision.values.reason} onChange={event => changeDraft(decisionKey, {}, "reason", event.target.value)} /></label>
          <ActionButton name="decision" value="approved">승인</ActionButton> <ActionButton secondary name="decision" value="rejected">반려</ActionButton></fieldset></form>}
        {formDirty && <p>수정한 폼 설정을 먼저 임시저장한 후 승인 작업을 진행해주세요.</p>}
        {data.canRequest && row.canCancel && <ActionButton secondary disabled={busy || formDirty || conflict} onClick={async () => {
          if (approvalInputDirty(decision) && !await ask({ title: "검토 의견 입력 폐기", message: "작성 중인 검토 의견을 버리고 승인 요청을 취소할까요?", confirmLabel: "입력 버리고 요청 취소", cancelLabel: "계속 편집" })) return;
          clearDraft(decisionKey); void mutate("/approvals/" + row.id, "DELETE", { version: row.version }, { draftKey: decisionKey });
        }}>요청 취소</ActionButton>}
      </div>}
    </article>; })}
    {data.total === 0 && <p className="mg-muted">승인 요청 내역이 없습니다.</p>}
    {data.total > 0 && <div className="cs-pagination"><span>총 {data.total}개</span><select aria-label="승인 내역 페이지당 행 수" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50].map(size => <option key={size}>{size}</option>)}</select>
      <button aria-label="이전 승인 내역" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>이전</button><span>{data.page}</span>
      <button aria-label="다음 승인 내역" disabled={data.page * pageSize >= data.total} onClick={() => setPage(data.page + 1)}>다음</button></div>}
  </Panel>;
}
function ApprovalSnapshot({ id, snapshot }: { id: string; snapshot: Approval["snapshot"] }) {
  return <AuthorAssetProvider scope={{ kind: "approval", id }} enabled={hasAuthorAssets(snapshot.content.questions)}><section className="approval-snapshot"><h3>{snapshot.title}</h3><p className="approval-text">{snapshot.content.body}</p>
    <ol>{snapshot.content.questions.map(question => <li key={question.id}><strong>{question.label}</strong> ({question.type}{question.required ? " · 필수" : ""})
      <QuestionSummary question={question} questions={snapshot.content.questions} language={snapshot.content.formLanguage} /><QuestionChoiceSummary question={question} language={snapshot.content.formLanguage} /></li>)}</ol>
    <dl><dt>개인정보 동의</dt><dd>{snapshot.content.consentRequired ? "필수" : "선택"}</dd><dt>수집·이용 목적</dt><dd>{snapshot.content.consentPurpose || "-"}</dd>
      <dt>보유·이용 기간</dt><dd>{snapshot.content.retentionDays}일</dd><dt>최대 응답 수</dt><dd>{snapshot.content.maxResponses}개</dd>
      <dt>응답 시작</dt><dd>{snapshot.content.collectionOpenAt ? new Date(snapshot.content.collectionOpenAt).toLocaleString("ko-KR") : "게시 즉시"}</dd>
      <dt>응답 종료</dt><dd>{snapshot.content.collectionCloseAt ? new Date(snapshot.content.collectionCloseAt).toLocaleString("ko-KR") : "직접 종료할 때까지"}</dd>
      <dt>참여 인증</dt><dd>{snapshot.content.participationAccess?.enabled
        ? `${snapshot.content.participationAccess.method === "EMAIL" ? "이메일" : snapshot.content.participationAccess.socialProvider} · ${snapshot.content.participationAccess.targetScope === "WHITELIST" ? "지정 명단" : "전체"} · 중복 ${snapshot.content.participationAccess.limitDuplicate ? "제한" : "허용"}`
        : "사용 안 함"}</dd>
      <dt>본인인증</dt><dd>{snapshot.content.verify ? "사용" : "사용 안 함"}</dd></dl><ConsentItems items={snapshot.consentBundle?.collectedItems} />
    <ConsentDisplay display={snapshot.consentBundle?.display} /><ConsentDocuments bundle={snapshot.consentBundle} /></section></AuthorAssetProvider>;
}
export function ApprovalLog() {
  const app = useApplication(), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [search, setSearch] = useState(""), [draftSearch, setDraftSearch] = useState(""), [status, setStatus] = useState("all");
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status });
  if (app.data?.serviceId) query.set("serviceId", app.data.serviceId);
  const result = useResource<Paged<Approval>>(app.data ? "/approvals?" + query : null);
  return <><PageHeading title="캐치폼 승인 내역" /><Panel><form className="mg-toolbar" onSubmit={event => { event.preventDefault(); setSearch(draftSearch); setPage(1); }}>
    <input className="cs-input" aria-label="캐치폼 제목 검색" placeholder="캐치폼 제목" value={draftSearch} onChange={event => setDraftSearch(event.target.value)} />
    <select className="cs-input" aria-label="승인 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
      <option value="all">모든 상태</option>{approvalStatuses.map(value => <option key={value} value={value}>{approvalStatusLabels[value]}</option>)}</select><ActionButton>검색</ActionButton>
  </form><RemoteTable columns={["캐치폼", "서비스", "요청자", "승인 담당자", "상태", "요청일"]} rows={(result.data?.items ?? []).map(row => ({ id: row.id,
    cells: [<Link key="form" className="cs-link" href={"/form/ai/setting?formId=" + row.formId}>{row.title}</Link>, row.serviceName, row.requesterName, row.reviewerName || "-", approvalStatusLabels[row.status], new Date(row.createdAt).toLocaleString("ko-KR")] }))}
    total={result.data?.total ?? 0} page={result.data?.page ?? page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={result.loading} error={result.error?.message} /></Panel></>;
}
