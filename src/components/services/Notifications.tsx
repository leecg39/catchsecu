"use client";
import { useRef, useState } from "react";
import { api, errorText, useResource } from "@/lib/api";
import type { Paged } from "@/contracts/forms";
import { notificationLabels, notificationStatusLabels, notificationStatuses, type IntegrationRecord, type IntegrationOptions, type NotificationRecord, type SubscriptionInput } from "@/contracts/notifications";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import "./notifications.css";
const providers = { slack: "Slack", teams: "Microsoft Teams" };
const when = (date: string) => new Date(date).toLocaleString("ko-KR");
const roles: Record<string, string> = { owner: "소유자", admin: "관리자" };
export function IntegrationPage() {
  const app = useApplication();
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("integration.read")) return <Panel><p role="alert">알림 설정을 조회할 권한이 없습니다.</p></Panel>;
  if (!app.data.serviceId) return <Panel><p>서비스를 선택해주세요.</p></Panel>;
  return <IntegrationList key={app.data.serviceId} serviceId={app.data.serviceId} serviceName={app.data.services.find(s => s.id === app.data!.serviceId)?.name ?? ""} canWrite={app.data.capabilities.includes("integration.manage")} />;
}
function IntegrationList({ serviceId, serviceName, canWrite }: { serviceId: string; serviceName: string; canWrite: boolean }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [enabled, setEnabled] = useState("all"), [provider, setProvider] = useState("all"), [creator, setCreator] = useState(""), [target, setTarget] = useState(""), [kind, setKind] = useState("all");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [editor, setEditor] = useState<string>(), [selection, setSelection] = useState<string[]>([]), [remove, setRemove] = useState<IntegrationRecord[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const options = useResource<IntegrationOptions>("/integrations/options?serviceId=" + serviceId);
  const list = useResource<Paged<IntegrationRecord>>("/integrations?" + new URLSearchParams({ serviceId, search, enabled, provider, kind, ...(creator ? { creatorId: creator } : {}), ...(target ? { targetId: target } : {}), page: String(page), pageSize: String(pageSize) }));
  const reload = () => { list.reload(); options.reload(); setSelection([]); };
  async function toggle(row: IntegrationRecord) {
    setBusy(true); setError(""); try { await api("/integrations/" + row.id + "/enabled", { method: "POST", body: JSON.stringify({ version: row.version, enabled: !row.enabled }) }); reload(); setNotice(row.enabled ? "알림을 중지하고 대기 전송을 취소했습니다." : "알림을 사용하도록 변경했습니다."); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="notifications-page"><PageHeading title="알림 받기"><p>슬랙, 팀즈 등 워크 메신저에서 캐치폼·개인정보 업로드 관련 알림을 수신할 수 있습니다.</p></PageHeading>
    <Panel><p><strong>{serviceName}</strong>의 알림 설정</p><form className="notification-filters" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); setSelection([]); }}>
      <label>이벤트<select className="cs-input" aria-label="알림 이벤트 필터" value={kind} onChange={e => { setKind(e.target.value); setTarget(""); setPage(1); setSelection([]); }}><option value="all">전체 이벤트</option><option value="submission.created">응답 제출</option><option value="import.completed">CSV 반영 완료</option></select></label>
      <label>캐치폼·개인정보 업로드<select className="cs-input" aria-label="알림 대상 필터" value={target} onChange={e => { setTarget(e.target.value); setPage(1); setSelection([]); }}><option value="">전체 대상</option>{kind !== "import.completed" && options.data?.forms.map(f => <option key={f.id} value={f.id}>폼 · {f.title}</option>)}{kind !== "submission.created" && options.data?.imports.map(f => <option key={f.id} value={f.id}>CSV · {f.title}</option>)}</select></label>
      <label>등록자<select className="cs-input" aria-label="알림 등록자 필터" value={creator} onChange={e => { setCreator(e.target.value); setPage(1); setSelection([]); }}><option value="">전체 등록자</option>{options.data?.creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>연동 방식<select className="cs-input" aria-label="알림 연동 방식 필터" value={provider} onChange={e => { setProvider(e.target.value); setPage(1); setSelection([]); }}><option value="all">전체</option><option value="slack">Slack</option><option value="teams">Microsoft Teams</option></select></label>
      <label>사용여부<select className="cs-input" aria-label="알림 사용여부 필터" value={enabled} onChange={e => { setEnabled(e.target.value); setPage(1); setSelection([]); }}><option value="all">전체</option><option value="true">사용</option><option value="false">중지</option></select></label>
      <label>알림 이름<input className="cs-input" aria-label="알림 이름 검색" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} /></label>
      <ActionButton secondary>알림 검색</ActionButton><ActionButton secondary type="button" onClick={() => { setQuery(""); setSearch(""); setKind("all"); setTarget(""); setCreator(""); setProvider("all"); setEnabled("all"); setPage(1); setSelection([]); }}>초기화</ActionButton>
    </form><div className="notification-actions">{canWrite && <><ActionButton onClick={() => setEditor("new")}>추가하기</ActionButton><ActionButton secondary disabled={!selection.length || busy} onClick={() => setRemove((list.data?.items ?? []).filter(r => selection.includes(r.id)))}>선택 삭제</ActionButton></>}<ActionButton secondary onClick={reload}>새로고침</ActionButton></div>
    {options.data?.transport === "local" && <p className="notification-note">현재 로컬 시험 모드입니다. 알림은 이 서버에 기록되며 외부 메신저로 전송되지 않습니다.</p>}
    {options.error && <p role="alert">{options.error.message}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <RemoteTable columns={["선택", "#", "사용여부", "역할", "서비스명", "캐치폼·개인정보 업로드 명", "알림 이름", "연동 방식", "등록자", "알림 받을 이벤트", "등록일", "관리"]} rows={(list.data?.items ?? []).map((r, i) => ({ id: r.id, cells: [<input key="select" type="checkbox" aria-label={r.name + " 선택"} checked={selection.includes(r.id)} disabled={!canWrite || busy} onChange={e => setSelection(e.target.checked ? [...selection, r.id] : selection.filter(id => id !== r.id))} />, (page - 1) * pageSize + i + 1,
      <label key="enabled" className="notification-toggle"><input type="checkbox" aria-label={r.name + " 사용여부"} checked={r.enabled} disabled={!canWrite || busy} onChange={() => toggle(r)} />{r.enabled ? "사용" : "중지"}</label>, roles[r.creatorRole] ?? r.creatorRole, serviceName, r.subscriptions.map(s => (s.kind === "submission.created" ? "폼: " : "CSV: ") + (s.targetName ?? "전체")).join(" / "), r.name, <span key="provider">{providers[r.provider]}<small>{r.transport === "local" ? "로컬 시험" : "외부 웹훅"}</small></span>, r.creatorName, r.subscriptions.map(s => notificationLabels[s.kind]).join(", "), when(r.createdAt), <button key="manage" className="cs-link" onClick={() => setEditor(r.id)}>{r.name} 관리</button>] }))} total={list.data?.total ?? 0} page={page} pageSize={pageSize} onPage={n => { setPage(n); setSelection([]); }} onPageSize={n => { setPageSize(n); setPage(1); setSelection([]); }} loading={list.loading} error={list.error?.message} />
    </Panel>
    {editor && <IntegrationEditor key={editor} id={editor} serviceId={serviceId} canWrite={canWrite} options={options.data} close={() => setEditor(undefined)} saved={id => { reload(); setEditor(id); setNotice("알림 설정을 저장했습니다."); }} remove={row => setRemove([row])} />}
    {!!remove.length && <Modal title="알림 설정 삭제" onClose={() => { if (!busy) setRemove([]); }}><p>{remove.length}개 알림의 URL·설정을 삭제하고 대기 전송을 취소합니다. 이미 전송된 메시지는 수신 채널에 남습니다.</p><p role="alert">{error}</p><ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/integrations/delete", { method: "POST", body: JSON.stringify({ serviceId, items: remove.map(r => ({ id: r.id, version: r.version })) }) }); setRemove([]); setEditor(undefined); reload(); setNotice("알림 설정을 삭제했습니다."); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}>알림 삭제 확인</ActionButton></Modal>}
  </div>;
}
function IntegrationEditor({ id, serviceId, canWrite, options, close, saved, remove }: { id: string; serviceId: string; canWrite: boolean; options?: IntegrationOptions; close: () => void; saved: (id: string) => void; remove: (row: IntegrationRecord) => void }) {
  const result = useResource<IntegrationRecord>(id === "new" ? null : "/integrations/" + id);
  return <Modal title={id === "new" ? "알림 추가하기" : "알림 관리"} onClose={close}>
    {result.loading ? <p role="status">알림 설정을 불러오는 중입니다.</p> : result.error ? <p role="alert">{result.error.message}</p> : <IntegrationFields key={id + ":" + result.data?.version} row={result.data} serviceId={serviceId} canWrite={canWrite} options={options} saved={newId => { saved(newId); result.reload(); }} refresh={result.reload} remove={remove} />}
  </Modal>;
}
function IntegrationFields({ row, serviceId, canWrite, options, saved, refresh, remove }: { row?: IntegrationRecord; serviceId: string; canWrite: boolean; options?: IntegrationOptions; saved: (id: string) => void; refresh: () => void; remove: (row: IntegrationRecord) => void }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionInput[]>(row?.subscriptions.map(({ kind, targetId }) => ({ kind, targetId })) ?? [{ kind: "submission.created", targetId: null }]);
  const [provider, setProvider] = useState(row?.provider ?? "slack"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [testConfirm, setTestConfirm] = useState(false), [notice, setNotice] = useState(""), [historyRevision, setHistoryRevision] = useState(0);
  const key = useRef<{ signature: string; value: string }>(null);
  const transport = row?.transport ?? options?.transport;
  return <section className="notification-editor"><p>{transport === "local" ? "로컬 시험: 알림을 서버에 기록합니다." : "외부 웹훅: 저장한 채널로 알림을 전송합니다."}</p>
    <form onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget), endpoint = String(form.get("endpoint") ?? "");
      const input = { name: form.get("name"), enabled: form.get("enabled") === "on", subscriptions, ...(row ? { version: row.version, ...(endpoint ? { endpoint } : {}) } : { serviceId, provider, endpoint }) };
      const signature = JSON.stringify(input); if (!key.current || key.current.signature !== signature) key.current = { signature, value: crypto.randomUUID() };
      setBusy(true); setError(""); try { const out = await api<{ id: string }>("/integrations" + (row ? "/" + row.id : ""), { method: row ? "PATCH" : "POST", headers: { "Idempotency-Key": key.current.value }, body: JSON.stringify(input) }); saved(out.id); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}><fieldset disabled={busy || !canWrite} className="notification-fields">
      <label>알림 이름<input className="cs-input" name="name" aria-label="알림 이름" required maxLength={100} defaultValue={row?.name} /></label>
      <label>연동 방식<select className="cs-input" aria-label="알림 연동 방식" value={provider} disabled={!!row} onChange={e => setProvider(e.target.value as "slack" | "teams")}><option value="slack">Slack</option><option value="teams">Microsoft Teams</option></select></label>
      <label>{row ? "Webhook URL 교체" : "Webhook URL"}<input className="cs-input" type="password" name="endpoint" aria-label="Webhook URL" autoComplete="new-password" required={!row} maxLength={2048} placeholder={row ? "새 URL을 입력하면 교체합니다" : "https://"} /></label>
      {row && <p className="notification-note">저장된 호스트: {row.endpointHost} · 버전 {row.version}. 저장하면 대기 중인 알림을 취소하고 이후 이벤트부터 새 설정을 적용합니다.</p>}
      {provider === "teams" && <p className="notification-note">Teams Workflows에서 “Teams 웹후크 요청이 수신될 때”를 만들고 호출 권한 “누구나(Anyone)”로 발급한 URL을 입력하세요.</p>}
      <label className="notification-toggle"><input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? true} />알림 사용</label>
      <fieldset><legend>알림 받을 이벤트·대상</legend>{(["submission.created", "import.completed"] as const).map(kind => {
        const sub = subscriptions.find(s => s.kind === kind), choices = kind === "submission.created" ? options?.forms : options?.imports;
        return <div key={kind} className="notification-subscription"><label className="notification-toggle"><input type="checkbox" checked={!!sub} aria-label={notificationLabels[kind] + " 이벤트"} onChange={e => setSubscriptions(e.target.checked ? [...subscriptions, { kind, targetId: null }] : subscriptions.filter(s => s.kind !== kind))} />{notificationLabels[kind]}</label>
          {sub && <select className="cs-input" aria-label={notificationLabels[kind] + " 대상"} value={sub.targetId ?? ""} onChange={e => setSubscriptions(subscriptions.map(s => s.kind === kind ? { ...s, targetId: e.target.value || null } : s))}><option value="">서비스의 전체 {kind === "submission.created" ? "폼" : "CSV 업로드"}</option>{choices?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}{sub.targetId && !choices?.some(c => c.id === sub.targetId) && <option value={sub.targetId}>선택된 대상 · {sub.targetId}</option>}</select>}</div>;
      })}</fieldset>
      {(options?.formsTruncated || options?.importsTruncated) && <p>대상 선택은 이름순 처음 300개까지 표시합니다. 전체 대상 구독을 사용할 수 있습니다.</p>}
      <p className="notification-note">알림에는 이벤트 종류·시각·반영 건수·참조 번호가 포함됩니다. 응답 내용과 연락처는 포함하지 않습니다.</p>
      <ActionButton disabled={busy || !subscriptions.length || !options}>{row ? "알림 설정 저장" : "알림 등록"}</ActionButton>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {row && <><div className="notification-actions"><ActionButton secondary disabled={busy} onClick={refresh}>최신 설정 불러오기</ActionButton>{canWrite && <><ActionButton disabled={busy || !row.enabled} onClick={() => setTestConfirm(true)}>테스트 전송</ActionButton><ActionButton secondary disabled={busy} onClick={() => remove(row)}>이 알림 삭제</ActionButton></>}</div>
      {testConfirm && <div className="notification-confirm"><p>{transport === "local" ? "로컬 시험 알림을 1건 기록합니다." : "저장한 메신저 채널에 테스트 알림 1건을 전송합니다."}</p><ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/integrations/" + row.id + "/test", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ version: row.version }) }); setTestConfirm(false); setNotice("테스트 전송을 요청했습니다. 아래 전송 이력에서 결과를 확인하세요."); setHistoryRevision(n => n + 1); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}>테스트 전송 확인</ActionButton><ActionButton secondary disabled={busy} onClick={() => setTestConfirm(false)}>취소</ActionButton></div>}
      <NotificationHistory key={historyRevision} id={row.id} canWrite={canWrite} />
    </>}
  </section>;
}
function NotificationHistory({ id, canWrite }: { id: string; canWrite: boolean }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [status, setStatus] = useState("all"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const result = useResource<Paged<NotificationRecord>>("/integrations/" + id + "/deliveries?" + new URLSearchParams({ page: String(page), pageSize: String(pageSize), status }));
  return <section aria-label="알림 전송 이력"><h3>전송 이력</h3><div className="notification-actions"><select className="cs-input" aria-label="알림 전송 상태 필터" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">전체 상태</option>{notificationStatuses.map(s => <option key={s} value={s}>{notificationStatusLabels[s]}</option>)}</select><ActionButton secondary onClick={result.reload}>전송 이력 새로고침</ActionButton></div>{error && <p role="alert">{error}</p>}
    <RemoteTable columns={["이벤트", "결과", "시도", "요청일", "처리일", "이력·관리"]} rows={(result.data?.items ?? []).map(r => ({ id: r.id, cells: [notificationLabels[r.kind], <span key="status">{r.outcome === "local_delivered" ? "로컬 기록 완료" : r.outcome === "accepted" ? "공급자 접수" : notificationStatusLabels[r.status]}{r.error && <small>{r.error}</small>}</span>, r.attempts + "/" + r.maxAttempts, when(r.createdAt), r.completedAt ? when(r.completedAt) : "—", <div key="history"><details><summary>시도 기록 {r.history.length}개</summary>{r.history.map(h => <p key={h.number}>{h.number}회 · {h.outcome} · {h.code ?? "정상"}{h.httpStatus ? " · HTTP " + h.httpStatus : ""} · {when(h.finishedAt)}</p>)}</details>{canWrite && r.canRetry && <button className="cs-link" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/integrations/" + id + "/deliveries/" + r.id + "/retry", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ version: r.version }) }); result.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}>안전한 실패 재처리</button>}</div>] }))} total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={result.loading} error={result.error?.message} />
    <p className="notification-note">공급자 접수는 채널 수신 확인과 구분됩니다. 결과 불명은 중복 전송을 막기 위해 재전송하지 않습니다.</p>
  </section>;
}
