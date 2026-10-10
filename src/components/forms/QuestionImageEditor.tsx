"use client";
import { useEffect, useRef, useState } from "react";
import type { Question } from "@/contracts/forms";
import { AuthorAssetUpload, type AuthorAssetEditContext } from "./AuthorAssetUpload";
import { QuestionImage } from "./QuestionImage";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { useConfirm, type ConfirmOptions } from "../ux/confirm";

type ImageEditState = {
  questionId: string; assetKey?: string | null; disabled: boolean; context?: AuthorAssetEditContext;
  onChange: (key: string | null) => void;
};
/** Re-read the destination after confirmation; an old dialog cannot delete a replacement or another question. */
export async function confirmQuestionImageRemoval(read: () => ImageEditState | undefined,
  confirm: (options: ConfirmOptions) => Promise<boolean>, turnOff: boolean): Promise<"removed" | "cancelled" | "stale" | "blocked"> {
  const original = read();
  if (!original || original.disabled) return "blocked";
  if (!original.assetKey) return "removed";
  const snapshot = original.context?.capture();
  if (!await confirm({ title: turnOff ? "문항 이미지를 끌까요?" : "이미지를 삭제할까요?",
    message: turnOff ? "등록한 이미지 1개가 삭제됩니다. 다시 켜도 복구되지 않습니다. 이전 게시본과 응답의 이미지는 유지됩니다."
      : "이 문항에서 이미지를 제거할까요? 이전 게시본과 응답의 이미지는 유지됩니다.",
    confirmLabel: turnOff ? "끄고 삭제" : "이미지 삭제", cancelLabel: "취소" })) return "cancelled";
  const current = read();
  if (!current || current.disabled) return "blocked";
  if (current.questionId !== original.questionId || current.assetKey !== original.assetKey
    || current.context?.serviceId !== original.context?.serviceId || (original.context && !original.context.isCurrent(snapshot))) return "stale";
  current.onChange(null);
  return "removed";
}

export function QuestionImageEditor({ question, index, disabled, context, onChange }: {
  question: Question; index: number; disabled: boolean; context?: AuthorAssetEditContext; onChange: (key: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false), [uploading, setUploading] = useState(false), [confirming, setConfirming] = useState(false), [error, setError] = useState("");
  const confirm = useConfirm(), { asset } = useAuthorAsset(question.questionImageKey);
  const mounted = useRef(true), pending = useRef(false), checking = useRef(false);
  const latest = useRef<ImageEditState>({ questionId: question.id, assetKey: question.questionImageKey, disabled, context, onChange });
  useEffect(() => { latest.current = { questionId: question.id, assetKey: question.questionImageKey, disabled, context, onChange }; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = (): ImageEditState | undefined => mounted.current ? { ...latest.current, disabled: latest.current.disabled || pending.current } : undefined;
  const trackedContext: AuthorAssetEditContext | undefined = context && { ...context, begin: () => {
    if (checking.current || pending.current || latest.current.disabled) return undefined;
    const release = context.begin(); if (!release) return undefined;
    pending.current = true; setUploading(true);
    let released = false;
    return () => { if (released) return; released = true; pending.current = false; release(); if (mounted.current) setUploading(false); };
  } };
  async function remove(turnOff: boolean) {
    if (checking.current) return;
    checking.current = true; setConfirming(true);
    try {
      const result = await confirmQuestionImageRemoval(read, confirm, turnOff);
      if (!mounted.current) return;
      if (result === "removed") { setExpanded(!turnOff); setError(""); }
      else if (result === "stale") setError("문항이나 저장 상태가 변경되었습니다. 확인한 뒤 다시 시도해주세요.");
    } finally { checking.current = false; if (mounted.current) setConfirming(false); }
  }
  const enabled = expanded || !!question.questionImageKey, prefix = `Q${index + 1}`;
  return <div className="forms-question-image-editor">
    <label className="member-check"><input type="checkbox" aria-label={`${prefix} 문항 이미지 사용`} checked={enabled} disabled={disabled || uploading || confirming}
      onChange={event => { if (disabled || pending.current || checking.current) return; if (event.target.checked) { setExpanded(true); setError(""); } else void remove(true); }} />
      문항 설명 이미지 <span className="cs-muted">{question.questionImageKey ? 1 : 0} / 1</span></label>
    {enabled && <div className="cs-stack">
      <QuestionImage assetKey={question.questionImageKey} />
      {question.questionImageKey && <div className="forms-actions">
        {asset?.info.purpose === "QUESTION_IMAGE" && <span dir="auto">{asset.info.name}</span>}
        <button type="button" disabled={disabled || uploading || confirming} aria-label={`${prefix} 문항 이미지 삭제`} onClick={() => void remove(false)}>삭제</button>
      </div>}
      <AuthorAssetUpload key={`${question.id}:${question.questionImageKey ?? "empty"}`} purpose="QUESTION_IMAGE"
        label={`${prefix} 문항 설명 이미지 ${question.questionImageKey ? "교체" : "추가"}`} targetKey={`${question.id}:question-image`}
        context={trackedContext} disabled={disabled || confirming} onComplete={upload => {
          const current = latest.current;
          if (!mounted.current || current.disabled || current.questionId !== question.id || current.assetKey !== question.questionImageKey || upload.purpose !== "QUESTION_IMAGE") return false;
          current.onChange(upload.id); setError(""); return true;
        }} />
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
