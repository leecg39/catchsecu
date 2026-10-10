"use client";
import type { FormContent } from "@/contracts/forms";
import { marketingQuestionTypeAllowed, type MarketingQuestionKind } from "@/contracts/marketing";
import { Panel } from "../shared";
export function MarketingSettings({ content, onChange }: { content: FormContent; onChange: (patch: Partial<FormContent>) => void }) {
  const settings = content.marketing;
  const select = (field: "nameQuestionId" | "emailQuestionId" | "smsQuestionId" | "kakaoQuestionId", kind: MarketingQuestionKind, label: string) => {
    const questions = content.questions.filter(q => marketingQuestionTypeAllowed(kind, q.type));
    return <label className="cs-label">{label}<select className="cs-input" aria-label={label} value={settings?.[field] ?? ""} onChange={e => onChange({ marketing: { ...settings!, [field]: e.target.value || (field === "nameQuestionId" ? "" : undefined) } })}>
      <option value="">지정하지 않음</option>{settings?.[field] && !questions.some(q => q.id === settings[field]) && <option value={settings[field]}>연결 질문 수정 필요</option>}
      {questions.map(q => <option key={q.id} value={q.id}>{q.label || "제목 없는 질문"}</option>)}</select></label>;
  };
  return <Panel><h2>광고성 정보 수신동의</h2><label><input type="checkbox" checked={!!settings} onChange={e => onChange({ marketing: e.target.checked ? { purpose: "", nameQuestionId: "" } : null })} />채널별 선택 동의 받기</label>
    <p className="forms-muted">응답자가 별도로 선택한 이메일·문자·알림톡 채널만 수신동의 목록에 등록됩니다.</p>
    {settings && <div className="cs-stack"><label className="cs-label">마케팅 이용 목적<textarea className="cs-input" aria-label="마케팅 이용 목적" value={settings.purpose} maxLength={3000} onChange={e => onChange({ marketing: { ...settings, purpose: e.target.value } })} /></label>
      {select("nameQuestionId", "name", "마케팅 이름 질문")}{select("emailQuestionId", "email", "마케팅 이메일 질문")}{select("smsQuestionId", "sms", "마케팅 전화번호 질문")}{select("kakaoQuestionId", "kakao", "마케팅 알림톡 전화번호 질문")}
      <p className="forms-muted">이름과 한 개 이상의 연락처 질문을 지정하세요. 동의한 채널에는 유효한 연락처가 필요합니다. 보유 기간은 원본 응답과 같습니다.</p></div>}
  </Panel>;
}
