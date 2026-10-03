"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import { destructionLabels, destructionStatuses, type DestructionRecord, type CertificateRecord } from "@/contracts/destruction";
import { useApplication } from "../ApplicationContext";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { RemoteTable } from "../RemoteTable";
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
const time = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR") : "-";
const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const countLabels: Record<string, string> = { campaignRecipients: "캠페인 수신자 연락처", marketingJobs: "마케팅 발송 원문·로컬 파일", marketingPreferences: "마케팅 연락처·동의 근거", subjectBindings: "정보주체 연결", dataSubjects: "정보주체 연락처", importEvidence: "CSV 수집 근거", importRows: "CSV 임시 행", answers: "답변", notes: "담당자 메모", correctionPayloads: "정정 원문", corrections: "정정 기록", consentEvents: "동의 변경 기록", receipts: "동의 영수증", files: "첨부 저장 기록" };

function DestructionActions({ row, reload }: { row: DestructionRecord; reload: () => void }) {
  const app = useApplication(), manager = ["owner", "admin"].includes(app.data?.company?.role ?? "");
  const [action, setAction] = useState(""), [reason, setReason] = useState(""), [date, setDate] = useState(localDate(row.dueAt));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await api("/destruction-requests/" + row.id + "/" + action, { method: "POST", body: JSON.stringify({
      version: row.version, reason, ...(action === "reschedule" ? { dueAt: new Date(date).toISOString() } : {}),
    }) }); setAction(""); reload(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const pending = !row.startedAt && ["pending", "scheduled"].includes(row.status);
  return <div className="cs-stack"><p><strong>{destructionLabels[row.status]}</strong> · 예정 {time(row.dueAt)} {row.legalHold && "· 보존 조치 중"}</p>
    {row.reason && <p>요청 사유: {row.reason}</p>}{row.decision && <p>처리 사유: {row.decision}</p>}
    {row.startedAt && <p>시작 {time(row.startedAt)} · 처리 시도 {row.attempts}회</p>}
    {row.lastError && <p role="status">{row.lastError === "APPROVAL_REQUIRED" ? "현재 관리자 권한 또는 회사 정책이 바뀌어 다시 승인받아야 합니다." :
      "삭제를 완료하지 못했습니다. 원문 열람은 차단되어 있습니다."} {row.nextAttemptAt && "다음 재시도 " + time(row.nextAttemptAt)}</p>}
    {row.certificateId && <Link className="cs-link" href={"/log/destruction_certificate?submissionId=" + row.submissionId}>파기 증명서 확인</Link>}
    {action ? <form className="cs-stack" onSubmit={submit}>
      {action === "approve" && <p>승인하면 예정 시각에 답변·정정 이력·메모·동의 기록·첨부파일이 삭제됩니다. 삭제가 시작된 후에는 취소할 수 없습니다.</p>}
      {action === "cancel" && <p>이 파기 예약을 취소합니다. 보유 기한이 지난 원문은 계속 열람할 수 없습니다. 다시 파기하려면 응답 상세에서 새로 요청해주세요.</p>}
      {action === "reschedule" && <label className="cs-label">파기 예정 시각<input className="cs-input" type="datetime-local" aria-label="파기 예정 시각" required value={date} onChange={event => setDate(event.target.value)} /><span>일정 변경 후 관리자 승인을 다시 받습니다.</span></label>}
      <label className="cs-label">처리 사유<textarea className="cs-input" aria-label="파기 처리 사유" required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="forms-actions"><ActionButton disabled={busy}>처리 확인</ActionButton><ActionButton secondary type="button" disabled={busy} onClick={() => setAction("")}>닫기</ActionButton></div>
    </form> : <div className="forms-actions">{pending && <>
      {manager && row.status === "pending" && <ActionButton disabled={row.legalHold} onClick={() => setAction("approve")}>파기 승인</ActionButton>}
      {manager && <ActionButton secondary onClick={() => setAction("reject")}>반려</ActionButton>}
      <ActionButton secondary onClick={() => setAction("reschedule")}>일정 변경</ActionButton>
      <ActionButton secondary onClick={() => setAction("cancel")}>예약 취소</ActionButton></>}
      {row.status === "failed" && <ActionButton onClick={() => setAction("retry")}>파기 재처리</ActionButton>}
    </div>}{error && <p role="alert">{error}</p>}</div>;
}
export function SubmissionDestruction({ id, changed }: { id: string; changed: () => void }) {
  const result = useResource<Page<DestructionRecord>>("/destruction-requests?submissionId=" + id + "&pageSize=10");
  return <section><h3>파기 처리</h3><ActionButton secondary onClick={() => { result.reload(); changed(); }}>처리 상태 새로고침</ActionButton>
    {result.error ? <p role="alert">{result.error.message}</p> : result.data?.items.map(row =>
      <article className="forms-note" key={row.id + ":" + row.version}><DestructionActions row={row} reload={() => { result.reload(); changed(); }} /></article>)}
    {result.data?.total === 0 && <p>등록된 파기 요청이 없습니다.</p>}
  </section>;
}
export function DestructionPages({ certificates = false }: { certificates?: boolean }) {
  const app = useApplication(), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState(""), [service, setService] = useState(""), [selected, setSelected] = useState<DestructionRecord | CertificateRecord>();
  const [submissionId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("submissionId") ?? "");
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status && !certificates) params.set("status", status); if (service) params.set("serviceId", service); if (submissionId) params.set("submissionId", submissionId);
  const result = useResource<Page<DestructionRecord | CertificateRecord>>("/destruction-" + (certificates ? "certificates" : "requests") + "?" + params);
  const reload = result.reload;
  const processing = result.data?.items.some(item => "status" in item && ["scheduled", "running", "retry"].includes(item.status));
  useEffect(() => { if (!processing) return; const timer = setInterval(() => { if (!document.hidden) reload(); }, 5000); return () => clearInterval(timer); }, [processing, reload]);
  return <><PageHeading title={certificates ? "개인정보 파기 증명서" : "개인정보 파기 일정"}><ActionButton secondary onClick={reload}>새로고침</ActionButton></PageHeading>
    <p className="mg-description">{certificates ? "현재 DB 원문과 비공개 저장소 파일의 삭제를 확인한 기록입니다. 백업과 데이터베이스 복구 로그의 물리 삭제는 이 증명 범위에 포함되지 않습니다." :
      "요청·승인·보존 조치·예약 취소와 실제 삭제 결과를 확인합니다. 응답 상세에서 파기를 요청할 수 있습니다."}</p>
    <Panel><div className="mg-toolbar"><div className="mg-flex"><select className="cs-input" aria-label="파기 서비스" value={service} onChange={event => { setService(event.target.value); setPage(1); }}>
      <option value="">권한이 있는 모든 서비스</option>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {!certificates && <select className="cs-input" aria-label="파기 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">모든 상태</option>
        {destructionStatuses.map(value => <option key={value} value={value}>{destructionLabels[value]}</option>)}</select>}
      <Link className="cs-link" href={certificates ? "/log/destruction-schedule" : "/log/destruction_certificate"}>{certificates ? "파기 일정" : "파기 증명서"}</Link>
    </div></div>
    <RemoteTable columns={certificates ? ["증명서 번호", "응답 ID", "파기 완료일", "무결성", "보기"] : ["폼", "응답 ID", "예정 시각", "상태", "처리"]}
      rows={(result.data?.items ?? []).map(item => ({ id: item.id, cells: "status" in item
        ? [item.formTitle, item.submissionId, time(item.dueAt), destructionLabels[item.status] + (item.legalHold ? " · 보존 조치" : ""), <button className="cs-link" key="open" onClick={() => setSelected(item)}>상세</button>]
        : [item.id, item.submissionId, time(item.completedAt), item.integrityVerified ? "확인" : "확인 실패", <button className="cs-link" key="open" onClick={() => setSelected(item)}>증명서 보기</button>] }))}
      total={result.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }}
      loading={result.loading} error={result.error?.message} />
    </Panel>{selected && <Modal title={"status" in selected ? "파기 요청 상세" : "파기 증명서"} onClose={() => setSelected(undefined)}>
      {"status" in selected ? <><p>응답 ID: {selected.submissionId}</p><DestructionActions key={selected.id + ":" + selected.version} row={selected}
        reload={() => { setSelected(undefined); reload(); }} /></> :
        <div className="cs-stack"><p>증명서 번호: {selected.id}</p><p>응답 ID: {selected.submissionId}</p><p>파기 완료: {time(selected.completedAt)}</p>
          <dl className="forms-response-values">{Object.entries(selected.counts).map(([key, value]) => <div key={key}><dt>{countLabels[key] ?? key}</dt><dd>{value}개</dd></div>)}</dl>
          <p>DB에서 원문 행을 삭제하고 암호화 파일 객체를 저장소에서 제거했습니다. 관련 중복 요청의 응답 캐시도 제거했습니다.</p>
          <p>원문이 없는 감사 기록과 재실행 방지 표식은 남습니다. 백업·복구 로그·이미 내려받은 외부 사본은 이 증명서의 대상이 아닙니다.</p>
          <p>무결성: {selected.integrityVerified ? "확인됨" : "확인 실패"}</p>
          <a className="cs-button" href={"/api/v1/destruction-certificates/" + selected.id + "/download"}>증명서 JSON 다운로드</a>
        </div>}</Modal>}
  </>;
}
