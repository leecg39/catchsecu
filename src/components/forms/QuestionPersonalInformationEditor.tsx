"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Question } from "@/contracts/forms";
import { matrixTypes, newTextMaxLength } from "@/contracts/questions";
import { defaultInfoPatternId } from "@/contracts/question-patterns";
import { subjectQuestionTypeAllowed } from "@/contracts/subjects";
import { MAX_QUESTION_PERSONAL_INFORMATION, MAX_PERSONAL_INFORMATION_NAME_LENGTH, personalInformationTypes,
  questionPersonalInformationSchema, hasResidentPersonalInformation, type QuestionPersonalInformation,
  type PersonalInformationType } from "@/contracts/question-personal-information";
import { nlpAnalyzeResult } from "@/contracts/question-nlp";
import { Modal, ActionButton } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { useApplication } from "../ApplicationContext";
import { api } from "@/lib/api";
import { QuestionPersonalInformation as Summary, personalInformationLabels } from "./QuestionPersonalInformation";

type Editable = { key: string; value: QuestionPersonalInformation };
type Edit = { items: Editable[]; original: string; snapshot: string; proposal?: { items: QuestionPersonalInformation[]; suggestedType: string | null } };
type Proposal = { key: string; items: QuestionPersonalInformation[]; suggestedType: string | null };
function snapshot(question: Question) {
  return JSON.stringify({ id: question.id, type: question.type, required: question.required, label: question.label,
    items: question.catchFormPersonalInformationRequests ?? [] });
}
function blank(matrix: boolean): Editable {
  return { key: crypto.randomUUID(), value: { nlpFeedbackId: null, personalInformationSource: "USER",
    personalInformationType: matrix ? "NON_PERSONAL_INFORMATION" : "PERSONAL_INFORMATION", detectedPersonalInformation: "" } };
}

