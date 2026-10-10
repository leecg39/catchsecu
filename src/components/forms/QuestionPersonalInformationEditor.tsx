"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Question } from "@/contracts/forms";
import { matrixTypes } from "@/contracts/questions";
import { MAX_QUESTION_PERSONAL_INFORMATION, MAX_PERSONAL_INFORMATION_NAME_LENGTH, personalInformationTypes,
  questionPersonalInformationSchema, hasResidentPersonalInformation, type QuestionPersonalInformation,
  type PersonalInformationType } from "@/contracts/question-personal-information";
import { Modal, ActionButton } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { QuestionPersonalInformation as Summary, personalInformationLabels } from "./QuestionPersonalInformation";

type Editable = { key: string; value: QuestionPersonalInformation };
type Edit = { items: Editable[]; original: string; snapshot: string };
function snapshot(question: Question) {
  return JSON.stringify({ id: question.id, type: question.type, required: question.required, label: question.label,
    items: question.catchFormPersonalInformationRequests ?? [] });
}
function blank(matrix: boolean): Editable {
  return { key: crypto.randomUUID(), value: { nlpFeedbackId: null, personalInformationSource: "USER",
    personalInformationType: matrix ? "NON_PERSONAL_INFORMATION" : "PERSONAL_INFORMATION", detectedPersonalInformation: "" } };
}

