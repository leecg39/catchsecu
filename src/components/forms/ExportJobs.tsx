"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { exportStatusLabels, type ExportRecord } from "@/contracts/exports";
import { ActionButton, Panel } from "../shared";

export function ExportJobs({ formId, filters }: { formId: string; filters: Record<string, string> }) {
  const [page, setPage] = useState(1);
  const result = useResource<{ items: ExportRecord[]; total: number; page: number; pageSize: number; canCreate: boolean }>("/exports?formId=" + formId + "&page=" + page);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), pending = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => { if (!busy && document.visibilityState === "visible") result.reload(); }, result.data?.items.some(r => ["queued", "processing"].includes(r.status)) ? 3000 : 15000);
    const focus = () => { if (!busy) result.reload(); }; window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [result.data, result.reload, busy]);
  async function create() {
    if (busy) return; setBusy(true); setError("");
    const payload = JSON.stringify({ formId, filters });
    if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
    try { await api("/exports", { method: "POST", body: payload, headers: { "Idempotency-Key": pending.current.key } }); pending.current = null; result.reload(); }
    catch (cause) { if (cause instanceof ApiError && [400, 403, 409, 410, 413, 422].includes(cause.status)) pending.current = null; setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function change(row: ExportRecord, remove: boolean) {
    if (busy) return; setBusy(true); setError("");
    try { await api("/exports/" + row.id + (remove ? "" : "/cancel"), { method: remove ? "DELETE" : "POST", body: JSON.stringify({ version: row.version }) }); result.reload(); }
    catch (cause) { setError(errorText(cause)); result.reload(); } finally { setBusy(false); }
  }
  async function download(row: ExportRecord) {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/exports/" + row.id + "/download", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const value = await response.json().catch(() => null); throw new Error(value?.error?.message ?? "다운로드할 수 없습니다."); }
      if (!response.headers.get("content-type")?.startsWith("text/csv")) throw new Error("CSV 형식을 확인할 수 없습니다.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = "responses-" + row.id + ".csv";
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (cause) { setError(errorText(cause)); result.reload(); } finally { setBusy(false); }
  }
  return <Panel title="비동기 CSV 내보내기"><p className="cs-muted">현재 검색 조건으로 최대 100,000건·20MB를 처리합니다. 결과는 최대 24시간 보관되며, 응답이나 권한이 바뀌면 새 작업을 요청해야 합니다.</p>
    <div className="forms-actions"><ActionButton disabled={busy || !!result.error || !result.data?.canCreate} onClick={create}>내보내기 요청</ActionButton><ActionButton secondary disabled={busy} onClick={result.reload}>새로고침</ActionButton></div>
    {(error || result.error) && <p role="alert">{error || result.error?.message}</p>}
    {result.loading && !result.data ? <p role="status">작업을 불러오는 중입니다.</p> : !result.data?.items.length ? <p>내보내기 작업이 없습니다.</p> : <div className="cs-table-wrap"><table className="cs-table"><thead><tr><th>요청 시각</th><th>상태</th><th>처리</th><th>만료</th><th>작업</th></tr></thead><tbody>{result.data.items.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("ko-KR")}</td><td>{exportStatusLabels[row.status] ?? row.status}</td><td>{row.processedRows.toLocaleString()} / {row.totalRows.toLocaleString()}</td><td>{new Date(row.expiresAt).toLocaleString("ko-KR")}</td><td><div className="forms-actions">{row.actions.download && <ActionButton secondary disabled={busy} onClick={() => download(row)}>다운로드</ActionButton>}{row.actions.cancel && <ActionButton secondary disabled={busy} onClick={() => change(row, false)}>취소</ActionButton>}{row.actions.delete && <ActionButton secondary disabled={busy} onClick={() => change(row, true)}>삭제</ActionButton>}</div></td></tr>)}</tbody></table></div>}
    {result.data && <div className="forms-actions"><ActionButton secondary disabled={busy || result.data.page <= 1} onClick={() => setPage(result.data!.page - 1)}>이전</ActionButton><span>{result.data.page}쪽 · 총 {result.data.total}개</span><ActionButton secondary disabled={busy || result.data.page * result.data.pageSize >= result.data.total} onClick={() => setPage(result.data!.page + 1)}>다음</ActionButton></div>}
  </Panel>;
}
