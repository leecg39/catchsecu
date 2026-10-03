"use client";
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import { campaignStatuses, deliveryStatuses, deliveryReasons, type CampaignRecord, type CampaignPreview, type DeliveryRecord } from "@/contracts/campaigns";
import type { Paged } from "@/contracts/forms";
import type { SenderRecord } from "@/contracts/senders";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import { feedbackLabels } from "@/contracts/email-feedback";
import { EmailSuppressions } from "./EmailSuppressions";
import { CampaignFiles } from "./CampaignFiles";
import { MessageContentFields, SavedMessage, contentFromForm } from "./MessageContent";
import { MessageTemplateLibrary } from "./MessageTemplates";
import "./campaigns.css";
type Channel = "email" | "sms";
const when = (v: string | null) => v ? new Date(v).toLocaleString("ko-KR") : "—";
const base = (channel: Channel) => channel === "email" ? "/mail" : "/sms";
const recordPath = (r: CampaignRecord) => base(r.channel) + (r.source === "form" ? "/catchform" : "/direct") + "?campaignId=" + r.id;
const eventLabels: Record<string, string> = { created: "초안 생성", updated: "내용 변경", recipients_replaced: "대상 변경", scheduled: "발송 요청", rescheduled: "예약 변경", dispatching: "처리 시작", settled: "처리 종료", cancelled: "발송 취소", retry_requested: "실패 건 재처리 요청", archived: "보관", unarchived: "보관 해제", deleted: "초안 삭제", expired: "원문 보관 종료", template_applied: "템플릿 적용", file_attached: "첨부 연결", file_removed: "첨부 삭제" };
function useRequestKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return (signature: string) => { if (current.current?.signature !== signature) current.current = { signature, key: crypto.randomUUID() }; return current.current.key; };
}
export function CampaignPage({ email, source = "direct", history = false }: { email: boolean; source?: "direct" | "form"; history?: boolean }) {
  const app = useApplication(), params = useSearchParams(), id = params.get("campaignId"), templateView = params.get("view") === "templates", suppressionView = email && params.get("view") === "suppression", channel = email ? "email" : "sms";
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("message.read")) return <Panel><p role="alert">발송 내역을 조회할 권한이 없습니다.</p></Panel>;
  if (!app.data.serviceId) return <Panel><p>서비스를 선택해주세요.</p></Panel>;
  const scope = { serviceId: app.data.serviceId, channel: channel as Channel, canManage: app.data.capabilities.includes("message.manage"), canSend: app.data.capabilities.includes("message.send"), canTargets: app.data.capabilities.includes("marketing.read") };
  if (suppressionView) return <div className="campaign-page" key={scope.serviceId}><EmailSuppressions serviceId={scope.serviceId} canReadContacts={scope.canTargets} /></div>;
  return <div className="campaign-page" key={scope.serviceId + channel + source + (id ?? "") + templateView}>{templateView ? <><PageHeading title="메시지 템플릿 관리" /><Link className="cs-link" href={base(scope.channel) + "/history"}>발송 내역으로</Link><MessageTemplateLibrary {...scope} /></> : <>{email && <Link className="cs-link" href="/mail/history?view=suppression">이메일 발송 차단</Link>}<Link className="cs-link" href={base(scope.channel) + "/history?view=templates"}>메시지 템플릿 관리</Link>{id ? <CampaignDetail id={id} {...scope} /> : history ? <CampaignHistory {...scope} /> : <CampaignNew {...scope} source={source} />}</>}</div>;
}
type Scope = { serviceId: string; channel: Channel; canManage: boolean; canSend: boolean; canTargets: boolean };
function CampaignHistory({ serviceId, channel, canManage }: Scope) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const params = new URLSearchParams({ serviceId, channel, search, status, archived: String(archived), page: String(page), pageSize: String(pageSize) });
  if (from) params.set("from", new Date(from + "T00:00:00").toISOString());
  if (to) params.set("to", new Date(to + "T23:59:59.999").toISOString());
  const result = useResource<Paged<CampaignRecord>>("/campaigns?" + params);
  return <><PageHeading title={channel === "email" ? "이메일 발송 내역" : "문자 발송 내역"}><p>초안부터 예약, 수신자별 처리 결과까지 확인합니다.</p></PageHeading>
    <Panel><div className="campaign-toolbar"><h2>발송 목록</h2>{canManage && <div className="campaign-actions"><Link className="cs-button" href={base(channel) + "/direct"}>직접 입력 작성</Link><Link className="cs-button secondary" href={base(channel) + "/catchform"}>수집 자료에서 작성</Link></div>}</div>
      <form className="campaign-filters" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}>
        <input className="cs-input" aria-label="캠페인 제목 검색" placeholder="캠페인 제목" value={query} onChange={e => setQuery(e.target.value)} maxLength={200} />
        <select className="cs-input" aria-label="캠페인 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">현재 전체</option>{Object.entries(campaignStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label>생성 시작일<input className="cs-input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>생성 종료일<input className="cs-input" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        <label className="campaign-check"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(1); }} />보관한 캠페인</label><ActionButton secondary>검색</ActionButton><ActionButton secondary type="button" onClick={result.reload}>새로고침</ActionButton>
      </form>
      <RemoteTable columns={["캠페인", "대상", "상태", "수신자", "처리 결과", "예약 시각", "생성일"]} rows={(result.data?.items ?? []).map(r => ({ id: r.id, cells: [
        <Link key="title" className="cs-link" href={recordPath(r)}>{r.title || "삭제된 초안"}</Link>, r.source === "form" ? "수집 자료 선택" : "직접 입력", campaignStatuses[r.status], r.total,
        <span key="count">접수·로컬 전달 {(r.counts.accepted ?? 0) + (r.counts.local_delivered ?? 0)}<small>실패·확인 필요 {(r.counts.failed ?? 0) + (r.counts.unknown ?? 0)} · 제외 {r.counts.excluded ?? 0}</small></span>, when(r.scheduledAt), when(r.createdAt)
      ] }))} total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={result.loading} error={result.error?.message} />
    </Panel><p className="campaign-note">SMTP 접수는 메일 서버의 접수 결과입니다. 수신 결과는 인증된 이벤트가 접수된 경우에만 표시합니다. 외부 공급자 연결은 별도 확인이 필요합니다. 캠페인 내용과 연락처 사본은 생성 후 최대 30일 동안 보관합니다.</p></>;
}
function ContentFields({ record, channel, serviceId }: { record?: CampaignRecord; channel: Channel; serviceId: string }) {
  const [search, setSearch] = useState(""), [senderId, setSenderId] = useState(record?.senderId ?? "");
  const senders = useResource<Paged<SenderRecord>>("/senders?" + new URLSearchParams({ serviceId, channel, pageSize: "100", search }));
  const selected = useResource<SenderRecord>(senderId ? "/senders/" + senderId : null);
  return <><label>캠페인 이름<input className="cs-input" name="title" maxLength={200} required defaultValue={record?.title} placeholder="내역에서 구분할 이름" /></label>
    <label>발신자 검색<input className="cs-input" aria-label="발신자 이름 검색" value={search} onChange={e => { e.stopPropagation(); setSearch(e.target.value); }} placeholder="발신자 이름 또는 정확한 주소·번호" /></label>
    <label>발신자<select className="cs-input" name="senderId" value={senderId} onChange={e => setSenderId(e.target.value)}><option value="">나중에 선택</option>{senderId && !senders.data?.items.some(s => s.id === senderId) && <option value={senderId}>{selected.data ? selected.data.label + " · " + (selected.data.address ?? "원문 삭제") : "선택한 발신자"}</option>}{senders.data?.items.map(s => <option key={s.id} value={s.id}>{s.label} · {s.address} · {s.eligible ? "사용 가능" : "인증 필요"}</option>)}</select></label>
    {(senders.data?.total ?? 0) > 100 && <p className="campaign-note">검색 결과 중 100개를 표시합니다. 검색어를 입력해 발신자를 찾으세요.</p>}
    {senders.error && <p role="alert">{senders.error.message}</p>}<Link className="cs-link" href={base(channel) + "/number"}>발신자 등록·인증 관리</Link>
    <MessageContentFields channel={channel} serviceId={serviceId} initial={record?.content} />{channel === "email" && <p className="campaign-note">발송할 때 서비스별 수신거부 링크가 본문 하단에 자동으로 추가됩니다.</p>}</>;
}
function formContent(form: HTMLFormElement) {
  const values = new FormData(form); return { title: values.get("title"), senderId: values.get("senderId") || null, content: contentFromForm(values) };
}
function CampaignNew({ serviceId, channel, canManage, source }: Scope & { source: "direct" | "form" }) {
  const router = useRouter(), requestKey = useRequestKey(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!canManage) return <Panel><p role="alert">캠페인을 작성할 권한이 없습니다.</p></Panel>;
  return <><PageHeading title={channel === "email" ? "이메일 보내기" : "문자 보내기"}><p>{source === "form" ? "수집 자료의 동의 대상 선택" : "연락처 직접 입력·CSV"} · 내용 저장 후 수신자를 선택합니다.</p></PageHeading>
    <Panel title="1. 내용 작성"><form className="campaign-fields" onSubmit={async e => { e.preventDefault(); if (busy) return; const input = { serviceId, channel, source, ...formContent(e.currentTarget) }; setBusy(true); setError("");
      try { const saved = await api<{ id: string }>("/campaigns", { method: "POST", headers: { "Idempotency-Key": requestKey(JSON.stringify(input)) }, body: JSON.stringify(input) }); router.push(base(channel) + (source === "form" ? "/catchform" : "/direct") + "?campaignId=" + saved.id); }
      catch (error) { setError(errorText(error)); setBusy(false); } }}>
      <fieldset className="campaign-fields" disabled={busy}><ContentFields channel={channel} serviceId={serviceId} /><div className="campaign-actions"><ActionButton>초안 생성</ActionButton><Link className="cs-link" href={base(channel) + "/history"}>발송 내역</Link></div></fieldset>
      {error && <p role="alert">{error}</p>}</form></Panel></>;
}
function CampaignDetail({ id, ...scope }: Scope & { id: string }) {
  const result = useResource<CampaignRecord>("/campaigns/" + id);
  if (result.loading) return <Panel><p role="status">캠페인을 불러오는 중입니다.</p></Panel>;
  if (result.error) return <Panel><p role="alert">{result.error.message}</p></Panel>;
  if (!result.data) return null;
  if (result.data.serviceId !== scope.serviceId || result.data.channel !== scope.channel) return <Panel><p role="alert">캠페인의 서비스와 채널을 선택해주세요.</p></Panel>;
  return <CampaignBody key={result.data.version} record={result.data} {...scope} refresh={result.reload} />;
}
function CampaignBody({ record: r, refresh, canManage, canSend, canTargets, ...scope }: Scope & { record: CampaignRecord; refresh: () => void }) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirtyContent, setDirtyContent] = useState(false), [dirtyTargets, setDirtyTargets] = useState(false);
  const [preview, setPreview] = useState<CampaignPreview>(), [at, setAt] = useState(""), [exclude, setExclude] = useState(false), [confirm, setConfirm] = useState<"delete" | "cancel">();
  const requestKey = useRequestKey(), router = useRouter(), draft = r.status === "draft", live = !["deleted", "expired"].includes(r.status);
  async function change(action: string, input: object = {}, method = "POST") {
    if (busy) return; setBusy(true); setError(""); const payload = { version: r.version, ...input }, path = "/campaigns/" + r.id + (action ? "/" + action : "");
    try { const result = await api<CampaignPreview>(path, { method, body: JSON.stringify(payload), headers: ["schedule", "retry"].includes(action) ? { "Idempotency-Key": requestKey(path + JSON.stringify(payload)) } : {} });
      if (action === "preview") setPreview(result); else if (method === "DELETE") router.push(base(r.channel) + "/history"); else refresh();
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <><PageHeading title={r.title || "삭제된 초안"}><p>{campaignStatuses[r.status]} · 생성 {when(r.createdAt)} · 원문 보관 종료 {when(r.expiresAt)}</p></PageHeading>
    <div className="campaign-toolbar"><Link className="cs-link" href={base(r.channel) + "/history"}>발송 내역으로</Link><ActionButton secondary onClick={refresh} disabled={busy}>최신 상태 불러오기</ActionButton></div>
    {error && <p className="campaign-alert" role="alert">{error} 변경 충돌이면 최신 상태를 불러온 뒤 다시 확인해주세요.</p>}
    <Panel title={draft ? "1. 내용 작성" : "발송 내용"}>{draft && canManage && <ActionButton secondary disabled={busy || dirtyContent || dirtyTargets} onClick={() => setShowTemplates(true)}>템플릿에서 내용 적용</ActionButton>}{r.messageTemplateId && <p className="campaign-note">템플릿 버전 {r.messageTemplateVersion}의 내용 사본입니다.</p>}{draft && canManage ? <form className="campaign-fields" onChange={() => { setDirtyContent(true); setPreview(undefined); }} onSubmit={e => { e.preventDefault(); change("", formContent(e.currentTarget), "PATCH"); }}><fieldset className="campaign-fields" disabled={busy}><ContentFields record={r} channel={r.channel} serviceId={r.serviceId} /><ActionButton secondary>내용 저장</ActionButton></fieldset></form> :
      r.content ? <SavedMessage content={r.content} /> : <p>보관된 원문이 없습니다.</p>}</Panel>
    {r.channel === "email" && r.content && <CampaignFiles record={r} editable={draft && canManage && !dirtyContent && !dirtyTargets} onChanged={refresh} onBusy={value => { setBusy(value); if (value) setPreview(undefined); }} />}
    {showTemplates && <Modal title="템플릿에서 내용 적용" onClose={() => setShowTemplates(false)}><MessageTemplateLibrary serviceId={r.serviceId} channel={r.channel} canManage={false} onApply={async (templateId, templateVersion) => { setBusy(true); try { await api("/campaigns/" + r.id + "/apply-template", { method: "POST", body: JSON.stringify({ version: r.version, templateId, templateVersion }) }); setShowTemplates(false); refresh(); } finally { setBusy(false); } }} /></Modal>}
    {draft && canManage && canTargets && <TargetsEditor record={r} busy={busy} onDirty={() => { setDirtyTargets(true); setPreview(undefined); }} onApply={input => change("recipients", input)} />}
    {canTargets && <RecipientResults record={r} canRetry={canSend && !r.archivedAt && ["failed", "partial_failed"].includes(r.status)} busy={busy} onRetry={ids => change("retry", { ids })} />}
    {draft && canManage && canTargets && <Panel title="3. 확인 후 발송"><div className="campaign-fields">
      {(dirtyContent || dirtyTargets) && <p role="status">변경한 내용과 수신자를 먼저 저장·적용해주세요.</p>}
      <ActionButton secondary disabled={busy || dirtyContent || dirtyTargets} onClick={() => change("preview")}>저장된 내용 미리보기</ActionButton>
      {preview && <><div className="campaign-summary"><span>전체 <strong>{preview.total}</strong></span><span>발송 가능 <strong>{preview.eligible}</strong></span><span>제외 <strong>{preview.excluded}</strong></span></div>
        {preview.senderReason && <p role="alert">{preview.senderReason}</p>}{preview.transportReason && <p role="alert">{preview.transportReason}</p>}{preview.attachmentReason && <p role="alert">{preview.attachmentReason}</p>}
        <p>{preview.estimate.amount === null ? "요금 미확인" : preview.estimate.amount.toLocaleString() + "원"} · {preview.estimate.reason}</p>
        {preview.sample && <section className="campaign-preview" aria-label="수신자 메시지 예시"><SavedMessage content={preview.sample} /></section>}
        {!!preview.excluded && <><ul>{Object.entries(preview.items.reduce<Record<string, number>>((counts, item) => { if (item.reason) counts[item.reason] = (counts[item.reason] ?? 0) + 1; return counts; }, {})).map(([reason, count]) => <li key={reason}>{deliveryReasons[reason] ?? reason}: {count}명</li>)}</ul><label className="campaign-check"><input type="checkbox" checked={exclude} onChange={e => setExclude(e.target.checked)} />제외 사유를 확인했으며 발송 가능한 대상에게만 요청합니다.</label></>}
        <label>예약 시각 (비워두면 즉시 요청)<input className="cs-input" aria-label="발송 예약 시각" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
        <ActionButton disabled={busy || !canSend || !preview.eligible || !preview.senderReady || !preview.attachmentsReady || !preview.transportReady || !!preview.excluded && !exclude} onClick={() => change("schedule", { at: at ? new Date(at).toISOString() : null, excludeInvalid: exclude })}>{busy ? "요청 중…" : at ? "예약 발송 요청" : "즉시 발송 요청"}</ActionButton>
      </>}
    </div></Panel>}
    {!draft && live && <Panel title="예약·처리 관리"><div className="campaign-fields"><p>예약 시각 {when(r.scheduledAt)} · 처리 종료 {when(r.completedAt)}</p>
      {r.status === "scheduled" && canSend && <form className="campaign-actions" onSubmit={e => { e.preventDefault(); change("reschedule", { at: new Date(at).toISOString() }); }}><label>변경할 예약 시각<input className="cs-input" aria-label="변경할 예약 시각" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} required /></label><ActionButton secondary disabled={busy}>예약 변경</ActionButton></form>}
      <div className="campaign-actions">{canManage && ["scheduled", "dispatching"].includes(r.status) && <ActionButton secondary disabled={busy} onClick={() => setConfirm("cancel")}>발송 취소</ActionButton>}
        {canManage && ["completed", "partial_failed", "failed", "cancelled"].includes(r.status) && <ActionButton secondary disabled={busy} onClick={() => change("archive")}>{r.archivedAt ? "보관 해제" : "캠페인 보관"}</ActionButton>}</div>
      <p className="campaign-note">이미 로컬 메일함에 전달되거나 SMTP가 접수한 건은 취소로 회수되지 않습니다. 접수 여부가 불확실한 건은 공급자 확인 전 재전송할 수 없습니다.</p></div></Panel>}
    {draft && canManage && <ActionButton secondary disabled={busy} onClick={() => setConfirm("delete")}>초안 삭제</ActionButton>}
    <Panel title="변경 이력"><ol className="campaign-events">{r.events?.map(e => <li key={e.version}>{eventLabels[e.kind] ?? e.kind}<small>v{e.version} · {when(e.createdAt)}</small></li>)}</ol></Panel>
    {confirm && <Modal title={confirm === "delete" ? "초안 삭제" : "발송 취소"} onClose={() => { if (!busy) setConfirm(undefined); }}><div className="campaign-fields"><p>{confirm === "delete" ? "초안 내용·수신자 사본·첨부파일 원문을 삭제합니다." : "아직 전달되지 않은 예약을 취소합니다. 이미 접수된 메시지는 회수되지 않습니다."}</p><div className="campaign-actions"><ActionButton secondary disabled={busy} onClick={() => setConfirm(undefined)}>돌아가기</ActionButton><ActionButton disabled={busy} onClick={() => change(confirm === "delete" ? "" : "cancel", {}, confirm === "delete" ? "DELETE" : "POST")}>확인</ActionButton></div>{error && <p role="alert">{error}</p>}</div></Modal>}
    {scope.channel === "sms" && <p className="campaign-note">문자 전송·단가·잔액 공급자 연결 전에는 초안과 수신자 관리만 사용할 수 있습니다.</p>}
  </>;
}
type Source = { id: string; name: string; contact: string; sourceTitle: string; status: string; excluded: boolean; retentionUntil: string };
function TargetsEditor({ record: r, busy, onDirty, onApply }: { record: CampaignRecord; busy: boolean; onDirty: () => void; onApply: (input: object) => void }) {
  const [text, setText] = useState(""), [csv, setCsv] = useState<string>(), [error, setError] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const sources = useResource<Paged<Source>>(r.source === "form" ? "/campaigns/sources?" + new URLSearchParams({ serviceId: r.serviceId, channel: r.channel, page: String(page), pageSize: String(pageSize), search }) : null);
  return <Panel title="2. 수신자 지정"><div className="campaign-fields"><p>새 입력·선택을 적용하면 저장된 수신자 전체를 교체합니다. 같은 서비스의 유효한 마케팅 동의가 있는 대상에게 발송할 수 있습니다. 최대 1,000명입니다.</p>
    {r.source === "direct" ? <><label>연락처 (한 줄에 하나)<textarea className="cs-input" aria-label="직접 입력 수신자" rows={5} value={text} disabled={busy || csv !== undefined} onChange={e => { setText(e.target.value); onDirty(); }} placeholder={r.channel === "email" ? "sample@example.com" : "01012345678"} /></label>
      <label>또는 UTF-8 CSV (연락처 한 열)<input type="file" aria-label="수신자 CSV" accept=".csv,text/csv" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setError(""); try { if (file.size > 300000) throw new Error("300KB 이하 CSV를 선택해주세요."); const value = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); setCsv(value); onDirty(); } catch (error) { setError(errorText(error)); } e.target.value = ""; }} /></label>
      {csv !== undefined && <div className="campaign-actions"><span>CSV 선택됨</span><button className="cs-link" onClick={() => { setCsv(undefined); onDirty(); }}>CSV 선택 해제</button></div>}
      <ActionButton secondary disabled={busy || csv === undefined && !text.trim()} onClick={() => onApply(csv === undefined ? { mode: "direct", contacts: text.split(/\r?\n/).map(v => v.trim()).filter(Boolean) } : { mode: "csv", csv })}>수신자 전체 교체·적용</ActionButton></> :
      <><form className="campaign-actions" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input className="cs-input" aria-label="수집 폼 이름 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="수집 폼 이름" /><ActionButton secondary>검색</ActionButton></form>
        <p role="status">새로 선택한 대상 {selected.length}명 · 페이지를 이동해도 선택을 유지합니다.</p>
        <RemoteTable columns={["선택", "이름", "연락처", "수집 폼", "동의 상태", "보관 기한"]} rows={(sources.data?.items ?? []).map(item => ({ id: item.id, cells: [
          <input key="select" aria-label={item.contact + " 선택"} type="checkbox" disabled={busy || selected.length >= 1000 && !selected.includes(item.id)} checked={selected.includes(item.id)} onChange={e => { setSelected(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id)); onDirty(); }} />,
          item.name, item.contact, item.sourceTitle, item.status === "granted" && !item.excluded ? "동의" : "철회·제외", when(item.retentionUntil)
        ] }))} total={sources.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={sources.loading} error={sources.error?.message} />
        <ActionButton secondary disabled={busy || !selected.length} onClick={() => onApply({ mode: "selection", preferenceIds: selected })}>선택한 대상으로 전체 교체·적용</ActionButton></>}
    {!!r.total && <button className="cs-link" disabled={busy} onClick={() => onApply(r.source === "direct" ? { mode: "direct", contacts: [] } : { mode: "selection", preferenceIds: [] })}>저장된 수신자 전체 비우기</button>}
    {error && <p role="alert">{error}</p>}</div></Panel>;
}
function RecipientResults({ record: r, canRetry, busy, onRetry }: { record: CampaignRecord; canRetry: boolean; busy: boolean; onRetry: (ids: string[]) => void }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [status, setStatus] = useState("all"), [selected, setSelected] = useState<string[]>([]);
  const result = useResource<Paged<DeliveryRecord>>("/campaigns/" + r.id + "/deliveries?" + new URLSearchParams({ page: String(page), pageSize: String(pageSize), status }));
  const columns = [...(canRetry ? ["재처리 선택"] : []), "순서", "이름", "연락처", "상태", "사유", "시도", "접수·전달 시각"];
  if (r.channel === "email") columns.push("수신 결과");
  return <Panel title="저장된 수신자·처리 결과"><div className="campaign-toolbar"><select className="cs-input" aria-label="수신자 처리 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">전체 결과</option>{Object.entries(deliveryStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <a className="cs-link" href={"/api/v1/campaigns/" + r.id + "/export?" + new URLSearchParams({ status })}>결과 CSV 다운로드</a></div>
    <RemoteTable columns={columns} rows={(result.data?.items ?? []).map(item => { const cells: ReactNode[] = [item.position, item.name || "—", item.contact ?? "원문 삭제", deliveryStatuses[item.status], item.reason ? deliveryReasons[item.reason] ?? item.reason : "—", item.attempt, when(item.acceptedAt)];
      if (r.channel === "email") cells.push(item.feedback ? <span className="campaign-feedback" key="feedback">{feedbackLabels[item.feedback.outcome]}<small>{item.feedback.source === "relay" ? "서명된 릴레이" : "수신자 확인"} · {when(item.feedback.occurredAt)}</small><small>접수 이력 {item.feedback.count}건</small></span> : "접수된 결과 없음");
      if (canRetry) cells.unshift(item.status === "failed" ? <input key="retry" type="checkbox" aria-label={"수신자 " + item.position + " 재처리 선택"} checked={selected.includes(item.id)} disabled={busy || selected.length >= 100 && !selected.includes(item.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} /> : "—"); return { id: item.id, cells }; })}
      total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={result.loading} error={result.error?.message} />
    {canRetry && <ActionButton secondary disabled={busy || !selected.length} onClick={() => onRetry(selected)}>선택한 실패 {selected.length}건 재처리</ActionButton>}
  </Panel>;
}
