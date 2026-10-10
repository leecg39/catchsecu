"use client";
import type { Question } from "@/contracts/forms";
import type { AnswerValue } from "@/contracts/questions";
import type { FormLanguage } from "@/contracts/form-language";
import { MAX_CUSTOM_CHOICE_TEXT_LENGTH, selectedChoiceValues, type CustomChoiceAnswer } from "@/contracts/custom-choice";
import { formPhrase, formSelectionText } from "@/contracts/form-system-copy";
import { OptionImage } from "./OptionImage";
import { preserveTextLineEndings } from "@/lib/preserve-text-line-endings";

export function CustomChoiceQuestionInput({ question, value, onChange, language, disabled, hint }: {
  question: Question; value: AnswerValue | undefined; onChange: (value: AnswerValue) => void;
  language?: FormLanguage; disabled: boolean; hint: string;
}) {
  const options = question.optionDefinitions ?? [], custom = options.find(option => option.isCustomValue);
  const selected = selectedChoiceValues(value), multiple = question.type === "체크박스", limits = question.selectionLimits;
  // Local editing includes a selected custom option whose text has not been entered yet.
  // The server validates the complete strict answer before storing it.
  const current = value && typeof value === "object" && !Array.isArray(value) && "kind" in value && value.kind === "custom-choice"
    ? value as CustomChoiceAnswer : undefined;
  const text = current?.custom.optionId === custom?.id ? current?.custom.text ?? "" : "";
  const chosen = !!custom && selected.includes(custom.value), prompt = formPhrase(language, "phrase16");
  function emit(values: string[], customText = text) {
    if (disabled) return;
    // Preserve local selection order across custom on/off. The server canonicalizes stored custom objects.
    if (custom && values.includes(custom.value)) onChange({ kind: "custom-choice", selectedValues: values, custom: { optionId: custom.id, text: customText } });
    else onChange(multiple ? values : values[0] ?? "");
  }
  const textInput = chosen && <label className="cs-label forms-custom-choice-text">{prompt}
    <textarea className="cs-input" rows={2} name={question.id + ":custom"} aria-label={question.label + " · " + prompt}
      required disabled={disabled} maxLength={MAX_CUSTOM_CHOICE_TEXT_LENGTH} value={text}
      ref={element => element?.setCustomValidity(!text.trim() ? prompt : text.length > MAX_CUSTOM_CHOICE_TEXT_LENGTH ? prompt + ` (${text.length} / ${MAX_CUSTOM_CHOICE_TEXT_LENGTH})` : "")}
      onChange={event => emit(selected, preserveTextLineEndings(text, event.target.value))} />
    <small className="cs-muted">{text.length} / {MAX_CUSTOM_CHOICE_TEXT_LENGTH}</small>
  </label>;
  if (question.type === "드롭다운") return <div className="cs-stack">
    <select className="cs-input" name={question.id} aria-label={question.label} required={question.required} disabled={disabled}
      value={selected[0] ?? ""} onChange={event => emit(event.target.value ? [event.target.value] : [])}>
      <option value="">{formPhrase(language, "phrase38")}</option>
      {options.map(option => <option key={option.id} value={option.value}>{option.label}</option>)}
    </select>{textInput}
  </div>;
  const validationIndex = Math.max(0, options.findIndex(option => selected.includes(option.value)));
  const hasImages = options.some(option => !option.isCustomValue && !!option.optionImageKey);
  return <div className="public-options">
    {options.map((option, index) => <div className="forms-custom-choice-option" key={option.id}>
      <div className={hasImages ? "forms-option-image-row" : undefined}><label><input name={question.id} type={multiple ? "checkbox" : "radio"} value={option.value}
        checked={selected.includes(option.value)} required={question.required && (!multiple || selected.length === 0)}
        disabled={disabled || (multiple && !selected.includes(option.value) && selected.length >= (limits?.max ?? 100))}
        ref={element => element?.setCustomValidity(multiple && index === validationIndex && limits?.mode === "exact" &&
          (question.required || selected.length > 0) && selected.length !== limits.min
          ? formSelectionText(language, question.required ? "errorExact" : "errorExactOptional", { count: limits.min! }) : "")}
        onChange={event => emit(multiple ? event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value) : [option.value])} />
        {option.label}</label>{!option.isCustomValue && <OptionImage assetKey={option.optionImageKey} label={option.label} reserve={hasImages} language={language} />}</div>{option.isCustomValue && textInput}
    </div>)}
    {hint && <p className="cs-muted">{hint}</p>}
  </div>;
}
