"use client";
import { useState } from "react";
import type { Question } from "@/contracts/forms";
import { effectiveFormLanguage, type FormLanguage } from "@/contracts/form-language";
import { internationalContactCountries, internationalContactDialCode, internationalContactError, parseInternationalContact } from "@/contracts/international-contact";
import { formPhrase, formSystemCopy } from "@/contracts/form-system-copy";

export function InternationalContactInput({ question, value, onChange, language, disabled = false }: {
  question: Question; value: string; language?: FormLanguage; disabled?: boolean; onChange: (value: string) => void;
}) {
  const [initial] = useState(() => parseInternationalContact(value));
  // Shared calling codes do not identify a country. Preserve the stored code until the person selects a country.
  const [country, setCountry] = useState(initial.countryCode || (initial.dialCode ? "dial:" + initial.dialCode : ""));
  const [number, setNumber] = useState(initial.number);
  const locale = effectiveFormLanguage(language);
  const labels = formSystemCopy(locale).internationalContact;
  const dialCode = (selected: string) => internationalContactDialCode(selected.replace(/^dial:/, "")) ?? "";
  const candidate = (selected: string, digits: string) => selected || digits ? dialCode(selected) + " " + digits : "";
  const error = !country && (number || question.required) ? labels.errCountryCode
    : internationalContactError(candidate(country, number), question.required) ? labels.errLength : undefined;
  const update = (selected: string, digits: string) => {
    if (disabled) return;
    setCountry(selected); setNumber(digits); onChange(candidate(selected, digits));
  };
  const ambiguousNames = initial.countryCodes.map(code => internationalContactCountries.find(item => item.iso === code))
    .filter(item => !!item).map(item => item.names[locale] || item.names.en || item.names.ko).join(" / ");
  return <div className="cs-stack" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <label className="cs-label">{labels.countryCodePlaceholder}<select className="cs-input" aria-label={question.label + " · " + labels.countryCodePlaceholder} required={question.required || !!number}
      value={country} disabled={disabled} onChange={event => update(event.target.value, number)}>
      <option value="" disabled hidden>{labels.countryCodePlaceholder}</option>
      {initial.countryCodes.length > 1 && <option value={"dial:" + initial.dialCode}>{ambiguousNames} ({initial.dialCode})</option>}
      {internationalContactCountries.map(item => <option key={item.iso} value={item.iso}>{item.names[locale] || item.names.en || item.names.ko} ({item.dialCode})</option>)}
    </select></label>
    <label className="cs-label">{labels.numberPlaceholder}<input className="cs-input" name={question.id} aria-label={question.label + " · " + labels.numberPlaceholder} type="tel" inputMode="numeric" dir="ltr"
      autoComplete="tel-national" placeholder={labels.numberPlaceholder} maxLength={30} required={question.required || !!country} value={number} disabled={disabled}
      ref={element => element?.setCustomValidity(error ?? "")} onChange={event => update(country, event.target.value.replace(/\D/g, ""))} /></label>
    <p className="cs-muted">{labels.errLength}</p>
    {!question.required && (country || number) && <button type="button" className="cs-link" disabled={disabled} onClick={() => update("", "")}>{formPhrase(locale, "phrase70")}</button>}
  </div>;
}
