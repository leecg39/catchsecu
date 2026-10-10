"use client";
import { useEffect, useRef, useState } from "react";
import type { OptionDefinition } from "@/contracts/questions";
import { MAX_OPTION_IMAGES } from "@/contracts/author-assets";
import { AuthorAssetUpload, type AuthorAssetEditContext } from "./AuthorAssetUpload";
import { OptionImage } from "./OptionImage";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { useConfirm } from "../ux/confirm";

export function OptionImageEditor({ questionId, option, label, imageCount, disabled, context, onChange }: {
  questionId: string; option: OptionDefinition; label: string; imageCount: number; disabled: boolean;
  context?: AuthorAssetEditContext; onChange: (key: string | null) => void;
}) {
  const confirm = useConfirm(), [error, setError] = useState("");
  const { asset } = useAuthorAsset(option.optionImageKey);
  const latest = useRef({ questionId, option, imageCount, disabled, context, onChange });
  useEffect(() => { latest.current = { questionId, option, imageCount, disabled, context, onChange }; });
  if (option.isCustomValue) return null;
  async function remove() {
    if (disabled || !option.optionImageKey) return;
    const snapshot = context?.capture(), key = option.optionImageKey;
    if (!await confirm({ title: "보기 이미지 삭제", message: "이 보기에서 이미지를 제거할까요? 이전 게시본의 이미지는 유지됩니다.", confirmLabel: "이미지 삭제" })) return;
    const current = latest.current;
    if (current.disabled) return;
    if (current.questionId !== questionId || current.option.id !== option.id || current.option.optionImageKey !== key || (context && !context.isCurrent(snapshot))) {
      setError("보기 또는 저장 상태가 변경되었습니다. 확인한 뒤 다시 시도해주세요."); return;
    }
    current.onChange(null); setError("");
  }
  return <div className="forms-option-image-editor">
    {option.optionImageKey && <div className="forms-actions"><OptionImage assetKey={option.optionImageKey} label={option.label} />
      {asset && <span dir="auto">{asset.info.name}</span>}
      <button type="button" disabled={disabled} aria-label={`${label} 이미지 삭제`} onClick={() => void remove()}>이미지 삭제</button></div>}
    <AuthorAssetUpload key={option.optionImageKey ?? "empty"} purpose="OPTION_IMAGE" label={`${label} 이미지 ${option.optionImageKey ? "교체" : "추가"}`}
      targetKey={`${questionId}:option:${option.id}`} context={context} disabled={disabled || (!option.optionImageKey && imageCount >= MAX_OPTION_IMAGES)}
      onComplete={upload => {
        const current = latest.current;
        if (current.disabled || current.questionId !== questionId || current.option.id !== option.id || current.option.isCustomValue
          || (!current.option.optionImageKey && current.imageCount >= MAX_OPTION_IMAGES)) return false;
        current.onChange(upload.id); return true;
      }} />
    {error && <p role="alert">{error}</p>}
  </div>;
}
