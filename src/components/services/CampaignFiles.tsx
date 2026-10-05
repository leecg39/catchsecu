"use client";
import { useRef, useState } from "react";
import { api, errorText } from "@/lib/api";
import type { CampaignRecord } from "@/contracts/campaigns";
import { FILE_ACCEPT, type FileInfo } from "@/contracts/files";
import { ActionButton, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";
const statuses: Record<string, string> = { pending: "업로드 대기", uploaded: "검사 필요", ready: "첨부 연결 대기", attached: "검사·연결 완료", rejected: "검사 거부", deleting: "실제 파일 삭제 중" };
export function CampaignFiles({ record: r, editable, onChanged, onBusy }: { record: CampaignRecord; editable: boolean; onChanged: () => void; onBusy: (value: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const pending = useRef<{ signature: string; key: string; file?: FileInfo }>(null);
  const ask = useConfirm();
  function working(value: boolean) { setBusy(value); onBusy(value); }
  async function attach(fileId: string) { await api("/campaigns/" + r.id + "/files/" + fileId + "/attach", { method: "POST", body: JSON.stringify({ version: r.version }) }); }
  async function upload(file: File) {
    if (busy) return; working(true); setError(""); setProgress("파일을 준비하고 있습니다.");
    try {
      const mime = file.type || (/\.csv$/i.test(file.name) ? "text/csv" : /\.txt$/i.test(file.name) ? "text/plain" : "");
      if (!file.size || file.size > 10485760 || !["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"].includes(mime)) throw new Error("각 10MB 이하의 PDF·PNG·JPG·TXT·CSV를 선택해주세요.");
      const bytes = await file.arrayBuffer(), sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("");
      const signature = r.id + ":" + r.version + ":" + file.name + ":" + sha256;
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const item = pending.current; item.file ??= await api<FileInfo>("/campaigns/" + r.id + "/files", { method: "POST", headers: { "Idempotency-Key": item.key }, body: JSON.stringify({ version: r.version, name: file.name, mime, size: file.size, sha256 }) });
      setProgress("파일 업로드와 악성코드 검사를 진행합니다.");
      const response = await fetch("/api/v1/uploads/" + item.file.id + "/content", { method: "PUT", headers: { "Content-Type": mime }, body: bytes });
      if (!response.ok) throw new Error((await response.json()).error.message);
      await api("/uploads/" + item.file.id + "/complete", { method: "POST" }); await attach(item.file.id);
      pending.current = null; setProgress("검사를 마친 파일을 첨부했습니다."); onChanged();
    } catch (error) { setError(errorText(error)); setProgress(""); } finally { working(false); }
  }
  async function action(file: FileInfo, remove: boolean) {
    if (busy) return;
    if (remove && !await ask({ title: "첨부파일 삭제", message: `“${file.name}” 첨부파일을 이 발송에서 삭제합니다.`, confirmLabel: "삭제" })) return;
    working(true); setError("");
    try {
      if (remove) { const result = await api<{ cleanupPending: boolean }>("/campaigns/" + r.id + "/files/" + file.id, { method: "DELETE", body: JSON.stringify({ version: r.version }) }); setProgress(result.cleanupPending ? "접근을 차단했고 실제 파일 삭제를 재처리 중입니다." : "첨부 원문을 삭제했습니다."); }
      else { if (file.status === "uploaded") await api("/uploads/" + file.id + "/complete", { method: "POST" }); await attach(file.id); }
      onChanged();
    } catch (error) { setError(errorText(error)); } finally { working(false); }
  }
  return <Panel title="이메일 첨부파일"><div className="campaign-fields"><p className="campaign-note">최대 5개, 각 10MB·합계 20MB입니다. 검사 후 연결한 파일을 모든 수신자에게 전달합니다. 발송 요청 후에는 변경할 수 없으며 캠페인 생성 후 최대 30일 보관합니다.</p>
    {editable && <label>첨부파일 선택<input type="file" aria-label="이메일 첨부파일" accept={FILE_ACCEPT} disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ""; }} /></label>}
    {!r.files.length && <p>첨부파일이 없습니다.</p>}
    <ul className="campaign-files">{r.files.map(file => <li key={file.id}><div><strong>{file.name}</strong><small>{statuses[file.status] ?? file.status} · {file.size.toLocaleString()} bytes</small></div><div className="campaign-actions">
      {file.status === "attached" && <a className="cs-link" href={"/api/v1/campaigns/" + r.id + "/files/" + file.id + "/download"}>다운로드</a>}
      {editable && ["uploaded", "ready"].includes(file.status) && <ActionButton secondary disabled={busy} onClick={() => action(file, false)}>검사·연결 재처리</ActionButton>}
      {editable && file.status !== "deleting" && <ActionButton secondary disabled={busy} onClick={() => action(file, true)}>첨부파일 삭제</ActionButton>}
    </div></li>)}</ul>
    {editable && <ActionButton secondary disabled={busy} onClick={onChanged}>첨부 상태 불러오기</ActionButton>}{error && <p role="alert">{error} 첨부 상태를 불러오면 미완료 파일을 정리할 수 있습니다.</p>}<p role="status">{progress}</p>
  </div></Panel>;
}
