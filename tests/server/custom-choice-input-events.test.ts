import React, { type ReactElement, type ReactNode } from "react";
import { expect, test } from "vitest";
import { CustomChoiceQuestionInput } from "@/components/forms/CustomChoiceQuestionInput";
import type { Question } from "@/contracts/forms";
import type { AnswerValue } from "@/contracts/questions";

const options = ["A", "B", "other"].map((value, index) => ({ id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  value, label: value, ...(value === "other" ? { isCustomValue: true } : {}) }));
const base: Question = { id: "10000000-0000-4000-8000-000000000001", type: "체크박스", required: false, label: "선택",
  options: options.map(option => option.value), optionDefinitions: options };
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}
function trigger(tree: ReactNode, type: string, target: { value?: string; checked?: boolean }, value?: string) {
  const input = descendants(tree).find(element => element.type === type && (value === undefined || element.props.value === value));
  expect(input).toBeDefined();
  (input!.props.onChange as (event: { target: typeof target }) => void)({ target });
}
test("temporarily selecting custom and removing it restores the original ordinary selection order and clears text", () => {
  let value: AnswerValue = ["B", "A"];
  const render = () => CustomChoiceQuestionInput({ question: base, value, disabled: false, hint: "", onChange: next => { value = next; } });
  trigger(render(), "input", { checked: true }, "other");
  expect(value).toMatchObject({ selectedValues: ["B", "A", "other"], custom: { text: "" } });
  trigger(render(), "textarea", { value: "직접 입력" });
  trigger(render(), "input", { checked: false }, "other");
  expect(value).toEqual(["B", "A"]);
  trigger(render(), "input", { checked: true }, "other");
  expect(value).toMatchObject({ custom: { text: "" } });
});
test.each(["객관식 답변", "드롭다운"] as const)("%s returns to scalar values and clears prior custom text on reselection", type => {
  let value: AnswerValue = "A";
  const render = () => CustomChoiceQuestionInput({ question: { ...base, type }, value, disabled: false, hint: "", onChange: next => { value = next; } });
  const select = (next: string) => type === "드롭다운" ? trigger(render(), "select", { value: next }) : trigger(render(), "input", { checked: true }, next);
  select("other"); trigger(render(), "textarea", { value: "기존 입력" }); select("B"); expect(value).toBe("B");
  select("other"); expect(value).toMatchObject({ selectedValues: ["other"], custom: { text: "" } });
});
test("editing text preserves unaffected CRLF and disabled controls cannot emit a changed answer", () => {
  let value: AnswerValue = { kind: "custom-choice", selectedValues: ["other"], custom: { optionId: options[2].id, text: "앞\r\n뒤" } };
  const render = (disabled: boolean) => CustomChoiceQuestionInput({ question: base, value, disabled, hint: "", onChange: next => { value = next; } });
  trigger(render(false), "textarea", { value: "앞\n뒤!" }); expect(value).toMatchObject({ custom: { text: "앞\r\n뒤!" } });
  const before = value; trigger(render(true), "textarea", { value: "변경 거부" }); trigger(render(true), "input", { checked: false }, "other"); expect(value).toBe(before);
});
