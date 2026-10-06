"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { kakaoChannelInput, kakaoChannelPatch, kakaoTemplateInput, type KakaoChannelRecord, type KakaoTemplateRecord } from "@/contracts/kakao";

const channelStatus: Record<string, string> = { pending: "확인 전", verified: "확인됨", archived: "보관" };
const templateStatus: Record<KakaoTemplateRecord["status"], string> = { draft: "초안", submitted: "심사 중", rejected: "반려", approved: "승인", archived: "보관" };
export function KakaoTemplates({ path }: { path: string }) {
  const app = useApplication();
  const [service, setService] = useState("");
  const serviceId = service || app.data?.serviceId || "";
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("message.manage")) return <Panel><p role="alert">알림톡을 관리할 권한이 없습니다.</p></Panel>;
  return <KakaoForms key={(app.data.company?.id ?? "") + serviceId} path={path} serviceId={serviceId} setService={setService} />;
}
function KakaoForms({ path, serviceId, setService }: { path: string; serviceId: string; setService: (id: string) => void }) {
  const app = useApplication();
  const channels = useResource<{ items: KakaoChannelRecord[] }>(serviceId ? "/kakao/channels?serviceId=" + serviceId : null);
  const templates = useResource<{ items: KakaoTemplateRecord[] }>(serviceId && path.includes("/templates") ? "/kakao/templates?serviceId=" + serviceId : null);
  const [name, setName] = useState("");
  const [searchId, setSearchId] = useState("@");
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateChannel, setTemplateChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<KakaoChannelRecord | null>(null);
  const [removing, setRemoving] = useState<KakaoChannelRecord | null>(null);
  const [removeConflict, setRemoveConflict] = useState(false);
  const running = useRef(false);
  const channelRequest = useRef<{ body: string; key: string } | null>(null);
  const templateRequest = useRef<{ body: string; key: string } | null>(null);
  async function run(work: () => Promise<unknown>, done: string) {
    if (running.current) return false; running.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); setMessage(done); channels.reload(); templates.reload(); return true; }
    catch (cause) { setError(errorText(cause)); return false; } finally { running.current = false; setBusy(false); }
  }
  async function add(event: FormEvent) {
    event.preventDefault(); if (!serviceId || running.current) return;
    await run(async () => {
      const checked = kakaoChannelInput.safeParse({ serviceId, name, searchId });
      if (!checked.success) throw new Error(checked.error.issues.map(issue => issue.message).join(" "));
      const body = JSON.stringify(checked.data);
      if (channelRequest.current?.body !== body) channelRequest.current = { body, key: crypto.randomUUID() };
      await api("/kakao/channels", { method: "POST", headers: { "Idempotency-Key": channelRequest.current.key }, body });
      channelRequest.current = null; setName(""); setSearchId("@");
    }, "채널을 등록했습니다. 공급자 확인 전에는 인증되지 않습니다.");
  }
  async function addTemplate(event: FormEvent) {
    event.preventDefault(); if (!serviceId || !templateChannel || running.current) return;
    await run(async () => {
      const checked = kakaoTemplateInput.safeParse({ serviceId, channelId: templateChannel, name: templateName, body: templateBody, buttons: [] });
      if (!checked.success) throw new Error(checked.error.issues.map(issue => issue.message).join(" "));
      if (!channels.data?.items.some(item => item.id === templateChannel && item.status !== "archived")) throw new Error("사용할 수 있는 채널을 다시 선택해주세요.");
      const body = JSON.stringify(checked.data);
      if (templateRequest.current?.body !== body) templateRequest.current = { body, key: crypto.randomUUID() };
      await api("/kakao/templates", { method: "POST", headers: { "Idempotency-Key": templateRequest.current.key }, body });
      templateRequest.current = null; setTemplateName(""); setTemplateBody("");
    }, "템플릿 초안을 저장했습니다. 심사 요청 후 승인되어야 발송할 수 있습니다.");
  }
  async function removeChannel() {
    if (!removing || removeConflict) return;
    await run(async () => {
      try {
        const result = await api<KakaoChannelRecord | undefined>("/kakao/channels/" + removing.id, { method: "DELETE", headers: { "If-Match": String(removing.version) } });
        if (templateChannel === removing.id) setTemplateChannel("");
        setRemoving(null); setRemoveConflict(false);
        return result;
      } catch (cause) { if (cause instanceof ApiError && cause.status === 409 && cause.code === "VERSION_CONFLICT") setRemoveConflict(true); throw cause; }
    }, "채널 삭제·보관을 완료했습니다.");
  }
  const managing = !!editing || !!removing;
  const unavailable = busy || managing || !serviceId || channels.loading || !!channels.error;
  return <div>
    <PageHeading title={path.includes("/templates") ? "알림톡 템플릿" : "알림톡 채널"} />
    <label>서비스<select className="cs-input" aria-label="알림톡 서비스" disabled={busy || managing} value={serviceId} onChange={event => setService(event.target.value)}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <Panel title="채널"><form className="mg-fields" onSubmit={add}><fieldset disabled={unavailable}>
      <label>이름<input className="cs-input" aria-label="채널 이름" required maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>검색용 아이디<input className="cs-input" aria-label="채널 검색용 아이디" required value={searchId} onChange={event => setSearchId(event.target.value)} /></label>
    </fieldset><ActionButton disabled={unavailable}>채널 등록</ActionButton></form>
    {channels.loading && <p role="status">채널을 불러오는 중입니다.</p>}
    {channels.error && <div><p role="alert">{channels.error.message}</p><ActionButton secondary disabled={busy} onClick={channels.reload}>채널 다시 불러오기</ActionButton></div>}
    {channels.data?.items.length === 0 && <p>등록된 채널이 없습니다.</p>}
    <ul>{(channels.data?.items ?? []).map(item => <li key={item.id}>{item.name} {item.searchId} · {channelStatus[item.status] ?? item.status}
      {item.status === "pending" && <> <ActionButton secondary disabled={busy || managing} onClick={() => run(() => api("/kakao/channels/" + item.id + "/verify", { method: "POST", body: "{}" }), "채널 확인을 요청했습니다.")}>확인 요청</ActionButton></>}
      {item.status !== "archived" && <ActionButton secondary disabled={busy || managing} aria-label={item.name + " " + item.searchId + " 채널 수정"} onClick={() => { setError(""); setMessage(""); setEditing(item); }}>수정</ActionButton>}
      <ActionButton secondary disabled={busy || managing} aria-label={item.name + " " + item.searchId + " 채널 삭제·보관"} onClick={() => { setError(""); setMessage(""); setRemoving(item); setRemoveConflict(false); }}>삭제·보관</ActionButton>
    </li>)}</ul>
    {editing && <ChannelEditor row={editing} busy={busy} run={run} close={() => setEditing(null)} />}
    {removing && <div role="alertdialog" aria-label="채널 삭제·보관 확인"><p>{removing.name} · {removing.searchId} · v{removing.version}</p><p>사용 중인 템플릿이 있으면 진행할 수 없습니다. 템플릿 이력이 있으면 보관하고, 이력이 없으면 삭제합니다.</p>
      {removeConflict && <p>다른 곳에서 수정되었습니다. 삭제 대상을 다시 확인해주세요.</p>}
      <ActionButton secondary disabled={busy} onClick={() => { setRemoving(null); setRemoveConflict(false); }}>채널 삭제 취소</ActionButton>
      {removeConflict && <ActionButton secondary disabled={busy} onClick={() => run(async () => { setRemoving(await api<KakaoChannelRecord>("/kakao/channels/" + removing.id)); setRemoveConflict(false); }, "최신 삭제 대상을 불러왔습니다.")}>삭제 대상 다시 확인</ActionButton>}
      <ActionButton disabled={busy || removeConflict} onClick={removeChannel}>채널 삭제·보관 진행</ActionButton></div>}
    </Panel>
    {path.includes("/templates") && <Panel title="템플릿">
      <form className="mg-fields" onSubmit={addTemplate}><fieldset disabled={unavailable}>
        <label>채널<select className="cs-input" aria-label="템플릿 채널" required value={templateChannel} onChange={event => setTemplateChannel(event.target.value)}><option value="">채널 선택</option>{(channels.data?.items ?? []).filter(item => item.status !== "archived").map(item => <option key={item.id} value={item.id}>{item.name} · {channelStatus[item.status] ?? item.status}</option>)}</select></label>
        <label>템플릿 이름<input className="cs-input" aria-label="템플릿 이름" required maxLength={100} value={templateName} onChange={event => setTemplateName(event.target.value)} /></label>
        <label>본문<textarea className="cs-input" aria-label="템플릿 본문" required maxLength={1000} rows={4} value={templateBody} onChange={event => setTemplateBody(event.target.value)} placeholder={"#{name}님 안내드립니다."} /></label>
      </fieldset><ActionButton disabled={unavailable || !templateChannel}>초안 저장</ActionButton></form>
      {templates.loading && <p role="status">템플릿을 불러오는 중입니다.</p>}
      {templates.error && <div><p role="alert">{templates.error.message}</p><ActionButton secondary disabled={busy} onClick={templates.reload}>템플릿 다시 불러오기</ActionButton></div>}
      {templates.data?.items.length === 0 && <p>등록된 템플릿이 없습니다.</p>}
      <ul>{(templates.data?.items ?? []).map(item => <li key={item.id}><Link href={"/alimtalk/templates/" + item.id}>{item.name}</Link> · v{item.version} · {templateStatus[item.status]}
        {(item.status === "draft" || item.status === "rejected") && <> <ActionButton secondary disabled={busy || managing} onClick={() => run(() => api("/kakao/templates/" + item.id + "/submit", { method: "POST", body: JSON.stringify({ version: item.version }) }), "심사를 요청했습니다.")}>심사 요청</ActionButton></>}
        {item.status === "rejected" && item.reviewNote && <small> · 반려 사유: {item.reviewNote}</small>}</li>)}</ul>
      <p>승인되지 않은 템플릿은 발송할 수 없습니다. 내용을 바꾸면 다시 심사해야 합니다. 캠페인은 <Link className="cs-link" href="/alimtalk/direct">알림톡 보내기</Link>에서 작성합니다.</p></Panel>}
  </div>;
}


