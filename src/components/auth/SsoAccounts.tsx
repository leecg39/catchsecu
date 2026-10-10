"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { OwnSsoAccounts } from "@/contracts/sso";
const login = "/login?returnTo=%2Flink%2Foauth2";
export function SsoAccounts() {
  const resource = useResource<OwnSsoAccounts>("/me/sso-accounts");
  const [selected, setSelected] = useState(""), [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reauth, setReauth] = useState(false), [done, setDone] = useState(false);
  async function unlink(id: string, updatedAt: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await api("/me/sso-accounts/" + id, { method: "DELETE", body: JSON.stringify({ updatedAt, confirm: true }) }); setDone(true); }
    catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 401) setReauth(true);
      else if (cause instanceof ApiError && [404, 409].includes(cause.status)) { setRemoving(null); resource.reload(); }
    } finally { setBusy(false); }
  }
  if (done) return <><p role="status" className="auth-note">회사 계정 연결을 해제하고 모든 기기의 로그인을 종료했습니다.</p><Link className="auth-primary auth-block" href={login}>다른 로그인 수단으로 다시 로그인</Link><Link className="auth-back" href="/login/oauth2">다른 회사 SSO로 로그인</Link></>;
  if (resource.error) return <><p role="alert" className="auth-error">{errorText(resource.error)}</p>
    {resource.error.status === 401 ? <Link href={login}>로그인 후 연결 관리</Link> : <button className="auth-text-button" onClick={resource.reload}>다시 불러오기</button>}
    <Link className="auth-back" href="/dashboard">회사 선택 화면으로 돌아가기</Link></>;
  if (!resource.data) return <p role="status">연결 계정을 확인하고 있습니다.</p>;
  const { providers, items, companyName, reauthenticate, loginPolicy } = resource.data;
  const available = providers.filter(p => p.available);
  const providerId = available.find(p => p.id === selected)?.id ?? available[0]?.id;
  return <><p className="auth-description">{companyName}의 내 SSO 연결 계정을 관리합니다.</p>
    {(reauthenticate || reauth) && <p className="auth-note">변경하려면 다시 로그인한 뒤 5분 안에 시도해주세요. <Link href={login}>이메일 로그인</Link> · <Link href="/login/oauth2">SSO 로그인</Link></p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {items.length ? <ul className="auth-sso-accounts">{items.map(item => <li key={item.id}>
      <strong>{providers.find(p => p.id === item.providerId)?.name ?? "회사 SSO"}</strong>
      <p className="auth-note">연결일: {new Date(item.createdAt).toLocaleDateString("ko-KR")}</p>
      {!item.canUnlink && (loginPolicy !== "NONE" ? <p className="auth-note">회사가 {loginPolicy === "GOOGLE" ? "Google" : "Microsoft"} 로그인을 제한하고 있어 연결을 해제할 수 없습니다.</p>
        : <p className="auth-note">마지막 로그인 수단입니다. 다른 SSO를 연결하거나 이메일 비밀번호를 설정한 뒤 해제해주세요. <Link href="/password-change-email">비밀번호 설정 메일 요청</Link></p>)}
      {removing === item.id ? <div>
        <p className="auth-note">연결을 해제하면 모든 기기의 로그인과 대기 중 인증이 종료됩니다. 다른 로그인 수단으로 다시 로그인해야 합니다.</p>
        <button type="button" className="auth-primary" disabled={busy} onClick={() => void unlink(item.id, item.updatedAt)}>{busy ? "해제 중…" : "연결 해제 확인"}</button>
        <button type="button" className="auth-text-button" disabled={busy} onClick={() => setRemoving(null)}>취소</button>
      </div> : <button type="button" className="auth-text-button" disabled={!item.canUnlink || reauthenticate || reauth || busy} onClick={() => { setRemoving(item.id); setError(""); }}>연결 해제</button>}
    </li>)}</ul> : <p className="auth-note">이 회사에 연결된 SSO 계정이 없습니다.</p>}
    {available.length ? <div className="auth-recover-form"><label htmlFor="sso-connect-provider">연결할 회사 SSO</label>
      <select id="sso-connect-provider" value={providerId} onChange={event => setSelected(event.target.value)} disabled={busy}>
        {available.map(p => <option key={p.id} value={p.id}>{p.name} ({p.protocol.toUpperCase()})</option>)}
      </select>
      {!reauthenticate && !reauth && !busy && <a className="auth-primary auth-block" href={`/api/v1/auth/sso/${providerId}?mode=link`}>회사 계정 연결 시작</a>}
    </div> : <p className="auth-note">사용 가능한 SSO가 없습니다. 회사 관리자에게 설정을 요청해주세요.</p>}
    <Link className="auth-back" href="/dashboard">대시보드로 돌아가기</Link></>;
}
