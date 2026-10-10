"use client";
import { subjectQuestionTypeAllowed } from "@/contracts/subjects";
import { MarketingSettings } from "./MarketingSettings";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading, Panel, ActionButton } from "../shared";
import { useApplication } from "../ApplicationContext";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { formContentSchema } from "@/contracts/domains";
import type { FormRecord, FormContent, Question, TemplateRecord, TemplatePage } from "@/contracts/forms";
import Link from "next/link";
import { choiceTypes, matrixTypes, newTextMaxLength, questionTypes, validateQuestionDefinitions } from "@/contracts/questions";
import { QuestionOptions } from "./QuestionOptions";
import { QuestionSettings } from "./QuestionSettings";
import { useFormDraft } from "@/lib/use-form-draft";
import { DraftStatus } from "./DraftStatus";
import { VerificationSettings } from "./VerificationSettings";
import { FormLanguageSettings } from "./FormLanguageSettings";
import { QuestionMaterialsEditor } from "./QuestionMaterialsEditor";
import { QuestionImageEditor } from "./QuestionImageEditor";
import { QuestionPersonalInformationEditor } from "./QuestionPersonalInformationEditor";
import { hasResidentPersonalInformation } from "@/contracts/question-personal-information";
import { defaultInfoPatternId } from "@/contracts/question-patterns";
import { MAX_QUESTION_EXPLANATION_LENGTH } from "@/contracts/question-explanations";
import { customChoiceTypes } from "@/contracts/custom-choice";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
import { AuthorAssetProvider } from "./AuthorAssetProvider";
import { AuthorAssetUpload, discardUnusedAuthorUpload, type AuthorAssetEditContext } from "./AuthorAssetUpload";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { bodyImagePurposes, optionImageQuestionTypes, type AuthorAssetUploadInfo } from "@/contracts/author-assets";
import { richDocumentImages } from "@/contracts/rich-content";
import { RichDocumentEditor } from "./RichDocumentEditor";
import { FormPagesEditor, QuestionPageSettings } from "./FormPagesEditor";
import { FormNoticesEditor } from "./FormNoticesEditor";
import { datetimeLocalIso, datetimeLocalValue } from "@/contracts/form-collection-window";
import { defaultParticipationAccessPolicy } from "@/contracts/form-participation-access";
import { ParticipationPolicyFields } from "./ParticipationAccessSettings";

const newQuestion = (pageId?: string): Question => ({ id: crypto.randomUUID(), ...(pageId ? { pageId } : {}), type: "단문형 답변", label: "", required: true, infoPatternId: 1, textMaxLength: 100 });
function newContent(): FormContent {
  return { body: "", questions: [newQuestion()], formLanguage: "ko", verify: false, font: "14px", bold: false,
    consentRequired: true, consentPurpose: "", retentionDays: 365, maxResponses: 100,
    collectionOpenAt: null, collectionCloseAt: null, participationAccess: defaultParticipationAccessPolicy(), showSubmitNotice: true };
}
type TemplateEditorValue = { serviceId: string; title: string; category: string; description: string;
  thumbnailAssetId: string | null; content: FormContent };
const templateEditorStamp = (value: TemplateEditorValue) => JSON.stringify(value);
const templateRecordValue = (row: TemplateRecord): TemplateEditorValue => ({ serviceId: row.serviceId!, title: row.title,
  category: row.category, description: row.description, thumbnailAssetId: row.thumbnailAssetId, content: row.content });
