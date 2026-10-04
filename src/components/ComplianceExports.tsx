"use client";
import { useRef, useState } from "react";
import type { ComplianceExportRecord } from "@/contracts/compliance-exports";
import { exportStatusLabels } from "@/contracts/exports";
import { api, errorText, useResource } from "@/lib/api";
import { ActionButton, Panel } from "./shared";

export function ComplianceExports({ closeId }: { closeId: string }) {
  const [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const keys = useRef<Partial<Record<"pdf" | "csv", string>>>({});
  const result = useResource<{ items: ComplianceExportRecord[]; total: number; page: number; pageSize: number }>(`/analytics/exports?closeId=${closeId}&page=${page}`);
  async function create(format: "pdf" | "csv") {
    if (busy) return; setBusy(true); setError("");
    const key = keys.current[format] ??= crypto.randomUUID();
    try { await api("/analytics/exports", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ closeId, format }) });
      delete keys.current[format]; setPage(1); result.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function change(row: ComplianceExportRecord, remove: boolean) {
    if (busy) return; setBusy(true); setError("");
    try { await api(`/analytics/exports/${row.id}${remove ? "" : "/cancel"}`, { method: remove ? "DELETE" : "POST", body: JSON.stringify({ version: row.version }) }); result.reload(); }
    catch (cause) { setError(errorText(cause)); result.reload(); } finally { setBusy(false); }
  }
  async function download(row: ComplianceExportRecord) {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/analytics/exports/${row.id}/download`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const problem = await response.json(); throw new Error(problem.error?.message ?? "파일을 내려받지 못했습니다."); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = `compliance-${row.id}.${row.format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) { setError(errorText(cause)); result.reload(); } finally { setBusy(false); }
  }
  return <Panel title="마감 출력 작업">
    <p className="public-stat-note">선택한 마감의 합계로 파일을 만듭니다. 요청한 사람만 현재 권한으로 내려받을 수 있으며, 파일은 요청 후 24시간에 만료됩니다.</p>
    <div className="public-stat-filters">
      <ActionButton disabled={busy} onClick={() => { void create("pdf"); }}>PDF 출력 요청</ActionButton>
      <ActionButton secondary disabled={busy} onClick={() => { void create("csv"); }}>CSV 출력 요청</ActionButton>
      <ActionButton secondary disabled={busy} onClick={result.reload}>출력 상태 새로고침</ActionButton>
    </div>
    {(error || result.error) && <p role="alert">{error || result.error?.message}</p>}
    {result.loading ? <p role="status">출력 작업을 불러오는 중입니다.</p> : result.data && <>
      <div className="cs-table-wrap"><table className="cs-table"><thead><tr>{["형식", "상태", "요청 시각", "만료 시각", "크기", "작업"].map(title => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{result.data.items.length ? result.data.items.map(row => <tr key={row.id}>
          <td>{row.format.toUpperCase()}</td><td>{exportStatusLabels[row.status] ?? row.status}{row.errorCode && <p>{row.status === "processing" ? "자동 재시도 대기" : "다시 출력 요청해주세요."}</p>}</td>
          <td>{new Date(row.createdAt).toLocaleString("ko-KR")}</td><td>{new Date(row.expiresAt).toLocaleString("ko-KR")}</td><td>{row.byteLength ? `${(row.byteLength / 1024).toFixed(1)} KB` : "—"}</td>
          <td><div className="public-stat-filters">
            {row.actions.download && <ActionButton secondary disabled={busy} onClick={() => { void download(row); }}>{row.format.toUpperCase()} 내려받기</ActionButton>}
            {row.actions.cancel && <ActionButton secondary disabled={busy} onClick={() => { void change(row, false); }}>취소</ActionButton>}
            {row.actions.delete && <ActionButton secondary disabled={busy} onClick={() => { void change(row, true); }}>파일 삭제</ActionButton>}
          </div></td>
        </tr>) : <tr><td colSpan={6}>출력 작업이 없습니다.</td></tr>}</tbody></table></div>
      <div className="public-stat-filters"><span>{result.data.total}개 · {result.data.page}페이지</span>
        <ActionButton secondary disabled={busy || result.data.page <= 1} onClick={() => setPage(result.data!.page - 1)}>이전 출력</ActionButton>
        <ActionButton secondary disabled={busy || result.data.page * result.data.pageSize >= result.data.total} onClick={() => setPage(result.data!.page + 1)}>다음 출력</ActionButton>
      </div>
    </>}
  </Panel>;
}
