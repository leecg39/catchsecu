"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { kakaoTemplatePatch, kakaoVariables, type KakaoTemplateRecord } from "@/contracts/kakao";
import "./KakaoTemplateDetail.css";

const statuses: Record<KakaoTemplateRecord["status"], string> = { draft: "초안", submitted: "심사 중", rejected: "반려", approved: "승인", archived: "보관" };
type Draft = Pick<KakaoTemplateRecord, "name" | "body" | "buttons">;
const draftOf = (row: KakaoTemplateRecord): Draft => ({ name: row.name, body: row.body, buttons: structuredClone(row.buttons) });
const stamp = (value: Draft) => JSON.stringify(value);
export function KakaoTemplateDetail({ id, edit = false }: { id: string; edit?: boolean }) {
  const app = useApplication();
  if (!z.uuid().safeParse(id).success) return <Panel><p role="alert">템플릿 주소를 확인해주세요.</p></Panel>;
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("message.manage")) return <Panel><p role="alert">알림톡 템플릿을 관리할 권한이 없습니다.</p></Panel>;
  return <TemplateResource key={id + edit} id={id} edit={edit} />;
}
function TemplateResource({ id, edit }: { id: string; edit: boolean }) {
  const result = useResource<KakaoTemplateRecord>("/kakao/templates/" + id);
  if (result.error) return <Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 시도</ActionButton><Link href="/alimtalk/templates">템플릿 목록</Link></Panel>;
  if (!result.data) return <Panel><p role="status">템플릿을 불러오는 중입니다.</p></Panel>;
  return <TemplateContent initial={result.data} edit={edit} />;
}
function TemplateContent({ initial, edit }: { initial: KakaoTemplateRecord; edit: boolean }) {
  const router = useRouter();
  const [row, setRow] = useState(initial), [draft, setDraft] = useState(() => draftOf(initial));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false), [refreshWarning, setRefreshWarning] = useState(false), [navigation, setNavigation] = useState("");
  const [removeWarning, setRemoveWarning] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({}), [preview, setPreview] = useState("");
  const running = useRef(false);
  const dirty = edit && stamp(draft) !== stamp(draftOf(row));
  const editable = edit && row.status !== "archived" && row.status !== "submitted";
  const names = [...new Set(kakaoVariables(edit ? draft.body : row.body))];
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.download || anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href); if (url.origin !== location.origin) return;
      event.preventDefault(); event.stopPropagation(); setNavigation(url.pathname + url.search + url.hash);
    };
    addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  function change(patch: Partial<Draft>) { setDraft(previous => ({ ...previous, ...patch })); setPreview(""); setNotice(""); }
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (cause) { setError(errorText(cause)); if (cause instanceof ApiError && cause.status === 409) setConflict(true); }
    finally { running.current = false; setBusy(false); }
  }
  function accept(saved: KakaoTemplateRecord) { setRow(saved); setDraft(draftOf(saved)); setConflict(false); setRefreshWarning(false); setPreview(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editable || conflict) return;
    await run(async () => {
      const checked = kakaoTemplatePatch.safeParse({ ...draft, version: row.version });
      if (!checked.success) throw new Error(checked.error.issues.map(issue => issue.message).join(" "));
      accept(await api<KakaoTemplateRecord>("/kakao/templates/" + row.id, { method: "PATCH", body: JSON.stringify(checked.data) }));
      setNotice("템플릿 초안을 저장했습니다. 발송하려면 다시 심사를 요청해주세요.");
    });
  }
  async function refresh(discard = false) {
    if (dirty && !discard) { setRefreshWarning(true); return; }
    await run(async () => { accept(await api<KakaoTemplateRecord>("/kakao/templates/" + row.id)); setNotice("최신 템플릿을 불러왔습니다."); });
  }
  async function requestReview() {
    if (dirty || !["draft", "rejected"].includes(row.status) || conflict) return;
    await run(async () => {
      accept(await api<KakaoTemplateRecord>("/kakao/templates/" + row.id + "/submit", { method: "POST", body: JSON.stringify({ version: row.version }) }));
      setNotice("심사 요청 결과를 반영했습니다.");
    });
  }
  async function showPreview() {
    await run(async () => {
      const result = await api<{ text: string }>("/kakao/templates/preview", { method: "POST", body: JSON.stringify({ body: edit ? draft.body : row.body, buttons: edit ? draft.buttons : row.buttons, values: Object.fromEntries(names.map(name => [name, values[name] ?? ""])) }) });
      setPreview(result.text);
    });
  }
  async function remove() {
    if (dirty || conflict) return;
    await run(async () => {
      const saved = await api<KakaoTemplateRecord | undefined>("/kakao/templates/" + row.id, { method: "DELETE", headers: { "If-Match": String(row.version) } });
      setRemoveWarning(false);
      if (saved) { accept(saved); setNotice("템플릿을 보관했습니다."); } else router.push("/alimtalk/templates");
    });
  }
  return <div className="kakao-template-detail cs-stack"><PageHeading title={edit ? "알림톡 템플릿 수정" : "알림톡 템플릿 상세"}><div className="cs-row"><ActionButton secondary disabled={busy} onClick={() => refresh()}>최신 내용 불러오기</ActionButton><Link href="/alimtalk/templates">템플릿 목록</Link></div></PageHeading>
    <Panel title="심사 상태"><dl><dt>상태</dt><dd>{statuses[row.status]}</dd><dt>저장 버전</dt><dd>{row.version}</dd><dt>채널</dt><dd>{row.channelName ?? initial.channelName ?? "등록된 채널"} {row.channelSearchId ?? initial.channelSearchId ?? ""}</dd></dl>
      {row.reviewNote && <p>심사 의견: {row.reviewNote}</p>}{row.status === "submitted" && <p>심사 중에는 내용을 수정할 수 없습니다. 결과를 확인한 뒤 수정해주세요.</p>}
      {row.status === "archived" && <p>보관된 템플릿은 수정하거나 심사를 요청할 수 없습니다.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{conflict && <p role="alert">최신 상태와 충돌했습니다. 작성한 내용은 유지됩니다. 최신 내용을 확인한 뒤 다시 수정해주세요.</p>}
      {refreshWarning && <div role="alert"><p>최신 내용을 불러오면 저장하지 않은 수정 내용이 사라집니다.</p><ActionButton secondary disabled={busy} onClick={() => refresh(true)}>수정 내용 버리고 최신 불러오기</ActionButton><ActionButton secondary onClick={() => setRefreshWarning(false)}>계속 수정</ActionButton></div>}
    </Panel>
    <Panel title="템플릿 내용">{edit ? <form className="cs-stack" onSubmit={save}><fieldset disabled={busy || !editable}>
      <label>템플릿 이름<input className="cs-input" aria-label="템플릿 이름" required maxLength={100} value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
      <label>본문<textarea className="cs-input" aria-label="템플릿 본문" required maxLength={1000} rows={6} value={draft.body} onChange={event => change({ body: event.target.value })} /></label>
      <p>변수는 #&#123;name&#125; 형식으로 입력해주세요. {draft.body.length}/1,000자</p>
      <div className="cs-stack">{draft.buttons.map((button, index) => <fieldset className="kakao-button-fields" key={index}><legend>버튼 {index + 1}</legend>
        <label>버튼 이름<input className="cs-input" aria-label={"버튼 " + (index + 1) + " 이름"} required maxLength={14} value={button.name} onChange={event => change({ buttons: draft.buttons.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} /></label>
        <label>버튼 유형<select className="cs-input" aria-label={"버튼 " + (index + 1) + " 유형"} value={button.type} onChange={event => change({ buttons: draft.buttons.map((item, position) => position === index ? { ...item, type: event.target.value as typeof item.type, link: "" } : item) })}><option value="WL">웹 링크</option><option value="AL">앱 링크</option><option value="BK">봇 키워드</option><option value="MD">메시지 전달</option></select></label>
        {button.type === "WL" && <label>HTTPS 주소<input className="cs-input" aria-label={"버튼 " + (index + 1) + " 주소"} type="url" required maxLength={500} value={button.link} onChange={event => change({ buttons: draft.buttons.map((item, position) => position === index ? { ...item, link: event.target.value } : item) })} /></label>}
        <ActionButton secondary type="button" onClick={() => change({ buttons: draft.buttons.filter((_, position) => position !== index) })}>버튼 {index + 1} 삭제</ActionButton>
      </fieldset>)}</div><ActionButton secondary type="button" disabled={draft.buttons.length >= 5} onClick={() => change({ buttons: [...draft.buttons, { name: "", type: "WL", link: "" }] })}>버튼 추가</ActionButton>
    </fieldset><ActionButton disabled={busy || !editable || !dirty || conflict}>{busy ? "저장 중…" : "초안 저장"}</ActionButton>{dirty && <p role="status">저장하지 않은 변경 내용이 있습니다.</p>}</form> : <><h3>{row.name}</h3><p className="kakao-template-body">{row.body}</p><ul>{row.buttons.map((button, index) => <li key={index}>{button.name} · {button.type}{button.link && <p>{button.link}</p>}</li>)}</ul>{!["submitted", "archived"].includes(row.status) && <Link className="cs-button" href={"/alimtalk/templates/" + row.id + "/edit"}>템플릿 수정</Link>}</>}</Panel>
    <Panel title="미리보기"><div className="cs-stack">{names.map(name => <label key={name}>{name} 변수 값<input className="cs-input" aria-label={name + " 변수 값"} maxLength={100} value={values[name] ?? ""} onChange={event => { setValues(previous => ({ ...previous, [name]: event.target.value })); setPreview(""); }} /></label>)}<ActionButton secondary disabled={busy || names.some(name => !values[name]?.trim())} onClick={showPreview}>미리보기 확인</ActionButton>{preview && <div className="svc-talk" aria-label="알림톡 미리보기"><div className="svc-talk-head">알림톡 도착</div><div className="svc-talk-content"><p className="kakao-template-body" role="status">{preview}</p>{(edit ? draft.buttons : row.buttons).map((button, index) => <button type="button" disabled key={index}>{button.name}</button>)}</div></div>}</div></Panel>
    <div className="cs-row"><ActionButton disabled={busy || dirty || conflict || !["draft", "rejected"].includes(row.status)} onClick={requestReview}>심사 요청</ActionButton>{row.status === "approved" && <Link href="/alimtalk/direct">알림톡 발송 작성</Link>}{row.status !== "archived" && <ActionButton secondary disabled={busy || dirty || conflict} onClick={() => setRemoveWarning(true)}>템플릿 삭제·보관</ActionButton>}</div>
    {removeWarning && <Panel><p role="alert">삭제 가능한 초안은 삭제되고, 사용 이력이 있는 템플릿은 보관됩니다. 진행하시겠습니까?</p><ActionButton secondary disabled={busy} onClick={() => setRemoveWarning(false)}>취소</ActionButton><ActionButton disabled={busy || dirty || conflict} onClick={remove}>삭제·보관 진행</ActionButton></Panel>}
    {navigation && <Panel><p role="alert">저장하지 않은 내용이 있습니다. 이동하면 수정 내용이 사라집니다.</p><ActionButton secondary disabled={busy} onClick={() => setNavigation("")}>계속 수정</ActionButton><ActionButton secondary disabled={busy} onClick={() => router.push(navigation)}>수정 내용 버리고 이동</ActionButton></Panel>}
  </div>;
}
