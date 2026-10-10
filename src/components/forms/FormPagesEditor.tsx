"use client";
import { useEffect, useRef, useState } from "react";
import type { FormContent, Question } from "@/contracts/forms";
import { formPresentationIssues, MAX_FORM_SECTIONS } from "@/contracts/form-sections";
import { choiceTypes } from "@/contracts/questions";
import { useConfirm } from "../ux/confirm";
import type { AuthorAssetEditContext } from "./AuthorAssetUpload";
import { RichDocumentEditor } from "./RichDocumentEditor";
import {
  addFormPage,
  changePage,
  destinationFromValue,
  destinationValue,
  disableFormPages,
  duplicateFormPage,
  enableFormPages,
  moveFormPage,
  pageDeleteImpact,
  removeFormPage,
} from "./form-page-state";

function issue(content: FormContent): string | undefined {
  return formPresentationIssues(content)[0]?.message;
}

export function FormPagesEditor({ content, disabled, context, getSaveState, onChange }: {
  content: FormContent;
  disabled: boolean;
  context: AuthorAssetEditContext;
  getSaveState: () => unknown;
  onChange: (content: FormContent) => void;
}) {
  const confirm = useConfirm(), [error, setError] = useState("");
  const latest = useRef({ content, disabled, getSaveState, onChange });
  useEffect(() => { latest.current = { content, disabled, getSaveState, onChange }; }, [content, disabled, getSaveState, onChange]);
  const pages = content.sections ?? [];
  const commit = (next: FormContent) => {
    const message = issue(next);
    if (message) { setError(message); return false; }
    setError(""); onChange(next); return true;
  };
  const guardedConfirm = async (title: string, message: string, confirmLabel: string) => {
    const snapshot = JSON.stringify(content), saveState = getSaveState();
    if (!await confirm({ title, message, confirmLabel, cancelLabel: "계속 편집" })) return false;
    if (latest.current.disabled || JSON.stringify(latest.current.content) !== snapshot || latest.current.getSaveState() !== saveState) {
      setError("편집 내용 또는 저장 상태가 변경되었습니다. 확인한 뒤 다시 시도해주세요."); return false;
    }
    return true;
  };
  async function turnOff() {
    if (!pages.length || !await guardedConfirm("여러 페이지 끄기", "페이지 배치와 보기별 이동을 제거하고 모든 질문을 한 화면에 표시할까요? 이전 게시본은 유지됩니다.", "한 페이지로 변경")) return;
    commit(disableFormPages(latest.current.content));
  }
  async function remove(pageId: string) {
    const impact = pageDeleteImpact(content, pageId);
    if (impact.first) { setError("첫 페이지는 삭제할 수 없습니다."); return; }
    if (impact.questions) { setError(`이 페이지의 질문 ${impact.questions}개를 다른 페이지로 옮긴 뒤 삭제해주세요.`); return; }
    const detail = impact.references ? `이 페이지를 가리키는 이동 ${impact.references}개는 이 페이지의 다음 목적지로 다시 연결됩니다.` : "이 페이지에는 들어오는 이동이 없습니다.";
    if (!await guardedConfirm("페이지 삭제", `${detail} 이전 게시본은 유지됩니다.`, "페이지 삭제")) return;
    commit(removeFormPage(latest.current.content, pageId));
  }
  if (!pages.length) return <section className="forms-pages-editor"><div className="forms-between"><div><h2>페이지와 이동</h2><p>질문을 여러 페이지로 나누고 보기별 다음 경로를 설정합니다.</p></div>
    <button type="button" disabled={disabled} onClick={() => commit(enableFormPages(content, () => crypto.randomUUID()))}>여러 페이지 사용</button></div>{error && <p role="alert">{error}</p>}</section>;

  return <section className="forms-pages-editor"><div className="forms-between"><div><h2>페이지와 이동</h2><p>첫 페이지는 캐치폼 제목과 본문을 사용합니다. 이동 경로는 순환하지 않아야 합니다.</p></div>
    <div className="forms-row-actions"><button type="button" disabled={disabled || pages.length >= MAX_FORM_SECTIONS} onClick={() => commit(addFormPage(content, () => crypto.randomUUID()))}>페이지 추가</button>
      <button type="button" disabled={disabled} onClick={() => void turnOff()}>여러 페이지 끄기</button></div></div>
    <div className="forms-pages-list">{pages.map((page, index) => <article className="forms-page-card" key={page.id}>
      <div className="forms-between"><h3>페이지 {index + 1}{page.title ? ` · ${page.title}` : ""}</h3><div className="forms-row-actions">
        <button type="button" aria-label={`페이지 ${index + 1} 위로`} disabled={disabled || index <= 1} onClick={() => commit(moveFormPage(content, page.id, -1))}>위로</button>
        <button type="button" aria-label={`페이지 ${index + 1} 아래로`} disabled={disabled || index === 0 || index === pages.length - 1} onClick={() => commit(moveFormPage(content, page.id, 1))}>아래로</button>
        <button type="button" aria-label={`페이지 ${index + 1} 복제`} disabled={disabled || pages.length >= MAX_FORM_SECTIONS} onClick={() => commit(duplicateFormPage(content, page.id, () => crypto.randomUUID()))}>복제</button>
        <button type="button" aria-label={`페이지 ${index + 1} 삭제`} disabled={disabled || index === 0} onClick={() => void remove(page.id)}>삭제</button>
      </div></div>
      {index === 0 ? <p className="cs-muted">이 페이지의 제목과 안내는 위의 캐치폼 제목·본문을 사용합니다.</p> : <>
        <label className="cs-label">페이지 제목<input className="cs-input" aria-label={`페이지 ${index + 1} 제목`} maxLength={200} value={page.title}
          onChange={event => commit(changePage(content, page.id, { title: event.target.value }))} /></label>
        <RichDocumentEditor label={`페이지 ${index + 1} 본문`} value={page.bodyRich} fallbackText={page.body} purpose="PAGE_CONTENT_IMAGE"
          disabled={disabled} context={context} onChange={(bodyRich, body) => commit(changePage(content, page.id, { bodyRich, body }))} />
      </>}
      <label className="cs-label">기본 다음 단계<select className="cs-input" aria-label={`페이지 ${index + 1} 기본 다음 단계`} value={destinationValue(page.defaultDestination)}
        onChange={event => { const destination = destinationFromValue(event.target.value); if (destination) commit(changePage(content, page.id, { defaultDestination: destination })); }}>
        {pages.filter(candidate => candidate.id !== page.id).map(candidate => <option key={candidate.id} value={`page:${candidate.id}`}>페이지 {pages.indexOf(candidate) + 1}{candidate.title ? ` · ${candidate.title}` : ""}</option>)}
        <option value="consent">동의 단계</option><option value="submit">제출 단계</option><option value="ineligible">참여 대상 아님</option>
      </select></label>
      <label className="member-check"><input type="checkbox" checked={page.allowBack} disabled={disabled || index === 0}
        onChange={event => commit(changePage(content, page.id, { allowBack: event.target.checked }))} />이 페이지에서 이전 페이지로 돌아가기 허용</label>
      <p className="cs-muted">질문 {content.questions.filter(question => question.pageId === page.id).length}개</p>
    </article>)}</div>
    <div className="forms-page-question-map"><h3>질문 배치</h3>{content.questions.map((question, index) => <label className="cs-label" key={question.id}>Q{index + 1} {question.label || "이름 없음"}
      <select className="cs-input" aria-label={`Q${index + 1} 페이지`} value={question.pageId ?? ""} disabled={disabled} onChange={event => {
        const next = structuredClone(content); next.questions[index] = { ...next.questions[index], pageId: event.target.value }; commit(next);
      }}>{pages.map((candidate, pageIndex) => <option key={candidate.id} value={candidate.id}>페이지 {pageIndex + 1}{candidate.title ? ` · ${candidate.title}` : ""}</option>)}</select>
    </label>)}</div>{error && <p role="alert">{error}</p>}
  </section>;
}

