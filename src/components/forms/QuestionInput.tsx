"use client";
import type { Question } from "@/contracts/forms";
import { matrixTypes, type AnswerValue } from "@/contracts/questions";
import { FILE_ACCEPT } from "@/contracts/files";

export function QuestionInput({ question, value, onChange, onFileChange }: { question: Question; value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void; onFileChange?: (file?: File) => void }) {
  const options = question.options ?? [], selected = Array.isArray(value) ? value : [];
  const limits = question.selectionLimits;
  const hint = limits ? "최소 " + (limits.min ?? (question.required ? 1 : 0)) + "개 · 최대 " + (limits.max ?? options.length) + "개 선택" : "";
  if (matrixTypes.includes(question.type)) {
    const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return <div className="forms-matrix">{question.rows?.map(row => {
      const answer = current[row.id], checked = Array.isArray(answer) ? answer : [];
      return <fieldset className="forms-matrix-row" key={row.id}><legend>{row.label}{question.required && " *"}</legend>
        {question.type === "행렬형 단일 선택" ? <select className="cs-input" name={question.id + ":" + row.id} aria-label={question.label + " · " + row.label}
          required={question.required} value={typeof answer === "string" ? answer : ""} onChange={event => onChange({ ...current, [row.id]: event.target.value })}>
          <option value="">선택해주세요</option>{options.map(option => <option key={option}>{option}</option>)}</select> :
          <div className="public-options">{options.map(option => <label key={option}><input type="checkbox" name={question.id + ":" + row.id} value={option} checked={checked.includes(option)}
            required={question.required && checked.length === 0} disabled={!checked.includes(option) && checked.length >= (limits?.max ?? 100)}
            onChange={event => onChange({ ...current, [row.id]: event.target.checked ? [...checked, option] : checked.filter(item => item !== option) })} />{option}</label>)}</div>}
        {hint && <p className="cs-muted">행별 {hint}</p>}</fieldset>;
    })}</div>;
  }
  if (question.type === "객관식 답변" || question.type === "체크박스") return <div className="public-options">
    {options.map(option => <label key={option}><input name={question.id} type={question.type === "체크박스" ? "checkbox" : "radio"} value={option}
      checked={question.type === "체크박스" ? selected.includes(option) : value === option}
      required={question.required && (question.type !== "체크박스" || selected.length === 0)}
      disabled={question.type === "체크박스" && !selected.includes(option) && selected.length >= (limits?.max ?? 100)}
      onChange={event => onChange(question.type === "체크박스" ? event.target.checked ? [...selected, option] : selected.filter(item => item !== option) : option)} />{option}</label>)}
    {hint && <p className="cs-muted">{hint}</p>}</div>;
  const common = { name: question.id, required: question.required, "aria-label": question.label };
  const text = typeof value === "string" ? value : "";
  if (question.type === "드롭다운") return <select {...common} className="cs-input" value={text} onChange={event => onChange(event.target.value)}>
    <option value="">선택해주세요</option>{options.map(option => <option key={option}>{option}</option>)}</select>;
  if (question.type === "파일 업로드") return <input {...common} className="cs-input" type="file" accept={FILE_ACCEPT} onChange={event => onFileChange?.(event.target.files?.[0])} />;
  if (question.type === "장문형 답변") return <textarea {...common} className="cs-input" rows={5} maxLength={20000} value={text} onChange={event => onChange(event.target.value)} />;
  return <input {...common} className="cs-input" type={question.type === "날짜" ? "date" : question.subjectRole === "email" ? "email" : "text"}
    autoComplete={question.subjectRole === "email" ? "email" : question.subjectRole === "name" ? "name" : undefined}
    maxLength={question.subjectRole === "name" ? 100 : question.subjectRole === "email" ? 254 : question.type === "단문형 답변" ? 1000 : undefined}
    value={text} onChange={event => onChange(event.target.value)} />;
}
