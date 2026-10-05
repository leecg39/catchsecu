"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import type { KakaoChannelRecord, KakaoTemplateRecord } from "@/contracts/kakao";

const channelStatus: Record<string, string> = { pending: "확인 전", verified: "확인됨", archived: "보관" };
const templateStatus: Record<KakaoTemplateRecord["status"], string> = { draft: "초안", submitted: "심사 중", rejected: "반려", approved: "승인", archived: "보관" };
export function KakaoTemplates({ path }: { path: string }) {
  const app = useApplication();
  const [service, setService] = useState("");
  const serviceId = service || app.data?.serviceId || "";
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
  async function run(work: () => Promise<unknown>, done: string) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await work(); setMessage(done); channels.reload(); templates.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function add(event: FormEvent) {
    event.preventDefault(); if (!serviceId) return;
    await run(() => api("/kakao/channels", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ serviceId, name, searchId }) }), "채널을 등록했습니다. 공급자 확인 전에는 인증되지 않습니다.");
    setName("");
  }
  async function addTemplate(event: FormEvent) {
    event.preventDefault(); if (!serviceId || !templateChannel) return;
    await run(() => api("/kakao/templates", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ serviceId, channelId: templateChannel, name: templateName, body: templateBody, buttons: [] }) }), "템플릿 초안을 저장했습니다. 심사 요청 후 승인되어야 발송할 수 있습니다.");
    setTemplateName(""); setTemplateBody("");
  }
  return <div>
    <PageHeading title={path.includes("/templates") ? "알림톡 템플릿" : "알림톡 채널"} />
    <label>서비스<select className="cs-input" aria-label="알림톡 서비스" value={serviceId} onChange={event => setService(event.target.value)}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <Panel title="채널"><form className="mg-fields" onSubmit={add}><fieldset disabled={busy}>
      <label>이름<input className="cs-input" aria-label="채널 이름" required maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>검색용 아이디<input className="cs-input" aria-label="채널 검색용 아이디" required value={searchId} onChange={event => setSearchId(event.target.value)} /></label>
    </fieldset><ActionButton disabled={busy}>채널 등록</ActionButton></form>
    <ul>{(channels.data?.items ?? []).map(item => <li key={item.id}>{item.name} {item.searchId} · {channelStatus[item.status] ?? item.status}
      {item.status === "pending" && <> <ActionButton secondary disabled={busy} onClick={() => run(() => api("/kakao/channels/" + item.id + "/verify", { method: "POST", body: "{}" }), "채널 확인을 요청했습니다.")}>확인 요청</ActionButton></>}</li>)}</ul></Panel>
    {path.includes("/templates") && <Panel title="템플릿">
      <form className="mg-fields" onSubmit={addTemplate}><fieldset disabled={busy}>
        <label>채널<select className="cs-input" aria-label="템플릿 채널" required value={templateChannel} onChange={event => setTemplateChannel(event.target.value)}><option value="">채널 선택</option>{(channels.data?.items ?? []).filter(item => item.status !== "archived").map(item => <option key={item.id} value={item.id}>{item.name} · {channelStatus[item.status] ?? item.status}</option>)}</select></label>
        <label>템플릿 이름<input className="cs-input" aria-label="템플릿 이름" required maxLength={40} value={templateName} onChange={event => setTemplateName(event.target.value)} /></label>
        <label>본문<textarea className="cs-input" aria-label="템플릿 본문" required maxLength={1000} rows={4} value={templateBody} onChange={event => setTemplateBody(event.target.value)} placeholder={"#{name}님 안내드립니다."} /></label>
      </fieldset><ActionButton disabled={busy || !templateChannel}>초안 저장</ActionButton></form>
      <ul>{(templates.data?.items ?? []).map(item => <li key={item.id}>{item.name} · v{item.version} · {templateStatus[item.status]}
        {(item.status === "draft" || item.status === "rejected") && <> <ActionButton secondary disabled={busy} onClick={() => run(() => api("/kakao/templates/" + item.id + "/submit", { method: "POST", body: JSON.stringify({ version: item.version }) }), "심사를 요청했습니다.")}>심사 요청</ActionButton></>}
        {item.status === "rejected" && item.reviewNote && <small> · 반려 사유: {item.reviewNote}</small>}</li>)}</ul>
      <p>승인되지 않은 템플릿은 발송할 수 없습니다. 내용을 바꾸면 다시 심사해야 합니다. 캠페인은 <Link className="cs-link" href="/alimtalk/direct">알림톡 보내기</Link>에서 작성합니다.</p></Panel>}
  </div>;
}
