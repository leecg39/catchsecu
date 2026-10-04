"use client";
import { useState, type FormEvent } from "react";
import { PageHeading, Panel, ActionButton, DataTable } from "../shared";
import { useApplication } from "../ApplicationContext";
import { api, errorText, useResource } from "@/lib/api";
import type { SubprocessorNoticeRecord, SubprocessorRecord } from "@/contracts/subprocessors";
import type { Paged } from "@/contracts/forms";

export function SubprocessorMail() {
  const app = useApplication();
  const [service, setService] = useState("");
  const [history, setHistory] = useState(false);
  const serviceId = service || app.data?.serviceId || "";
  const people = useResource<Paged<SubprocessorRecord>>(serviceId ? `/services/${serviceId}/subprocessors?pageSize=100` : null);
  const notices = useResource<Paged<SubprocessorNoticeRecord>>(serviceId && history ? `/services/${serviceId}/subprocessor-notices?pageSize=50` : null);
  return <>
    <PageHeading title="재위탁 안내 메일 발송">
      <ActionButton secondary onClick={() => setHistory(value => !value)}>{history ? "메일 작성" : "메일 발송 이력"}</ActionButton>
    </PageHeading>
    <div className="mg-toolbar"><label>서비스<select className="cs-input" aria-label="재위탁 서비스" value={serviceId} onChange={event => setService(event.target.value)}>{app.data?.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {history ? <Panel>{notices.error ? <p role="alert">{notices.error.message}</p> : <DataTable columns={["#", "발송일시", "수신인", "제목", "발송상태"]} rows={(notices.data?.items ?? []).map((item, index) => [index + 1, new Date(item.createdAt).toLocaleString("ko-KR"), item.email, item.subject, item.status === "queued" ? "발송 대기" : item.status === "sent" ? "발송" : "차단"])} />}</Panel>
      : serviceId && <Composer key={serviceId} serviceId={serviceId} people={people.data?.items ?? []} error={people.error?.message} onChanged={() => { people.reload(); }} />}
  </>;
}
function Composer({ serviceId, people, error, onChanged }: { serviceId: string; people: SubprocessorRecord[]; error?: string; onChanged: () => void }) {
  const active = people.filter(item => item.status === "active");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [summary, setSummary] = useState("");
  const [subprocessorId, setSubprocessorId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState(error ?? "");
  async function add(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy("add"); setAlert(""); setMessage("");
    try {
      await api(`/services/${serviceId}/subprocessors`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ name, email, changeSummary: summary }) });
      setName(""); setEmail(""); setSummary(""); setMessage("재위탁 수신자를 등록했습니다."); onChanged();
    } catch (cause) { setAlert(errorText(cause)); } finally { setBusy(""); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy("send"); setAlert(""); setMessage("");
    try {
      await api(`/services/${serviceId}/subprocessor-notices`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ subprocessorId, subject, body }) });
      setSubject(""); setBody(""); setMessage("재위탁 안내를 발송 대기열에 넣었습니다. 같은 내용은 다시 보내지 않습니다.");
    } catch (cause) { setAlert(errorText(cause)); } finally { setBusy(""); }
  }
  return <>
    <p>위탁사 담당자에게 개인정보 재위탁 안내 메일을 발송할 수 있습니다. 같은 수신자에게 같은 제목과 본문은 한 번만 기록됩니다.</p>
    {message && <p role="status">{message}</p>}{alert && <p role="alert">{alert}</p>}
    <Panel title="수신자 등록"><form className="mg-fields" onSubmit={add}><fieldset disabled={!!busy}>
      <label>이름<input className="cs-input" aria-label="재위탁 수신자 이름" required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>이메일<input className="cs-input" aria-label="재위탁 수신자 이메일" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>변경 내용<textarea className="cs-input" aria-label="재위탁 변경 내용" required maxLength={4000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    </fieldset><ActionButton disabled={!!busy}>{busy === "add" ? "등록 중…" : "수신자 등록"}</ActionButton></form></Panel>
    <Panel title="안내 메일"><form className="mg-fields" onSubmit={send}><fieldset disabled={!!busy}>
      <label>수신인<select className="cs-input" aria-label="재위탁 안내 수신인" required value={subprocessorId} onChange={event => setSubprocessorId(event.target.value)}><option value="">수신자 선택</option>{active.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}{people.filter(item => item.status === "archived").map(item => <option key={item.id} value={item.id} disabled>{item.name} · 보관</option>)}</select></label>
      <label>제목<input className="cs-input" aria-label="재위탁 안내 제목" required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label>본문<textarea className="cs-input mg-mail-body" aria-label="재위탁 안내 본문" required maxLength={20000} value={body} onChange={event => setBody(event.target.value)} /></label>
    </fieldset><ActionButton disabled={!!busy || !active.length}>{busy === "send" ? "발송 중…" : "메일 발송"}</ActionButton></form></Panel>
  </>;
}