function formContentAssetIds(content: FormContent): string[] {
  const ids = content.questions.flatMap(question => [
    ...(question.questionImageKey ? [question.questionImageKey] : []),
    ...(question.materialList ?? []).flatMap(item => item.materialType === "FILE" ? [item.fileKey] : []),
    ...(question.optionDefinitions ?? []).flatMap(option => option.optionImageKey ? [option.optionImageKey] : []),
  ]);
  const documents = [content.bodyRich, ...(content.sections ?? []).map(section => section.bodyRich),
    content.completionPage?.mode === "custom" ? content.completionPage.bodyRich : undefined,
    content.closedPage?.mode === "custom" ? content.closedPage.bodyRich : undefined];
  for (const document of documents) if (document) ids.push(...richDocumentImages(document).map(image => image.assetId));
  return ids;
}
function TemplateThumbnailEditor({ assetId, disabled, context, onChange }: { assetId: string | null; disabled: boolean;
  context: AuthorAssetEditContext; onChange: (id: string | null) => void }) {
  const { asset, loading } = useAuthorAsset(assetId);
  return <div className="forms-template-thumbnail-editor">
    {assetId && (asset ? <img src={asset.url} alt="현재 템플릿 대표 이미지" referrerPolicy="no-referrer" />
      : <p className="cs-muted" role="status">{loading ? "대표 이미지를 불러오는 중입니다." : "대표 이미지를 표시할 수 없습니다."}</p>)}
    <AuthorAssetUpload key={assetId ?? "empty"} purpose="FORM_CONTENT_IMAGE" label={assetId ? "대표 이미지 교체" : "대표 이미지 추가"}
      targetKey={assetId ?? "empty"} context={context} disabled={disabled} onComplete={upload => { onChange(upload.id); return true; }} />
    {assetId && <button type="button" className="cs-link" disabled={disabled} onClick={() => onChange(null)}>대표 이미지 제거</button>}
  </div>;
}
export function FormEditor({ path }: { path: string }) {
  const params = useSearchParams(), id = params.get("formId") ?? params.get("edit"), templateId = params.get("templateEdit"), app = useApplication();
  const result = useResource<FormRecord>(id ? "/forms/" + id : null);
  const template = useResource<TemplateRecord>(templateId && templateId !== "new" ? "/templates/" + templateId : null);
  const permissions = useResource<TemplatePage>(app.data ? "/templates?scope=public&pageSize=1" : null);
  if (params.has("template")) return <Panel><p>템플릿 목록에서 사용할 양식을 선택해주세요.</p><Link href="/form/template">템플릿 목록</Link></Panel>;
  if (template.error) return <Panel><p role="alert">{template.error.message}</p><ActionButton secondary onClick={template.reload}>템플릿 다시 불러오기</ActionButton></Panel>;
  if (result.error) return <Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>캐치폼 다시 불러오기</ActionButton></Panel>;
  if (permissions.error) return <Panel><p role="alert">{permissions.error.message}</p><ActionButton secondary onClick={permissions.reload}>서비스 권한 다시 불러오기</ActionButton></Panel>;
  if (result.loading || template.loading || permissions.loading || !app.data) return <Panel><p role="status">캐치폼을 불러오는 중입니다.</p></Panel>;
  const services = permissions.data?.permissions.targets ?? [];
  if (!services.length || (result.data && !(templateId !== null ? result.data.actions?.registerTemplate : result.data.actions?.edit)) || (template.data && !template.data.actions?.edit))
    return <Panel><p>현재 서비스의 캐치폼 또는 템플릿을 편집할 권한이 없습니다.</p></Panel>;
  return <Editor key={id ?? templateId ?? "new"} initial={result.data} initialTemplate={template.data} templateMode={templateId !== null} path={path} services={services} />;
}
function Editor({ initial, initialTemplate, templateMode, path, services }: { initial?: FormRecord; initialTemplate?: TemplateRecord; templateMode: boolean; path: string; services: { id: string; name: string }[] }) {
  const app = useApplication(), router = useRouter();
  const confirm = useConfirm();
  const editorRevision = useRef(0);
  const defaultService = services.find(service => service.id === app.data?.serviceId)?.id ?? services[0]?.id ?? "";
  const [seed] = useState(newContent), [savedTemplate, setSavedTemplate] = useState(initialTemplate);
  const [templateTitle, setTemplateTitle] = useState(initialTemplate?.title ?? initial?.title ?? ""), [category, setCategory] = useState(initialTemplate?.category ?? "일반");
  const [templateDescription, setTemplateDescription] = useState(initialTemplate?.description ?? "");
  const [templateThumbnailAssetId, setTemplateThumbnailAssetId] = useState<string | null>(initialTemplate?.thumbnailAssetId ?? null);
  const [templateContent, setTemplateContent] = useState<FormContent>(initialTemplate?.content ?? initial?.content ?? seed);
  const [templateServiceId, setTemplateServiceId] = useState(initialTemplate?.serviceId ?? initial?.serviceId ?? defaultService);
  const [templateBaseStamp, setTemplateBaseStamp] = useState(templateEditorStamp({ serviceId: initialTemplate?.serviceId ?? initial?.serviceId ?? defaultService,
    title: initialTemplate?.title ?? initial?.title ?? "", category: initialTemplate?.category ?? "일반",
    description: initialTemplate?.description ?? "", thumbnailAssetId: initialTemplate?.thumbnailAssetId ?? null,
    content: initialTemplate?.content ?? initial?.content ?? seed }));
  const draft = useFormDraft(initial, { serviceId: defaultService, title: "", content: seed }, !templateMode && initial?.status !== "archived");
  const saved = draft.record, title = templateMode ? templateTitle : draft.value.title, content = templateMode ? templateContent : draft.value.content;
  const serviceId = templateMode ? templateServiceId : draft.value.serviceId;
  const hasAnyAuthorAssets = formContentAssetIds(content).length > 0 || !!templateThumbnailAssetId;
  const setTitle = (value: string) => { editorRevision.current++; if (templateMode) setTemplateTitle(value); else draft.edit(current => ({ ...current, title: value })); };
  const setServiceId = (value: string) => {
    if (pendingUploads.current.size || uploadsRef.current.size || hasAnyAuthorAssets) { setError("서비스를 바꾸려면 이 화면에서 추가한 파일과 본문 이미지·첨부 자료·문항·보기 이미지를 먼저 정리해주세요."); return; }
    editorRevision.current++;
    if (templateMode) setTemplateServiceId(value); else draft.edit(current => ({ ...current, serviceId: value }));
  };
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [templateBusy, setTemplateBusy] = useState(false);
  const [templateConflict, setTemplateConflict] = useState(false);
  const busy = templateMode ? templateBusy : draft.saving;
  const pendingUploads = useRef(new Set<symbol>()), uploadsRef = useRef(new Map<string, AuthorAssetUploadInfo>()), editorMounted = useRef(true);
  const [uploadCount, setUploadCount] = useState(0), [uploads, setUploads] = useState<AuthorAssetUploadInfo[]>([]);
  const currentTemplateStamp = templateEditorStamp({ serviceId, title, category, description: templateDescription,
    thumbnailAssetId: templateThumbnailAssetId, content });
  const templateDirty = templateMode && currentTemplateStamp !== templateBaseStamp;
  useUnsavedChanges(uploadCount > 0 || templateDirty || templateBusy, uploadCount > 0
    ? "파일 업로드가 진행 중입니다. 완료 전에 나가면 문항에 연결되지 않을 수 있습니다."
    : templateBusy ? "템플릿 저장 결과를 확인하는 중입니다. 잠시 후 다시 시도해주세요."
      : "저장하지 않은 템플릿 변경 사항이 있습니다. 이 화면을 나가면 입력한 내용이 사라집니다.");
  useEffect(() => {
    editorMounted.current = true;
    const currentUploads = uploadsRef.current;
    return () => { editorMounted.current = false; for (const upload of currentUploads.values()) discardUnusedAuthorUpload(upload); };
  }, []);
  useEffect(() => {
    const referenced = new Set([...formContentAssetIds(content), ...(templateThumbnailAssetId ? [templateThumbnailAssetId] : [])]);
    let removed = false;
    for (const [key, upload] of uploadsRef.current) if (!referenced.has(key) && !(bodyImagePurposes as readonly string[]).includes(upload.purpose)) {
      discardUnusedAuthorUpload(upload); uploadsRef.current.delete(key); removed = true;
    }
    if (removed) setUploads([...uploadsRef.current.values()]);
  }, [content, templateThumbnailAssetId]);
  const pendingCreate = useRef<{ payload: string; key: string } | null>(null), templateSaveLock = useRef(false);
  const movingNext = useRef(false);
  useEffect(() => {
    if (!templateMode && !initial && saved && !movingNext.current && !draft.navigationTarget) router.replace(path + "?formId=" + saved.id);
  }, [draft.navigationTarget, initial, path, router, saved, templateMode]);
  const replaceContent = (next: FormContent) => { editorRevision.current++; if (templateMode) setTemplateContent(next); else draft.edit(current => ({ ...current, content: next })); };
  const update = (patch: Partial<FormContent>) => { editorRevision.current++; if (templateMode) setTemplateContent(current => ({ ...current, ...patch })); else draft.edit(current => ({ ...current, content: { ...current.content, ...patch } })); };
  const changeQuestion = (id: string, patch: Partial<Question>) => update({
    questions: content.questions.map(question => question.id === id ? { ...question, ...patch } : question),
  });
  async function save(next = false) {
    if (busy || pendingUploads.current.size || templateSaveLock.current || templateConflict) return;
    setError(""); setMessage("");
    if (!templateMode) {
      movingNext.current = next;
      const result = await draft.save(!draft.record);
      if (result && next) { router.push("/form/ai/recipient?formId=" + result.id); return; }
      movingNext.current = false;
      return;
    }
    if (!title.trim()) { setError("캐치폼 제목을 입력해주세요."); return; }
    if (!serviceId) { setError("서비스를 선택해주세요."); return; }
    const parsed = formContentSchema.safeParse(content);
    if (!parsed.success) { setError("질문과 선택 항목을 입력하고 설정 범위를 확인해주세요."); return; }
    try { validateQuestionDefinitions(parsed.data.questions, false, parsed.data.marketing ? [parsed.data.marketing.nameQuestionId, parsed.data.marketing.emailQuestionId, parsed.data.marketing.smsQuestionId, parsed.data.marketing.kakaoQuestionId].filter((id): id is string => !!id) : []); }
    catch (cause) { setError(errorText(cause)); return; }
    templateSaveLock.current = true; setTemplateBusy(true);
    try {
      if (templateMode) {
        const payload = JSON.stringify({ ...(savedTemplate ? { version: savedTemplate.version } : { serviceId }), title, category,
          description: templateDescription, thumbnailAssetId: templateThumbnailAssetId, content: parsed.data });
        if (pendingCreate.current?.payload !== payload) pendingCreate.current = { payload, key: crypto.randomUUID() };
        const result = await api<TemplateRecord>("/templates" + (savedTemplate ? "/" + savedTemplate.id : ""), {
          method: savedTemplate ? "PATCH" : "POST", body: payload, headers: { "Idempotency-Key": pendingCreate.current!.key },
        });
        const value = templateRecordValue(result);
        setTemplateTitle(value.title); setCategory(value.category); setTemplateDescription(value.description);
        setTemplateThumbnailAssetId(value.thumbnailAssetId); setTemplateContent(value.content); setTemplateServiceId(value.serviceId);
        setTemplateBaseStamp(templateEditorStamp(value)); pendingCreate.current = null; setTemplateConflict(false);
        setSavedTemplate(result); setMessage("템플릿을 저장했습니다.");
        if (next) router.push("/form/template?scope=company");
        else if (!savedTemplate) router.replace(path + "?templateEdit=" + result.id);
        return;
      }
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.code === "VERSION_CONFLICT") {
        setTemplateConflict(true); setMessage("이 화면의 입력은 유지했습니다. 최신본을 적용하려면 현재 입력 폐기를 확인해주세요.");
      }
    } finally { templateSaveLock.current = false; setTemplateBusy(false); }
  }
  async function applyLatestTemplate() {
    if (!savedTemplate || templateSaveLock.current) return;
    templateSaveLock.current = true; setTemplateBusy(true); setError("");
    try {
      const latest = await api<TemplateRecord>("/templates/" + savedTemplate.id);
      if (!await confirm({ title: "최신 템플릿 적용", message: "현재 화면에 유지된 입력을 폐기하고 서버의 최신 템플릿을 적용할까요?",
        confirmLabel: "입력 폐기하고 적용", cancelLabel: "현재 입력 유지" })) {
        setMessage("현재 입력을 유지했습니다."); return;
      }
      const value = templateRecordValue(latest); editorRevision.current++;
      setTemplateTitle(value.title); setCategory(value.category); setTemplateDescription(value.description);
      setTemplateThumbnailAssetId(value.thumbnailAssetId); setTemplateContent(value.content); setTemplateServiceId(value.serviceId);
      setTemplateBaseStamp(templateEditorStamp(value)); pendingCreate.current = null;
      setSavedTemplate(latest); setTemplateConflict(false); setMessage("서버의 최신 템플릿을 적용했습니다.");
    } catch (cause) { setError(errorText(cause)); }
    finally { templateSaveLock.current = false; setTemplateBusy(false); }
  }
  const disabled = (templateMode ? busy : !initial && (busy || !!saved)) || saved?.status === "archived" || savedTemplate?.scope === "public";
  const getSaveState = templateMode ? () => savedTemplate : draft.getSnapshot;
  const editorStamp = JSON.stringify({ content, title, category, templateDescription, templateThumbnailAssetId, serviceId });
  const latestEditor = useRef({ content, serviceId, disabled: !!disabled || busy, changeQuestion, getSaveState, editorStamp, application: app.data });
  useEffect(() => { latestEditor.current = { content, serviceId, disabled: !!disabled || busy, changeQuestion, getSaveState, editorStamp, application: app.data }; });
  const assetContext: AuthorAssetEditContext = {
    serviceId,
    capture: () => { const current = latestEditor.current; return { revision: editorRevision.current, serviceId: current.serviceId, stamp: current.editorStamp, saveState: current.getSaveState(), application: current.application }; },
    isCurrent: snapshot => {
      const current = latestEditor.current, original = snapshot as { revision: number; serviceId: string; stamp: string; saveState: unknown; application: unknown };
      return editorMounted.current && !current.disabled && original.revision === editorRevision.current && original.serviceId === current.serviceId && original.stamp === current.editorStamp
        && original.saveState === current.getSaveState() && original.application === current.application;
    },
    begin: () => {
      if (latestEditor.current.disabled || !latestEditor.current.serviceId) return undefined;
      const releaseSaving = templateMode ? () => {} : draft.pauseSaving();
      if (!releaseSaving) return undefined;
      const token = Symbol("author-upload"); pendingUploads.current.add(token); setUploadCount(pendingUploads.current.size);
      let released = false;
      return () => { if (released) return; released = true; pendingUploads.current.delete(token); releaseSaving();
        if (editorMounted.current) setUploadCount(pendingUploads.current.size); };
    },
    register: upload => { uploadsRef.current.set(upload.id, upload); setUploads([...uploadsRef.current.values()]); },
  };
  const assetScope = savedTemplate ? { kind: "template" as const, id: savedTemplate.id, version: savedTemplate.version }
    : saved ? { kind: "form" as const, id: saved.id, version: saved.version } : null;
  async function changeQuestionKind(question: Question, patch: Partial<Question>) {
    if (disabled || busy) return;
    if (content.questions.some(item => item.condition?.questionId === question.id)) {
      setError("연결된 질문의 표시 조건을 먼저 해제해주세요."); return;
    }
    const removeCustom = !!question.optionDefinitions?.some(option => option.isCustomValue) && !!patch.type && !customChoiceTypes.includes(patch.type);
    const removeImages = !!question.optionDefinitions?.some(option => option.optionImageKey) && !!patch.type && !optionImageQuestionTypes.includes(patch.type);
    if (removeCustom || removeImages) {
      const snapshot = JSON.stringify(content), originalService = serviceId, originalSaveState = getSaveState(), originalRevision = editorRevision.current;
      const details = [removeCustom ? "기타 직접입력 설정" : "", removeImages ? "답변별 이미지" : ""].filter(Boolean).join("과 ");
      if (!await confirm({ title: "답변 형식 변경", message: `이 형식에서는 다음 설정을 사용할 수 없습니다: ${details}. ${choiceTypes.includes(patch.type!) ? "일반 보기는 유지하고 해당 설정을 제거할까요?" : "보기 설정을 제거하고 변경할까요?"} 이전 게시본과 응답은 유지됩니다.`, confirmLabel: "설정 제거 후 변경" })) return;
      const current = latestEditor.current;
      if (current.disabled) return;
      if (editorRevision.current !== originalRevision || current.serviceId !== originalService || JSON.stringify(current.content) !== snapshot || current.getSaveState() !== originalSaveState) {
        setError("편집 내용이 변경되었습니다. 확인한 뒤 다시 시도해주세요."); return;
      }
      const definitions = choiceTypes.includes(patch.type!) ? (question.optionDefinitions ?? []).map(option => ({ ...option,
        ...(removeCustom ? { isCustomValue: false } : {}), ...(removeImages ? { optionImageKey: null } : {}) })) : [];
      current.changeQuestion(question.id, { ...patch, options: definitions.map(option => option.value), optionDefinitions: definitions });
    } else changeQuestion(question.id, patch);
    setError("");
  }
  return <AuthorAssetProvider scope={assetScope} enabled={hasAnyAuthorAssets} uploads={uploads}><PageHeading title={templateMode ? savedTemplate ? "템플릿 편집" : "템플릿 생성" : saved ? "캐치폼 편집" : "캐치폼 생성"}><p>개인정보 수집 목적과 응답 항목을 설정하세요.</p></PageHeading>
    <div className="forms-editor">
      {!templateMode && saved?.published && <p className="cs-note">수정한 내용은 초안으로 저장됩니다. 다시 게시하면 새 내용이 공개됩니다.</p>}
      {saved?.status === "archived" && <p role="alert">보관된 캐치폼입니다.</p>}
      <fieldset disabled={disabled} className="forms-editor-fieldset">
        <FormLanguageSettings content={content} disabled={!!disabled || busy} onChange={update} />
        {templateMode && <Panel><h2>템플릿 정보</h2>
          <label className="cs-label">템플릿 분류<input aria-label="템플릿 분류" className="cs-input" maxLength={80} value={category}
            onChange={event => { editorRevision.current++; setCategory(event.target.value); }} /></label>
          <label className="cs-label">템플릿 설명<textarea aria-label="템플릿 설명" className="cs-input" rows={4} maxLength={2000} value={templateDescription}
            onChange={event => { editorRevision.current++; setTemplateDescription(event.target.value); }} /></label>
          <small>{templateDescription.length} / 2000</small>
          <TemplateThumbnailEditor assetId={templateThumbnailAssetId} context={assetContext} disabled={!!disabled || busy}
            onChange={id => { editorRevision.current++; setTemplateThumbnailAssetId(id); }} />
          <p>같은 서비스에 접근 권한이 있는 구성원이 이 템플릿을 사용할 수 있습니다.</p></Panel>}
        <Panel><h2>서비스</h2><select className="cs-input" aria-label="캐치폼 서비스" disabled={!!saved || !!savedTemplate || uploadCount > 0 || uploads.length > 0 || hasAnyAuthorAssets || (!templateMode && draft.creationPending)} value={serviceId} onChange={event => setServiceId(event.target.value)}>
          <option value="">서비스를 선택해주세요</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
          {(uploadCount > 0 || uploads.length > 0 || hasAnyAuthorAssets) && <p className="cs-muted">본문 이미지나 첨부 자료·문항·보기 이미지가 있거나 이 화면에서 파일을 추가했으면 서비스를 변경할 수 없습니다. 업로드 이력은 undo를 위해 화면을 나갈 때까지 유지됩니다.</p>}
          {!templateMode && draft.creationPending && draft.phase === "error" && <p>생성 결과를 확인할 때까지 서비스 선택을 유지합니다. 제목과 본문은 계속 편집할 수 있습니다.</p>}</Panel>
        <Panel><h2>캐치폼 제목</h2><p>캐치폼의 상단과 링크 공유 시 노출됩니다.</p>
          <input className="cs-input" aria-label="캐치폼 제목" placeholder="제목을 입력하세요" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></Panel>
        <Panel><h2>캐치폼 본문</h2><p>본문 서식과 소유 이미지를 함께 저장합니다. 저장되는 평문은 이 문서에서 자동으로 계산됩니다.</p>
          <RichDocumentEditor label="캐치폼 본문" value={content.bodyRich} fallbackText={content.body} purpose="FORM_CONTENT_IMAGE"
            disabled={!!disabled || busy} context={assetContext} onChange={(bodyRich, body) => update({ body, bodyRich })} /></Panel>
        <Panel><FormPagesEditor content={content} disabled={!!disabled || busy} context={assetContext} getSaveState={getSaveState} onChange={replaceContent} /></Panel>
        <Panel><FormNoticesEditor content={content} disabled={!!disabled || busy} context={assetContext} onChange={replaceContent} /></Panel>
        <Panel><h2>본인인증 및 전자서명 설정</h2><p>답변 제출자의 본인인증·전자서명을 수집합니다.</p>
          <label><input type="radio" name="verify" checked={!!content.verify} disabled={!!content.formLanguage && content.formLanguage !== "ko"} onChange={() => update({ verify: true })} /> 예</label>　
          <label><input type="radio" name="verify" checked={!content.verify} onChange={() => update({ verify: false })} /> 아니요</label>
          {!!content.formLanguage && content.formLanguage !== "ko" && <p>본인인증 및 전자서명은 한국어로 설정된 캐치폼에서만 이용 가능합니다.</p>}
          {content.verify && <VerificationSettings key={serviceId} serviceId={serviceId} />}</Panel>
        {content.questions.map((question, index) => <Panel key={question.id}>
          <div className="forms-between"><select aria-label={`Q${index + 1} 답변 형식`} value={question.type} disabled={content.questions.some(item => item.condition?.questionId === question.id)} onChange={event => {
            const selectedType = event.target.value as Question["type"];
            const type = selectedType === "주소" && content.formLanguage && content.formLanguage !== "ko" ? "해외 주소" : selectedType;
            if (matrixTypes.includes(type) && question.catchFormPersonalInformationRequests?.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION")) {
              setError("행렬형으로 변경하려면 개인정보 분류를 먼저 제거하거나 개인정보 없음으로 수정해주세요."); return;
            }
            void changeQuestionKind(question, { type, infoPatternId: defaultInfoPatternId(type), textMaxLength: newTextMaxLength(type), ...(!question.subjectRole || !subjectQuestionTypeAllowed(question.subjectRole, type) ? { subjectRole: undefined } : {}),
              rows: matrixTypes.includes(type) ? question.rows ?? [{ id: crypto.randomUUID(), label: "행 1" }] : undefined,
              selectionLimits: ["체크박스", "행렬형 복수 선택"].includes(type) ? question.selectionLimits : undefined,
              options: choiceTypes.includes(type) ? question.options ?? [] : undefined,
              optionDefinitions: choiceTypes.includes(type) ? question.optionDefinitions ?? [] : undefined });
          }}>
            {questionTypes.map(type => <option key={type} disabled={matrixTypes.includes(type) && question.catchFormPersonalInformationRequests?.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION")}>{type}</option>)}</select>
            <label><input type="checkbox" aria-label={`Q${index + 1} 필수항목`} checked={question.required} disabled={!!question.subjectRole || hasResidentPersonalInformation(question.catchFormPersonalInformationRequests)} onChange={event => {
              if (!event.target.checked && hasResidentPersonalInformation(question.catchFormPersonalInformationRequests)) return;
              changeQuestion(question.id, { required: event.target.checked });
            }} /> 필수항목</label>
            <button type="button" aria-label={`Q${index + 1} 위로 이동`} disabled={index === 0} onClick={() => {
              const items = [...content.questions]; [items[index - 1], items[index]] = [items[index], items[index - 1]];
              try { validateQuestionDefinitions(items); update({ questions: items }); }
              catch (cause) { setError(errorText(cause)); }
            }}>위로</button>
            <button type="button" aria-label={`Q${index + 1} 삭제`} disabled={content.questions.some(item => item.condition?.questionId === question.id)} onClick={() => update({ questions: content.questions.filter(item => item.id !== question.id) })}>삭제</button></div>
          <h2>Q{index + 1}</h2><textarea className="cs-input" aria-label={`Q${index + 1} 질문`} value={question.label} maxLength={3000} onChange={event => changeQuestion(question.id, { label: event.target.value })} />
          <QuestionImageEditor question={question} index={index} disabled={!!disabled || busy} context={assetContext} onChange={questionImageKey => changeQuestion(question.id, { questionImageKey })} />
          <QuestionPersonalInformationEditor question={question} index={index} disabled={!!disabled || busy} onChange={(items, required) => changeQuestion(question.id, { catchFormPersonalInformationRequests: items, required })} />
          {hasResidentPersonalInformation(question.catchFormPersonalInformationRequests) && <p className="cs-muted">주민등록번호 분류가 있는 문항은 필수항목을 해제할 수 없습니다.</p>}
          {question.catchFormPersonalInformationRequests?.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION") && <p className="cs-muted">행렬형으로 변경하려면 개인정보 분류를 먼저 제거하거나 개인정보 없음으로 수정해주세요.</p>}
          <QuestionMaterialsEditor question={question} index={index} disabled={!!disabled || busy} context={assetContext} onChange={materialList => changeQuestion(question.id, { materialList })} />
          <div className="forms-explanation-editor"><label className="cs-label">추가 설명
            <textarea className="cs-input" aria-label={`Q${index + 1} 추가 설명`} rows={3} maxLength={MAX_QUESTION_EXPLANATION_LENGTH}
              value={question.additionalExplanation ?? ""} onChange={event => changeQuestion(question.id, { additionalExplanation: event.target.value })} />
          </label><div className="forms-between"><small>{(question.additionalExplanation ?? "").length} / {MAX_QUESTION_EXPLANATION_LENGTH}</small>
            <button type="button" className="cs-link" aria-label={`Q${index + 1} 추가 설명 제거`} disabled={!question.additionalExplanation}
              onClick={() => changeQuestion(question.id, { additionalExplanation: "" })}>설명 제거</button></div></div>
          {choiceTypes.includes(question.type) && <QuestionOptions question={question} index={index} questions={content.questions} disabled={!!disabled || busy} getSaveState={getSaveState} assetContext={assetContext} change={patch => changeQuestion(question.id, patch)} />}
          <QuestionPageSettings content={content} question={question} index={index} disabled={!!disabled || busy} onChange={replaceContent} />
          <QuestionSettings question={question} previous={content.questions.slice(0, index)} change={patch => changeQuestion(question.id, patch)}
            alwaysVisible={!!content.marketing && [content.marketing.nameQuestionId, content.marketing.emailQuestionId, content.marketing.smsQuestionId, content.marketing.kakaoQuestionId].includes(question.id)} />
          {content.questions.some(item => item.condition?.questionId === question.id) && <p className="cs-muted">분기에 연결된 질문입니다. 형식 변경·삭제는 연결한 질문의 표시 조건을 해제한 뒤 가능합니다.</p>}
          <label className="cs-label">정보주체 조회 항목<select aria-label={`Q${index + 1} 정보주체 항목`} disabled={!!question.condition || content.questions.some(item => item.condition?.questionId === question.id)} value={question.subjectRole ?? ""} onChange={event => {
            if (!event.target.value) { changeQuestion(question.id, { subjectRole: undefined }); return; }
            void changeQuestionKind(question, { subjectRole: event.target.value as "name" | "email", infoPatternId: 1,
              textMaxLength: subjectQuestionTypeAllowed(event.target.value, question.type) ? question.textMaxLength : 100,
              type: subjectQuestionTypeAllowed(event.target.value, question.type) ? question.type : "단문형 답변", required: true, rows: undefined, selectionLimits: undefined, options: undefined, optionDefinitions: undefined });
          }}><option value="">지정하지 않음</option><option value="name">정보주체 이름</option><option value="email">정보주체 이메일</option></select></label>
          {question.subjectRole && <p className="forms-muted">이름과 이메일을 각각 하나씩 지정하면 응답자가 이메일 인증 후 자신의 동의 이력을 조회할 수 있습니다.</p>}
          <div className="forms-count">{question.label.length} / 3000</div></Panel>)}
        <MarketingSettings content={content} onChange={update} />
        {templateMode && <Panel><h2>동의 및 응답 설정</h2><div className="cs-stack">
          <label><input type="checkbox" checked={content.consentRequired} onChange={event => update({ consentRequired: event.target.checked })} />개인정보 수집·이용 동의 필수</label>
          <label className="cs-label">수집·이용 목적<textarea className="cs-input" aria-label="수집·이용 목적" maxLength={3000} value={content.consentPurpose} onChange={event => update({ consentPurpose: event.target.value })} /></label>
          <label className="member-check"><input type="checkbox" checked={content.retentionDays === null} onChange={event => update({ retentionDays: event.target.checked ? null : 365 })} />보유 기간 미지정 (제출 시점의 서비스 규칙 또는 회사 기본 보유 기간 적용)</label>
          {content.retentionDays !== null && <label className="cs-label">보유 기간 (일)<input className="cs-input" aria-label="보유 기간" type="number" min={1} max={36500} value={content.retentionDays} onChange={event => update({ retentionDays: Number(event.target.value) })} /></label>}
          <label className="cs-label">최대 응답 수<input className="cs-input" aria-label="최대 응답 수" type="number" min={1} max={1000000} value={content.maxResponses} onChange={event => update({ maxResponses: Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={!!content.collectionOpenAt} onChange={event => update({ collectionOpenAt: event.target.checked
            ? new Date(Math.ceil((Date.now() + 3_600_000) / 3_600_000) * 3_600_000).toISOString() : null })} />응답 수집 시작 일시 예약</label>
          {!!content.collectionOpenAt && <label className="cs-label">응답 수집 시작 일시<input className="cs-input" aria-label="응답 수집 시작 일시" type="datetime-local"
            min={datetimeLocalValue(new Date().toISOString())} value={datetimeLocalValue(content.collectionOpenAt)} onChange={event => update({ collectionOpenAt: datetimeLocalIso(event.target.value) })} /></label>}
          <label><input type="checkbox" checked={!!content.collectionCloseAt} onChange={event => update({ collectionCloseAt: event.target.checked
            ? new Date(Math.max(Date.now(), content.collectionOpenAt ? new Date(content.collectionOpenAt).getTime() : 0) + 7 * 86_400_000).toISOString() : null })} />응답 수집 종료 일시 예약</label>
          {!!content.collectionCloseAt && <label className="cs-label">응답 수집 종료 일시<input className="cs-input" aria-label="응답 수집 종료 일시" type="datetime-local"
            min={content.collectionOpenAt ? datetimeLocalValue(new Date(new Date(content.collectionOpenAt).getTime() + 60_000).toISOString()) : undefined}
            value={datetimeLocalValue(content.collectionCloseAt)} onChange={event => update({ collectionCloseAt: datetimeLocalIso(event.target.value) })} /></label>}
          <ParticipationPolicyFields content={content} onChange={update} />
          <label><input type="checkbox" checked={!!content.showSubmitNotice} onChange={event => update({ showSubmitNotice: event.target.checked })} />제출 완료 안내 표시</label>
        </div></Panel>}
        <button type="button" className="forms-add" disabled={content.questions.length >= 100} onClick={() => update({ questions: [...content.questions, newQuestion(content.sections?.at(-1)?.id)] })}>+ 항목 추가하기</button>
      </fieldset>
      {uploadCount > 0 && <p role="status">파일 업로드 {uploadCount}건이 끝나면 저장을 다시 시작합니다.</p>}
      {error && <p role="alert">{error}</p>}<p role="status">{message}</p>{!templateMode && <DraftStatus draft={draft} />}
      {templateMode && templateConflict && <div className="cs-note"><p>다른 화면에서 템플릿이 변경되었습니다. 현재 입력은 이 화면에 그대로 남아 있습니다.</p>
        <ActionButton type="button" secondary disabled={templateBusy} onClick={applyLatestTemplate}>입력 폐기 후 최신본 적용</ActionButton></div>}
      <div className="forms-editor-actions"><ActionButton secondary disabled={disabled || busy || uploadCount > 0 || templateConflict} onClick={() => save()}>{templateMode ? "템플릿 저장" : "임시저장"}</ActionButton>
        <ActionButton disabled={disabled || busy || uploadCount > 0 || templateConflict} onClick={() => save(true)}>{busy ? "저장 중…" : templateMode ? "저장 후 목록" : "다음으로"}</ActionButton></div>
    </div></AuthorAssetProvider>;
}
