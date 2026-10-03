"use client";
import type { Question } from "@/contracts/forms";
import { matrixTypes } from "@/contracts/questions";

export function QuestionSettings({ question, previous, alwaysVisible, change }: { question: Question; previous: Question[]; alwaysVisible: boolean; change: (patch: Partial<Question>) => void }) {
  const sources = previous.filter(item => ["객관식 답변", "드롭다운", "체크박스"].includes(item.type) && item.options?.some(option => option.trim()));
  const source = sources.find(item => item.id === question.condition?.questionId);
  return <div className="cs-stack">
    <label className="cs-label">질문 표시 조건<select className="cs-input" aria-label={question.label + " 표시 조건"} value={question.condition?.questionId ?? ""}
      disabled={!!question.subjectRole || alwaysVisible} onChange={event => {
        const parent = sources.find(item => item.id === event.target.value);
        change({ condition: parent ? { questionId: parent.id, operator: parent.type === "체크박스" ? "includes" : "equals", value: parent.options!.find(option => option.trim())! } : undefined });
      }}><option value="">항상 표시</option>{sources.map(item => <option key={item.id} value={item.id}>{item.label || "제목 없는 질문"}</option>)}</select></label>
    {question.condition && <label className="cs-label">다음 답변을 선택했을 때 표시<select className="cs-input" aria-label={question.label + " 조건 답변"} value={question.condition.value}
      onChange={event => change({ condition: { ...question.condition!, value: event.target.value } })}>
      {!source?.options?.includes(question.condition.value) && <option value={question.condition.value}>연결된 답변 수정 필요</option>}
      {source?.options?.filter(option => option.trim()).map(option => <option key={option}>{option}</option>)}</select></label>}
    {question.condition && <p className="cs-muted">조건을 만족할 때 표시합니다. 숨겨진 질문의 답변은 제출하지 않습니다. 필수 설정은 표시될 때 적용됩니다.</p>}
    {matrixTypes.includes(question.type) && <fieldset className="forms-matrix-editor"><legend>행렬의 행</legend>
      {question.rows?.map((row, index) => <div className="forms-matrix-row" key={row.id}><label className="cs-label">행 {index + 1}<input className="cs-input" aria-label={question.label + " 행 " + (index + 1)} maxLength={500}
        value={row.label} onChange={event => change({ rows: question.rows!.map(item => item.id === row.id ? { ...item, label: event.target.value } : item) })} /></label>
        <button type="button" disabled={question.rows!.length <= 1} onClick={() => change({ rows: question.rows!.filter(item => item.id !== row.id) })}>행 삭제</button></div>)}
      <button type="button" disabled={(question.rows?.length ?? 0) >= 100} onClick={() => change({ rows: [...question.rows ?? [], { id: crypto.randomUUID(), label: "새 행" }] })}>행 추가</button></fieldset>}
    {["체크박스", "행렬형 복수 선택"].includes(question.type) && <fieldset><legend>{matrixTypes.includes(question.type) ? "행별 선택 수 제한" : "선택 수 제한"}</legend>
      <label><input type="checkbox" checked={!!question.selectionLimits} onChange={event => change({ selectionLimits: event.target.checked ? { min: question.required ? 1 : 0, max: Math.max(1, question.options?.length ?? 1) } : undefined })} />최소·최대 개수 설정</label>
      {question.selectionLimits && <div className="forms-selection-limits">{(["min", "max"] as const).map(key => <label className="cs-label" key={key}>{key === "min" ? "최소 선택 수" : "최대 선택 수"}
        <input className="cs-input" type="number" aria-label={question.label + (key === "min" ? " 최소 선택 수" : " 최대 선택 수")} min={key === "min" ? 0 : 1} max={question.options?.length ?? 100}
          value={question.selectionLimits?.[key] ?? (key === "min" ? 0 : question.options?.length ?? 100)} onChange={event => change({ selectionLimits: { ...question.selectionLimits, [key]: Number(event.target.value) } })} /></label>)}</div>}
      <p className="cs-muted">선택 항목을 비우면 선택 질문은 생략할 수 있습니다. 답변을 입력한 경우 개수 제한이 적용됩니다.</p></fieldset>}
  </div>;
}
