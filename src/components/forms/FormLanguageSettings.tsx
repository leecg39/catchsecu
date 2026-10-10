"use client";
import { useState } from "react";
import type { FormContent } from "@/contracts/forms";
import { effectiveFormLanguage, formLanguageLabel, formLanguages, type FormLanguage } from "@/contracts/form-language";
import { ActionButton, Modal, Panel } from "../shared";

export function FormLanguageSettings({ content, disabled, onChange }: { content: FormContent; disabled: boolean; onChange: (patch: Partial<FormContent>) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [language, setLanguage] = useState<FormLanguage>(effectiveFormLanguage(content.formLanguage));
  const conflicts = language !== "ko" && content.verify;
  return <Panel><h2>캐치폼 서비스 언어</h2><p>선택한 언어로 캐치폼을 작성해 주세요.</p>
    <div className="forms-actions"><strong>{formLanguageLabel(content.formLanguage)}</strong>
      <button type="button" className="cs-button secondary" disabled={disabled} onClick={() => { setLanguage(effectiveFormLanguage(content.formLanguage)); setChoosing(true); }}>언어변경</button></div>
    {choosing && <Modal title="캐치폼 서비스 언어 설정" onClose={() => { if (!disabled) setChoosing(false); }}>
      <div className="cs-stack"><p>본 캐치폼을 서비스할 언어를 선택해 주세요.</p>
        <p>질문, 본문과 답변 선택항목은 선택하신 언어로 직접 입력해 주세요.</p>
        <label className="cs-label">언어<select className="cs-input" aria-label="캐치폼 서비스 언어" value={language} disabled={disabled} onChange={event => setLanguage(event.target.value as FormLanguage)}>
          {formLanguages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select></label>
        <p>한국어와 외국어 사이에서 변경하면 주소 질문도 국내 주소 또는 해외 주소로 변경됩니다. 이미 게시된 응답은 유지됩니다.</p>
        {conflicts && <p role="alert">본인인증 및 전자서명은 한국어 캐치폼에서만 사용할 수 있습니다. 창을 닫고 해당 설정을 먼저 해제해 주세요.</p>}
        <div className="forms-actions"><ActionButton secondary disabled={disabled} onClick={() => setChoosing(false)}>취소하기</ActionButton>
          <ActionButton disabled={disabled || !!conflicts} onClick={() => {
            if (disabled || conflicts) return;
            onChange({ formLanguage: language, questions: content.questions.map(question =>
              ["주소", "해외 주소"].includes(question.type) ? { ...question, type: language === "ko" ? "주소" as const : "해외 주소" as const,
                infoPatternId: language === "ko" ? 7 as const : undefined } : question) });
            setChoosing(false);
          }}>{formLanguageLabel(language)} 선택하기</ActionButton></div>
      </div>
    </Modal>}
  </Panel>;
}