export function QuestionPersonalInformationEditor({ question, index, disabled, formLanguage, conditionLinked, onChange }: {
  question: Question; index: number; disabled: boolean; formLanguage?: string; conditionLinked?: boolean;
  onChange: (items: QuestionPersonalInformation[], required: boolean, patch?: Partial<Question>) => void;
}) {
  const [edit, setEdit] = useState<Edit>(), [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const confirm = useConfirm(), prefix = `Q${index + 1}`, matrix = matrixTypes.includes(question.type);
  const serviceId = useApplication().data?.serviceId;
  const analyzed = useRef(""), dismissed = useRef("");
  const latest = useRef({ question, disabled, onChange, proposal });
  useEffect(() => { latest.current = { question, disabled, onChange, proposal }; }, [question, disabled, onChange, proposal]);
  // Korean-only automatic analysis, mirroring the original's title-change NLP call.
  // Proposals stay transient until the reviewer confirms them in the modal; only
  // confirmed items are persisted, matching the original's isConfirm gate.
  useEffect(() => {
    if (disabled || !serviceId || !formLanguage?.startsWith("ko") || matrix) return;
    const label = question.label.trim(), key = question.id + ":" + label;
    if (!label || analyzed.current === key || dismissed.current === key || question.catchFormPersonalInformationRequests?.length) return;
    const timer = setTimeout(async () => {
      analyzed.current = key;
      try {
        const result = nlpAnalyzeResult.parse(await api(`/services/${serviceId}/question-personal-information/analyze`, { method: "POST",
          body: JSON.stringify({ formLanguage, questionType: question.type, label,
            optionLabels: question.optionDefinitions?.map(option => option.label) ?? question.options }) }));
        const current = latest.current;
        if (current.disabled || current.question.id !== question.id || current.question.label !== label || current.question.catchFormPersonalInformationRequests?.length) return;
        if (result.items.length) setProposal({ key, items: result.items, suggestedType: result.suggestedType });
      } catch { analyzed.current = ""; }
    }, 700);
    return () => clearTimeout(timer);
  }, [disabled, serviceId, formLanguage, matrix, question.id, question.label, question.type, question.options, question.optionDefinitions, question.catchFormPersonalInformationRequests?.length]);
  const visibleProposal = proposal && !question.catchFormPersonalInformationRequests?.length ? proposal : undefined;
  const dirty = !!edit && JSON.stringify(edit.items.map(item => item.value)) !== edit.original;
  useUnsavedChanges(dirty, "아직 적용하지 않은 개인정보 분류가 있습니다.");
  function begin() {
    if (disabled) return;
    const values = question.catchFormPersonalInformationRequests ?? [];
    const items = values.length ? values.map(value => ({ key: crypto.randomUUID(), value: { ...value } })) : [blank(matrix)];
    setError(""); setEdit({ items, original: JSON.stringify(items.map(item => item.value)), snapshot: snapshot(question) });
  }
  function beginProposal() {
    if (disabled || !visibleProposal) return;
    const proposal = visibleProposal;
    const items = proposal.items.map(value => ({ key: crypto.randomUUID(), value: { ...value } }));
    setError(""); setEdit({ items, original: JSON.stringify(items.map(item => item.value)), snapshot: snapshot(question),
      proposal: { items: proposal.items, suggestedType: proposal.suggestedType } });
  }
  function dismissProposal() { if (visibleProposal) dismissed.current = visibleProposal.key; setProposal(undefined); }
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
  async function apply(event: FormEvent) {
    event.preventDefault(); if (disabled || !edit) return;
    if (snapshot(question) !== edit.snapshot) { setError("문항이 변경되었습니다. 입력을 취소한 뒤 다시 열어주세요."); return; }
    try {
      const values = questionPersonalInformationSchema.parse(edit.items.map(item => item.value));
      if (matrix && values.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION")) {
        setError("행렬형 문항은 개인정보 없음 분류만 사용할 수 있습니다."); return;
      }
      // A confirmed NLP proposal whose first item is RESIDENT converts the question
      // to 단문형 and resets options/matrix, matching the original's NLP behavior.
      const fromNlp = !!edit.proposal && values[0]?.personalInformationType === "RESIDENT" && values[0]?.personalInformationSource === "NLP";
      // 다른 문항의 표시 조건이 이 문항을 참조하면 자동 형식 전환을 건너뛴다(수동 형식 변경은 기존 경로에서 차단됨).
      const patch: Partial<Question> | undefined = fromNlp && !conditionLinked && !["단문형 답변", "장문형 답변"].includes(question.type)
        ? { type: "단문형 답변", options: undefined, optionDefinitions: undefined, rows: undefined, selectionLimits: undefined,
          condition: undefined, textMaxLength: newTextMaxLength("단문형 답변"), infoPatternId: defaultInfoPatternId("단문형 답변"),
          ...(question.subjectRole && !subjectQuestionTypeAllowed(question.subjectRole, "단문형 답변") ? { subjectRole: undefined } : {}) }
        : undefined;
      onChange(values, hasResidentPersonalInformation(values) || question.required, patch);
      const changed = edit.proposal && JSON.stringify(edit.proposal.items) !== JSON.stringify(values);
      setProposal(undefined); setEdit(undefined);
      if (edit.proposal && changed && serviceId) {
        try {
          await api(`/services/${serviceId}/question-personal-information/feedback`, { method: "POST",
            body: JSON.stringify({ formLanguage: formLanguage ?? "ko", questionType: question.type, label: question.label,
              proposed: edit.proposal.items, corrected: values }) });
        } catch { setError("분석 피드백 기록에 실패했습니다. 분류 적용은 완료됐습니다."); return; }
      }
      setError("");
    } catch (cause) {
      const issue = cause as { issues?: { message: string }[] };
      setError(issue.issues?.[0]?.message ?? "분류와 항목 이름을 확인해주세요.");
    }
  }
  return <div className="forms-personal-information-editor">
    <Summary question={question} />
    {visibleProposal && !edit && <div className="forms-note" role="status"><p>문항 분석 결과 개인정보 추정 항목 {visibleProposal.items.length}건을 찾았습니다. 로컬 분석 결과이며 공식 외부 분석이 아닙니다. 확인 후 적용해주세요.</p>
      <div className="forms-actions"><button type="button" className="cs-button secondary" aria-label={`${prefix} 자동 분석 제안 확인`} disabled={disabled} onClick={beginProposal}>제안 확인</button>
        <button type="button" className="cs-link" aria-label={`${prefix} 자동 분석 제안 무시`} disabled={disabled} onClick={dismissProposal}>제안 무시</button></div></div>}
    <div className="forms-actions"><button type="button" className="cs-button secondary" aria-label={`${prefix} 개인정보 분류 편집`} disabled={disabled} onClick={begin}>개인정보 분류</button>
      {!!question.catchFormPersonalInformationRequests?.length && <button type="button" className="cs-link" aria-label={`${prefix} 개인정보 분류 제거`} disabled={disabled} onClick={() => void removeAll()}>분류 제거</button>}</div>
    {!edit && error && <p role="alert">{error}</p>}
    {edit && <Modal title={`${prefix} 개인정보 분류`} onClose={() => void close()}>
      <form className="cs-stack" onSubmit={apply} noValidate>
        <p className="cs-muted">문항에서 수집하는 항목의 이름과 분류를 직접 확인해주세요. 문항을 수정한 뒤에는 분류도 다시 확인해주세요.</p>
        {matrix && <p className="cs-note">행렬형 문항은 개인정보 없음 분류만 사용할 수 있습니다.</p>}
        {edit.proposal && <p className="cs-note">자동 분석 제안을 확인하는 중입니다.{edit.proposal.suggestedType && edit.proposal.suggestedType !== question.type ? ` ‘${edit.proposal.suggestedType}’ 유형에 적합한 항목이 포함되어 있습니다.` : ""}</p>}
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
