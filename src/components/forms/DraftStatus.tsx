"use client";
import { useState } from "react";
import type { FormDraftState } from "@/lib/use-form-draft";
import { errorText } from "@/lib/api";
import "./form-draft.css";

export function DraftStatus({ draft }: { draft: FormDraftState }) {
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ formId: draft.record?.id, version: draft.record?.version, ...draft.value }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "catchform-draft.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="forms-draft-status" aria-label="초안 저장 상태">
    <p role="status">{draft.message || "입력 후 자동으로 저장합니다."}</p>
    {draft.error && <p role="alert">{draft.error}</p>}{error && <p role="alert">{error}</p>}
    {["error", "conflict"].includes(draft.phase) && <>
      <div className="forms-actions">{draft.phase === "error" && <button type="button" className="cs-button secondary" disabled={loading || draft.saving} onClick={() => void draft.save()}>저장 재시도</button>}
        <button type="button" className="cs-button secondary" onClick={download}>내 수정본 내려받기</button>
        {draft.record && <button type="button" className="cs-button secondary" disabled={loading || draft.saving} onClick={async () => {
          setLoading(true); setError(""); try { await draft.reload(); } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
        }}>{loading ? "불러오는 중…" : "최신본 불러오기"}</button>}</div>
      <p>최신본을 불러오면 이 화면의 미저장 수정 내용이 교체됩니다. 필요한 수정본은 먼저 내려받으세요.</p>
    </>}
    {draft.navigationTarget && draft.dirty && !draft.saving && <div className="forms-actions">
      <p>저장을 마치지 못해 이동을 멈췄습니다.</p><button type="button" className="cs-button secondary" onClick={draft.cancelNavigation}>계속 편집</button>
      <button type="button" className="cs-button secondary" onClick={draft.discardNavigation}>저장하지 않고 이동</button>
    </div>}
  </section>;
}
