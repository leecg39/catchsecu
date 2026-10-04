"use client";
import { useState, type FormEvent } from "react";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import type { KakaoChannelRecord, KakaoTemplateRecord } from "@/contracts/kakao";

export function KakaoTemplates({ path }: { path: string }) {
  const app = useApplication();
  const [service, setService] = useState("");
  const serviceId = service || app.data?.serviceId || "";
  const channels = useResource<{ items: KakaoChannelRecord[] }>(serviceId ? "/kakao/channels?serviceId=" + serviceId : null);
  const templates = useResource<{ items: KakaoTemplateRecord[] }>(serviceId && path.includes("/templates") ? "/kakao/templates?serviceId=" + serviceId : null);
  const [name, setName] = useState("");
  const [searchId, setSearchId] = useState("@");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault(); if (busy || !serviceId) return; setBusy(true); setError(""); setMessage("");
    try {
      await api("/kakao/channels", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ serviceId, name, searchId }) });
      setName(""); setMessage("채널을 등록했습니다. 공급자 확인 전에는 인증되지 않습니다."); channels.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div>
    <PageHeading title={path.includes("/templates") ? "알림톡 템플릿" : "알림톡 채널"} />
    <label>서비스<select className="cs-input" aria-label="알림톡 서비스" value={serviceId} onChange={event => setService(event.target.value)}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <Panel title="채널"><form className="mg-fields" onSubmit={add}><fieldset disabled={busy}>
      <label>이름<input className="cs-input" aria-label="채널 이름" required maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>검색용 아이디<input className="cs-input" aria-label="채널 검색용 아이디" required value={searchId} onChange={event => setSearchId(event.target.value)} /></label>
    </fieldset><ActionButton disabled={busy}>채널 등록</ActionButton></form>
    <ul>{(channels.data?.items ?? []).map(item => <li key={item.id}>{item.name} {item.searchId} · {item.status === "verified" ? "확인됨" : item.status === "archived" ? "보관" : "확인 전"}</li>)}</ul></Panel>
    {path.includes("/templates") && <Panel title="템플릿"><ul>{(templates.data?.items ?? []).map(item => <li key={item.id}>{item.name} · {item.status === "approved" ? "승인" : item.status === "submitted" ? "심사 중" : item.status === "rejected" ? "반려" : "초안"}</li>)}</ul>
      <p>승인되지 않은 템플릿은 발송할 수 없습니다. 내용을 바꾸면 다시 심사해야 합니다.</p></Panel>}
  </div>;
}