function ChannelEditor({ row, busy, run, close }: { row: KakaoChannelRecord; busy: boolean; run: (work: () => Promise<unknown>, done: string) => Promise<boolean>; close: () => void }) {
  const router = useRouter();
  const [navigation, setNavigation] = useState("");
  const [current, setCurrent] = useState(row), [name, setName] = useState(row.name), [searchId, setSearchId] = useState(row.searchId);
  const [conflict, setConflict] = useState(false), [discard, setDiscard] = useState<"cancel" | "refresh" | null>(null);
  const dirty = name !== current.name || searchId !== current.searchId;
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
  async function save(event: FormEvent) {
    event.preventDefault(); if (conflict || current.status === "archived") return;
    await run(async () => {
      const checked = kakaoChannelPatch.safeParse({ name, searchId, version: current.version, status: "pending" });
      if (!checked.success) throw new Error(checked.error.issues.map(issue => issue.message).join(" "));
      try { await api("/kakao/channels/" + row.id, { method: "PATCH", body: JSON.stringify(checked.data) }); close(); }
      catch (cause) { if (cause instanceof ApiError && cause.status === 409 && cause.code === "VERSION_CONFLICT") setConflict(true); throw cause; }
    }, "채널을 수정했습니다. 검색용 아이디가 바뀌면 채널 확인과 템플릿 심사를 다시 진행해주세요.");
  }
  async function refresh() {
    await run(async () => { const latest = await api<KakaoChannelRecord>("/kakao/channels/" + row.id); setCurrent(latest); setName(latest.name); setSearchId(latest.searchId); setConflict(false); setDiscard(null); }, "최신 채널을 불러왔습니다.");
  }
  return <div aria-label="채널 수정 영역"><h3>채널 수정 · v{current.version}</h3><p>검색용 아이디를 바꾸면 기존 확인과 연결된 템플릿 승인이 해제됩니다.</p>
    <form onSubmit={save}><fieldset disabled={busy || current.status === "archived"}><label>이름<input className="cs-input" aria-label="수정할 채널 이름" required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><label>검색용 아이디<input className="cs-input" aria-label="수정할 채널 검색용 아이디" required maxLength={21} value={searchId} onChange={e => setSearchId(e.target.value)} /></label></fieldset>
      <ActionButton disabled={busy || conflict || current.status === "archived"}>채널 수정 저장</ActionButton></form>
    {conflict && <p role="alert">작성한 내용은 유지됩니다. 최신 내용을 불러온 뒤 다시 수정해주세요.</p>}
    {current.status === "archived" && <p role="alert">보관된 채널은 수정할 수 없습니다.</p>}
    <ActionButton secondary disabled={busy} onClick={() => dirty ? setDiscard("refresh") : refresh()}>최신 채널 불러오기</ActionButton>
    <ActionButton secondary disabled={busy} onClick={() => dirty ? setDiscard("cancel") : close()}>채널 수정 취소</ActionButton>
    {navigation && <div role="alertdialog" aria-label="채널 수정 중 화면 이동 확인"><p>저장하지 않은 채널 수정 내용이 사라집니다.</p><ActionButton secondary disabled={busy} onClick={() => setNavigation("")}>채널 수정 유지</ActionButton><ActionButton disabled={busy} onClick={() => router.push(navigation)}>채널 수정 버리고 이동</ActionButton></div>}
    {discard && <div role="alertdialog" aria-label="채널 수정 내용 폐기 확인"><p>저장하지 않은 채널 수정 내용이 사라집니다.</p><ActionButton secondary disabled={busy} onClick={() => setDiscard(null)}>채널 계속 수정</ActionButton><ActionButton disabled={busy} onClick={() => discard === "cancel" ? close() : refresh()}>채널 수정 내용 버리기</ActionButton></div>}
  </div>;
}