export function QuestionPersonalInformationEditor({ question, index, disabled, onChange }: {
  question: Question; index: number; disabled: boolean; onChange: (items: QuestionPersonalInformation[], required: boolean) => void;
}) {
  const [edit, setEdit] = useState<Edit>(), [error, setError] = useState("");
  const confirm = useConfirm(), prefix = `Q${index + 1}`, matrix = matrixTypes.includes(question.type);
  const latest = useRef({ question, disabled, onChange });
  useEffect(() => { latest.current = { question, disabled, onChange }; }, [question, disabled, onChange]);
  const dirty = !!edit && JSON.stringify(edit.items.map(item => item.value)) !== edit.original;
  useUnsavedChanges(dirty, "아직 적용하지 않은 개인정보 분류가 있습니다.");
  function begin() {
    if (disabled) return;
    const values = question.catchFormPersonalInformationRequests ?? [];
    const items = values.length ? values.map(value => ({ key: crypto.randomUUID(), value: { ...value } })) : [blank(matrix)];
    setError(""); setEdit({ items, original: JSON.stringify(items.map(item => item.value)), snapshot: snapshot(question) });
  }
  async function close() {
    if (latest.current.disabled) return;
    if (dirty && !await confirm({ title: "개인정보 분류 입력 취소", message: "적용하지 않은 분류 입력을 버릴까요?", confirmLabel: "입력 버리기", cancelLabel: "계속 편집" })) return;
    if (!latest.current.disabled) { setEdit(undefined); setError(""); }
  }
  async function removeAll() {
    if (disabled) return;
    const before = snapshot(question);
    if (!await confirm({ title: "개인정보 분류 제거", message: "이 문항에 저장한 수동 분류를 모두 제거할까요? 필수항목 설정은 유지됩니다.", confirmLabel: "분류 제거", cancelLabel: "취소" })) return;
    const current = latest.current;
    if (current.disabled) return;
    if (snapshot(current.question) !== before) { setError("문항이 변경되었습니다. 내용을 확인한 뒤 다시 시도해주세요."); return; }
    current.onChange([], current.question.required); setError("");
  }
  function update(key: string, patch: Partial<QuestionPersonalInformation>) {
    if (disabled) return;
    setEdit(current => current && ({ ...current, items: current.items.map(item => item.key === key ? { ...item, value: { ...item.value, ...patch } } : item) }));
  }
  function apply(event: FormEvent) {
    event.preventDefault(); if (disabled || !edit) return;
    if (snapshot(question) !== edit.snapshot) { setError("문항이 변경되었습니다. 입력을 취소한 뒤 다시 열어주세요."); return; }
    try {
      const values = questionPersonalInformationSchema.parse(edit.items.map(item => item.value));
      if (matrix && values.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION")) {
        setError("행렬형 문항은 개인정보 없음 분류만 사용할 수 있습니다."); return;
      }
      onChange(values, hasResidentPersonalInformation(values) || question.required);
      setEdit(undefined); setError("");
    } catch (cause) {
      const issue = cause as { issues?: { message: string }[] };
      setError(issue.issues?.[0]?.message ?? "분류와 항목 이름을 확인해주세요.");
    }
  }
  return <div className="forms-personal-information-editor">
    <Summary question={question} />
    <div className="forms-actions"><button type="button" className="cs-button secondary" aria-label={`${prefix} 개인정보 분류 편집`} disabled={disabled} onClick={begin}>개인정보 분류</button>
      {!!question.catchFormPersonalInformationRequests?.length && <button type="button" className="cs-link" aria-label={`${prefix} 개인정보 분류 제거`} disabled={disabled} onClick={() => void removeAll()}>분류 제거</button>}</div>
    {!edit && error && <p role="alert">{error}</p>}
    {edit && <Modal title={`${prefix} 개인정보 분류`} onClose={() => void close()}>
      <form className="cs-stack" onSubmit={apply} noValidate>
        <p className="cs-muted">문항에서 수집하는 항목의 이름과 분류를 직접 확인해주세요. 문항을 수정한 뒤에는 분류도 다시 확인해주세요.</p>
        {matrix && <p className="cs-note">행렬형 문항은 개인정보 없음 분류만 사용할 수 있습니다.</p>}
        {edit.items.map((item, position) => <fieldset className="forms-personal-information-row" disabled={disabled} key={item.key}>
          <legend>항목 {position + 1}</legend>
          <label className="cs-label">분류<select className="cs-input" aria-label={`분류 항목 ${position + 1} 종류`} value={item.value.personalInformationType} onChange={event => {
            const type = event.target.value as PersonalInformationType;
            if (matrix && type !== "NON_PERSONAL_INFORMATION") return;
            update(item.key, { personalInformationType: type, ...(type === "NON_PERSONAL_INFORMATION" ? { detectedPersonalInformation: "" } : {}) });
          }}>{personalInformationTypes.map(type => <option key={type} value={type} disabled={matrix && type !== "NON_PERSONAL_INFORMATION"}>{personalInformationLabels[type]}</option>)}</select></label>
          {item.value.personalInformationType !== "NON_PERSONAL_INFORMATION" && <label className="cs-label">항목 이름<input className="cs-input" aria-label={`분류 항목 ${position + 1} 이름`} value={item.value.detectedPersonalInformation}
            maxLength={MAX_PERSONAL_INFORMATION_NAME_LENGTH} onChange={event => update(item.key, { detectedPersonalInformation: event.target.value })} />
            <small>{item.value.detectedPersonalInformation.length} / {MAX_PERSONAL_INFORMATION_NAME_LENGTH}</small></label>}
          {item.value.personalInformationType === "RESIDENT" && <p className="cs-note">주민등록번호 분류를 적용하면 이 문항이 필수항목으로 설정됩니다.</p>}
          <button type="button" className="cs-link" aria-label={`분류 항목 ${position + 1} 삭제`} onClick={() => {
            if (!disabled) setEdit(current => current && ({ ...current, items: current.items.filter(value => value.key !== item.key) }));
          }}>항목 삭제</button>
        </fieldset>)}
        {!edit.items.length && <p>분류를 적용하면 저장된 분류가 모두 제거됩니다. 필수항목 설정은 유지됩니다.</p>}
        <button type="button" className="cs-button secondary" disabled={disabled || edit.items.length >= MAX_QUESTION_PERSONAL_INFORMATION} onClick={() => {
          if (!disabled) setEdit(current => current && current.items.length < MAX_QUESTION_PERSONAL_INFORMATION ? { ...current, items: [...current.items, blank(matrix)] } : current);
        }}>분류 항목 추가</button>
        <small>문항당 {MAX_QUESTION_PERSONAL_INFORMATION}개까지 추가할 수 있습니다.</small>
        {error && <p role="alert">{error}</p>}
        <div className="forms-actions"><ActionButton secondary type="button" disabled={disabled} onClick={() => void close()}>취소</ActionButton>
          <ActionButton type="submit" disabled={disabled}>분류 적용</ActionButton></div>
      </form>
    </Modal>}
  </div>;
}
