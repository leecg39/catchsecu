"use client";
import { useState } from "react";
import type { Question } from "@/contracts/forms";
import { domesticPhonePrefixes, emailDomains, parseDomesticPhone, serializeDomesticPhone, specialAnswerError } from "@/contracts/special-questions";

export function ContactQuestionInput({ question, value, onChange }: { question: Question; value: string; onChange: (value: string) => void }) {
  const [initial] = useState(() => parseDomesticPhone(value));
  const [prefix, setPrefix] = useState(initial.prefix);
  const [direct, setDirect] = useState(!domesticPhonePrefixes.some(item => item === initial.prefix));
  const [number, setNumber] = useState(initial.number);
  const error = specialAnswerError(question.type, value);
  const update = (nextPrefix: string, nextNumber: string) => { setPrefix(nextPrefix); setNumber(nextNumber); onChange(serializeDomesticPhone(nextPrefix, nextNumber)); };
  return <div className="cs-stack">
    <label className="cs-label">전화번호 앞자리<select className="cs-input" aria-label={question.label + " 앞자리 선택"} value={direct ? "direct" : prefix}
      onChange={event => { const custom = event.target.value === "direct"; setDirect(custom); update(custom ? "" : event.target.value, number); }}>
      {domesticPhonePrefixes.map(item => <option key={item}>{item}</option>)}<option value="direct">직접 입력</option></select></label>
    {direct && <label className="cs-label">직접 입력 앞자리<input className="cs-input" aria-label={question.label + " 앞자리 직접 입력"} inputMode="numeric" type="text" maxLength={4}
      required={question.required || !!number} value={prefix} onChange={event => update(event.target.value.replace(/\D/g, ""), number)} /></label>}
    <label className="cs-label">나머지 전화번호<input className="cs-input" aria-label={question.label + " 뒤 번호"} name={question.id} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={8}
      required={question.required} value={number} ref={element => element?.setCustomValidity(error ?? "")} onChange={event => update(prefix, event.target.value.replace(/\D/g, ""))} /></label>
    <p className="cs-muted">앞자리를 제외한 전화번호 7~8자리를 입력해주세요.</p>
  </div>;
}
export function EmailQuestionInput({ question, value, onChange }: { question: Question; value: string; onChange: (value: string) => void }) {
  const [initial] = useState(() => { const split = value.lastIndexOf("@"); return { local: split < 0 ? value : value.slice(0, split), domain: split < 0 ? emailDomains[0] : value.slice(split + 1) }; });
  const [local, setLocal] = useState(initial.local), [domain, setDomain] = useState<string>(initial.domain);
  const [direct, setDirect] = useState(!emailDomains.some(item => item === initial.domain));
  const update = (nextLocal: string, nextDomain: string) => { setLocal(nextLocal); setDomain(nextDomain); onChange(nextLocal ? nextLocal + "@" + nextDomain : ""); };
  return <div className="cs-stack">
    <label className="cs-label">이메일 아이디<input className="cs-input" aria-label={question.label + " 아이디"} name={question.id} type="text" autoCapitalize="none" spellCheck={false} maxLength={100}
      required={question.required} value={local} ref={element => element?.setCustomValidity(specialAnswerError(question.type, value) ?? "")} onChange={event => update(event.target.value.replace(/\s/g, ""), domain)} /></label>
    <label className="cs-label">@ 도메인<input className="cs-input" aria-label={question.label + " 도메인"} type="text" autoCapitalize="none" spellCheck={false} maxLength={100} readOnly={!direct}
      required={question.required || !!local} value={domain} onChange={event => update(local, event.target.value.replace(/\s/g, ""))} /></label>
    <label className="cs-label">이메일 도메인 선택<select className="cs-input" aria-label={question.label + " 도메인 선택"} value={direct ? "direct" : domain}
      onChange={event => { const custom = event.target.value === "direct"; setDirect(custom); update(local, custom ? "" : event.target.value); }}>
      {emailDomains.map(item => <option key={item}>{item}</option>)}<option value="direct">직접 입력</option></select></label>
  </div>;
}
