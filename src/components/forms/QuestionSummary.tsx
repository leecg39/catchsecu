import type { Question } from "@/contracts/forms";

export function QuestionSummary({ question, questions }: { question: Question; questions: Question[] }) {
  return <>
    {question.condition && <p>표시 조건: {questions.find(item => item.id === question.condition?.questionId)?.label ?? "연결 질문 확인 필요"}에서 “{question.condition.value}” 선택</p>}
    {question.rows && <p>행: {question.rows.map(row => row.label).join(", ")}</p>}
    {question.selectionLimits && <p>선택 수: 최소 {question.selectionLimits.min ?? 0}개 · 최대 {question.selectionLimits.max ?? question.options?.length ?? 100}개{question.rows ? " (행별)" : ""}</p>}
  </>;
}
