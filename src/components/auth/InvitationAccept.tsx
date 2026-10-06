"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, errorText } from "@/lib/api";
import { authPath } from "@/lib/return-to";
import type { SsoInvitationOptions } from "@/contracts/sso";
import { roleLabels, type MemberRole } from "@/contracts/members";

type Preview = { id: string; companyName: string; email: string; role: MemberRole; expiresAt: string };
export function InvitationAccept() {
  const token = useSearchParams().get("token") ?? "", router = useRouter();
  const [state, setState] = useState<{ data?: Preview; error?: string; login?: boolean }>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef<string | null>(null), returnTo = "/oauth2/invite/signup?token=" + encodeURIComponent(token);
  useEffect(() => {
    const controller = new AbortController();
    api<Preview>("/invitations/preview", { method: "POST", body: JSON.stringify({ token }), signal: controller.signal })
      .then(data => setState({ data }))
      .catch(error => { if (error.name !== "AbortError") setState({ error: errorText(error), login: error instanceof ApiError && error.status === 401 }); });
    return () => controller.abort();
  }, [token]);
  return <><h1>회사 초대 수락</h1>{state.login ? <><p className="auth-description">초대받은 이메일 주소로 가입하거나 로그인해주세요.</p>
    <Link className="auth-primary auth-block" href={authPath("/login", returnTo)}>로그인 후 수락</Link><Link className="auth-back" href={authPath("/signup", returnTo)}>회원가입</Link>
    <InvitationSso key={token} token={token} /></> :
    state.error ? <><p className="auth-error" role="alert">{state.error}</p><Link href={authPath("/login", returnTo)}>초대받은 계정으로 로그인</Link></> :
    !state.data ? <p role="status">초대를 확인하는 중입니다.</p> : <>
      <p className="auth-description"><strong>{state.data.companyName}</strong>에서 초대했습니다.</p>
      <dl className="member-invite-summary"><dt>이메일</dt><dd>{state.data.email}</dd><dt>역할</dt><dd>{roleLabels[state.data.role]}</dd><dt>만료일</dt><dd>{new Date(state.data.expiresAt).toLocaleString("ko-KR")}</dd></dl>
      {error && <p role="alert" className="auth-error">{error}</p>}<button className="auth-primary auth-block" disabled={busy} onClick={async () => {
        setBusy(true); setError(""); if (!key.current) key.current = crypto.randomUUID();
        try { await api("/invitations/accept", { method: "POST", headers: { "Idempotency-Key": key.current }, body: JSON.stringify({ token }) }); router.replace("/dashboard"); router.refresh(); }
        catch (error) { setError(errorText(error)); } finally { setBusy(false); }
      }}>{busy ? "수락 중…" : "초대 수락"}</button></>}</>;
}

function InvitationSso({ token }: { token: string }) {
  const [options, setOptions] = useState<SsoInvitationOptions | null>(null), [selected, setSelected] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<SsoInvitationOptions>("/invitations/sso/options", { method: "POST", body: JSON.stringify({ token }), signal: controller.signal })
      .then(data => { setOptions(data); setError(""); })
      .catch(cause => { if (cause.name !== "AbortError") setError(errorText(cause)); });
    return () => controller.abort();
  }, [token, attempt]);
  const providerId = options?.providers.find(provider => provider.id === selected)?.id ?? options?.providers[0]?.id;
  async function start() {
    if (busy || !providerId) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ redirect: string }>("/invitations/sso/start", { method: "POST", body: JSON.stringify({ token, providerId }) });
      window.location.assign(result.redirect);
    } catch (cause) { setError(errorText(cause)); setBusy(false); }
  }
  return <section aria-label="회사 SSO로 초대 수락" className="auth-recover-form">
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!options && !error && <p role="status">회사 로그인 방법을 확인하고 있습니다.</p>}
    {error && <button type="button" className="auth-text-button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>초대 로그인 방법 다시 확인</button>}
    {options && !options.providers.length && <p className="auth-note">이 초대에 사용할 수 있는 회사 SSO가 없습니다. 이메일로 로그인하거나 가입해주세요.</p>}
    {!!options?.providers.length && <>
      <label htmlFor="invitation-sso-provider">회사 SSO</label>
      <select id="invitation-sso-provider" value={providerId} disabled={busy} onChange={event => setSelected(event.target.value)}>
        {options.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} ({provider.protocol.toUpperCase()})</option>)}
      </select>
      <p className="auth-note">초대받은 이메일의 회사 계정으로 인증하면 초대를 수락합니다. 기존 이메일 계정이 있다면 위의 로그인 후 수락을 이용하고, 수락 후 내 SSO 연결 관리에서 연결해주세요.</p>
      <button type="button" className="auth-primary auth-block" disabled={busy || !providerId} onClick={() => void start()}>{busy ? "회사 로그인으로 이동 중…" : "회사 SSO로 초대 수락"}</button>
    </>}
  </section>;
}
