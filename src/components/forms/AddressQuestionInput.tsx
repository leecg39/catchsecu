"use client";
import { useEffect, useRef, useState } from "react";
import type { Question } from "@/contracts/forms";
import type { AnswerValue } from "@/contracts/questions";
import countries from "@/data/form-countries.json";
import { domesticAddressError, emptyForeignAddress, foreignAddressError, foreignAddressFields, serializeDomesticAddress, type ForeignAddress } from "@/contracts/address-questions";
import { loadPostcode, type PostcodeResult } from "@/lib/postcode";
import { effectiveFormLanguage, type FormLanguage } from "@/contracts/form-language";
import { formSystemCopy } from "@/contracts/form-system-copy";

function PostcodeSearch({ onFound, onClose }: { onFound: (value: PostcodeResult) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null), found = useRef(onFound);
  useEffect(() => { found.current = onFound; }, [onFound]);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const element = host.current!;
    void loadPostcode().then(Postcode => {
      if (!active) return;
      new Postcode({ width: "100%", height: 500, minWidth: 200,
        onresize: size => { if (active && Number.isFinite(size.height) && size.height >= 400) element.style.height = Math.min(size.height, 2000) + "px"; },
        oncomplete: value => {
          if (!active) return;
          if (typeof value?.zonecode !== "string" || !/^\d{5}$/.test(value.zonecode) || typeof value.address !== "string" || !value.address.trim() || value.address.length > 800) {
            setError("선택한 주소를 확인할 수 없습니다. 다시 검색해주세요."); return;
          }
          found.current(value);
        },
      }).embed(element);
      setLoading(false);
    }).catch(cause => { if (active) { setLoading(false); setError(cause instanceof Error ? cause.message : "주소 검색을 불러오지 못했습니다."); } });
    return () => { active = false; element.replaceChildren(); };
  }, [attempt]);
  return <section className="forms-address-search" aria-label="카카오 주소 검색">
    <div className="forms-actions"><strong>카카오 주소 검색</strong><button type="button" className="cs-button secondary" onClick={onClose}>검색 닫기</button></div>
    {loading && <p role="status">주소 검색을 불러오는 중입니다.</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="cs-button secondary" onClick={() => { setError(""); setLoading(true); setAttempt(value => value + 1); }}>다시 시도</button></div>}
    <div ref={host} style={{ width: "100%", height: 500, minWidth: 0 }} />
  </section>;
}

export function DomesticAddressInput({ question, value, onChange, disabled = false }: { question: Question; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [stored, setStored] = useState(!!value.trim());
  const [parts, setParts] = useState({ zipcode: "", address: "", detailAddress: "" });
  const [search, setSearch] = useState(false), [tried, setTried] = useState(false);
  const root = useRef<HTMLDivElement>(null), searchButton = useRef<HTMLButtonElement>(null), detail = useRef<HTMLInputElement>(null);
  const error = domesticAddressError(value, question.required);
  // Read-only provider fields do not participate in native validation. Validate this
  // composite before React's form submit handler and focus its usable search action.
  useEffect(() => {
    const form = root.current?.closest("form");
    const validate = (event: SubmitEvent) => {
      if (!error) return;
      event.preventDefault(); event.stopImmediatePropagation(); setTried(true); searchButton.current?.focus();
    };
    form?.addEventListener("submit", validate, true);
    return () => form?.removeEventListener("submit", validate, true);
  }, [error]);
  function found(result: PostcodeResult) {
    if (disabled || searchButton.current?.matches(":disabled")) return;
    const next = { zipcode: result.zonecode, address: result.address, detailAddress: stored ? "" : parts.detailAddress };
    setParts(next); setStored(false); onChange(serializeDomesticAddress(next.zipcode, next.address, next.detailAddress)); setSearch(false);
    requestAnimationFrame(() => detail.current?.focus());
  }
  return <div ref={root} className="cs-stack forms-address-input">
    {stored ? <label className="cs-label">저장된 전체 주소<input className="cs-input" name={question.id} aria-label={question.label + " 전체 주소"} value={value} required={question.required} maxLength={1000}
      ref={element => element?.setCustomValidity(error ?? "")} onChange={event => onChange(event.target.value)} />
      <span className="cs-muted">우편번호와 상세주소를 포함한 주소입니다. 새 주소를 검색하면 전체 주소가 교체됩니다.</span></label> : <>
      <label className="cs-label">우편번호<input className="cs-input" aria-label={question.label + " 우편번호"} value={parts.zipcode} readOnly maxLength={100} /></label>
      <label className="cs-label">기본주소<input className="cs-input" aria-label={question.label + " 기본주소"} value={parts.address} readOnly maxLength={100} /></label>
      <label className="cs-label">상세주소<input ref={detail} className="cs-input" aria-label={question.label + " 상세주소"} value={parts.detailAddress} maxLength={100} disabled={!parts.zipcode}
        onChange={event => { const next = { ...parts, detailAddress: event.target.value }; setParts(next); onChange(serializeDomesticAddress(next.zipcode, next.address, next.detailAddress)); }} /></label>
    </>}
    <div className="forms-actions"><button ref={searchButton} type="button" className="cs-button secondary" aria-expanded={search} onClick={() => setSearch(true)}>주소 검색</button>
      {value && !question.required && <button type="button" className="cs-button secondary" onClick={() => { setParts({ zipcode: "", address: "", detailAddress: "" }); setStored(false); onChange(""); setSearch(false); setTried(false); }}>주소 비우기</button>}</div>
    {tried && error && <p role="alert">{error}</p>}
    {search && !disabled && <PostcodeSearch onFound={found} onClose={() => { setSearch(false); searchButton.current?.focus(); }} />}
  </div>;
}

export function ForeignAddressInput({ question, value, onChange, language }: { question: Question; value: AnswerValue | undefined; onChange: (value: ForeignAddress) => void; language?: FormLanguage }) {
  const address = { ...emptyForeignAddress(), ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}) } as ForeignAddress;
  const required = question.required || !!(address.country.trim() || address.streetAddress.trim() || address.city.trim());
  const error = foreignAddressError(address, question.required);
  const locale = effectiveFormLanguage(language), labels = formSystemCopy(locale).internationalAddress;
  return <div className="cs-stack forms-address-input" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <label className="cs-label">{labels.country}<select className="cs-input" aria-label={question.label + " " + labels.country} value={address.country} required={required}
      onChange={event => onChange({ ...address, country: event.target.value, countryName: countries.find(country => country.iso === event.target.value)?.names.ko ?? "" })}>
      <option value="">{labels.countryPlaceholder}</option>{countries.map(country => <option key={country.iso} value={country.iso}>{country.names[locale] || country.names.en || country.names.ko}</option>)}</select></label>
    {foreignAddressFields.map(field => <label key={field.key} className="cs-label">{labels[field.key]}<input className="cs-input" aria-label={question.label + " " + labels[field.key]}
      placeholder={labels[`${field.key}Placeholder`]}
      value={address[field.key]} maxLength={field.maxLength} required={required && (field.key === "streetAddress" || field.key === "city")}
      ref={element => { if (field.key === "streetAddress") element?.setCustomValidity(error ?? ""); }} onChange={event => onChange({ ...address, [field.key]: event.target.value })} /></label>)}
  </div>;
}
