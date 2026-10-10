import type { Question } from "@/contracts/forms";
import type { PersonalInformationType } from "@/contracts/question-personal-information";

export const personalInformationLabels: Record<PersonalInformationType, string> = {
  PERSONAL_INFORMATION: "개인정보", SENSITIVE: "민감정보", IDENTIFICATION: "고유식별정보",
  RESIDENT: "주민등록번호", NON_PERSONAL_INFORMATION: "개인정보 없음",
};

export function QuestionPersonalInformation({ question }: { question: Question }) {
  const items = question.catchFormPersonalInformationRequests;
  if (!items?.length) return null;
  return <div className="forms-personal-information"><small>개인정보 분류 · 수동 확인</small>
    <ul aria-label="수동 개인정보 분류">{items.map((item, index) => <li key={index}>
      <span className="forms-personal-information-kind">{personalInformationLabels[item.personalInformationType]}</span>
      {item.personalInformationType !== "NON_PERSONAL_INFORMATION" && <span className="forms-personal-information-name" dir="auto">{item.detectedPersonalInformation}</span>}
    </li>)}</ul>
  </div>;
}