export function QuestionPageSettings({ content, question, index, disabled, onChange }: {
  content: FormContent; question: Question; index: number; disabled: boolean; onChange: (content: FormContent) => void;
}) {
  const [error, setError] = useState("");
  const pages = content.sections ?? [];
  if (!pages.length) return null;
  const commit = (next: FormContent) => {
    const message = issue(next);
    if (message) { setError(message); return; }
    setError(""); onChange(next);
  };
  const definitions = question.optionDefinitions ?? [];
  const branchable = ["객관식 답변", "드롭다운"].includes(question.type) && !question.condition;
  return <fieldset className="forms-question-page-settings"><legend>페이지 이동</legend>
    <p className="cs-muted">질문 배치는 위 페이지 설정에서 바꿀 수 있습니다. 객관식·드롭다운 보기는 기본 다음 단계를 덮어쓸 수 있습니다.</p>
    {choiceTypes.includes(question.type) && !branchable && <p className="cs-muted">보기별 이동은 조건 없이 항상 표시되는 객관식·드롭다운 질문에서만 사용할 수 있습니다.</p>}
    {branchable && definitions.map((option, optionIndex) => <label className="cs-label" key={option.id}>보기 {optionIndex + 1} · {option.label}
      <select className="cs-input" aria-label={`Q${index + 1} 보기 ${optionIndex + 1} 다음 단계`} disabled={disabled || option.isCustomValue}
        value={destinationValue(option.branchDestination)} onChange={event => {
          const destination = destinationFromValue(event.target.value), next = structuredClone(content);
          const target = next.questions.find(item => item.id === question.id)!;
          target.optionDefinitions = (target.optionDefinitions ?? []).map(item => {
            if (item.id !== option.id) return item;
            const copy = { ...item };
            if (destination) copy.branchDestination = destination; else delete copy.branchDestination;
            return copy;
          });
          commit(next);
        }}><option value="">페이지 기본 이동 사용</option>
        {pages.filter(page => page.id !== question.pageId).map(page => <option key={page.id} value={`page:${page.id}`}>페이지 {pages.indexOf(page) + 1}{page.title ? ` · ${page.title}` : ""}</option>)}
        <option value="consent">동의 단계</option><option value="submit">제출 단계</option><option value="ineligible">참여 대상 아님</option>
      </select>{option.isCustomValue && <span className="cs-muted">직접입력 보기에는 이동을 지정할 수 없습니다.</span>}</label>)}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
