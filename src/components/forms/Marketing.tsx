"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import { marketingEventLabel, marketingStatus, type MarketingRecord, type MarketingSource, type MarketingSummary } from "@/contracts/marketing";
import type { Paged } from "@/contracts/forms";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel, DataTable } from "../shared";
import { RemoteTable } from "../RemoteTable";
import "./marketing.css";
const time = (v: string | null) => v ? new Date(v).toLocaleString("ko-KR") : "—";
const dateBoundary = (value: string, end: boolean) => {
  const day = new Date(value + "T00:00:00");
  if (end) day.setDate(day.getDate() + 1);
  return day.toISOString();
};
export function Marketing() {
  const app = useApplication();
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("marketing.read")) return <Panel><p role="alert">마케팅 수신동의를 조회할 권한이 없습니다.</p></Panel>;
  if (!app.data.serviceId) return <Panel><p>서비스를 선택해주세요.</p></Panel>;
  return <MarketingList key={app.data.serviceId} serviceId={app.data.serviceId} canWrite={app.data.capabilities.includes("marketing.write")} />;
}
function MarketingList({ serviceId, canWrite }: { serviceId: string; canWrite: boolean }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [channel, setChannel] = useState(""), [status, setStatus] = useState(""), [excluded, setExcluded] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [selected, setSelected] = useState<MarketingRecord[]>([]);
  const [create, setCreate] = useState(false), [detail, setDetail] = useState<string>(), [confirm, setConfirm] = useState<{ rows: MarketingRecord[]; erase: boolean }>();
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ serviceId, page: String(page), pageSize: String(pageSize), search });
  if (channel) params.set("channel", channel); if (status) params.set("status", status); if (excluded) params.set("excluded", excluded);
  const list = useResource<Paged<MarketingRecord>>("/marketing/preferences?" + params);
  const reload = () => { setSelected([]); list.reload(); };
  const changed = () => { setPage(1); setSelected([]); };
  async function perform() {
    if (!confirm || busy) return; setBusy(true); setError("");
    try {
      if (confirm.erase) await api("/marketing/preferences/" + confirm.rows[0].id, { method: "DELETE", body: JSON.stringify({ serviceId, version: confirm.rows[0].version }) });
      else await api("/marketing/preferences/withdrawals", { method: "POST", body: JSON.stringify({ serviceId, items: confirm.rows.map(r => ({ id: r.id, version: r.version })) }) });
      setMessage(confirm.erase ? "마케팅 연락처와 동의 근거 원문을 삭제했습니다." : "선택한 채널의 수신동의를 철회했습니다."); setConfirm(undefined); setDetail(undefined); reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setError("");
    try { const r = await fetch("/api/v1/marketing/preferences/export?" + params, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error.message);
      const url = URL.createObjectURL(await r.blob()), a = document.createElement("a"); a.href = url; a.download = "marketing-preferences.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("현재 검색 조건의 CSV를 내려받았습니다.");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="marketing-page"><PageHeading title="광고성 정보 수신동의 관리"><p>폼과 개인정보 업로드에서 받은 채널별 동의를 확인하고 관리합니다.</p></PageHeading>
    <Panel><div className="marketing-toolbar"><h2>수신동의 목록</h2><div className="cs-row"><Link href="/marketing-detail" className="cs-link">서비스별 현황</Link><ActionButton secondary disabled={busy || !!list.error || list.loading} onClick={download}>CSV 내보내기</ActionButton>{canWrite && <ActionButton onClick={() => setCreate(true)}>동의 근거 등록</ActionButton>}</div></div>
      <form className="marketing-filters" onSubmit={e => { e.preventDefault(); setSearch(query); changed(); }}>
        <input className="cs-input" aria-label="이름 또는 연락처 검색" placeholder="이름·이메일·전화번호 완전일치" value={query} onChange={e => setQuery(e.target.value)} maxLength={254} />
        <select className="cs-input" aria-label="마케팅 채널" value={channel} onChange={e => { setChannel(e.target.value); changed(); }}><option value="">전체 채널</option><option value="email">이메일</option><option value="sms">문자</option></select>
        <select className="cs-input" aria-label="동의 상태" value={status} onChange={e => { setStatus(e.target.value); changed(); }}><option value="">전체 상태</option>{Object.entries(marketingStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select className="cs-input" aria-label="발송 제외 필터" value={excluded} onChange={e => { setExcluded(e.target.value); changed(); }}><option value="">발송 제외 전체</option><option value="true">발송 제외</option><option value="false">제외하지 않음</option></select><ActionButton secondary>검색</ActionButton>
      </form>
      <div className="marketing-toolbar"><p>이메일과 문자의 동의는 각각 한 건으로 표시됩니다.</p><div className="cs-row"><ActionButton secondary onClick={reload}>새로고침</ActionButton>{canWrite && <ActionButton secondary disabled={!selected.length || busy} onClick={() => { setError(""); setConfirm({ rows: selected, erase: false }); }}>선택동의철회 ({selected.length})</ActionButton>}</div></div>
      <RemoteTable columns={["선택", "이름", "채널", "연락처", "수집 출처", "동의일", "발송 제외", "상태 · 철회일", "관리"]}
        rows={(list.data?.items ?? []).map(row => ({ id: row.id, cells: [<input key="select" type="checkbox" aria-label={`${row.name ?? "삭제된 항목"} ${row.channel} 선택`} disabled={!canWrite || row.status !== "granted"} checked={selected.some(s => s.id === row.id)} onChange={e => setSelected(v => e.target.checked ? [...v, row] : v.filter(s => s.id !== row.id))} />,
          row.name ?? "원문 없음", row.channel === "email" ? "이메일" : "문자", row.contact ?? "—", row.sourceTitle, time(row.grantedAt), row.excluded ? "제외" : "—",
          <span key="state">{marketingStatus[row.status]}<small className="marketing-subtext">{time(row.withdrawnAt)}</small>{row.denial && <small className="marketing-subtext">{row.denial}</small>}</span>,
          <button key="detail" className="cs-link" onClick={() => setDetail(row.id)}>상세</button>] }))} total={list.data?.total ?? 0} page={page} pageSize={pageSize} onPage={p => { setPage(p); setSelected([]); }} onPageSize={n => { setPageSize(n); changed(); }} loading={list.loading} error={list.error?.message} />
      {error && !confirm && <p role="alert">{error}</p>}<p role="status">{message}</p>
    </Panel>
    {create && <MarketingCreate serviceId={serviceId} onClose={() => setCreate(false)} onCreated={id => { setCreate(false); reload(); setDetail(id); setMessage("명시한 근거로 수신동의를 등록했습니다."); }} />}
    {detail && !confirm && <MarketingDetail id={detail} canWrite={canWrite} onClose={() => setDetail(undefined)} onChanged={reload} onAction={(row, erase) => { setError(""); setConfirm({ rows: [row], erase }); }} />}
    {confirm && <Modal title={confirm.erase ? "마케팅 개인정보 삭제" : "마케팅 수신동의 철회"} onClose={() => { if (!busy) setConfirm(undefined); }}>
      <p>{confirm.erase ? "마케팅 목록의 연락처와 근거 원문을 삭제합니다. 발송 거부 기록과 변경 이력은 남습니다. 원본 응답의 파기는 응답 관리에서 진행하세요." : `${confirm.rows.length}개 채널의 수신동의를 철회합니다. 해당 채널의 예약 발송도 전달 전에 차단됩니다.`}</p>
      {error && <p role="alert">{error}</p>}<div className="marketing-actions"><ActionButton secondary disabled={busy} onClick={() => setConfirm(undefined)}>취소</ActionButton><ActionButton disabled={busy} onClick={perform}>{busy ? "처리 중…" : confirm.erase ? "개인정보 삭제" : "철회 확인"}</ActionButton></div>
    </Modal>}
  </div>;
}
function MarketingDetail({ id, canWrite, onClose, onChanged, onAction }: { id: string; canWrite: boolean; onClose: () => void; onChanged: () => void; onAction: (row: MarketingRecord, erase: boolean) => void }) {
  const result = useResource<MarketingRecord>("/marketing/preferences/" + id), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const r = result.data;
  async function toggle() { if (!r || busy) return; setBusy(true); setError(""); try { await api("/marketing/preferences/" + id, { method: "PATCH", body: JSON.stringify({ version: r.version, excluded: !r.excluded }) }); result.reload(); onChanged(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  return <Modal title="수신동의 상세" onClose={onClose}>{result.loading ? <p role="status">불러오는 중입니다.</p> : result.error ? <p role="alert">{result.error.message}</p> : r && <div className="cs-stack">
    <dl className="marketing-detail"><dt>이름</dt><dd>{r.name ?? "원문 없음"}</dd><dt>{r.channel === "email" ? "이메일" : "전화번호"}</dt><dd>{r.contact ?? "원문 없음"}</dd><dt>상태</dt><dd>{marketingStatus[r.status]} · {r.eligible ? "발송 가능" : r.denial}</dd><dt>수집 출처</dt><dd>{r.sourceTitle}</dd><dt>동의일</dt><dd>{time(r.grantedAt)}</dd><dt>보유 기한</dt><dd>{time(r.retentionUntil)}</dd><dt>마케팅 목적</dt><dd>{r.evidence?.purpose ?? "원문 없음"}</dd><dt>증빙 참조</dt><dd>{r.evidence?.reference ?? "원문 없음"}</dd><dt>버전</dt><dd>{r.version}</dd></dl>
    {canWrite && r.status !== "erased" && <div className="marketing-actions"><ActionButton secondary disabled={busy} onClick={toggle}>{r.excluded ? "발송 제외 해제" : "이 채널 발송 제외"}</ActionButton><ActionButton secondary disabled={busy || r.status !== "granted"} onClick={() => onAction(r, false)}>동의 철회</ActionButton><ActionButton secondary disabled={busy} onClick={() => onAction(r, true)}>개인정보 삭제</ActionButton></div>}
    {error && <p role="alert">{error}</p>}<h3>변경 이력 (최근 100건)</h3><ol className="marketing-events">{r.events?.map(e => <li key={e.id}>{marketingEventLabel[e.kind] ?? e.kind}<small>v{e.version} · {time(e.createdAt)}</small></li>)}</ol>
  </div>}</Modal>;
}
function MarketingCreate({ serviceId, onClose, onCreated }: { serviceId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [page, setPage] = useState(1), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [source, setSource] = useState<MarketingSource>();
  const [channel, setChannel] = useState("email"), [nameId, setNameId] = useState(""), [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const pending = useRef<{ body: string; key: string } | null>(null);
  const sources = useResource<Paged<MarketingSource>>("/marketing/sources?" + new URLSearchParams({ serviceId, page: String(page), search }));
  return <Modal title="기존 응답의 마케팅 동의 근거 등록" onClose={() => { if (!busy) onClose(); }}><div className="cs-stack">
    <p>별도로 받은 채널별 수신동의의 근거를 등록하세요. 원본 응답에 있는 이름과 연락처를 직접 선택합니다.</p>
    <form className="cs-row" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input className="cs-input" aria-label="동의 출처 검색" placeholder="캐치폼·업로드 제목" value={query} onChange={e => setQuery(e.target.value)} /><ActionButton secondary>출처 검색</ActionButton></form>
    {sources.error && <p role="alert">{sources.error.message}</p>}
    <label className="cs-label">원본 응답<select className="cs-input" aria-label="동의 출처 응답" value={source?.id ?? ""} onChange={e => { setSource(sources.data?.items.find(s => s.id === e.target.value)); setNameId(""); setContactId(""); }}><option value="">응답을 선택하세요</option>{sources.data?.items.map(s => <option key={s.id} value={s.id}>{s.title} · {time(s.createdAt)} · {s.id.slice(0, 8)}</option>)}</select></label>
    <div className="marketing-actions"><ActionButton secondary disabled={page === 1 || sources.loading} onClick={() => { setPage(p => p - 1); setSource(undefined); }}>이전 출처</ActionButton><span>{page} / {Math.max(1, Math.ceil((sources.data?.total ?? 0) / 20))}</span><ActionButton secondary disabled={page * 20 >= (sources.data?.total ?? 0) || sources.loading} onClick={() => { setPage(p => p + 1); setSource(undefined); }}>다음 출처</ActionButton></div>
    {source && <form className="cs-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; const f = new FormData(e.currentTarget); setBusy(true); setError("");
      try { const body = JSON.stringify({ serviceId, submissionId: source.id, channel, nameQuestionId: nameId, contactQuestionId: contactId, grantedAt: new Date(String(f.get("grantedAt"))).toISOString(), purpose: f.get("purpose"), reference: f.get("reference"), attested: f.get("attested") === "on" });
        if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
        const r = await api<{ id: string }>("/marketing/preferences", { method: "POST", body, headers: { "Idempotency-Key": pending.current.key } }); onCreated(r.id);
      } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="cs-stack marketing-fieldset">
      <label className="cs-label">동의 채널<select className="cs-input" aria-label="등록할 동의 채널" value={channel} onChange={e => setChannel(e.target.value)}><option value="email">이메일</option><option value="sms">문자</option></select></label>
      {[{ id: "이름 질문", value: nameId, change: setNameId }, { id: "연락처 질문", value: contactId, change: setContactId }].map(field => <label className="cs-label" key={field.id}>{field.id}<select className="cs-input" aria-label={field.id} value={field.value} required onChange={e => field.change(e.target.value)}><option value="">선택하세요</option>{source.questions.map(q => <option key={q.id} value={q.id}>{q.label} · {q.value.slice(0, 70)}</option>)}</select></label>)}
      <label className="cs-label">동의한 시각<input className="cs-input" aria-label="동의한 시각" name="grantedAt" type="datetime-local" required /></label>
      <label className="cs-label">마케팅 목적<textarea className="cs-input" aria-label="등록 마케팅 목적" name="purpose" required maxLength={3000} /></label>
      <label className="cs-label">증빙 참조<textarea className="cs-input" aria-label="동의 증빙 참조" name="reference" placeholder="수신동의 문서명·기록 번호·수집 경로" required minLength={5} maxLength={1000} /></label>
      <label><input name="attested" type="checkbox" required />선택한 채널의 별도 수신동의를 받은 근거를 확인했습니다.</label>
      {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "등록 중…" : "근거 확인 후 등록"}</ActionButton></fieldset></form>}
  </div></Modal>;
}
export function MarketingStatistics({ serviceId }: { serviceId?: string }) {
  const app = useApplication(), [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [filterError, setFilterError] = useState("");
  const params = new URLSearchParams({ search });
  if (serviceId) params.set("serviceId", serviceId);
  if (period.from) params.set("from", dateBoundary(period.from, false));
  if (period.to) params.set("to", dateBoundary(period.to, true));
  const result = useResource<MarketingSummary>(app.data?.capabilities.includes("marketing.read") ? "/marketing/summary?" + params : null);
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("marketing.read")) return <Panel><p role="alert">마케팅 통계를 조회할 권한이 없습니다.</p></Panel>;
  const totals = (result.data?.items ?? []).reduce((sum, row) => ({ granted: sum.granted + row.granted,
    withdrawn: sum.withdrawn + row.withdrawn, eligible: sum.eligible + row.eligible,
    suppressed: sum.suppressed + row.suppressed, periodGrants: sum.periodGrants + row.periodGrants,
    periodWithdrawals: sum.periodWithdrawals + row.periodWithdrawals,
    periodErasures: sum.periodErasures + row.periodErasures }),
  { granted: 0, withdrawn: 0, eligible: 0, suppressed: 0, periodGrants: 0, periodWithdrawals: 0, periodErasures: 0 });
  function applyPeriod() {
    if (!!draft.from !== !!draft.to) { setFilterError("시작일과 종료일을 모두 선택해주세요."); return; }
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError("종료일은 시작일 이후여야 합니다."); return; }
    setFilterError(""); setPeriod(draft);
  }
  return <div className="marketing-page"><PageHeading title="마케팅 동의 현황 (광고성 정보)"><p>접근 가능한 서비스의 수신동의·발송 차단과 기간별 변경 기록입니다.</p></PageHeading>
    <Panel title="조회 기간"><div className="marketing-summary-filters">
      <label>시작일 <input className="cs-input" type="date" value={draft.from}
        onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label>
      <label>종료일 <input className="cs-input" type="date" value={draft.to}
        onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label>
      <ActionButton onClick={applyPeriod}>기간 적용</ActionButton>
      <ActionButton secondary onClick={() => { setDraft({ from: "", to: "" }); setPeriod({ from: "", to: "" }); setFilterError(""); }}>기본 기간</ActionButton>
    </div>{filterError && <p role="alert">{filterError}</p>}
      {result.data && <p className="forms-muted">집계 기준 {new Date(result.data.asOf).toLocaleString("ko-KR")} · 기간 {new Date(result.data.period.from).toLocaleString("ko-KR")}부터 {new Date(result.data.period.to).toLocaleString("ko-KR")} 전까지</p>}
    </Panel>
    <Panel title="검색된 서비스의 마케팅 동의 현황">{result.loading ? <p role="status">집계 중입니다.</p> : result.error ? <p role="alert">{result.error.message}</p>
      : <div className="marketing-stats"><p>현재 동의 <strong>{totals.granted}</strong></p><p>현재 철회 <strong>{totals.withdrawn}</strong></p>
        <p>현재 수신 차단 <strong>{totals.suppressed}</strong></p><p>현재 발송 가능 <strong>{totals.eligible}</strong></p>
        <p>기간 내 동의 기록 <strong>{totals.periodGrants}</strong></p><p>기간 내 철회 기록 <strong>{totals.periodWithdrawals}</strong></p>
        <p>기간 내 삭제 기록 <strong>{totals.periodErasures}</strong></p></div>}</Panel>
    <Panel title="서비스별 마케팅 동의 현황"><form className="cs-row" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
      <input className="cs-input" aria-label="서비스명 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <ActionButton secondary>검색</ActionButton><ActionButton type="button" secondary onClick={result.reload}>새로고침</ActionButton></form>
      <DataTable columns={["서비스명", "현재 동의", "현재 철회", "현재 삭제", "발송 제외", "수신 차단", "발송 가능", "기간 동의", "기간 철회", "기간 삭제"]}
        rows={(result.data?.items ?? []).map(row => [row.name, row.granted, row.withdrawn, row.erased,
          row.excluded, row.suppressed, row.eligible, row.periodGrants, row.periodWithdrawals, row.periodErasures])} />
      <p className="forms-muted">기간 수치는 저장된 동의 변경 이벤트의 발생 시각을 기준으로 합니다. 수신 차단은 정보주체 철회·이메일 반송·신고·수신거부로 차단된 현재 동의 건수입니다.</p>
      <Link href="/form/ad-manage" className="cs-link">수신동의 관리로 이동</Link>
    </Panel></div>;
}
