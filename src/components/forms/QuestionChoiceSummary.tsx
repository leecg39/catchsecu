"use client";
import { choiceTypes, type OptionDefinition } from "@/contracts/questions";
import { OptionImage } from "./OptionImage";

export function QuestionChoiceSummary({ question, language, imagesOnly = false }: {
  question: { type: string; options?: string[]; optionDefinitions?: OptionDefinition[] }; language?: string | null; imagesOnly?: boolean;
}) {
  const options = (choiceTypes as readonly string[]).includes(question.type) ? question.optionDefinitions ?? (question.options ?? []).map(value => ({ value, label: value })) : [], images = question.optionDefinitions?.some(option => !!option.optionImageKey) ?? false;
  if (!options.length || (imagesOnly && !images)) return null;
  return <ul>{options.map(option => <li key={option.value} className={images ? "forms-option-image-row" : undefined}>
    {images && <OptionImage assetKey={question.optionDefinitions?.find(item => item.value === option.value)?.optionImageKey} label={option.label} reserve language={language} />}
    <span>{option.label}</span>
  </li>)}</ul>;
}
