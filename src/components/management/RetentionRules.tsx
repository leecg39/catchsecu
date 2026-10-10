"use client";

import { useRef, useState, type FormEvent } from "react";
import { retentionRuleCreate, retentionRulePatch, type RetentionRulePage, type RetentionRuleRecord } from "@/contracts/retention-rules";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, EmptyState, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import styles from "./retention-rules.module.css";

export function RetentionRules() {
  const app = useApplication();
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("security.read")) return <Panel><p role="alert">보유기간 규칙을 조회할 권한이 없습니다.</p></Panel>;
  return <RuleManager key={app.data.company?.id} />;
}

function RuleManager() {
  const { data: app } = useApplication();
  const confirm = useConfirm();
  const canWrite = !!app?.capabilities.includes("security.write");
  const [serviceFilter, setServiceFilter] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const query = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  if (serviceFilter) query.set("serviceId", serviceFilter);
  const result = useResource<RetentionRulePage>("/retention-rules?" + query);
  const [editor, setEditor] = useState<RetentionRuleRecord | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const services = app?.services ?? [];
  const serviceName = (id: string) => services.find(service => service.id === id)?.name ?? "접근 가능한 서비스";
  async function archive(row: RetentionRuleRecord) {
    if (running.current) return;
    const accepted = await confirm({ title: "보유기간 규칙 보관", message: `${serviceName(row.serviceId)}의 ${row.retentionDays}일 규칙을 보관합니다. 기존 응답의 보유기한은 바뀌지 않으며, 이 규칙을 사용하던 폼의 다음 제출에는 회사 기본값이 적용됩니다.`, confirmLabel: "규칙 보관" });
    if (!accepted || running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await api("/retention-rules/" + row.id, { method: "DELETE", headers: { "If-Match": String(row.version) } });
      setMessage("규칙을 보관했습니다. 기존 응답의 보유기한은 유지됩니다.");
      setPage(1); result.reload();
    } catch (cause) {
      setError(errorText(cause));
      // A stale row must be re-read and confirmed again before another deletion.
      if (cause instanceof ApiError && cause.status === 409) result.reload();
    } finally { running.current = false; setBusy(false); }
  }
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className={styles.page}>
    <PageHeading title="보유기간 규칙"><p>폼에서 기간을 지정하지 않은 경우 적용할 서비스별 기본 보유기간을 관리합니다.</p></PageHeading>
    <Panel title="적용 기준"><p>폼 버전에 지정된 기간 → 폼에 사후 지정한 기간 → 활성 서비스 규칙 → 회사 기본기간 순서로 적용합니다.</p>
      <p>규칙 변경은 이후 제출에 적용됩니다. 이미 접수한 응답의 기간을 소급 변경하거나 즉시 파기하지 않습니다.</p></Panel>
    <Panel title="서비스별 규칙">
      <div className={styles.filters}>
        <label>서비스 <select className="cs-input" aria-label="보유기간 서비스 필터" disabled={busy || !!editor} value={serviceFilter}
          onChange={event => { setServiceFilter(event.target.value); setPage(1); }}><option value="">전체 서비스</option>
          {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label>상태 <select className="cs-input" aria-label="보유기간 규칙 상태" disabled={busy || !!editor} value={status}
          onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">사용 중</option><option value="archived">보관</option></select></label>
        <ActionButton secondary disabled={busy || !!editor} onClick={result.reload}>규칙 새로고침</ActionButton>
        {canWrite && <ActionButton disabled={busy || !!editor || !services.length} onClick={() => { setError(""); setMessage(""); setEditor("new"); }}>규칙 추가</ActionButton>}
      </div>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {result.loading && <p role="status">보유기간 규칙을 불러오는 중입니다.</p>}
      {result.error && <div><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>규칙 다시 불러오기</ActionButton></div>}
      {result.data && <><p>전체 {total}개</p>{!total ? <EmptyState text="등록된 보유기간 규칙이 없습니다." /> :
        <div className="cs-table-wrap"><table className="cs-table"><thead><tr><th>서비스</th><th>보유기간</th><th>사유</th><th>상태</th><th>수정일</th><th>관리</th></tr></thead>
          <tbody>{result.data.items.map(row => <tr key={row.id}><td>{serviceName(row.serviceId)}</td><td>{row.retentionDays}일</td>
            <td style={{ maxWidth: 320, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.reason}</td><td>{row.status === "active" ? "사용 중" : "보관"}</td>
            <td>{new Date(row.updatedAt).toLocaleDateString("ko-KR")}</td><td>{canWrite && row.status === "active" ? <div className="mg-flex">
              <ActionButton secondary disabled={busy || !!editor} aria-label={serviceName(row.serviceId) + " 규칙 수정"} onClick={() => { setError(""); setMessage(""); setEditor(row); }}>수정</ActionButton>
              <ActionButton secondary disabled={busy || !!editor} aria-label={serviceName(row.serviceId) + " 규칙 보관"} onClick={() => void archive(row)}>보관</ActionButton>
            </div> : "—"}</td></tr>)}</tbody></table></div>}
        <nav className="cs-pagination" aria-label="보유기간 규칙 페이지">
          <label>페이지당 행 <select aria-label="보유기간 페이지당 행 수" value={pageSize} disabled={busy || !!editor} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <div><button disabled={busy || !!editor || page <= 1} onClick={() => setPage(value => value - 1)}>이전</button><span>{page} / {pages}</span>
            <button disabled={busy || !!editor || page >= pages} onClick={() => setPage(value => value + 1)}>다음</button></div>
        </nav></>}
    </Panel>
    {editor && <RuleEditor key={editor === "new" ? "new" : editor.id} initial={editor} services={services}
      defaultService={serviceFilter || app?.serviceId || services[0]?.id || ""} close={() => setEditor(null)}
      saved={() => { setEditor(null); setStatus("active"); setPage(1); setMessage("보유기간 규칙을 저장했습니다."); result.reload(); }} />}
  </div>;
}

function RuleEditor({ initial, services, defaultService, close, saved }: {
  initial: RetentionRuleRecord | "new"; services: { id: string; name: string }[]; defaultService: string;
  close: () => void; saved: () => void;
}) {
  const confirm = useConfirm();
  const [current, setCurrent] = useState(initial === "new" ? null : initial);
  const [serviceId, setServiceId] = useState(initial === "new" ? defaultService : initial.serviceId);
  const [days, setDays] = useState(initial === "new" ? "" : String(initial.retentionDays));
  const [reason, setReason] = useState(initial === "new" ? "" : initial.reason);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const dirty = current ? days !== String(current.retentionDays) || reason !== current.reason : !!days || !!reason;
  useUnsavedChanges(dirty || busy);
  async function discard() {
    return !dirty || confirm({ title: "입력 내용 확인", message: "저장하지 않은 보유기간 규칙 입력을 버릴까요?", confirmLabel: "입력 버리기" });
  }
  async function refresh() {
    if (!current || running.current || !await discard()) return;
    running.current = true; setBusy(true); setError("");
    try {
      const latest = await api<RetentionRuleRecord>("/retention-rules/" + current.id);
      setCurrent(latest); setDays(String(latest.retentionDays)); setReason(latest.reason); setConflict(false);
    } catch (cause) { setError(errorText(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || conflict || current?.status === "archived") return;
    const value = { retentionDays: Number(days), reason };
    const checked = current ? retentionRulePatch.safeParse({ ...value, version: current.version }) : retentionRuleCreate.safeParse({ ...value, serviceId });
    if (!checked.success) { setError("1~36,500일 사이의 정수 보유기간과 1~1,000자의 사유를 입력하고 서비스를 선택해주세요."); return; }
    running.current = true; setBusy(true); setError("");
    try {
      const body = JSON.stringify(checked.data);
      if (!current && request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      await api(current ? "/retention-rules/" + current.id : "/retention-rules", {
        method: current ? "PATCH" : "POST", body, headers: current ? {} : { "Idempotency-Key": request.current!.key },
      });
      request.current = null; saved();
    } catch (cause) {
      setError(errorText(cause));
      if (current && cause instanceof ApiError && cause.status === 409) setConflict(true);
    } finally { running.current = false; setBusy(false); }
  }
  return <Panel title={current ? "보유기간 규칙 수정" : "보유기간 규칙 추가"}>
    <form className="mg-fields" onSubmit={submit}><fieldset disabled={busy || current?.status === "archived"}>
      <label>서비스<select className="cs-input" aria-label="규칙 적용 서비스" required disabled={!!current} value={serviceId} onChange={event => setServiceId(event.target.value)}>
        <option value="">서비스 선택</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <label>보유기간(일)<input className="cs-input" aria-label="보유기간(일)" type="number" min={1} max={36500} step={1} required value={days} onChange={event => setDays(event.target.value)} /></label>
      <label>사유<textarea className="cs-input" aria-label="보유기간 설정 사유" required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
    </fieldset>
      {error && <p role="alert">{error}</p>}
      {conflict && <p role="alert">작성한 내용은 유지됩니다. 최신 규칙을 불러온 뒤 다시 수정해주세요.</p>}
      {current?.status === "archived" && <p role="alert">보관된 규칙입니다. 목록에서 규칙 추가로 다시 등록할 수 있습니다.</p>}
      <div className="mg-flex"><ActionButton disabled={busy || conflict || current?.status === "archived"}>{busy ? "저장 중…" : "규칙 저장"}</ActionButton>
        {current && <ActionButton type="button" secondary disabled={busy} onClick={() => void refresh()}>최신 규칙 불러오기</ActionButton>}
        <ActionButton type="button" secondary disabled={busy} onClick={() => void discard().then(accepted => { if (accepted) close(); })}>편집 취소</ActionButton></div>
    </form>
  </Panel>;
}
