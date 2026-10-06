"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ssoFailure, ssoLoginPath } from "@/lib/sso-recovery";

export function SsoRecovery({ code }: { code: string | null }) {
  const failure = ssoFailure(code);
  if (!failure) return null;
  return <section aria-label="회사 로그인 안내">
    <p role="alert" className="auth-error">{failure.message}</p>
    <p className="auth-note">{failure.help}</p>
    {failure.action === "login" && <Link className="auth-back" href="/login?returnTo=%2Flink%2Foauth2">이메일 로그인 후 연결 관리</Link>}
    {failure.action === "restart" && <Link className="auth-back" href="/login/oauth2">회사 SSO 로그인 다시 시작</Link>}
  </section>;
}

export function SsoStartForm() {
  const [value, setValue] = useState(""), [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = ssoLoginPath(value, window.location.origin);
    if (!path) { setError("현재 사이트의 회사 SSO 로그인 주소 또는 연결 ID를 입력해주세요. 초대·계정 연결은 받은 원래 주소에서 시작해주세요."); return; }
    window.location.assign(path);
  }
  return <><p className="auth-description">회사 관리자가 제공한 SSO 로그인 주소 또는 연결 ID를 입력해주세요.</p>
    <form className="auth-recover-form" onSubmit={submit}>
      <label htmlFor="company-sso-address">회사 SSO 로그인 주소</label>
      <input id="company-sso-address" name="ssoAddress" type="text" required maxLength={2048} autoComplete="off"
        value={value} onChange={event => { setValue(event.target.value); setError(""); }} placeholder="회사 SSO 주소 또는 연결 ID" />
      {error && <p role="alert" className="auth-error">{error}</p>}
      <button className="auth-primary auth-block">회사 계정으로 로그인</button>
    </form><Link className="auth-back" href="/login">이메일 로그인으로 돌아가기</Link></>;
}
