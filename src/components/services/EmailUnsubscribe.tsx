"use client";
import { useEffect, useState } from "react";
import type { UnsubscribeInfo } from "@/contracts/email-feedback";
import { ActionButton, Panel } from "../shared";
import "./campaigns.css";
export function EmailUnsubscribe({ token }: { token: string }) {
  const [record, setRecord] = useState<UnsubscribeInfo>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [completed, setCompleted] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/email-unsubscribe/" + encodeURIComponent(token), { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal })
      .then(async r => { const value = await r.json(); if (!r.ok) throw new Error(value.error?.message ?? "링크를 확인해주세요."); setRecord(value); setCompleted(value.unsubscribed); })
      .catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [token]);
  async function confirm() {
    if (busy) return; setBusy(true); setError("");
    try { const r = await fetch("/api/v1/email-unsubscribe/" + encodeURIComponent(token), { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const value = await r.json(); if (!r.ok) throw new Error(value.error?.message ?? "처리하지 못했습니다. 다시 시도해주세요."); setCompleted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  }
  return <main className="email-unsubscribe campaign-page"><Panel><h1>이메일 수신 거부</h1>
    {record ? <><p><strong>{record.company} · {record.service}</strong></p>{completed ? <p role="status">수신거부가 완료되었습니다. 이 서비스의 이후 이메일 발송 대상에서 제외됩니다. 이미 전달된 메일은 회수되지 않습니다.</p> : <><p>이 서비스의 이메일을 더 이상 받지 않으려면 아래 버튼을 눌러주세요. 다른 서비스의 수신 설정은 유지됩니다.</p><ActionButton disabled={busy} onClick={confirm}>{busy ? "처리 중…" : "이메일 수신 거부 확인"}</ActionButton></>}</> : !error && <p role="status">링크를 확인하는 중입니다.</p>}
    {error && <p role="alert">{error}</p>}
  </Panel></main>;
}
