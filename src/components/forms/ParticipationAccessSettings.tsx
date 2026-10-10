"use client";
import { useRef, useState } from "react";
import type { FormContent } from "@/contracts/forms";
import { defaultParticipationAccessPolicy, type ParticipationAccessPolicy } from "@/contracts/form-participation-access";
import { api, errorText, useResource } from "@/lib/api";
import { ActionButton } from "../shared";

export function ParticipationPolicyFields({ content, onChange }: { content: FormContent; onChange: (patch: Partial<FormContent>) => void }) {
  const policy = content.participationAccess ?? defaultParticipationAccessPolicy();
  const update = (patch: Partial<ParticipationAccessPolicy>) => onChange({ participationAccess: { ...policy, ...patch } });
  return <section className="cs-stack forms-participation-settings"><h3>참여 인증</h3>
    <label><input type="checkbox" checked={policy.enabled} onChange={event => onChange({ participationAccess: event.target.checked
      ? { ...defaultParticipationAccessPolicy(), enabled: true, useOtp: true }
      : defaultParticipationAccessPolicy() })} /> 참여자 인증 사용</label>
    {policy.enabled && <>
      <label>인증 방법<select className="cs-input" value={policy.method} onChange={event => update(event.target.value === "SOCIAL"
        ? { method: "SOCIAL", targetScope: "ALL", useOtp: false, socialProvider: "KAKAO" }
        : { method: "EMAIL", targetScope: "ALL", useOtp: true, socialProvider: "KAKAO" })}>
        <option value="EMAIL">이메일</option><option value="SOCIAL">소셜 로그인</option></select></label>
      <fieldset><legend>중복 참여</legend><label><input type="radio" name="duplicate-participation" checked={!policy.limitDuplicate} onChange={() => update({ limitDuplicate: false })} /> 허용</label>
        <label><input type="radio" name="duplicate-participation" checked={policy.limitDuplicate} onChange={() => update({ limitDuplicate: true })} /> 동일 인증정보로 한 번만 참여</label></fieldset>
      {policy.method === "EMAIL" ? <>
        <label>참여 대상<select className="cs-input" value={policy.targetScope} onChange={event => update(event.target.value === "WHITELIST"
          ? { targetScope: "WHITELIST", useOtp: false } : { targetScope: "ALL", useOtp: true })}>
          <option value="ALL">모든 이메일</option><option value="WHITELIST">지정 명단</option></select></label>
        {policy.targetScope === "WHITELIST" && <label><input type="checkbox" checked={policy.useOtp} onChange={event => update({ useOtp: event.target.checked })} /> 지정 이메일에도 인증번호 확인</label>}
        <p className="cs-note">모든 이메일을 허용하면 인증번호 확인이 필수입니다. 지정 명단은 CSV로 등록하며 인증번호 확인을 선택할 수 있습니다.</p>
      </> : <><label>소셜 제공자<select className="cs-input" value={policy.socialProvider} onChange={event => update({ socialProvider: event.target.value as "KAKAO" | "NAVER" })}>
        <option value="KAKAO">카카오</option><option value="NAVER">네이버</option></select></label>
        <p className="cs-note">소셜 참여 인증은 제공사 자격증명을 연결한 뒤 게시할 수 있습니다.</p></>}
    </>}
  </section>;
}

type TargetBatch = { id: string; name: string; acceptedCount: number; rejectedCount: number; version: number; createdAt: string };
type TargetData = { formId: string; formVersion: number; targetCount: number; batches: TargetBatch[] };

function firstCsvColumn(text: string) {
  const rows: string[] = []; let field = "", quoted = false;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index] ?? "\n";
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === "," || char === ";" || char === "\t") {
      while (index < text.length && !["\n", "\r"].includes(text[index])) index++;
      rows.push(field.trim().replace(/^\uFEFF/, "")); field = "";
    } else if (char === "\n" || char === "\r") {
      rows.push(field.trim().replace(/^\uFEFF/, "")); field = "";
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else field += char;
  }
  if (rows[0] && /^(email|이메일|email address)$/i.test(rows[0])) rows.shift();
  return rows.filter(Boolean).slice(0, 10000);
}

export function ParticipationTargetManager({ formId, disabled, beforeMutation, afterMutation }: { formId: string; disabled?: boolean;
  beforeMutation: () => Promise<number>; afterMutation: () => Promise<void> }) {
  const resource = useResource<TargetData>("/forms/" + formId + "/participation-targets");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function upload(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("CSV 파일만 등록할 수 있습니다.");
      if (file.size > 2 * 1024 * 1024) throw new Error("대상자 명단 파일은 2MB 이하여야 합니다.");
      const emails = firstCsvColumn(await file.text());
      if (!emails.length) throw new Error("CSV 첫 번째 열에서 이메일을 찾을 수 없습니다.");
      const version = await beforeMutation();
      const result = await api<{ batch: TargetBatch; targetCount: number }>("/forms/" + formId + "/participation-targets", { method: "POST",
        body: JSON.stringify({ version, name: file.name, emails }) });
      setMessage(`${result.batch.acceptedCount.toLocaleString()}명을 등록했습니다.${result.batch.rejectedCount ? ` ${result.batch.rejectedCount.toLocaleString()}건은 형식 또는 중복으로 제외했습니다.` : ""}`);
      resource.reload(); await afterMutation();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove(batch: TargetBatch) {
    setBusy(true); setError(""); setMessage("");
    try {
      const version = await beforeMutation();
      await api("/forms/" + formId + "/participation-targets?batchId=" + encodeURIComponent(batch.id), { method: "DELETE",
        headers: { "If-Match": String(version), "X-Batch-Version": String(batch.version) } });
      setMessage(`${batch.name} 명단을 삭제했습니다.`); resource.reload(); await afterMutation();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section className="cs-stack forms-participation-targets"><div><h3>지정 대상자 명단</h3><p>현재 등록 대상: {resource.data?.targetCount.toLocaleString() ?? "-"}명</p></div>
    <label className="cs-button secondary">CSV 명단 등록<input ref={input} hidden type="file" accept=".csv,text/csv" disabled={disabled || busy}
      onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
    <p className="cs-note">첫 번째 열에 이메일을 넣어주세요. 헤더는 email 또는 이메일을 사용할 수 있으며 한 파일당 최대 10,000명입니다.</p>
    {resource.loading ? <p role="status">명단을 불러오는 중입니다.</p> : resource.error ? <p role="alert">{resource.error.message}</p>
      : resource.data?.batches.length ? <ul>{resource.data.batches.map(batch => <li key={batch.id}><strong>{batch.name}</strong> · 등록 {batch.acceptedCount.toLocaleString()}명
        {batch.rejectedCount ? ` · 제외 ${batch.rejectedCount.toLocaleString()}건` : ""} · {new Date(batch.createdAt).toLocaleString("ko-KR")}
        <ActionButton secondary disabled={disabled || busy} onClick={() => remove(batch)}>삭제</ActionButton></li>)}</ul> : <p>등록된 명단이 없습니다.</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{message}</p>
  </section>;
}
