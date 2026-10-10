import type { Question } from "@/contracts/forms";

export function QuestionExplanation({ question, id }: { question: Pick<Question, "additionalExplanation">; id?: string }) {
  if (!question.additionalExplanation) return null;
  return <p id={id} className="forms-question-explanation">{question.additionalExplanation}</p>;
}
