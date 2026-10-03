"use client";
import { MarketingSettings } from "./MarketingSettings";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton } from "../shared";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import { formContentSchema } from "@/contracts/domains";
import type { FormRecord, FormContent, Question, TemplateRecord, TemplatePage } from "@/contracts/forms";
import Link from "next/link";
import { choiceTypes, matrixTypes, questionTypes, validateQuestionDefinitions } from "@/contracts/questions";
import { QuestionSettings } from "./QuestionSettings";
import { useFormDraft } from "@/lib/use-form-draft";
import { DraftStatus } from "./DraftStatus";
import { VerificationSettings } from "./VerificationSettings";

const newQuestion = (): Question => ({ id: crypto.randomUUID(), type: "단문형 답변", label: "", required: true });
function newContent(): FormContent {
  return { body: "", questions: [newQuestion()], verify: false, font: "14px", bold: false,
    consentRequired: true, consentPurpose: "", retentionDays: 365, maxResponses: 100, showSubmitNotice: true };
}
export function FormEditor({ path }: { path: string }) {
  const params = useSearchParams(), id = params.get("formId") ?? params.get("edit"), templateId = params.get("templateEdit"), app = useApplication();
  const result = useResource<FormRecord>(id ? "/forms/" + id : null);
  const template = useResource<TemplateRecord>(templateId && templateId !== "new" ? "/templates/" + templateId : null);
  const permissions = useResource<TemplatePage>(app.data ? "/templates?scope=public&pageSize=1" : null);
  if (params.has("template")) return <Panel><p>템플릿 목록에서 사용할 양식을 선택해주세요.</p><Link href="/form/template">템플릿 목록</Link></Panel>;
  if (template.error) return <Panel><p role="alert">{template.error.message}</p></Panel>;
  if (result.error) return <Panel><p role="alert">{result.error.message}</p></Panel>;
  if (permissions.error) return <Panel><p role="alert">{permissions.error.message}</p></Panel>;
  if (result.loading || template.loading || permissions.loading || !app.data) return <Panel><p role="status">캐치폼을 불러오는 중입니다.</p></Panel>;
  const services = permissions.data?.permissions.targets ?? [];
  if (!services.length || (result.data && !(templateId !== null ? result.data.actions?.registerTemplate : result.data.actions?.edit)) || (template.data && !template.data.actions?.edit))
    return <Panel><p>현재 서비스의 캐치폼 또는 템플릿을 편집할 권한이 없습니다.</p></Panel>;
  return <Editor key={id ?? templateId ?? "new"} initial={result.data} initialTemplate={template.data} templateMode={templateId !== null} path={path} services={services} />;
}
function Editor({ initial, initialTemplate, templateMode, path, services }: { initial?: FormRecord; initialTemplate?: TemplateRecord; templateMode: boolean; path: string; services: { id: string; name: string }[] }) {
  const app = useApplication(), router = useRouter();
  const defaultService = services.find(service => service.id === app.data?.serviceId)?.id ?? services[0]?.id ?? "";
  const [seed] = useState(newContent), [savedTemplate, setSavedTemplate] = useState(initialTemplate);
  const [templateTitle, setTemplateTitle] = useState(initialTemplate?.title ?? initial?.title ?? ""), [category, setCategory] = useState(initialTemplate?.category ?? "일반");
  const [templateContent, setTemplateContent] = useState<FormContent>(initialTemplate?.content ?? initial?.content ?? seed);
  const [templateServiceId, setTemplateServiceId] = useState(initialTemplate?.serviceId ?? initial?.serviceId ?? defaultService);
  const draft = useFormDraft(initial, { serviceId: defaultService, title: "", content: seed }, !templateMode && initial?.status !== "archived");
  const saved = draft.record, title = templateMode ? templateTitle : draft.value.title, content = templateMode ? templateContent : draft.value.content;
  const serviceId = templateMode ? templateServiceId : draft.value.serviceId;
  const setTitle = (value: string) => templateMode ? setTemplateTitle(value) : draft.edit(current => ({ ...current, title: value }));
  const setServiceId = (value: string) => templateMode ? setTemplateServiceId(value) : draft.edit(current => ({ ...current, serviceId: value }));
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [templateBusy, setTemplateBusy] = useState(false);
  const busy = templateMode ? templateBusy : draft.saving;
  const pendingCreate = useRef<{ payload: string; key: string } | null>(null);
  const movingNext = useRef(false);
  useEffect(() => {
    if (!templateMode && !initial && saved && !movingNext.current && !draft.navigationTarget) router.replace(path + "?formId=" + saved.id);
  }, [draft.navigationTarget, initial, path, router, saved, templateMode]);
  const update = (patch: Partial<FormContent>) => templateMode ? setTemplateContent(current => ({ ...current, ...patch })) : draft.edit(current => ({ ...current, content: { ...current.content, ...patch } }));
  const changeQuestion = (id: string, patch: Partial<Question>) => update({
    questions: content.questions.map(question => question.id === id ? { ...question, ...patch } : question),
  });
  async function save(next = false) {
    if (busy) return;
    setError(""); setMessage("");
    if (!templateMode) {
      movingNext.current = next;
      const result = await draft.save();
      if (result && next) { router.push("/form/ai/recipient?formId=" + result.id); return; }
      movingNext.current = false;
      return;
    }
    if (!title.trim()) { setError("캐치폼 제목을 입력해주세요."); return; }
    if (!serviceId) { setError("서비스를 선택해주세요."); return; }
    const parsed = formContentSchema.safeParse(content);
    if (!parsed.success) { setError("질문과 선택 항목을 입력하고 설정 범위를 확인해주세요."); return; }
    try { validateQuestionDefinitions(parsed.data.questions, false, parsed.data.marketing ? [parsed.data.marketing.nameQuestionId, parsed.data.marketing.emailQuestionId, parsed.data.marketing.smsQuestionId].filter((id): id is string => !!id) : []); }
    catch (cause) { setError(errorText(cause)); return; }
    setTemplateBusy(true);
    try {
      if (templateMode) {
        const payload = JSON.stringify({ ...(savedTemplate ? { version: savedTemplate.version } : { serviceId }), title, category, content: parsed.data });
        if (pendingCreate.current?.payload !== payload) pendingCreate.current = { payload, key: crypto.randomUUID() };
        const result = await api<TemplateRecord>("/templates" + (savedTemplate ? "/" + savedTemplate.id : ""), {
          method: savedTemplate ? "PATCH" : "POST", body: payload, headers: { "Idempotency-Key": pendingCreate.current!.key },
        });
        setSavedTemplate(result); setMessage("템플릿을 저장했습니다.");
        if (next) router.push("/form/template?scope=company");
        else if (!savedTemplate) router.replace(path + "?templateEdit=" + result.id);
        return;
      }
    } catch (cause) { setError(errorText(cause)); } finally { setTemplateBusy(false); }
  }
  const disabled = (templateMode ? busy : !initial && (busy || !!saved)) || saved?.status === "archived" || savedTemplate?.scope === "public";
  return <><PageHeading title={templateMode ? savedTemplate ? "템플릿 편집" : "템플릿 생성" : saved ? "캐치폼 편집" : "캐치폼 생성"}><p>개인정보 수집 목적과 응답 항목을 설정하세요.</p></PageHeading>
    <div className="forms-editor">
      {!templateMode && saved?.published && <p className="cs-note">수정한 내용은 초안으로 저장됩니다. 다시 게시하면 새 내용이 공개됩니다.</p>}
      {saved?.status === "archived" && <p role="alert">보관된 캐치폼입니다.</p>}
      <fieldset disabled={disabled} className="forms-editor-fieldset">
        {templateMode && <Panel><h2>템플릿 분류</h2><input aria-label="템플릿 분류" className="cs-input" maxLength={80} value={category} onChange={event => setCategory(event.target.value)} /><p>같은 서비스에 접근 권한이 있는 구성원이 이 템플릿을 사용할 수 있습니다.</p></Panel>}
        <Panel><h2>서비스</h2><select className="cs-input" aria-label="캐치폼 서비스" disabled={!!saved || !!savedTemplate || (!templateMode && draft.creationPending)} value={serviceId} onChange={event => setServiceId(event.target.value)}>
          <option value="">서비스를 선택해주세요</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
          {!templateMode && draft.creationPending && draft.phase === "error" && <p>생성 결과를 확인할 때까지 서비스 선택을 유지합니다. 제목과 본문은 계속 편집할 수 있습니다.</p>}</Panel>
        <Panel><h2>캐치폼 제목</h2><p>캐치폼의 상단과 링크 공유 시 노출됩니다.</p>
          <input className="cs-input" aria-label="캐치폼 제목" placeholder="제목을 입력하세요" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></Panel>
        <Panel><h2>캐치폼 본문</h2><p>캐치폼의 본문 내용을 편집할 수 있습니다.</p>
          <div className="forms-toolbar"><button type="button" aria-label="굵게" aria-pressed={content.bold} onClick={() => update({ bold: !content.bold })}><b>B</b></button>
            <select aria-label="폰트 크기" value={content.font} onChange={event => update({ font: event.target.value as FormContent["font"] })}>
              {[12, 14, 15, 16, 20, 24, 32].map(size => <option key={size}>{size}px</option>)}</select></div>
          <textarea aria-label="캐치폼 본문" className="forms-richtext" maxLength={20000} value={content.body} onChange={event => update({ body: event.target.value })}
            style={{ fontSize: content.font, fontWeight: content.bold ? 700 : 400 }} /></Panel>
        <Panel><h2>본인인증 및 전자서명 설정</h2><p>답변 제출자의 본인인증·전자서명을 수집합니다.</p>
          <label><input type="radio" name="verify" checked={!!content.verify} onChange={() => update({ verify: true })} /> 예</label>　
          <label><input type="radio" name="verify" checked={!content.verify} onChange={() => update({ verify: false })} /> 아니요</label>
          {content.verify && <VerificationSettings key={serviceId} serviceId={serviceId} />}</Panel>
        {content.questions.map((question, index) => <Panel key={question.id}>
          <div className="forms-between"><select aria-label={`Q${index + 1} 답변 형식`} value={question.type} disabled={content.questions.some(item => item.condition?.questionId === question.id)} onChange={event => {
            const type = event.target.value as Question["type"];
            changeQuestion(question.id, { type, ...(type !== "단문형 답변" ? { subjectRole: undefined } : {}),
              rows: matrixTypes.includes(type) ? question.rows ?? [{ id: crypto.randomUUID(), label: "행 1" }] : undefined,
              selectionLimits: ["체크박스", "행렬형 복수 선택"].includes(type) ? question.selectionLimits : undefined,
              options: choiceTypes.includes(type) ? question.options ?? [] : undefined });
          }}>
            {questionTypes.map(type => <option key={type}>{type}</option>)}</select>
            <label><input type="checkbox" checked={question.required} disabled={!!question.subjectRole} onChange={event => changeQuestion(question.id, { required: event.target.checked })} /> 필수항목</label>
            <button type="button" aria-label={`Q${index + 1} 위로 이동`} disabled={index === 0} onClick={() => {
              const items = [...content.questions]; [items[index - 1], items[index]] = [items[index], items[index - 1]];
              try { validateQuestionDefinitions(items); update({ questions: items }); }
              catch (cause) { setError(errorText(cause)); }
            }}>위로</button>
            <button type="button" aria-label={`Q${index + 1} 삭제`} disabled={content.questions.some(item => item.condition?.questionId === question.id)} onClick={() => update({ questions: content.questions.filter(item => item.id !== question.id) })}>삭제</button></div>
          <h2>Q{index + 1}</h2><textarea className="cs-input" aria-label={`Q${index + 1} 질문`} value={question.label} maxLength={3000} onChange={event => changeQuestion(question.id, { label: event.target.value })} />
          {choiceTypes.includes(question.type) && <label className="forms-options">선택 항목 (한 줄에 하나씩)
            <textarea className="cs-input" aria-label={`Q${index + 1} 선택 항목`} value={(question.options ?? []).join("\n")} onChange={event => changeQuestion(question.id, { options: event.target.value.split("\n") })} /></label>}
          <QuestionSettings question={question} previous={content.questions.slice(0, index)} change={patch => changeQuestion(question.id, patch)}
            alwaysVisible={!!content.marketing && [content.marketing.nameQuestionId, content.marketing.emailQuestionId, content.marketing.smsQuestionId].includes(question.id)} />
          {content.questions.some(item => item.condition?.questionId === question.id) && <p className="cs-muted">분기에 연결된 질문입니다. 형식 변경·삭제는 연결한 질문의 표시 조건을 해제한 뒤 가능합니다.</p>}
          <label className="cs-label">정보주체 조회 항목<select aria-label={`Q${index + 1} 정보주체 항목`} disabled={!!question.condition} value={question.subjectRole ?? ""} onChange={event => changeQuestion(question.id, event.target.value ? { subjectRole: event.target.value as "name" | "email", type: "단문형 답변", required: true, rows: undefined, selectionLimits: undefined, options: undefined } : { subjectRole: undefined })}><option value="">지정하지 않음</option><option value="name">정보주체 이름</option><option value="email">정보주체 이메일</option></select></label>
          {question.subjectRole && <p className="forms-muted">이름과 이메일을 각각 하나씩 지정하면 응답자가 이메일 인증 후 자신의 동의 이력을 조회할 수 있습니다.</p>}
          <div className="forms-count">{question.label.length} / 3000</div></Panel>)}
        <MarketingSettings content={content} onChange={update} />
        {templateMode && <Panel><h2>동의 및 응답 설정</h2><div className="cs-stack">
          <label><input type="checkbox" checked={content.consentRequired} onChange={event => update({ consentRequired: event.target.checked })} />개인정보 수집·이용 동의 필수</label>
          <label className="cs-label">수집·이용 목적<textarea className="cs-input" aria-label="수집·이용 목적" maxLength={3000} value={content.consentPurpose} onChange={event => update({ consentPurpose: event.target.value })} /></label>
          <label className="cs-label">보유 기간 (일)<input className="cs-input" aria-label="보유 기간" type="number" min={1} max={36500} value={content.retentionDays} onChange={event => update({ retentionDays: Number(event.target.value) })} /></label>
          <label className="cs-label">최대 응답 수<input className="cs-input" aria-label="최대 응답 수" type="number" min={1} max={1000000} value={content.maxResponses} onChange={event => update({ maxResponses: Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={!!content.showSubmitNotice} onChange={event => update({ showSubmitNotice: event.target.checked })} />제출 완료 안내 표시</label>
        </div></Panel>}
        <button type="button" className="forms-add" disabled={content.questions.length >= 100} onClick={() => update({ questions: [...content.questions, newQuestion()] })}>+ 항목 추가하기</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}<p role="status">{message}</p>{!templateMode && <DraftStatus draft={draft} />}
      <div className="forms-editor-actions"><ActionButton secondary disabled={disabled || busy} onClick={() => save()}>{templateMode ? "템플릿 저장" : "임시저장"}</ActionButton>
        <ActionButton disabled={disabled || busy} onClick={() => save(true)}>{busy ? "저장 중…" : templateMode ? "저장 후 목록" : "다음으로"}</ActionButton></div>
    </div></>;
}
