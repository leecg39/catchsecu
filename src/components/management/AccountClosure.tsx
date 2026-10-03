"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import type { AccountClosureStatus } from "@/contracts/account-closure";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";

export function LiveAccountClosure() {
  const router = useRouter();
  const result = useResource<AccountClosureStatus>("/me/closure");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), data = result.data;
  const blocked = !data || !!data.ownedCompanies.length || data.platformAdminHandoffRequired || !data.hasPassword;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || lock.current) return;
    const form = new FormData(event.currentTarget); lock.current = true; setBusy(true); setError("");
    try {
      await api("/me/closure", { method: "POST", body: JSON.stringify({ version: data.version,
        confirmation: String(form.get("confirmation")), password: String(form.get("password")), reason: String(form.get("reason") ?? "").trim(),
      }) });
      router.replace("/login?accountClosed=1"); router.refresh();
    } catch (cause) { setError(errorText(cause)); result.reload(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="mg-narrow"><PageHeading title="회원탈퇴" />
    <Panel title="계정 폐쇄"><p>탈퇴하면 모든 기기의 로그인이 해제되고 회사·서비스 접근 권한과 인증 정보가 회수됩니다.</p>
      <p>회사 업무 자료와 감사 이력은 회사에 남습니다. 회사 자료 삭제는 회사 폐쇄·파기 절차에서 진행합니다. 폐쇄한 계정은 다시 사용할 수 없습니다.</p>
      {result.error && <p role="alert">{result.error.message} <button className="cs-link" onClick={result.reload}>다시 시도</button></p>}
      {result.loading && <p>탈퇴 조건을 확인하고 있습니다.</p>}
      {data?.ownedCompanies.length ? <div><p>아래 회사의 소유권을 다른 활성 구성원에게 먼저 이전해주세요.</p>
        <ul>{data.ownedCompanies.map(company => <li key={company.id}>{company.name}</li>)}</ul>
        <Link className="cs-button secondary" href="/set/member">구성원 관리</Link></div> : null}
      {data?.platformAdminHandoffRequired && <p>다른 활성 플랫폼 운영자에게 운영 권한을 먼저 인계해주세요.</p>}
      {data && !data.hasPassword && <p>계정 폐쇄에는 비밀번호 인증 수단이 필요합니다. 연결된 인증 수단을 확인해주세요.</p>}
      <ActionButton secondary disabled={blocked || result.loading} onClick={() => { setOpen(true); setError(""); }}>회원탈퇴</ActionButton>
    </Panel>
    {open && data && <Modal title="회원탈퇴 확인" onClose={() => { if (!busy) setOpen(false); }}>
      <form className="mg-fields" onSubmit={submit}><p><strong>{data.email}</strong> 계정을 폐쇄합니다.</p>
        <label><span>로그인 이메일 확인</span><input name="confirmation" className="cs-input" type="email" required disabled={busy} maxLength={254} autoComplete="off" /></label>
        <label><span>현재 비밀번호</span><input name="password" className="cs-input" type="password" required disabled={busy} maxLength={128} autoComplete="current-password" /></label>
        <label><span>탈퇴 사유 (선택)</span><textarea name="reason" className="cs-input" disabled={busy} maxLength={1000} /></label>
        <label className="member-check"><input type="checkbox" required disabled={busy} />접근 권한이 회수되고 계정을 다시 사용할 수 없음을 확인했습니다.</label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <ActionButton disabled={busy || blocked}>{busy ? "처리 중…" : "계정 폐쇄"}</ActionButton>
      </form>
    </Modal>}
  </div>;
}
