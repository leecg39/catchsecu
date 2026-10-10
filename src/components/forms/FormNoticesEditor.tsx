"use client";

import type { FormContent } from "@/contracts/forms";
import { plainTextRichDocument } from "@/contracts/rich-content";
import type { AuthorAssetEditContext } from "./AuthorAssetUpload";
import { RichDocumentEditor } from "./RichDocumentEditor";

type NoticeKey = "completionPage" | "closedPage";

const noticeMeta = {
  completionPage: {
    title: "제출 완료 안내",
    description: "정상적으로 제출된 응답에만 이 게시본의 완료 안내를 표시합니다.",
    label: "제출 완료 안내 본문",
    purpose: "END_PAGE_CONTENT_IMAGE" as const,
  },
  closedPage: {
    title: "접수 마감 안내",
    description: "일시 중지, 접수 기간 종료 또는 응답 한도 도달 시 이 게시본의 마감 안내만 표시합니다.",
    label: "접수 마감 안내 본문",
    purpose: "PRIVATE_PAGE_CONTENT_IMAGE" as const,
  },
};

function NoticeEditor({ kind, content, disabled, context, onChange }: {
  kind: NoticeKey;
  content: FormContent;
  disabled: boolean;
  context: AuthorAssetEditContext;
  onChange: (content: FormContent) => void;
}) {
  const meta = noticeMeta[kind], notice = content[kind], mode = notice?.mode ?? "default";
  function changeMode(nextMode: "default" | "custom") {
    const next = structuredClone(content);
    next[kind] = nextMode === "default" ? { mode: "default" } : {
      mode: "custom", body: "", bodyRich: plainTextRichDocument(""),
    };
    onChange(next);
  }
  return <article className="forms-notice-card"><div><h3>{meta.title}</h3><p>{meta.description}</p></div>
    <label className="cs-label">표시 방식<select className="cs-input" aria-label={`${meta.title} 표시 방식`} value={mode} disabled={disabled}
      onChange={event => changeMode(event.target.value as "default" | "custom")}>
      <option value="default">기본 안내 사용</option><option value="custom">직접 작성</option>
    </select></label>
    {mode === "custom" && <RichDocumentEditor label={meta.label} value={notice?.mode === "custom" ? notice.bodyRich : undefined}
      fallbackText={notice?.mode === "custom" ? notice.body : ""} purpose={meta.purpose} disabled={disabled} context={context}
      onChange={(bodyRich, body) => {
        const next = structuredClone(content); next[kind] = { mode: "custom", body, bodyRich }; onChange(next);
      }} />}
  </article>;
}

export function FormNoticesEditor({ content, disabled, context, onChange }: {
  content: FormContent;
  disabled: boolean;
  context: AuthorAssetEditContext;
  onChange: (content: FormContent) => void;
}) {
  return <section className="forms-notices-editor"><div><h2>완료 및 마감 화면</h2>
    <p>안내는 현재 초안과 함께 저장됩니다. 다시 게시한 뒤부터 새 공개 링크 상태에 적용됩니다.</p></div>
    <NoticeEditor kind="completionPage" content={content} disabled={disabled} context={context} onChange={onChange} />
    <NoticeEditor kind="closedPage" content={content} disabled={disabled} context={context} onChange={onChange} />
  </section>;
}
