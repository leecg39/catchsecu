"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Question } from "@/contracts/forms";
import { createQuestionMaterialLink, reindexQuestionMaterials, MAX_QUESTION_MATERIALS, MAX_MATERIAL_LINK_URL_LENGTH,
  MAX_MATERIAL_LINK_LABEL_LENGTH, type QuestionMaterial, createQuestionMaterialFile } from "@/contracts/question-materials";
import { ActionButton, Modal } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { AuthorAssetUpload, type AuthorAssetEditContext } from "./AuthorAssetUpload";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { authorAssetSizeLabel } from "@/lib/author-assets";

const emptyMaterials: QuestionMaterial[] = [];
function MaterialName({ material }: { material: QuestionMaterial }) {
  const { asset } = useAuthorAsset(material.fileKey);
  return <span className="forms-material-label" dir="auto">{material.materialType === "LINK" ? material.linkLabel : asset?.info.name ?? "첨부 파일"}
    {material.materialType === "FILE" && asset && <small> · {authorAssetSizeLabel(asset.info.size)}</small>}</span>;
}
type Edit = { position: number | null; label: string; url: string; originalLabel: string; originalUrl: string; snapshot: string; contextSnapshot: unknown };
export function QuestionMaterialsEditor({ question, index, disabled, context, onChange }: {
  question: Question; index: number; disabled: boolean; context?: AuthorAssetEditContext; onChange: (materials: QuestionMaterial[]) => void;
}) {
  const [expanded, setExpanded] = useState(false), [edit, setEdit] = useState<Edit>(), [error, setError] = useState("");
  const confirm = useConfirm(), materials = question.materialList ?? emptyMaterials, enabled = expanded || materials.length > 0;
  const latest = useRef({ questionId: question.id, materials, disabled, context, onChange });
  useEffect(() => { latest.current = { questionId: question.id, materials, disabled, context, onChange }; }, [question.id, materials, disabled, context, onChange]);
  const dirty = !!edit && (edit.label !== edit.originalLabel || edit.url !== edit.originalUrl);
  useUnsavedChanges(dirty, "아직 적용하지 않은 참고 링크 입력이 있습니다.");
  const prefix = `Q${index + 1}`;
  function begin(position: number | null) {
    if (disabled) return;
    const item = position === null ? undefined : materials[position];
    setError(""); setEdit({ position, label: item?.linkLabel ?? "", url: item?.linkUrl ?? "", originalLabel: item?.linkLabel ?? "",
      originalUrl: item?.linkUrl ?? "", snapshot: JSON.stringify(materials), contextSnapshot: context?.capture() });
  }
  async function close() {
    if (latest.current.disabled) return;
    if (dirty && !await confirm({ title: "참고 링크 입력 취소", message: "적용하지 않은 링크 입력을 버릴까요?", confirmLabel: "입력 버리기", cancelLabel: "계속 편집" })) return;
    if (!latest.current.disabled) { setEdit(undefined); setError(""); }
  }
  async function remove(position: number | null) {
    if (disabled) return;
    const snapshot = JSON.stringify(materials), contextSnapshot = context?.capture();
    if (materials.length && !await confirm({ title: position === null ? "참고 자료를 끌까요?" : "문항 자료 삭제",
      message: position === null ? `등록한 자료 ${materials.length}개가 삭제됩니다. 다시 켜도 복구되지 않습니다.` : `이 문항의 ${position + 1}번째 자료를 삭제하시겠습니까?`,
      confirmLabel: position === null ? "끄고 삭제" : "삭제", cancelLabel: "취소" })) return;
    const current = latest.current;
    if (current.disabled) return;
    if (current.questionId !== question.id || JSON.stringify(current.materials) !== snapshot || (context && !context.isCurrent(contextSnapshot))) { setError("참고 자료가 변경되었습니다. 내용을 확인한 뒤 다시 시도해주세요."); return; }
    setError("");
    current.onChange(position === null ? [] : reindexQuestionMaterials(current.materials.filter((_, i) => i !== position)));
    if (position === null) setExpanded(false); else setExpanded(true);
  }
  function move(position: number, direction: -1 | 1) {
    if (disabled) return;
    const items = [...materials], to = position + direction;
    if (to < 0 || to >= items.length) return;
    [items[position], items[to]] = [items[to], items[position]]; onChange(reindexQuestionMaterials(items));
  }
  function apply(event: FormEvent) {
    event.preventDefault(); if (disabled || !edit) return;
    if (JSON.stringify(materials) !== edit.snapshot || (context && !context.isCurrent(edit.contextSnapshot))) { setError("참고 자료가 변경되었습니다. 입력을 취소한 뒤 다시 열어주세요."); return; }
    try {
      const item = createQuestionMaterialLink({ linkLabel: edit.label, linkUrl: edit.url }, edit.position ?? materials.length);
      const next = edit.position === null ? [...materials, item] : materials.map((value, i) => i === edit.position ? item : value);
      if (next.length > MAX_QUESTION_MATERIALS) { setError("파일과 링크를 합해 문항당 3개까지 추가할 수 있습니다."); return; }
      onChange(reindexQuestionMaterials(next)); setEdit(undefined); setError(""); setExpanded(true);
    } catch (cause) {
      const issue = cause as { issues?: { message: string }[] };
      setError(issue.issues?.[0]?.message ?? "http 또는 https 주소와 표시명을 확인해주세요.");
    }
  }
  return <div className="forms-materials-editor">
    <label className="member-check"><input type="checkbox" aria-label={`${prefix} 참고 자료 사용`} checked={enabled} disabled={disabled}
      onChange={event => { if (event.target.checked) setExpanded(true); else void remove(null); }} />참고 자료</label>
    {enabled && <div className="cs-stack"><p className="cs-muted">파일과 링크를 합해 문항당 {MAX_QUESTION_MATERIALS}개까지 추가할 수 있습니다.</p>
      <ol className="forms-materials-edit-list">{materials.map((material, position) => <li key={position}>
        <MaterialName material={material} />{material.materialType === "LINK" && <span className="forms-material-url" dir="ltr">{material.linkUrl}</span>}
        <div className="forms-actions"><button type="button" disabled={disabled} aria-label={`${prefix} 참고 자료 ${position + 1} 링크로 수정`} onClick={() => begin(position)}>{material.materialType === "LINK" ? "링크 수정" : "링크로 교체"}</button>
          <button type="button" disabled={disabled || position === 0} aria-label={`${prefix} 참고 자료 ${position + 1} 위로`} onClick={() => move(position, -1)}>위로</button>
          <button type="button" disabled={disabled || position === materials.length - 1} aria-label={`${prefix} 참고 자료 ${position + 1} 아래로`} onClick={() => move(position, 1)}>아래로</button>
          <button type="button" disabled={disabled} aria-label={`${prefix} 참고 자료 ${position + 1} 삭제`} onClick={() => void remove(position)}>삭제</button></div>
        <AuthorAssetUpload key={`${question.id}:${position}:${material.fileKey ?? material.linkUrl}`} purpose="QUESTION_MATERIAL" label={`${prefix} 참고 자료 ${position + 1} 파일로 교체`}
          targetKey={`${question.id}:material:${position}`} context={context} disabled={disabled} onComplete={upload => {
            const current = latest.current;
            if (current.disabled || current.questionId !== question.id || current.materials[position] !== material) return false;
            current.onChange(reindexQuestionMaterials(current.materials.map((item, i) => i === position ? createQuestionMaterialFile(upload.id, i) : item))); return true;
          }} />
      </li>)}</ol>
      <button type="button" className="cs-button secondary" aria-label={`${prefix} 참고 링크 추가`} disabled={disabled || materials.length >= MAX_QUESTION_MATERIALS} onClick={() => begin(null)}>링크 추가</button>
      <AuthorAssetUpload purpose="QUESTION_MATERIAL" label={`${prefix} 참고 파일 추가`} targetKey={`${question.id}:material:add`} context={context}
        disabled={disabled || materials.length >= MAX_QUESTION_MATERIALS} onComplete={upload => {
          const current = latest.current;
          if (current.disabled || current.questionId !== question.id || current.materials.length >= MAX_QUESTION_MATERIALS) return false;
          current.onChange(reindexQuestionMaterials([...current.materials, createQuestionMaterialFile(upload.id, current.materials.length)])); return true;
        }} />
    </div>}
    {!edit && error && <p role="alert">{error}</p>}
    {edit && <Modal title={`${prefix} 참고 링크 ${edit.position === null ? "추가" : "수정"}`} onClose={() => void close()}>
      <form className="cs-stack" onSubmit={apply} noValidate>
        <label className="cs-label">표시명 (선택)<input className="cs-input" aria-label="링크 표시명" disabled={disabled} value={edit.label}
          maxLength={MAX_MATERIAL_LINK_LABEL_LENGTH} onChange={event => setEdit({ ...edit, label: event.target.value })} /></label>
        <label className="cs-label">URL<input className="cs-input" aria-label="링크 URL" dir="ltr" inputMode="url" autoComplete="off" disabled={disabled} value={edit.url}
          maxLength={MAX_MATERIAL_LINK_URL_LENGTH} onChange={event => setEdit({ ...edit, url: event.target.value })} placeholder="https://" /></label>
        <p className="cs-muted">표시명을 비워 두면 주소가 표시됩니다. 링크는 새 탭에서 열립니다.</p>
        {error && <p role="alert">{error}</p>}
        <div className="forms-actions"><ActionButton secondary type="button" disabled={disabled} onClick={() => void close()}>취소</ActionButton>
          <ActionButton type="submit" disabled={disabled}>{edit.position === null ? "추가" : "변경 적용"}</ActionButton></div>
      </form>
    </Modal>}
  </div>;
}
