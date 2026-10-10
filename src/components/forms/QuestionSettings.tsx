"use client";
import type { Question } from "@/contracts/forms";
import { answerTextMaxLength, displayOptions, matrixTypes, textQuestionTypes } from "@/contracts/questions";
import { infoPatternCatalog } from "@/contracts/question-patterns";

export function QuestionSettings({ question, previous, alwaysVisible, change }: { question: Question; previous: Question[]; alwaysVisible: boolean; change: (patch: Partial<Question>) => void }) {
  const sources = previous.filter(item => ["객관식 답변", "드롭다운", "체크박스"].includes(item.type) && item.options?.some(option => option.trim()));
  const source = sources.find(item => item.id === question.condition?.questionId);
  return <div className="cs-stack">
    {question.type === "단문형 답변" && !question.subjectRole && <label className="cs-label">입력 형식<select className="cs-input" aria-label={question.label + " 입력 형식"}
      value={question.infoPatternId ?? ""} onChange={event => change({ infoPatternId: event.target.value ? Number(event.target.value) as 1 | 3 : undefined })}>
      <option value="">기본 형식</option>{infoPatternCatalog.filter(item => item.questionTypes.includes(question.type)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select><span className="cs-muted">서버가 제공하는 고정 형식만 사용할 수 있습니다. 주민등록번호는 000000-0000000 형식으로 검사합니다.</span></label>}
    {textQuestionTypes.includes(question.type) && <label className="cs-label">최대 글자 수<input className="cs-input" type="number" aria-label={question.label + " 최대 글자 수"} min={1} max={question.type === "단문형 답변" ? 1000 : 20000}
      value={question.textMaxLength ?? (question.type === "단문형 답변" ? 1000 : 20000)} onChange={event => change({ textMaxLength: Number(event.target.value) })} />
      <span className="cs-muted">답변은 최대 {answerTextMaxLength(question)}자까지 입력할 수 있습니다.{question.subjectRole ? " 정보주체 이름은 100자, 이메일은 254자 이내로 제한됩니다." : ""}</span></label>}
    <label className="cs-label">질문 표시 조건<select className="cs-input" aria-label={question.label + " 표시 조건"} value={question.condition?.questionId ?? ""}
      disabled={!!question.subjectRole || alwaysVisible} onChange={event => {
        const parent = sources.find(item => item.id === event.target.value);
        change({ condition: parent ? { questionId: parent.id, operator: parent.type === "체크박스" ? "includes" : "equals", value: parent.options!.find(option => option.trim())!, optionId: parent.optionDefinitions?.find(option => option.value === parent.options!.find(value => value.trim()))?.id } : undefined });
      }}><option value="">항상 표시</option>{sources.map(item => <option key={item.id} value={item.id}>{item.label || "제목 없는 질문"}</option>)}</select></label>
    {question.condition && <label className="cs-label">다음 답변을 선택했을 때 표시<select className="cs-input" aria-label={question.label + " 조건 답변"} value={question.condition.value}
      onChange={event => change({ condition: { ...question.condition!, value: event.target.value, optionId: source?.optionDefinitions?.find(option => option.value === event.target.value)?.id } })}>
      {!source?.options?.includes(question.condition.value) && <option value={question.condition.value}>연결된 답변 수정 필요</option>}
      {source && displayOptions(source).filter(option => option.label.trim()).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
    {question.condition && <p className="cs-muted">조건을 만족할 때 표시합니다. 숨겨진 질문의 답변은 제출하지 않습니다. 필수 설정은 표시될 때 적용됩니다.</p>}
    {matrixTypes.includes(question.type) && <fieldset className="forms-matrix-editor"><legend>행렬의 행</legend>
      {question.rows?.map((row, index) => <div className="forms-matrix-row" key={row.id}><label className="cs-label">행 {index + 1}<input className="cs-input" aria-label={question.label + " 행 " + (index + 1)} maxLength={500}
        value={row.label} onChange={event => change({ rows: question.rows!.map(item => item.id === row.id ? { ...item, label: event.target.value } : item) })} /></label>
        <button type="button" disabled={question.rows!.length <= 1} onClick={() => change({ rows: question.rows!.filter(item => item.id !== row.id) })}>행 삭제</button></div>)}
      <button type="button" disabled={(question.rows?.length ?? 0) >= 100} onClick={() => change({ rows: [...question.rows ?? [], { id: crypto.randomUUID(), label: "새 행" }] })}>행 추가</button></fieldset>}
    {["체크박스", "행렬형 복수 선택"].includes(question.type) && <fieldset><legend>{matrixTypes.includes(question.type) ? "행별 선택 수 제한" : "선택 수 제한"}</legend>
      <label><input type="checkbox" checked={!!question.selectionLimits} onChange={event => change({ selectionLimits: event.target.checked ? { min: question.required ? 1 : 0, max: Math.max(1, question.options?.length ?? 1) } : undefined })} />최소·최대 개수 설정</label>
      {question.selectionLimits && <label className="cs-label">선택 수 방식<select className="cs-input" aria-label={question.label + " 선택 수 방식"} value={question.selectionLimits.mode ?? "range"}
        onChange={event => change({ selectionLimits: event.target.value === "exact" ? { mode: "exact", min: question.selectionLimits?.max ?? 1, max: question.selectionLimits?.max ?? 1 } : { min: question.selectionLimits?.min ?? 0, max: question.selectionLimits?.max ?? 1 } })}>
        <option value="range">최소·최대 범위</option><option value="exact">정확히 지정한 개수</option></select></label>}
      {question.selectionLimits?.mode === "exact" ? <label className="cs-label">정확한 선택 수<input className="cs-input" type="number" aria-label={question.label + " 정확한 선택 수"} min={1} max={question.options?.length ?? 100}
        value={question.selectionLimits.min} onChange={event => change({ selectionLimits: { mode: "exact", min: Number(event.target.value), max: Number(event.target.value) } })} /></label> :
      question.selectionLimits && <div className="forms-selection-limits">{(["min", "max"] as const).map(key => <label className="cs-label" key={key}>{key === "min" ? "최소 선택 수" : "최대 선택 수"}
        <input className="cs-input" type="number" aria-label={question.label + (key === "min" ? " 최소 선택 수" : " 최대 선택 수")} min={key === "min" ? 0 : 1} max={question.options?.length ?? 100}
          value={question.selectionLimits?.[key] ?? (key === "min" ? 0 : question.options?.length ?? 100)} onChange={event => change({ selectionLimits: { ...question.selectionLimits, [key]: Number(event.target.value) } })} /></label>)}</div>}
      <p className="cs-muted">{question.selectionLimits?.mode === "exact" && matrixTypes.includes(question.type)
        ? "선택 질문은 모든 행을 비우면 생략할 수 있습니다. 답변을 시작하면 모든 행에서 지정한 개수를 선택해주세요."
        : "선택 항목을 비우면 선택 질문은 생략할 수 있습니다. 답변을 입력한 경우 개수 제한이 적용됩니다."}</p></fieldset>}
  </div>;
}
