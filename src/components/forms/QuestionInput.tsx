"use client";
import type { Question } from "@/contracts/forms";
import { answerTextMaxLength, displayOptions, isEmptyAnswer, matrixTypes, type AnswerValue } from "@/contracts/questions";
import { ContactQuestionInput, EmailQuestionInput } from "./SpecialQuestionInput";
import { specialAnswerError } from "@/contracts/special-questions";
import { DomesticAddressInput, ForeignAddressInput } from "./AddressQuestionInput";
import { FILE_ACCEPT } from "@/contracts/files";
import { DrawingQuestionInput } from "./DrawingQuestionInput";
import { fileAnswerId } from "@/contracts/drawing-questions";
import { isInternationalFormLanguage, type FormLanguage } from "@/contracts/form-language";
import { InternationalContactInput } from "./InternationalContactInput";
import { formPhrase, formSelectionText } from "@/contracts/form-system-copy";
import { OptionImage } from "./OptionImage";
import { CustomChoiceQuestionInput } from "./CustomChoiceQuestionInput";
import { formatResidentRegistrationInput, infoPatternAnswerError } from "@/contracts/question-patterns";

export function QuestionInput({ question, value, onChange, onFileChange, file, savedPreview, language, disabled = false }: { question: Question; value: AnswerValue | undefined; disabled?: boolean; file?: File; savedPreview?: string; language?: FormLanguage;
  onChange: (value: AnswerValue) => void; onFileChange?: (file?: File) => void }) {
  const options = displayOptions(question), selected = Array.isArray(value) ? value : [];
  const imageOptions = question.optionDefinitions ?? [], hasImages = imageOptions.some(option => !option.isCustomValue && !!option.optionImageKey);
  const limits = question.selectionLimits, matrix = matrixTypes.includes(question.type);
  // Arbitrary minimum ranges have no equivalent source translation; retain their full local hint.
  const hint = limits?.mode === "exact" ? formSelectionText(language, matrix ? "exactMatrix" : "exact", { count: limits.min! })
    : limits ? (limits.min ?? 0) <= 1 ? formSelectionText(language, matrix ? "maxMatrix" : "max", { count: limits.max ?? options.length })
      : (matrix ? "행별 " : "") + "최소 " + limits.min + "개 · 최대 " + (limits.max ?? options.length) + "개 선택" : "";
  if (["객관식 답변", "체크박스", "드롭다운"].includes(question.type) && question.optionDefinitions?.some(option => option.isCustomValue))
    return <CustomChoiceQuestionInput question={question} value={value} onChange={onChange} language={language} disabled={disabled} hint={hint} />;
  if (matrix) {
    const current = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string | string[]>;
    const exactRows = limits?.mode === "exact" && (question.required || !isEmptyAnswer(current));
    return <div className="forms-matrix">{question.rows?.map(row => {
      const answer = current[row.id], checked = Array.isArray(answer) ? answer : [];
      const validationIndex = Math.max(0, options.findIndex(option => checked.includes(option.value)));
      return <fieldset className="forms-matrix-row" key={row.id}><legend>{row.label}{question.required && " *"}</legend>
        {question.type === "행렬형 단일 선택" ? <select className="cs-input" name={question.id + ":" + row.id} aria-label={question.label + " · " + row.label}
          required={question.required} value={typeof answer === "string" ? answer : ""} onChange={event => onChange({ ...current, [row.id]: event.target.value })}>
          <option value="">{formPhrase(language, "phrase38")}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> :
          <div className="public-options">{options.map((option, index) => <label key={option.value}><input type="checkbox" name={question.id + ":" + row.id} value={option.value} checked={checked.includes(option.value)}
            ref={element => { element?.setCustomValidity(index === validationIndex && exactRows && checked.length !== limits!.min
              ? formSelectionText(language, question.required ? "errorExactMatrix" : "errorExactOptionalMatrix", { row: row.label, count: limits!.min! }) : ""); }}
            required={question.required && checked.length === 0} disabled={!checked.includes(option.value) && checked.length >= (limits?.max ?? 100)}
            onChange={event => onChange({ ...current, [row.id]: event.target.checked ? [...checked, option.value] : checked.filter(item => item !== option.value) })} />{option.label}</label>)}</div>}
        {hint && <p className="cs-muted">{hint}</p>}</fieldset>;
    })}</div>;
  }
  if (question.type === "객관식 답변" || question.type === "체크박스") return <div className="public-options">
    {options.map((option, index) => <div className={hasImages ? "forms-option-image-row" : undefined} key={option.value}><label><input name={question.id} type={question.type === "체크박스" ? "checkbox" : "radio"} value={option.value}
      ref={element => { element?.setCustomValidity(index === Math.max(0, options.findIndex(item => selected.includes(item.value))) && limits?.mode === "exact" && (question.required || selected.length > 0) && selected.length !== limits.min
        ? formSelectionText(language, question.required ? "errorExact" : "errorExactOptional", { count: limits.min! }) : ""); }}
      checked={question.type === "체크박스" ? selected.includes(option.value) : value === option.value}
      required={question.required && (question.type !== "체크박스" || selected.length === 0)}
      disabled={disabled || (question.type === "체크박스" && !selected.includes(option.value) && selected.length >= (limits?.max ?? 100))}
      onChange={event => { if (!disabled) onChange(question.type === "체크박스" ? event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value) : option.value); }} />{option.label}</label>
      <OptionImage assetKey={imageOptions.find(item => item.value === option.value && !item.isCustomValue)?.optionImageKey} label={option.label} reserve={hasImages} language={language} /></div>)}
    {hint && <p className="cs-muted">{hint}</p>}</div>;
  const common = { name: question.id, required: question.required, "aria-label": question.label };
  const text = typeof value === "string" ? value : "";
  if (question.type === "직접 그리기") return <DrawingQuestionInput question={question} file={file} savedPreview={savedPreview} hasSaved={!!fileAnswerId(value)} disabled={disabled}
    onFileChange={file => onFileChange?.(file)} />;
  if (question.type === "주소") return <DomesticAddressInput question={question} value={text} onChange={onChange} disabled={disabled} />;
  if (question.type === "해외 주소") return <ForeignAddressInput question={question} value={value} onChange={onChange} language={language} />;
  if (question.type === "연락처") return isInternationalFormLanguage(language)
    ? <InternationalContactInput question={question} value={text} onChange={onChange} language={language} disabled={disabled} />
    : <ContactQuestionInput question={question} value={text} onChange={onChange} />;
  if (question.type === "이메일") return <EmailQuestionInput question={question} value={text} onChange={onChange} />;
  if (question.type === "이메일 직접 입력" || question.type === "생년월일") return <input {...common} className="cs-input" type={question.type === "이메일 직접 입력" ? "email" : "text"}
    inputMode={question.type === "생년월일" ? "numeric" : "email"} placeholder={question.type === "생년월일" ? "YYYYMMDD" : "name@example.com"}
    autoComplete={question.type === "이메일 직접 입력" ? "email" : "bday"} maxLength={question.type === "생년월일" ? 8 : 100}
    ref={element => element?.setCustomValidity(specialAnswerError(question.type, text) ?? "")} value={text} onChange={event => onChange(event.target.value)} />;
  if (question.type === "드롭다운") return <select {...common} className="cs-input" value={text} onChange={event => onChange(event.target.value)}>
    <option value="">{formPhrase(language, "phrase38")}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  if (question.type === "파일 업로드") return <input {...common} className="cs-input" type="file" accept={FILE_ACCEPT} onChange={event => onFileChange?.(event.target.files?.[0])} />;
  if (question.type === "장문형 답변") return <textarea {...common} className="cs-input" rows={5} maxLength={answerTextMaxLength(question)} value={text} onChange={event => onChange(event.target.value)} />;
  if (question.type === "단문형 답변" && question.infoPatternId === 3) return <input {...common} className="cs-input" type="text" inputMode="numeric"
    autoComplete="off" placeholder="000000-0000000" maxLength={14} value={text}
    ref={element => element?.setCustomValidity(infoPatternAnswerError(question.infoPatternId, text) ?? "")}
    onChange={event => onChange(formatResidentRegistrationInput(event.target.value))} />;
  return <input {...common} className="cs-input" type={question.type === "날짜" ? "date" : question.subjectRole === "email" ? "email" : "text"}
    autoComplete={question.subjectRole === "email" ? "email" : question.subjectRole === "name" ? "name" : undefined}
    maxLength={answerTextMaxLength(question)}
    value={text} onChange={event => onChange(event.target.value)} />;
}
