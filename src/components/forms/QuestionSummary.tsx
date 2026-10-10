import { answerTextMaxLength, optionLabel } from "@/contracts/questions";
import type { Question } from "@/contracts/forms";
import { QuestionMaterials } from "./QuestionMaterials";
import { QuestionImage } from "./QuestionImage";
import { QuestionExplanation } from "./QuestionExplanation";
import { QuestionPersonalInformation } from "./QuestionPersonalInformation";

export function QuestionSummary({ question, questions, language }: { question: Question; questions: Question[]; language?: string | null }) {
  return <>
    <QuestionImage assetKey={question.questionImageKey} language={language} />
    <QuestionPersonalInformation question={question} />
    <QuestionMaterials question={question} language={language} />
    <QuestionExplanation question={question} />
    {answerTextMaxLength(question) !== undefined && <p>최대 글자 수: {answerTextMaxLength(question)}자</p>}
    {question.condition && <p>표시 조건: {questions.find(item => item.id === question.condition?.questionId)?.label ?? "연결 질문 확인 필요"}에서 “{optionLabel(question.condition.value, questions.find(item => item.id === question.condition?.questionId)?.optionDefinitions)}” 선택</p>}
    {question.rows && <p>행: {question.rows.map(row => row.label).join(", ")}</p>}
    {question.selectionLimits && <p>선택 수: {question.selectionLimits.mode === "exact" ? "정확히 " + question.selectionLimits.min + "개" : "최소 " + (question.selectionLimits.min ?? 0) + "개 · 최대 " + (question.selectionLimits.max ?? question.options?.length ?? 100) + "개"}{question.rows ? " (행별)" : ""}
      {question.rows && question.selectionLimits.mode === "exact" && " · 답변을 시작하면 모든 행을 채워주세요."}</p>}
  </>;
}
