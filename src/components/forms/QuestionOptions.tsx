"use client";
import type { Question } from "@/contracts/forms";
import type { OptionDefinition } from "@/contracts/questions";
import { useEffect, useRef, useState } from "react";
import { customChoiceTypes, MAX_CUSTOM_CHOICE_LABEL_LENGTH } from "@/contracts/custom-choice";
import { Modal } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { MAX_OPTION_IMAGES, optionImageQuestionTypes } from "@/contracts/author-assets";
import { OptionImageEditor } from "./OptionImageEditor";
import type { AuthorAssetEditContext } from "./AuthorAssetUpload";

export function QuestionOptions({ question, index, questions, disabled = false, getSaveState, assetContext, change }: { question: Question; index: number; questions: Question[]; disabled?: boolean; getSaveState?: () => unknown; assetContext?: AuthorAssetEditContext; change: (patch: Partial<Question>) => void }) {
  const options = question.optionDefinitions ?? [];
  const [imagesExpanded, setImagesExpanded] = useState(false);
  const imageCount = options.filter(option => !!option.optionImageKey).length;
  const imagesAllowed = optionImageQuestionTypes.includes(question.type), imagesEnabled = imagesExpanded || imageCount > 0;
  const [edit, setEdit] = useState<{ id: string; original: string; text: string; snapshot: string; saveState: unknown }>(), [error, setError] = useState("");
  const confirm = useConfirm(), latest = useRef({ question, questions, disabled, getSaveState, change });
  useEffect(() => { latest.current = { question, questions, disabled, getSaveState, change }; }, [question, questions, disabled, getSaveState, change]);
  useUnsavedChanges(!!edit && edit.text !== edit.original, "아직 적용하지 않은 보기 이름이 있습니다.");
  const hasCustom = options.some(option => option.isCustomValue);
  const update = (items: OptionDefinition[]) => { if (!disabled) change({ options: items.map(option => option.value), optionDefinitions: items }); };
  const referenced = (option: OptionDefinition, list = questions) => list.some(item => item.condition?.questionId === question.id &&
    (item.condition.optionId === option.id || item.condition.value === option.value));
  const move = (from: number, to: number) => {
    if (disabled || to < 0 || to >= options.length || options[from]?.isCustomValue || options[to]?.isCustomValue) return;
    const items = [...options]; [items[from], items[to]] = [items[to], items[from]]; update(items);
  };
  async function remove(option: OptionDefinition) {
    if (disabled || referenced(option)) return;
    const snapshot = JSON.stringify(question), saveState = getSaveState?.();
    if (option.isCustomValue && !await confirm({ title: "기타 보기 제거", message: "기타 보기와 직접입력 설정을 제거할까요? 이전 게시본과 응답은 유지됩니다.", confirmLabel: "기타 제거" })) return;
    const current = latest.current;
    if (current.disabled) return;
    if (JSON.stringify(current.question) !== snapshot || referenced(option, current.questions) || current.getSaveState?.() !== saveState) { setError("문항 또는 저장 상태가 변경되었습니다. 확인한 뒤 다시 시도해주세요."); return; }
    const items = (current.question.optionDefinitions ?? []).filter(item => item.id !== option.id);
    current.change({ options: items.map(item => item.value), optionDefinitions: items }); setError("");
  }
  async function removeImages() {
    if (disabled) return;
    const snapshot = JSON.stringify(question), saveState = getSaveState?.(), contextSnapshot = assetContext?.capture();
    if (imageCount && !await confirm({ title: "답변별 이미지를 끌까요?", message: `현재 문항의 이미지 ${imageCount}개를 모두 제거합니다. 이전 게시본은 유지됩니다.`, confirmLabel: "끄고 삭제" })) return;
    const current = latest.current;
    if (current.disabled) return;
    if (JSON.stringify(current.question) !== snapshot || current.getSaveState?.() !== saveState || (assetContext && !assetContext.isCurrent(contextSnapshot))) {
      setError("문항 또는 저장 상태가 변경되었습니다. 확인한 뒤 다시 시도해주세요."); return;
    }
    const items = (current.question.optionDefinitions ?? []).map(option => ({ ...option, optionImageKey: null }));
    current.change({ options: items.map(option => option.value), optionDefinitions: items }); setImagesExpanded(false); setError("");
  }
  async function closeEdit() {
    if (edit && edit.text !== edit.original && !await confirm({ title: "보기 이름 입력 취소", message: "적용하지 않은 이름을 버릴까요?", confirmLabel: "입력 버리기", cancelLabel: "계속 편집" })) return;
    if (!latest.current.disabled) { setEdit(undefined); setError(""); }
  }
  return <fieldset className="forms-options"><legend>선택 항목</legend>
    {imagesAllowed && <><label className="member-check"><input type="checkbox" aria-label={`Q${index + 1} 답변별 이미지 사용`} checked={imagesEnabled} disabled={disabled}
      onChange={event => { if (event.target.checked) setImagesExpanded(true); else void removeImages(); }} />답변별 이미지</label>
      {imagesEnabled && <p className="cs-muted">일반 보기당 1개, 문항당 {MAX_OPTION_IMAGES}개까지 첨부할 수 있습니다. ({imageCount} / {MAX_OPTION_IMAGES})</p>}</>}
    {options.map((option, position) => {
      const connected = referenced(option), legacyLong = !option.isCustomValue && option.label.length > MAX_CUSTOM_CHOICE_LABEL_LENGTH;
      return <div className="cs-stack" key={option.id}>
        <label className="cs-label">보기 {position + 1}{option.isCustomValue && " · 기타 직접입력"}<input className="cs-input" aria-label={`Q${index + 1} 보기 ${position + 1}`} disabled={disabled}
          maxLength={legacyLong ? option.label.length : MAX_CUSTOM_CHOICE_LABEL_LENGTH} readOnly={legacyLong} value={option.label}
          onChange={event => update(options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item))} /></label>
        {legacyLong && <><p className="cs-muted">기존 긴 이름은 그대로 저장됩니다. 이름을 수정할 때는 250자 이내로 입력해주세요.</p>
          <button type="button" aria-label={`Q${index + 1} 보기 ${position + 1} 이름 수정`} disabled={disabled} onClick={() => {
            setError(""); setEdit({ id: option.id, original: option.label, text: option.label, snapshot: JSON.stringify(question), saveState: getSaveState?.() });
          }}>이름 수정</button></>}
        <div className="forms-between">
          <button type="button" aria-label={`Q${index + 1} 보기 ${position + 1} 위로`} disabled={disabled || position === 0 || option.isCustomValue} onClick={() => move(position, position - 1)}>위로</button>
          <button type="button" aria-label={`Q${index + 1} 보기 ${position + 1} 아래로`} disabled={disabled || position === options.length - 1 || option.isCustomValue || options[position + 1]?.isCustomValue} onClick={() => move(position, position + 1)}>아래로</button>
          <button type="button" aria-label={`Q${index + 1} 보기 ${position + 1} 삭제`} disabled={disabled || connected} onClick={() => void remove(option)}>삭제</button>
        </div>
        {imagesAllowed && imagesEnabled && !option.isCustomValue && <OptionImageEditor questionId={question.id} option={option} label={`Q${index + 1} 보기 ${position + 1}`}
          imageCount={imageCount} disabled={disabled} context={assetContext} onChange={optionImageKey => {
            const current = latest.current;
            if (current.disabled || current.question.id !== question.id || !optionImageQuestionTypes.includes(current.question.type)) return;
            const items = (current.question.optionDefinitions ?? []).map(item => item.id === option.id && !item.isCustomValue ? { ...item, optionImageKey } : item);
            current.change({ options: items.map(item => item.value), optionDefinitions: items });
          }} />}
        {connected && <p className="cs-muted">표시 조건에 연결된 보기입니다. 삭제하려면 연결된 질문의 조건을 먼저 해제해주세요.</p>}
      </div>;
    })}
    <button type="button" aria-label={`Q${index + 1} 보기 추가`} disabled={disabled || options.length >= 100} onClick={() => {
      const id = crypto.randomUUID(), items = [...options], customIndex = items.findIndex(option => option.isCustomValue);
      items.splice(customIndex < 0 ? items.length : customIndex, 0, { id, value: id, label: "새 보기" }); update(items);
    }}>보기 추가</button>
    {customChoiceTypes.includes(question.type) && <button type="button" aria-label={`Q${index + 1} 기타 보기 추가`} disabled={disabled || hasCustom || options.length >= 100} onClick={() => {
      if (hasCustom) return; const id = crypto.randomUUID(); update([...options, { id, value: id, label: "기타", isCustomValue: true }]);
    }}>기타 보기 추가</button>}
    {hasCustom && <p className="cs-muted">기타 보기는 마지막에 배치되며 선택하면 100자 이내로 직접 입력할 수 있습니다.</p>}
    {!edit && error && <p role="alert">{error}</p>}
    {edit && <Modal title={`Q${index + 1} 보기 이름 수정`} onClose={() => void closeEdit()}>
      <form className="cs-stack" noValidate onSubmit={event => {
        event.preventDefault(); if (disabled) return;
        if (JSON.stringify(question) !== edit.snapshot || getSaveState?.() !== edit.saveState) { setError("문항 또는 저장 상태가 변경되었습니다. 입력을 취소하고 다시 열어주세요."); return; }
        if (!edit.text.trim() || edit.text.length > MAX_CUSTOM_CHOICE_LABEL_LENGTH) { setError("보기 이름을 250자 이내로 입력해주세요."); return; }
        update(options.map(option => option.id === edit.id ? { ...option, label: edit.text } : option)); setEdit(undefined); setError("");
      }}>
        <label className="cs-label">보기 이름<input className="cs-input" aria-label="수정할 보기 이름" maxLength={MAX_CUSTOM_CHOICE_LABEL_LENGTH} value={edit.text} disabled={disabled}
          onChange={event => setEdit({ ...edit, text: event.target.value })} /></label>
        <p className="cs-muted">{edit.text.length} / {MAX_CUSTOM_CHOICE_LABEL_LENGTH} · 적용 전까지 기존 이름을 유지합니다.</p>
        {error && <p role="alert">{error}</p>}
        <div className="forms-actions"><button className="cs-button secondary" type="button" disabled={disabled} onClick={() => void closeEdit()}>취소</button>
          <button className="cs-button" type="submit" disabled={disabled || !edit.text.trim() || edit.text.length > MAX_CUSTOM_CHOICE_LABEL_LENGTH}>이름 적용</button></div>
      </form>
    </Modal>}
  </fieldset>;
}
