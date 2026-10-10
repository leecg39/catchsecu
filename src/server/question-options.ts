import type { OptionDefinition, QuestionDefinition } from "@/contracts/questions";
import { normalizeQuestionOptions } from "@/contracts/option-identities";
import { fail } from "./http";

export function storedOptionDefinitions(options: { id: string; stableKey: string | null; label: string | null; value: string; isCustomValue?: boolean | null; optionImageKey?: string | null;
  branchDestinationKind?: string | null; branchDestinationSectionId?: string | null }[], pageIds?: Map<string, string>): OptionDefinition[] {
  return options.map(option => ({ id: option.stableKey ?? option.id, label: option.label ?? option.value, value: option.value,
    ...(option.isCustomValue === true ? { isCustomValue: true } : {}), ...(option.optionImageKey ? { optionImageKey: option.optionImageKey } : {}),
    ...(pageIds && option.branchDestinationKind ? { branchDestination: option.branchDestinationKind === "page"
      ? { kind: "page" as const, pageId: pageIds.get(option.branchDestinationSectionId ?? "")! }
      : { kind: option.branchDestinationKind as "consent" | "submit" | "ineligible" } } : {}) }));
}
export function checkedQuestionOptions(questions: QuestionDefinition[], previous: QuestionDefinition[] = [], allocate?: (questionId: string, value: string) => string, current?: QuestionDefinition[]) {
  try { return normalizeQuestionOptions(questions, previous, allocate, current); }
  catch (error) { fail(422, "INVALID_OPTION_IDENTITIES", (error as Error).message); }
}
