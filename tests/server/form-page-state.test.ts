import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { FormContent } from "@/contracts/forms";
import { formContentSchema } from "@/contracts/domains";
import { formPageDestination, resolveFormVisit } from "@/contracts/form-sections";
import {
  addFormPage,
  destinationFromValue,
  destinationValue,
  disableFormPages,
  duplicateFormPage,
  enableFormPages,
  moveFormPage,
  pageDeleteImpact,
  removeFormPage,
} from "@/components/forms/form-page-state";

function base(): FormContent {
  const optionA = randomUUID(), optionB = randomUUID();
  return formContentSchema.parse({ body: "안내", questions: [
    { id: randomUUID(), type: "객관식 답변", label: "경로", required: true, options: [optionA, optionB], optionDefinitions: [
      { id: randomUUID(), label: "상세", value: optionA }, { id: randomUUID(), label: "바로", value: optionB },
    ] },
    { id: randomUUID(), type: "단문형 답변", label: "이름", required: true, textMaxLength: 100 },
  ], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
}

test("여러 페이지를 켜고 추가하면 기존 질문을 첫 페이지에 두고 끝 경로를 안전하게 연장한다", () => {
  const enabled = enableFormPages(base(), randomUUID), first = enabled.sections![0];
  expect(enabled.questions.every(question => question.pageId === first.id)).toBe(true);
  expect(first).toMatchObject({ title: "", body: "", allowBack: false, defaultDestination: { kind: "consent" } });
  const added = addFormPage(enabled, randomUUID), second = added.sections![1];
  expect(added.sections![0].defaultDestination).toEqual({ kind: "page", pageId: second.id });
  expect(second.defaultDestination).toEqual({ kind: "consent" });
  expect(second.allowBack).toBe(true);
  expect(formContentSchema.safeParse(added).success).toBe(true);
});

test("페이지 복제는 페이지·질문·보기·행 ID를 새로 만들고 원래 다음 경로 사이에 삽입한다", () => {
  const content = addFormPage(enableFormPages(base(), randomUUID), randomUUID);
  const source = content.sections![1].id, firstQuestion = content.questions[0], secondQuestion = content.questions[1];
  content.questions[0] = { ...firstQuestion, pageId: source };
  content.questions[1] = { ...secondQuestion, pageId: source, condition: {
    questionId: firstQuestion.id, operator: "equals", value: firstQuestion.optionDefinitions![0].value,
    optionId: firstQuestion.optionDefinitions![0].id,
  } };
  const copied = duplicateFormPage(content, source, randomUUID), clonePage = copied.sections![2];
  const clones = copied.questions.filter(question => question.pageId === clonePage.id);
  expect(copied.sections![1].defaultDestination).toEqual({ kind: "page", pageId: clonePage.id });
  expect(clones).toHaveLength(2); expect(clones.map(question => question.id)).not.toEqual([firstQuestion.id, secondQuestion.id]);
  expect(clones[1].condition?.questionId).toBe(clones[0].id);
  expect(clones[1].condition?.optionId).toBe(clones[0].optionDefinitions![0].id);
  expect(formContentSchema.safeParse(copied).success).toBe(true);
});

test("빈 중간 페이지 삭제는 기본·보기 이동을 다음 목적지로 재연결하고 질문이 있으면 막는다", () => {
  const content = addFormPage(addFormPage(enableFormPages(base(), randomUUID), randomUUID), randomUUID);
  const [first, middle, last] = content.sections!;
  content.questions = content.questions.map(question => ({ ...question, pageId: first.id }));
  content.questions[0].optionDefinitions![0].branchDestination = { kind: "page", pageId: middle.id };
  expect(pageDeleteImpact(content, middle.id)).toMatchObject({ first: false, questions: 0, references: 2 });
  const removed = removeFormPage(content, middle.id);
  expect(removed.sections).toHaveLength(2);
  expect(removed.sections![0].defaultDestination).toEqual({ kind: "page", pageId: last.id });
  expect(removed.questions[0].optionDefinitions![0].branchDestination).toEqual({ kind: "page", pageId: last.id });

  const occupied = structuredClone(content); occupied.questions[1].pageId = middle.id;
  expect(removeFormPage(occupied, middle.id)).toEqual(occupied);
});

test("첫 페이지는 고정하고 이후 페이지만 재정렬하며 한 페이지 전환은 배치와 보기 이동을 모두 제거한다", () => {
  const content = addFormPage(addFormPage(enableFormPages(base(), randomUUID), randomUUID), randomUUID);
  const ids = content.sections!.map(page => page.id);
  expect(moveFormPage(content, ids[0], 1).sections!.map(page => page.id)).toEqual(ids);
  expect(moveFormPage(content, ids[2], -1).sections!.map(page => page.id)).toEqual([ids[0], ids[2], ids[1]]);
  const branch = structuredClone(content); branch.questions[0].optionDefinitions![0].branchDestination = { kind: "submit" };
  const plain = disableFormPages(branch);
  expect(plain.sections).toBeUndefined(); expect(plain.questions.every(question => question.pageId === undefined)).toBe(true);
  expect(plain.questions[0].optionDefinitions![0]).not.toHaveProperty("branchDestination");
});

test("한 페이지 목적지 해석은 보기 이동을 기본 이동보다 우선하고 서버 전체 경로와 일치한다", () => {
  const content = addFormPage(enableFormPages(base(), randomUUID), randomUUID);
  const [first, second] = content.sections!;
  content.questions = content.questions.map(question => ({ ...question, pageId: first.id }));
  const route = content.questions[0]; route.optionDefinitions![0].branchDestination = { kind: "submit" };
  expect(formPageDestination(content, first.id, { [route.id]: route.optionDefinitions![0].value })).toEqual({ kind: "submit" });
  expect(formPageDestination(content, first.id, {})).toEqual({ kind: "page", pageId: second.id });
  expect(resolveFormVisit(content, { [route.id]: route.optionDefinitions![0].value })?.pageIds).toEqual([first.id]);
  expect(destinationValue({ kind: "page", pageId: second.id })).toBe(`page:${second.id}`);
  expect(destinationFromValue(`page:${second.id}`)).toEqual({ kind: "page", pageId: second.id });
  expect(destinationFromValue("invalid")).toBeUndefined();
});
